import { test as base, chromium, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const rootDir = path.dirname(testsDir)

// 既定は src/ をそのまま読み込む。
// EXTENSION_PATH を指定すると別ディレクトリ（例: npm run package で作った zip の展開先）を
// 対象にできる。配布物そのものを検証したいときに使う。
export const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(rootDir, 'src')

/** context から MV3 の Service Worker を取り出す（起動直後はまだ現れないことがある） */
const resolveServiceWorker = async (context) => {
  const [existing] = context.serviceWorkers()
  return existing ?? await context.waitForEvent('serviceworker')
}

/** http(s) の URL か（chrome-extension:// / chrome:// / data: は外部への要求ではない） */
const isWebUrl = (url) => /^https?:\/\//.test(url)

/** 遷移に失敗したタブの URL（差し替えずに出ていこうとして落ちた跡） */
const isErrorPageUrl = (url) => url.startsWith('chrome-error://')

/**
 * 初回インストールで開くオプションページ（SPEC-SW-04）が開き終わるのを待つ。
 *
 * プロファイルは毎回新しいので、起動するたびに拡張がインストールされ、オプションページが開く。
 * **開く先は「空のタブがあればそれを上書き」**で、起動の 100ms ほど後に開く（2026-10-12 実測）。
 * それより先にテストが空のタブ（`page` fixture など）を作ると、**そのタブがオプションページに遷移させられる**
 * （実測: `page.goto` が options.html への遷移で中断された）。開かないまま 5 秒経ったら待つのをやめる
 * @param {import('@playwright/test').BrowserContext} context
 */
const waitForInstallPageAsync = async (context) => {
  const deadline = Date.now() + 5000
  while (!context.pages().some((page) => page.url().endsWith('/options.html')) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * 拡張機能を読み込んだ永続コンテキストを提供する fixture。
 * Chrome 拡張はヘッドレスでも `channel: 'chromium'` (new headless) なら動作する。
 *
 * **名前解決をすべて失敗させる**（`--host-resolver-rules`）。テストは実サイトへ出ていかない前提
 * （外部リクエストゼロの方針。NFR-03 / CON-10）で、差し替え（`context.route`）は名前解決より前に応えるので影響しない。
 * 差し替えをすり抜けた要求があっても、外へは出られずに失敗する。
 * Service Worker の `chrome.tabs.create` で開いたタブの最初の遷移は、`context.route` にも
 * `request` イベントにも現れずに出ていく（2026-10-12 実測。スパイク中に楽天証券へ実際に1回出た）ので、その備え。
 * あわせてプロキシを使わせない（`--no-proxy-server`）。OS 側でプロキシが設定されていると、
 * 名前解決がプロキシ側で行われ、ここでの塞ぎをすり抜けうるため
 */
export const test = base.extend({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--no-proxy-server'
      ]
    })
    await waitForInstallPageAsync(context)
    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    await use(await resolveServiceWorker(context))
  },

  extensionId: async ({ context }, use) => {
    const serviceWorker = await resolveServiceWorker(context)
    await use(new URL(serviceWorker.url()).host)
  },

  /** 差し替え（routeHtml / serveFixture）で応えた要求の URL。externalRequests が照合に使う */
  routedUrls: async ({}, use) => {
    await use(new Set())
  },

  // URL への要求に、実サイトの代わりに HTML を返す（遷移はしない）。
  // リンクの遷移先など、ページから開かれるタブを差し替えるのに使う
  routeHtml: async ({ context, routedUrls }, use) => {
    await use(async (url, html) => {
      await context.route(url, (route) => {
        routedUrls.add(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: html
        })
      })
    })
  },

  // 対象サイトのオリジンでフィクスチャ HTML を返す。
  // content_scripts の `matches` は実オリジンでしか発火しないため、
  // ローカルファイルではなくネットワーク差し替えで再現する。
  serveFixture: async ({ routeHtml }, use) => {
    await use(async (page, url, html) => {
      await routeHtml(url, html)
      await page.goto(url)
    })
  },

  /**
   * 差し替えずに実サイトへ出ていこうとした要求・遷移を検査する（外部リクエストゼロの方針。NFR-03 / CON-10）。
   * **この fixture を受け取ったテストは、終わったときに検査される**（テスト本体に検査を書かない）。
   *
   * 次のどれかが1件でもあれば落とす。`routeHtml` / `serveFixture` で応えた URL は数えない
   * - http(s) の要求（`request` イベント）。差し替えの無いものは実サイトへ出さずに落とす
   *   （この fixture が最初に登録するので優先度は最低）
   * - タブの遷移先（ページができたときの URL と、メインフレームの遷移）が http(s) か、エラーページ
   *
   * **遷移先も見るのは、`request` イベントだけでは見逃すから。** Service Worker の `chrome.tabs.create` で
   * 開いたタブの最初の遷移は、`context.route` にも `request` イベントにも現れない（2026-10-12 実測。
   * ページができた時点で遷移が済んでいる）。実サイトなら成功してそのまま終わるので、残るのはタブの URL だけになる。
   * `context` fixture が名前解決を塞いでいるので、ここではエラーページとして見える。
   * **拡張がタブを開きうるテストでは、これとは別に Service Worker の `chrome.tabs.create` を差し替えること**
   */
  externalRequests: async ({ context, routedUrls }, use) => {
    const seen = []
    const record = (url) => {
      if (isWebUrl(url) || isErrorPageUrl(url)) {
        seen.push(url)
      }
    }
    const onRequest = (request) => record(request.url())
    const watchPage = (page) => {
      record(page.url())
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          record(frame.url())
        }
      })
    }

    context.on('request', onRequest)
    context.on('page', watchPage)
    context.pages().forEach(watchPage)
    await context.route((url) => isWebUrl(url.href), (route) => route.abort())

    await use(seen)

    context.off('request', onRequest)
    context.off('page', watchPage)
    const unrouted = [...new Set(seen)].filter((url) => !routedUrls.has(url))
    expect(unrouted, '差し替えずに出ていこうとした要求・遷移').toEqual([])
  },

  /**
   * 拡張機能を再読み込みし、それ以前に開いていたタブを切断状態にする（SPEC-CS-19 / NFR-14）。
   * 呼ぶと**新しい Service Worker** を返す。`serviceWorker` fixture は古い（止まった）ものを指したままになるので、
   * 再読み込みの後に Service Worker を触るときは、戻り値を使う
   *
   * 手順は `chrome://extensions` の `chrome.developerPrivate`（2026-10-12 実測）。
   * - **開発者モードを有効にしないと、再読み込みした拡張が戻ってこない**（新しい Service Worker が立たない）
   * - 古いタブの Content Script は、再読み込みの直後（+0ms）から `isExtensionAlive()` が偽になり、
   *   `chrome.runtime` はオブジェクトごと `undefined` になる
   *
   * 開発者モードはこの fixture を受け取った時点で有効にしておく。
   * 起動直後の窓を狙うテスト（G-5）で、再読み込みを遅らせないため
   */
  reloadExtension: async ({ context, extensionId }, use) => {
    const extensionsPage = await context.newPage()
    await extensionsPage.goto('chrome://extensions')
    await extensionsPage.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }))

    await use(async () => {
      const [worker] = await Promise.all([
        context.waitForEvent('serviceworker'),
        extensionsPage.evaluate((id) =>
          chrome.developerPrivate.reload(id, { failQuietly: true }), extensionId)
      ])
      return worker
    })
  }
})

export { expect } from '@playwright/test'

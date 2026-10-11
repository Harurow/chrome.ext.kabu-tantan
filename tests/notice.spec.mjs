import { test, expect } from './fixtures/extension.mjs'
import { STALE_KEY } from './fixtures/storage.mjs'

// SPEC-NT: 右クリックメニューの項目を押しても開けないときの小窓（FR-29）。
// Chrome の右クリックメニューそのものは Playwright から押せないので、押された後の処理
// （onContextMenuClickedAsync。SPEC-SW-05）を Service Worker で直接呼び、開いた小窓を page イベントで受け取る。
// 想定外の引数を試すときだけ notice.html に直接遷移する

/** 例に使う遷移先。url3 を持たない */
const NO_US_KEY = 'shikiho.toyokeizai.net/stocks'

/**
 * 実際の経路で小窓を開く（SPEC-NT-06 の前処理）。
 * 設定を変えるときは、ハンドラを呼ぶ前に storage へ書く（小窓のページは開いたときに読む）
 * @param {{ context: import('@playwright/test').BrowserContext, serviceWorker: import('@playwright/test').Worker }} fixtures
 * @param {{ menuItemId: string, selectionText: string }} info onClicked の第1引数
 * @param {{ [key: string]: number }} [enableLinkKeys]
 * @returns {Promise<import('@playwright/test').Page>}
 */
const openNoticeAsync = async ({ context, serviceWorker }, info, enableLinkKeys) => {
  if (enableLinkKeys) {
    await serviceWorker.evaluate((value) => chrome.storage.sync.set({ enableLinkKeys: value }), enableLinkKeys)
  }
  const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/notice.html') })
  await serviceWorker.evaluate((clicked) => onContextMenuClickedAsync(clicked, undefined), info)
  const page = await opened
  await page.waitForLoadState('domcontentloaded')
  return page
}

/**
 * textContent が期待と完全一致するまで待つ。toHaveText は空白を正規化して比べるので使わない。
 * #notice-detail は storage を読んでから入るので、待たずに読むと空になりうる
 */
const expectExactTextAsync = (locator, expected, message) =>
  expect.poll(() => locator.textContent(), { message }).toBe(expected)

/** 遷移先の名前は Service Worker の externalUrlsMap から実行時に引く（直書きしない） */
const titleOfAsync = (serviceWorker, key) =>
  serviceWorker.evaluate((k) => externalUrlsMap[k].title, key)

/** 開いている小窓（SPEC-SW-10 の手順 2 と同じ判定）の数 */
const countNoticeWindowsAsync = (serviceWorker) =>
  serviceWorker.evaluate(async () => {
    const noticeBase = chrome.runtime.getURL('notice.html')
    const popups = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })
    return popups
      .filter((popup) => (popup.tabs ?? [])
        .some((t) => (t.pendingUrl ?? t.url ?? '').startsWith(noticeBase)))
      .length
  })

test.describe('小窓のページ', () => {
  test('米国株のページが無い遷移先では、遷移先の名前と銘柄を出す', async ({ context, serviceWorker }) => {
    const title = await titleOfAsync(serviceWorker, NO_US_KEY)
    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: NO_US_KEY, selectionText: 'AAPL' })

    await expectExactTextAsync(page.locator('#notice-message'), `「${title}」には米国株のページがないため、AAPL を開けません。`)
  })

  test('米国株のページがある有効な遷移先を、設定の順に並べる', async ({ context, serviceWorker }) => {
    const moomoo = await titleOfAsync(serviceWorker, 'moomoo.com/')
    const kabutan = await titleOfAsync(serviceWorker, 'kabutan.jp/stock')
    const page = await openNoticeAsync({ context, serviceWorker },
      { menuItemId: NO_US_KEY, selectionText: 'AAPL' },
      { 'moomoo.com/': 0, [NO_US_KEY]: 1, 'kabutan.jp/stock': 2 })

    // url3 を持たないもの（四季報）と無効なものを含まず、設定の順（定義順なら株探が先）
    await expectExactTextAsync(page.locator('#notice-detail'), `米国株のページがある遷移先: ${moomoo}、${kabutan}`)
  })

  test('米国株のページがある遷移先が有効な中に無ければ、その旨を出す', async ({ context, serviceWorker }) => {
    const page = await openNoticeAsync({ context, serviceWorker },
      { menuItemId: NO_US_KEY, selectionText: 'AAPL' },
      { [NO_US_KEY]: 0 })

    await expectExactTextAsync(page.locator('#notice-detail'), '米国株のページがある遷移先は、いま有効な遷移先の中にありません。')
  })

  // FR-29 判定基準4（2026-10-11 利用者回答 (a)）: 知らせるが、選択した文字列は小窓に出さない
  test('銘柄コードと読み取れない文字列では、選択した文字列を出さない', async ({ context, serviceWorker }) => {
    const page = await openNoticeAsync({ context, serviceWorker },
      { menuItemId: 'kabutan.jp/stock', selectionText: 'こんにちは' })

    await expectExactTextAsync(page.locator('#notice-message'), '選択した文字列を銘柄コードとして読み取れませんでした。')
    await expectExactTextAsync(page.locator('#notice-detail'), '4桁の銘柄コード（例: 7203）か、米国株のティッカー（例: AAPL）を選択してください。')
    expect(await page.evaluate(() => document.body.textContent)).not.toContain('こんにちは')
  })

  test('想定外の引数では、汎用の文言だけを出す', async ({ page, extensionId }) => {
    const queries = [
      // (i) 引数なし
      '',
      // (ii) 定義に無い遷移先
      `?reason=us-unsupported&key=${encodeURIComponent(STALE_KEY)}&code=AAPL`,
      // (iii) プロトタイプ由来の名前。Object.hasOwn が無いと「undefined」には… になる
      '?reason=us-unsupported&key=__proto__&code=AAPL',
      // (iv) 未知の理由
      '?reason=unknown'
    ]

    for (const query of queries) {
      await page.goto(`chrome-extension://${extensionId}/notice.html${query}`)
      await expectExactTextAsync(page.locator('#notice-message'), 'ページを開けませんでした。', query)
      await expect(page.locator('#notice-detail'), query).toHaveAttribute('hidden', '')
    }
  })

  test('引数の文字列を HTML として解釈しない', async ({ page, extensionId }) => {
    const injected = '<b id="ktt-injected">X</b>'
    await page.goto(`chrome-extension://${extensionId}/notice.html` +
      `?reason=us-unsupported&key=shikiho.toyokeizai.net%2Fstocks&code=${encodeURIComponent(injected)}`)

    await expect(page.locator('#notice-message')).toContainText(injected)
    await expect(page.locator('#ktt-injected')).toHaveCount(0)
  })

  test('閉じるボタンで小窓が閉じる', async ({ context, serviceWorker }) => {
    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: NO_US_KEY, selectionText: 'AAPL' })

    const closed = page.waitForEvent('close', { timeout: 3000 })
    await page.locator('#notice-close').click()
    await closed

    await expect.poll(() => countNoticeWindowsAsync(serviceWorker)).toBe(0)
  })

  test('Esc キーで小窓が閉じる', async ({ context, serviceWorker }) => {
    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: NO_US_KEY, selectionText: 'AAPL' })

    const closed = page.waitForEvent('close', { timeout: 3000 })
    // press は keydown と keyup を送る。keydown で小窓が閉じると keyup の送り先が無くなり、
    // press そのものが「Target page … has been closed」で落ちる（15回中9回）。閉じる処理が見る keydown だけを送る
    await page.keyboard.down('Escape')
    await closed

    await expect.poll(() => countNoticeWindowsAsync(serviceWorker)).toBe(0)
  })

  test('開いた直後は閉じるボタンにフォーカスがある', async ({ context, serviceWorker }) => {
    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: NO_US_KEY, selectionText: 'AAPL' })

    // autofocus は読み込み後に効くので、効くまで待つ
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('notice-close')
  })

  // セキュリティ/プライバシー回帰テスト（FR-29 判定基準7 / NFR-03）。オプションページと同じ観点
  test('外部ホストへ一切リクエストしない', async ({ context, serviceWorker, extensionId }) => {
    const requested = []
    context.on('request', (request) => requested.push(request.url()))

    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: NO_US_KEY, selectionText: 'AAPL' })
    await expect(page.locator('#notice-detail')).not.toBeEmpty()
    // CSS の @import 等の副リソースまで出し切らせる
    await page.waitForLoadState('load')

    const origin = `chrome-extension://${extensionId}/`
    expect(requested.filter((url) => !url.startsWith(origin))).toEqual([])
    // 前提: 小窓の要求を集め損ねていない（notice.html そのものは Playwright がつながる前に出るので数えない）
    expect(requested).toContain(`${origin}notice.css`)
    expect(requested).toContain(`${origin}notice.js`)
  })

  // 実際のウィンドウ（440×280）での見え方は Playwright では測れない（表示領域が 1280×720 に置き換わる）。
  // 枠とタイトルバーの分を控えめに差し引いた 424×220 で近似する（SPEC-NT-05）。実機は SPEC-SW-10 の M-1
  test('既定の設定で、文言が小窓の大きさに収まる', async ({ context, serviceWorker }) => {
    // url3 を持たない遷移先のうち title が最も長いもの。米国株を開ける遷移先は既定（全件有効）で最も多く並ぶ
    const { key, expectedDetail } = await serviceWorker.evaluate(() => ({
      key: externalUrls
        .filter((u) => !u.url3)
        .reduce((longest, u) => (u.title.length > longest.title.length ? u : longest))
        .key,
      expectedDetail: `米国株のページがある遷移先: ${externalUrls.filter((u) => u.url3).map((u) => u.title).join('、')}`
    }))
    const page = await openNoticeAsync({ context, serviceWorker }, { menuItemId: key, selectionText: 'AAPL' })
    // 前提: 一覧が最も長い状態で測る
    await expectExactTextAsync(page.locator('#notice-detail'), expectedDetail)

    await page.setViewportSize({ width: 424, height: 220 })

    const metrics = await page.evaluate(() => {
      const rect = document.getElementById('notice-close').getBoundingClientRect()
      return {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth,
        innerHeight,
        button: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      }
    })

    expect(metrics.innerWidth).toBe(424)
    expect(metrics.innerHeight).toBe(220)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight)
    expect(metrics.button.left).toBeGreaterThanOrEqual(0)
    expect(metrics.button.top).toBeGreaterThanOrEqual(0)
    expect(metrics.button.right).toBeLessThanOrEqual(metrics.innerWidth)
    expect(metrics.button.bottom).toBeLessThanOrEqual(metrics.innerHeight)
  })
})

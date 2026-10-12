/**
 * 切断状態（拡張機能の更新・再読み込みの後に残った古いタブ）の振る舞い（SPEC-CS-19 / NFR-14）。
 * 手動確認 G-1〜G-7 を自動化したもの。
 *
 * 再読み込みは `reloadExtension` fixture が `chrome://extensions` の `chrome.developerPrivate` で起こす。
 * 直後から古いタブの Content Script は `isExtensionAlive()` が偽になる（2026-10-12 実測）。
 * **切断状態では何もしないのが正しい**ので、見るのは NFR-14 の判定基準どおり次の3つ。
 *
 * 1. 例外が出ない（`collectErrors`。Content Script の例外も届く）
 * 2. 要素を一切足さない。**足してすぐ消す、も含む**（`recordAddedNodesAsync` を操作の前に仕込む）
 * 3. 正常時の挙動は変わらない。**各テストで、切断の前（または別のタブ）に同じ操作が効くことを対照として示す**。
 *    対照が無いと、操作そのものが効いていなくても緑になる
 *
 * **二重になっている門は、片方だけ外しても落ちない**（TradingView のオーバーレイ層の監視と `attachMenu()`、
 * スクリーナーの監視とデバウンス後）。両方を外すと落ちることを確かめてある。
 * 「株Link」ボタンの守りは三重（門、try/catch、クリック処理側の `.catch(() => {})`）で、
 * 門と try/catch の両方を外しても DOM も例外も出ないので落ちない。落とせる壊し方は G-2 の直前に書いた。
 *
 * 実サイトへの要求は `externalRequests` がファイル全体で検査する。
 * メニューを開くテストは Service Worker の `chrome.tabs.create` を差し替える（再読み込みの後は新しい Service Worker に）
 */
import { test, expect } from './fixtures/extension.mjs'
import {
  TRADINGVIEW_URL,
  CHART_CODE,
  CHART_MARK,
  OVERLAP_MARK,
  MENU_BOX_MARK,
  chartLabel,
  tradingViewPageHtml,
  overlapRootHtml,
  contextMenuHtml,
  insertToolbarAsync,
  setChartLabelAsync
} from './fixtures/tradingview.mjs'
import {
  recordAddedNodesAsync,
  addedNodesAsync,
  collectErrors,
  clickReceiverAsync,
  watchContentScriptAsync
} from './fixtures/probes.mjs'

// どのテストも、差し替えずに実サイトへ出ていった要求があれば落とす（検査は fixture の後始末で行う）
test.beforeEach(async ({ externalRequests }) => {})

/**
 * 「起きないこと」を見る前に置く時間。切断していなければ起きる変化が起き終わるまでに、余裕を持たせた値。
 * 足りていることは、門を外した版で各テストが落ちることで確かめてある
 * - 右クリック・canvas の属性変化: 監視のコールバック（マイクロタスク）と、行を取り除くまでの問い合わせ
 * - 「株Link」ボタン: Service Worker への問い合わせを待ってから背景を敷く
 * - スクリーナー: 監視のデバウンス（200ms）
 * - 再試行: 間隔（500ms）の3回分
 */
const SETTLE_MS = { mutation: 300, button: 500, debounce: 1000, retry: 1500 }

const BUTTON = 'div.ktt-tv-kabuLinkMenu'
const MENU_BACK = 'div.ktt-tv-menuBack'
const ROW = 'tr[data-kabu-tantan]'
const ROOT = 'span.x-kabu-root'

/** 銘柄が取れない canvas の値（実サイトでもスクリーナー等へ移るとこう変わる前提。手動確認 A-8 で見る） */
const NOT_A_SYMBOL = 'スクリーナー'

/**
 * Service Worker の `chrome.tabs.create` を差し替える（実サイトへ出ていかせないため）。
 * 再読み込みの後は、`reloadExtension()` が返した新しい Service Worker にかけ直す
 * @param {import('@playwright/test').Worker} worker
 */
const stubTabsCreateAsync = (worker) => worker.evaluate(() => {
  self.__openedUrls = []
  chrome.tabs.create = (props) => {
    self.__openedUrls.push(props.url)
    return Promise.resolve({})
  }
})

/**
 * TradingView のフィクスチャを開き、ボタンが出るのを待ってからオーバーレイ層を足す。
 * 層を後から足す理由は `tests/tradingview.spec.mjs` の `openChartPageAsync` と同じ
 */
const openChartAsync = async (page, serveFixture) => {
  await serveFixture(page, TRADINGVIEW_URL, tradingViewPageHtml())
  await expect(page.locator(BUTTON)).toHaveCount(1)
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), overlapRootHtml())
  // MutationObserver のコールバック（マイクロタスク）が走り切るのを待つ
  await page.waitForTimeout(50)
}

/** チャートの中心を右クリックする */
const rightClickChartAsync = async (page) => {
  const box = await page.locator(`[${CHART_MARK}]`).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
}

/** サイト側の役割: 右クリックの後、オーバーレイ層にメニューを出す（契約4） */
const showContextMenuAsync = (page) => page.evaluate(([mark, html]) => {
  document.querySelector(`[${mark}]`).insertAdjacentHTML('beforeend', html)
}, [OVERLAP_MARK, contextMenuHtml()])

/** サイト側の役割: メニューを閉じる */
const closeContextMenuAsync = (page) => page.evaluate((mark) => {
  document.querySelectorAll(`[${mark}]`).forEach((menu) => menu.remove())
}, MENU_BOX_MARK)

test.describe('切断状態: TradingView', () => {
  // G-1
  test('切断後にチャートを右クリックしても、拡張の行は一瞬も現れない（3回続けても同じ）',
    async ({ page, serveFixture, reloadExtension }) => {
      const errors = collectErrors(page)
      await openChartAsync(page, serveFixture)

      // 対照: 切断の前は、同じ操作で行が1つ足される
      await rightClickChartAsync(page)
      await showContextMenuAsync(page)
      await expect(page.locator(ROW)).toHaveCount(1)
      await closeContextMenuAsync(page)

      await reloadExtension()
      await recordAddedNodesAsync(page)

      for (let i = 0; i < 3; i++) {
        await rightClickChartAsync(page)
        await showContextMenuAsync(page)
        await page.waitForTimeout(SETTLE_MS.mutation)
        await expect(page.locator(ROW)).toHaveCount(0)
        await closeContextMenuAsync(page)
      }

      expect(await addedNodesAsync(page)).toEqual([])
      expect(errors).toEqual([])
    })

  // G-1 の変形。オーバーレイ層が、右クリックの後にメニューごと初めて作られる。
  // このとき通るのは `bodyObserverCallback()` から `attachMenu()` を直接呼ぶ経路で、
  // オーバーレイ層の監視の門を通らない（`attachMenu()` の門だけが止める）
  test('右クリックの後にオーバーレイ層ごとメニューが現れても、切断後は拡張の行が一瞬も現れない',
    async ({ page, context, serveFixture, reloadExtension }) => {
      // 層の監視は層が一度できると外れる（以降は作り直しを見ない）ので、対照は別のタブで行う
      const showMenuWithLayerAsync = (target) => target.evaluate(([html, mark, menu]) => {
        document.body.insertAdjacentHTML('beforeend', html)
        document.querySelector(`[${mark}]`).insertAdjacentHTML('beforeend', menu)
      }, [overlapRootHtml(), OVERLAP_MARK, contextMenuHtml()])

      // 対照: 切断していなければ、この経路でも行が1つ足される
      const alive = await context.newPage()
      await serveFixture(alive, TRADINGVIEW_URL, tradingViewPageHtml())
      await expect(alive.locator(BUTTON)).toHaveCount(1)
      await rightClickChartAsync(alive)
      await showMenuWithLayerAsync(alive)
      await expect(alive.locator(ROW)).toHaveCount(1)

      const errors = collectErrors(page)
      await serveFixture(page, TRADINGVIEW_URL, tradingViewPageHtml())
      await expect(page.locator(BUTTON)).toHaveCount(1)

      await reloadExtension()
      await recordAddedNodesAsync(page)

      await rightClickChartAsync(page)
      await showMenuWithLayerAsync(page)
      await page.waitForTimeout(SETTLE_MS.mutation)

      await expect(page.locator(ROW)).toHaveCount(0)
      expect(await addedNodesAsync(page)).toEqual([])
      expect(errors).toEqual([])
    })

  // G-2。守りは三重（門 isExtensionAlive、網 try/catch、クリック処理側の `.catch(() => {})`）。
  // 門と try/catch の両方を外しても DOM も例外も出ないので、このテストは落ちない。落ちるのは次の3つの壊し方:
  // - 背景を問い合わせより前に敷く（切断前の対照で、背景が2枚になって落ちる）
  // - 門を外し、失敗したときに背景を残す（切断後の背景0件の検査で落ちる。透明な全画面の層がページのクリックを吸う）
  // - 三重をすべて外す（例外の検査で落ちる）
  test('切断後に「株Link」ボタンを押しても、メニューも背景も出ず、ページのクリックがそのまま届く',
    async ({ page, serviceWorker, serveFixture, reloadExtension }) => {
      const errors = collectErrors(page)
      await stubTabsCreateAsync(serviceWorker)
      await openChartAsync(page, serveFixture)

      // 対照: 切断の前は、同じ操作でメニューが開く（キーを押すと閉じる。SPEC-CS-12）
      await page.locator(BUTTON).click()
      await expect(page.locator(MENU_BACK)).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(page.locator(MENU_BACK)).toHaveCount(0)

      await reloadExtension()
      await recordAddedNodesAsync(page)

      await page.locator(BUTTON).click()
      await page.waitForTimeout(SETTLE_MS.button)

      await expect(page.locator(MENU_BACK)).toHaveCount(0)
      expect(await addedNodesAsync(page)).toEqual([])
      expect(await clickReceiverAsync(page, page.locator(`[${CHART_MARK}] canvas`))).toBe('canvas')
      expect(errors).toEqual([])
    })

  // G-5。ボタンは読み込みの 500ms 後に足す（attach()）。その窓の中で切断されたら足さない（SPEC-CS-19「起動時の門」）。
  // 窓は CDP で Content Script の isolated world ができた瞬間を捕まえ、その直後に再読み込みして踏む
  test('起動直後（ボタンを足す前の 500ms）に切断されたら、ボタンを足さない',
    async ({ page, context, extensionId, routeHtml, reloadExtension }) => {
      const errors = collectErrors(page)
      await recordAddedNodesAsync(page, { fromStart: true })
      await routeHtml(TRADINGVIEW_URL, tradingViewPageHtml())
      const world = await watchContentScriptAsync(context, page, extensionId)

      await page.goto(TRADINGVIEW_URL, { waitUntil: 'commit' })
      await world.created
      // world ができた時点では、まだスクリプトが走り終えていないことがある
      await expect.poll(() => world.evaluate('typeof attach'), { intervals: [10] }).toBe('function')

      const probe = `({
        alive: isExtensionAlive(),
        buttons: document.querySelectorAll(${JSON.stringify(BUTTON)}).length
      })`
      const before = await world.evaluate(probe)
      await reloadExtension()
      const after = await world.evaluate(probe)

      // 窓を踏んだこと。Content Script は生きていたがボタンはまだ無く、切断した後もまだ無い。
      // 窓を外して生きているうちに attach() が走っていれば、ここでボタンが1つある
      expect(before).toEqual({ alive: true, buttons: 0 })
      expect(after).toEqual({ alive: false, buttons: 0 })

      // attach() が走り終えるまで待つ
      await page.waitForTimeout(SETTLE_MS.retry)
      await expect(page.locator(BUTTON)).toHaveCount(0)
      expect(await addedNodesAsync(page)).toEqual([])
      expect(errors).toEqual([])

      // タブを再読み込みすると、ボタンが出る
      await page.reload()
      await expect(page.locator(BUTTON)).toHaveCount(1)
    })

  // G-6 の TradingView 版。ツールバーが無いあいだボタンの設置を試し直す（SPEC-CS-22）。
  // その途中で切断されたら、再試行の tick の門で止める
  test('ツールバーが遅れて出るとき、再試行の途中で切断されたら、ボタンを足さず再試行も止める',
    async ({ page, context, extensionId, serveFixture, reloadExtension }) => {
      const errors = collectErrors(page)
      const world = await watchContentScriptAsync(context, page, extensionId, { countIntervals: true })
      await serveFixture(page, TRADINGVIEW_URL, tradingViewPageHtml({ toolbar: false }))
      await world.created

      // 再試行が回っている（初回はツールバーが無く空振りした）ところで切断する
      await expect.poll(() => world.activeIntervalsAsync()).toBe(1)
      await reloadExtension()
      await recordAddedNodesAsync(page)

      await insertToolbarAsync(page)
      await page.waitForTimeout(SETTLE_MS.retry)

      await expect(page.locator(BUTTON)).toHaveCount(0)
      expect(await world.activeIntervalsAsync()).toBe(0)
      expect(await addedNodesAsync(page)).toEqual([])
      expect(errors).toEqual([])
    })

  // G-7。canvas の監視は切断を見つけると外れるので、ボタンの表示は以後変わらない（SPEC-CS-19）。
  // **「残る」だけでは監視が外れた証拠にならない**（変化が起きなかっただけかもしれない）。
  // 切断していなければ同じ変化で隠れること（A-8）を、同じタブで先に示す
  test('切断後は、銘柄が取れなくなっても「株Link」ボタンの表示を切り替えない',
    async ({ page, serveFixture, reloadExtension }) => {
      const errors = collectErrors(page)
      await openChartAsync(page, serveFixture)
      const button = page.locator(BUTTON)
      const chartSymbol = chartLabel(`TSE:${CHART_CODE}`)

      // 対照（A-8）: 切断の前は、同じ変化で隠れ、戻すと出る
      await setChartLabelAsync(page, NOT_A_SYMBOL)
      await expect(button).toBeHidden()
      await setChartLabelAsync(page, chartSymbol)
      await expect(button).toBeVisible()

      await reloadExtension()
      await recordAddedNodesAsync(page)

      await setChartLabelAsync(page, NOT_A_SYMBOL)
      await page.waitForTimeout(SETTLE_MS.mutation)
      await expect(button).toBeVisible()
      expect(await addedNodesAsync(page)).toEqual([])
      expect(errors).toEqual([])

      // タブを再読み込みすると、チャートでボタンが出て、同じ変化で隠れる（正常時に戻る）
      await page.reload()
      await expect(button).toBeVisible()
      await setChartLabelAsync(page, NOT_A_SYMBOL)
      await expect(button).toBeHidden()
    })

  // G-4
  test('切断後にタブを再読み込みすると、ボタンと右クリックの行が戻る',
    async ({ page, serveFixture, reloadExtension }) => {
      await openChartAsync(page, serveFixture)

      const worker = await reloadExtension()
      await stubTabsCreateAsync(worker)
      await page.reload()
      await expect(page.locator(BUTTON)).toHaveCount(1)
      await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), overlapRootHtml())
      await page.waitForTimeout(50)

      await rightClickChartAsync(page)
      await showContextMenuAsync(page)
      await expect(page.locator(ROW)).toHaveCount(1)
      await closeContextMenuAsync(page)

      await page.locator(BUTTON).click()
      await expect(page.locator(`${MENU_BACK} tr[data-role="menuitem"]`)).not.toHaveCount(0)
    })
})

const page$ = (title, body) => `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head>
${body}
</html>`

/**
 * スクリーナー2種。検索の結果一覧が出たところから始める。
 * 構造は `tests/content-script.spec.mjs` のフィクスチャと同じで、ページ送りを演じるため `tbody` に id を振る
 */
const SCREENERS = [
  {
    title: '楽天スーパースクリーナー',
    url: 'https://hs.trkd-asia.com/rakutensecscr/index.html',
    rows: (codes) => codes
      .map((code) => `<tr class="datarow"><td><a href="#">${code}</a></td><td>x</td></tr>`).join(''),
    html (codes) {
      return page$('スーパースクリーナー', `<body>
  <div id="resultpanel"><div class="resulttablebox"><table>
    <tbody id="rows">${this.rows(codes)}</tbody>
  </table></div></div>
</body>`)
    }
  },
  {
    title: 'SBI銘柄スクリーニング',
    url: 'https://graph.sbisec.co.jp/sbiscreener/index.html',
    rows: (codes) => codes
      .map((code) => `<tr><td class="c fixedtable">${code}</td><td>x</td></tr>`).join(''),
    html (codes) {
      return page$('銘柄スクリーニング', `<body>
  <div id="root"><div class="App"><div class="Screener"><div class="resultpane"><div class="ResultListMainDiv">
    <table class="leftTable"><tbody id="rows">${this.rows(codes)}</tbody></table>
  </div></div></div></div></div>
</body>`)
    }
  }
]

/** サイト側の役割: ページ送り（行を足す / 行を入れ替える） */
const appendRowsAsync = (page, html) =>
  page.evaluate((rows) => document.getElementById('rows').insertAdjacentHTML('beforeend', rows), html)
const replaceRowsAsync = (page, html) =>
  page.evaluate((rows) => { document.getElementById('rows').innerHTML = rows }, html)

/** 差し替えたページの目印。実サイトへ出ていっていないことを題名で確かめる */
const STUB_TITLE = 'stub'
const STUB_HTML = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${STUB_TITLE}</title></head><body></body></html>`

test.describe('切断状態: スクリーナー', () => {
  for (const screener of SCREENERS) {
    // G-3。常設監視は切断を見つけると外れる（監視のコールバックとデバウンス後の二重の門。SPEC-CS-19）
    test(`${screener.title}: 切断後のページ送りで現れた行にはメニューを付けず、付いていたメニューは開ける`,
      async ({ page, context, serveFixture, routeHtml, reloadExtension }) => {
        const errors = collectErrors(page)
        await serveFixture(page, screener.url, screener.html(['7203', '9984']))
        await expect(page.locator(ROOT)).toHaveCount(2)

        // 対照: 切断の前は、ページ送りで足された行にもメニューが付く
        await appendRowsAsync(page, screener.rows(['4502']))
        await expect(page.locator(ROOT)).toHaveCount(3)

        await reloadExtension()
        await recordAddedNodesAsync(page)

        // ページ送りで行が足される
        await appendRowsAsync(page, screener.rows(['6758', '8306']))
        await page.waitForTimeout(SETTLE_MS.debounce)
        await expect(page.locator(ROOT)).toHaveCount(3)

        // 付いていたメニューは残り、ホバーで開いて、リンクから新しいタブが開く（拡張 API を使わない）
        const root = page.locator(ROOT).first()
        await root.hover()
        await expect(root.locator('ul.x-kabu-body')).toBeVisible()
        const link = root.locator('li.x-kabu-menu-item a').first()
        await routeHtml(await link.getAttribute('href'), STUB_HTML)
        const [opened] = await Promise.all([context.waitForEvent('page'), link.click()])
        await opened.waitForLoadState('domcontentloaded')
        expect(await opened.title()).toBe(STUB_TITLE)

        // ページ送りで行が入れ替わる
        await page.bringToFront()
        await replaceRowsAsync(page, screener.rows(['4063', '6098']))
        await page.waitForTimeout(SETTLE_MS.debounce)
        await expect(page.locator(ROOT)).toHaveCount(0)

        expect(await addedNodesAsync(page)).toEqual([])
        expect(errors).toEqual([])
      })

    // G-4
    test(`${screener.title}: 切断後にタブを再読み込みすると、注入とページ送りへの追随が戻る`,
      async ({ page, serveFixture, reloadExtension }) => {
        await serveFixture(page, screener.url, screener.html(['7203', '9984']))
        await expect(page.locator(ROOT)).toHaveCount(2)

        await reloadExtension()
        await page.reload()
        await expect(page.locator(ROOT)).toHaveCount(2)

        await appendRowsAsync(page, screener.rows(['6758']))
        await expect(page.locator(ROOT)).toHaveCount(3)
      })
  }
})

/**
 * 楽天証券・SBI証券の一覧。読み込みの時点では行が無く、後から現れる（表示を増やす操作の再現）。
 * 構造は `tests/content-script.spec.mjs` の「遅れて現れた」のフィクスチャと同じで、行を足すのはテストが行う
 */
const LATE_LISTS = [
  {
    title: '楽天証券のお気に入り',
    url: 'https://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do;BV_SessionID=TEST',
    html: page$('お気に入り', `<body>
  <form id="form">
    <table class="tbl-data-01"><tbody id="rows"></tbody></table>
  </form>
</body>`),
    rows: (codes) => codes
      .map((code) => `<tr><td class="align-C"><div class="mbody"><nobr>${code}</nobr></div></td></tr>`).join('')
  },
  {
    title: 'SBI証券のポートフォリオ',
    url: 'https://site1.sbisec.co.jp/ETGate/?_ControlID=WPLETpfR001Control',
    html: page$('ポートフォリオ', `<body>
  <div class="middleArea2"><div class="middleAreaM2">
    <table><tbody><tr><td>
      <table><tbody><tr><td>
        <table><tbody id="rows"></tbody></table>
      </td></tr></tbody></table>
    </td></tr></tbody></table>
  </div></div>
</body>`),
    rows: (codes) => codes
      .map((code) => `<tr><td class="mtext">銘柄</td><td class="mtext">${code}</td></tr>`).join('')
  }
]

test.describe('切断状態: 楽天証券・SBI証券', () => {
  for (const list of LATE_LISTS) {
    // G-6。設定を起動時に読んでキャッシュするので、切断後も拡張 API に触れずに注入できてしまう。
    // 再試行の tick の門が止める（FR-13 判定基準4 / NFR-14 判定基準2）
    test(`${list.title}: 再試行の途中で切断されたら、そのあと現れた行にメニューを付けず再試行も止める`,
      async ({ page, context, extensionId, serveFixture, reloadExtension }) => {
        const errors = collectErrors(page)
        const world = await watchContentScriptAsync(context, page, extensionId, { countIntervals: true })
        await serveFixture(page, list.url, list.html)
        await world.created

        // 再試行が回っている（行がまだ無いので静止しない）ところで切断する
        await expect.poll(() => world.activeIntervalsAsync()).toBe(1)
        await reloadExtension()
        await recordAddedNodesAsync(page)

        await appendRowsAsync(page, list.rows(['7203', '9984']))
        await page.waitForTimeout(SETTLE_MS.retry)

        await expect(page.locator(ROOT)).toHaveCount(0)
        expect(await world.activeIntervalsAsync()).toBe(0)
        expect(await addedNodesAsync(page)).toEqual([])
        expect(errors).toEqual([])

        // タブを再読み込みすると、後から現れた行にも付く（正常時に戻る）
        await page.reload()
        await appendRowsAsync(page, list.rows(['7203', '9984']))
        await expect(page.locator(ROOT)).toHaveCount(2)
      })
  }
})

import { test, expect } from './fixtures/extension.mjs'
import { evaluateScripts } from '../scripts/selector-check/load-selectors.mjs'

/**
 * 対象サイトの DOM 構造を最小限だけ再現したフィクスチャ。
 * セレクタは src/*-cs.js の menuSelectors と対応しているため、
 * サイト側の構造変更でセレクタが陳腐化した場合はここも合わせて更新する。
 */
const page$ = (title, body) => `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head>
${body}
</html>`

// rakuten-cs.js: menuSelectors「お気に入り」
const RAKUTEN_FAVORITES_URL = 'https://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do;BV_SessionID=TEST'
const RAKUTEN_FAVORITES_HTML = page$('お気に入り', `<body>
  <form id="form">
    <table class="tbl-data-01">
      <tbody>
        <tr><td class="align-C"><div class="mbody"><nobr>7203</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>9984</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>135A</nobr></div></td></tr>
      </tbody>
    </table>
  </form>
</body>`)

// sbi-cs.js: menuSelectors「ポートフォリオ」
const SBI_PORTFOLIO_URL = 'https://site1.sbisec.co.jp/ETGate/?_ControlID=WPLETpfR001Control'
const SBI_PORTFOLIO_HTML = page$('ポートフォリオ', `<body>
  <div class="middleArea2"><div class="middleAreaM2">
    <table><tbody><tr><td>
      <table><tbody><tr><td>
        <table><tbody>
          <tr><td class="mtext">トヨタ自動車</td><td class="mtext">7203</td></tr>
          <tr><td class="mtext">ソフトバンクG</td><td class="mtext">9984</td></tr>
        </tbody></table>
      </td></tr></tbody></table>
    </td></tr></tbody></table>
  </div></div>
</body>`)

// 遅延描画の再現（SPEC-CS-22 / FR-13 判定基準1）。
// Content Script の固定待機（500ms）が明けた時点では行が存在せず、
// 1500ms 後に現れる。再試行が無いと、この状態は二度と注入されない。
const LATE_ROWS_MS = 1500

// rakuten-cs.js: 「お気に入り」の行が遅れて現れる
const RAKUTEN_FAVORITES_LATE_HTML = page$('お気に入り', `<body>
  <form id="form">
    <table class="tbl-data-01"><tbody id="rows"></tbody></table>
  </form>
  <script>
    setTimeout(() => {
      document.getElementById('rows').innerHTML = ['7203', '9984', '135A']
        .map((code) => '<tr><td class="align-C"><div class="mbody"><nobr>' + code + '</nobr></div></td></tr>')
        .join('')
    }, ${LATE_ROWS_MS})
  </script>
</body>`)

// sbi-cs.js: 「ポートフォリオ」の行が遅れて現れる
const SBI_PORTFOLIO_LATE_HTML = page$('ポートフォリオ', `<body>
  <div class="middleArea2"><div class="middleAreaM2">
    <table><tbody><tr><td>
      <table><tbody><tr><td>
        <table><tbody id="rows"></tbody></table>
      </td></tr></tbody></table>
    </td></tr></tbody></table>
  </div></div>
  <script>
    setTimeout(() => {
      document.getElementById('rows').innerHTML = [['トヨタ自動車', '7203'], ['ソフトバンクG', '9984']]
        .map(([name, code]) =>
          '<tr><td class="mtext">' + name + '</td><td class="mtext">' + code + '</td></tr>')
        .join('')
    }, ${LATE_ROWS_MS})
  </script>
</body>`)

// rakuten-scr-cs.js: 検索を実行するまで結果一覧の器（div#resultpanel）が存在しない。
// 常設監視の対象が器そのものだった 1.12.2 までは、この状態で監視すら張られず
// 以降どれだけ検索・ページ送りしても注入されなかった（SPEC-CS-08 / SPEC-CS-22）
const RAKUTEN_SCR_URL = 'https://hs.trkd-asia.com/rakutensecscr/index.html'
const RAKUTEN_SCR_LATE_HTML = page$('スーパースクリーナー', `<body>
  <div id="app"></div>
  <script>
    setTimeout(() => {
      document.getElementById('app').innerHTML =
        '<div id="resultpanel"><div class="resulttablebox"><table><tbody>' +
        ['7203', '9984'].map((code) =>
          '<tr class="datarow"><td><a href="#">' + code + '</a></td><td>x</td></tr>').join('') +
        '</tbody></table></div></div>'
    }, ${LATE_ROWS_MS})
  </script>
</body>`)

// sbi-scr-cs.js: 同上（SPEC-CS-10）。実測で 2 日連続の「注入 0 件」を出していた経路。
// 固定待機が 1500ms なので、待機が明けた後に器が現れる値にしてある
const SBI_SCR_URL = 'https://graph.sbisec.co.jp/sbiscreener/index.html'
const LATE_PANEL_MS = 2500
const SBI_SCR_LATE_HTML = page$('銘柄スクリーニング', `<body>
  <div id="root"><div class="App"><div class="Screener"></div></div></div>
  <script>
    setTimeout(() => {
      document.querySelector('div#root div.App div.Screener').innerHTML =
        '<div class="resultpane"><div class="ResultListMainDiv">' +
        '<table class="leftTable"><tbody>' +
        ['7203', '9984'].map((code) =>
          '<tr><td class="c fixedtable">' + code + '</td><td>x</td></tr>').join('') +
        '</tbody></table></div></div>'
    }, ${LATE_PANEL_MS})
  </script>
</body>`)

test.describe('楽天証券 Content Script', () => {
  test('お気に入りの銘柄コードにリンクメニューを注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    const roots = page.locator('span.x-kabu-root')
    await expect(roots).toHaveCount(3)

    // 元のテキスト（銘柄コード）は保持される
    await expect(roots.nth(0)).toContainText('7203')
    await expect(roots.nth(2)).toContainText('135A')
  })

  test('メニュー項目が銘柄コード入りの外部リンクになっている', async ({ page, serveFixture, serviceWorker }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    const first = page.locator('span.x-kabu-root').first()
    await expect(first.locator('ul.x-kabu-body')).toHaveCount(1)

    const expected = await serviceWorker.evaluate(() =>
      externalUrls.map((u) => ({ title: u.title, url: makeUrl(u.url1, '7203') })))

    const actual = await first.locator('ul.x-kabu-body li.x-kabu-menu-item a').evaluateAll(
      (as) => as.map((a) => ({
        title: a.getAttribute('title'),
        url: a.getAttribute('href'),
        rel: a.getAttribute('rel'),
        target: a.getAttribute('target')
      })))

    expect(actual.map(({ title, url }) => ({ title, url }))).toEqual(expected)
    for (const a of actual) {
      expect(a.target).toBe('_blank')
      expect(a.rel).toBe('noopener noreferrer')
    }
  })

  test('ホバーでメニューが開く', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    const root = page.locator('span.x-kabu-root').first()
    const menu = root.locator('ul.x-kabu-body')

    await expect(menu).toBeHidden()
    await root.hover()
    await expect(menu).toBeVisible()
  })

  // SPEC-CS-22: 固定待機が明けた後に現れた行にも注入する
  test('遅れて現れた銘柄コードにもメニューを注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_LATE_HTML)

    // 待機（500ms）が明けた時点ではまだ 0 件
    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)

    // 再試行で拾われる（1500ms で行が現れ、次の tick で注入される）
    await expect(page.locator('span.x-kabu-root')).toHaveCount(3, { timeout: 10000 })
    await expect(page.locator('span.x-kabu-root').nth(2)).toContainText('135A')
  })

  // SPEC-CS-22 / FR-13 判定基準3: 繰り返しパスを走らせても 2 度目の注入が起きない
  test('同じ銘柄コードに二重注入しない', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_LATE_HTML)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(3, { timeout: 10000 })

    // 再試行の 2 tick 分（500ms × 2）待っても増えない
    await page.waitForTimeout(1200)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(3)
    await expect(page.locator('ul.x-kabu-body')).toHaveCount(3)
  })

  test('対象外のページにはメニューを注入しない', async ({ page, serveFixture }) => {
    const url = 'https://member.rakuten-sec.co.jp/app/some_other_page.do;BV_SessionID=TEST'
    await serveFixture(page, url, RAKUTEN_FAVORITES_HTML)

    await page.waitForTimeout(1000)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)
  })
})

test.describe('SBI証券 Content Script', () => {
  test('ポートフォリオの銘柄コードにリンクメニューを注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, SBI_PORTFOLIO_URL, SBI_PORTFOLIO_HTML)

    const roots = page.locator('span.x-kabu-root')
    await expect(roots).toHaveCount(2)
    await expect(roots.nth(0)).toContainText('7203')
    await expect(roots.nth(1)).toContainText('9984')
  })

  // SPEC-CS-22: 固定待機が明けた後に現れた行にも注入する
  test('遅れて現れた銘柄コードにもメニューを注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, SBI_PORTFOLIO_URL, SBI_PORTFOLIO_LATE_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(2, { timeout: 10000 })
    await expect(page.locator('span.x-kabu-root').nth(1)).toContainText('9984')
  })

  test('銘柄コードごとに異なる URL が生成される', async ({ page, serveFixture }) => {
    await serveFixture(page, SBI_PORTFOLIO_URL, SBI_PORTFOLIO_HTML)

    // evaluateAll は自動待機しないため、注入完了を先に待つ
    await expect(page.locator('span.x-kabu-root')).toHaveCount(2)

    const hrefs = await page.locator('span.x-kabu-root').evaluateAll((roots) =>
      roots.map((root) => root.querySelector('a[href*="kabutan.jp"]')?.getAttribute('href')))

    expect(hrefs).toEqual([
      'https://kabutan.jp/stock/?code=7203',
      'https://kabutan.jp/stock/?code=9984'
    ])
  })
})

test.describe('スクリーナー Content Script', () => {
  // SPEC-CS-22 / SPEC-CS-08: 常設監視を document.body に上げたので、
  // 器（結果一覧）が固定待機の後に現れても追随できる
  test('楽天スーパースクリーナー: 後から現れた結果一覧に注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_SCR_URL, RAKUTEN_SCR_LATE_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(2, { timeout: 10000 })

    // 注入したメニュー項目の <a> も検出用セレクタにヒットするが、
    // span.x-kabu-root の内側なので二重注入しない（SPEC-CS-22 判定基準3）
    await page.waitForTimeout(1200)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(2)
  })

  // SPEC-CS-22 / SPEC-CS-10: 実測で「ヒット 50 / 注入 0」を出していた経路の回帰テスト
  test('SBI銘柄スクリーニング: 後から現れた結果一覧に注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, SBI_SCR_URL, SBI_SCR_LATE_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(2, { timeout: 10000 })
    await expect(page.locator('span.x-kabu-root').nth(0)).toContainText('7203')
  })
})

test.describe('設定の反映', () => {
  test('オプションで無効にしたサイトはメニューに出ない', async ({ page, context, extensionId, serveFixture }) => {
    // 株探と MINKABU だけを有効にする
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.evaluate(() => chrome.storage.sync.set({
      enableLinkKeys: { 'kabutan.jp/stock': 0, 'minkabu.jp/stock': 1 }
    }))
    await options.close()

    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    const items = page.locator('span.x-kabu-root').first().locator('li.x-kabu-menu-item a')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveAttribute('href', 'https://kabutan.jp/stock/?code=7203')
    await expect(items.nth(1)).toHaveAttribute('href', 'https://minkabu.jp/stock/7203')
  })
})

/**
 * SPEC-CS-25（2-d。FR-25）: 楽天証券・SBI証券のメニュー項目は、行のどこを押しても
 * 文字の上を押したときと同じ結果になる。
 *
 * 実装は `src/style.css` の `li.x-kabu-menu-item > a { display: block }` の1規則だけで、
 * 項目を組み立てる `linkMenu.js` と `style.css` は楽天・SBI の4本すべてに同じ組で注入される
 * （`manifest.json` の `content_scripts`）。よって楽天のフィクスチャで固定すれば
 * SBI 側も同じ規則で動く。TradingView 側（2-a / 2-b / 2-c）は自動化しない（CON-08）。
 */
test.describe('メニュー項目のクリック範囲', () => {
  /** 先頭の銘柄コードのメニューをホバーで開く */
  const openFirstMenuAsync = async (page) => {
    const root = page.locator('span.x-kabu-root').first()
    await root.hover()

    const menu = root.locator('ul.x-kabu-body')
    await expect(menu).toBeVisible()
    return menu
  }

  /**
   * 各項目について、`<a>` の箱（＝押せる範囲）と、その中の文字の右端を測る。
   * 文字の外を押すための座標を、タイトルの長さに依存せず決めるために使う
   */
  const measureItemsAsync = (menu) =>
    menu.locator('li.x-kabu-menu-item > a').evaluateAll((anchors) =>
      anchors.map((a) => {
        const box = a.getBoundingClientRect()
        // 文字そのものの矩形（<a> の箱ではなく中身のテキスト）
        const range = document.createRange()
        range.selectNodeContents(a)
        const text = range.getBoundingClientRect()

        return {
          href: a.href,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          textRight: text.right
        }
      }))

  /** 文字の外がいちばん広い項目を選ぶ（タイトルの長さは設定で変わるため実測で決める） */
  const widestPaddingOf = (items) =>
    items.reduce((widest, current) =>
      current.right - current.textRight > widest.right - widest.textRight ? current : widest)

  /** 差し替えたページの目印。実サイトへ出ていっていないことを題名で確かめる */
  const STUB_TITLE = 'stub'

  /** 新しいタブが実サイトへ出ていかないよう、その URL だけを差し替える */
  const stubTargetAsync = (context, url) =>
    context.route(url, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${STUB_TITLE}</title></head><body></body></html>`
    }))

  /**
   * 新しいタブが開くのを待ち、**差し替えたページであること**まで確かめる。
   * 差し替えの一致が外れると `npm test` が実サイトへリクエストを出すため、
   * URL だけでなく中身で見る（外部リクエストゼロの方針。`tests/options.spec.mjs` と同じ）
   */
  const waitForStubPageAsync = async (context, clickAsync) => {
    const [opened] = await Promise.all([context.waitForEvent('page'), clickAsync()])
    await opened.waitForLoadState('domcontentloaded')
    expect(await opened.title()).toBe(STUB_TITLE)
    return opened
  }

  // 判定基準1 / 2-d: 文字の外（右側の余白）でも、文字の上と同じ URL へ行く
  test('項目の文字の外を押しても、文字の上と同じ URL が開く', async ({ page, context, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)
    const menu = await openFirstMenuAsync(page)

    const item = widestPaddingOf(await measureItemsAsync(menu))

    // 余白が無いと「文字の外を押す」自体が成立しない（規則が効いていない場合もここで落ちる）。
    // 既定で有効なサイトはタイトルの幅が揃っていないので、いちばん短い項目には必ず余白が出る。
    // 幅が揃う日が来ても黙って通ることはなく、この行で落ちる
    expect(item.right - item.textRight).toBeGreaterThan(4)

    await stubTargetAsync(context, item.href)
    const y = (item.top + item.bottom) / 2

    // 文字の上
    const onText = await waitForStubPageAsync(context, () => page.mouse.click(item.left + 2, y))

    // 文字の外（文字の右端と <a> の右端の中間）
    await page.bringToFront()
    await openFirstMenuAsync(page)
    const besideText = await waitForStubPageAsync(context,
      () => page.mouse.click((item.textRight + item.right) / 2, y))

    expect(besideText.url()).toBe(onText.url())
    expect(besideText.url()).toBe(item.href)
  })

  // 判定基準6: 項目間の隙間（<li> の margin）は押せないまま
  test('項目と項目のあいだを押しても何も開かない', async ({ page, context, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)
    const menu = await openFirstMenuAsync(page)

    const [first, second] = await measureItemsAsync(menu)
    const gap = second.top - first.bottom
    expect(gap).toBeGreaterThan(0)

    const x = first.left + 2
    const y = (first.bottom + second.top) / 2

    // 隙間の点はどの <a> にも当たらない（クリックの前に当たり判定で確かめる）
    const hit = await page.evaluate(([x, y]) =>
      document.elementFromPoint(x, y)?.closest('a')?.href ?? null, [x, y])
    expect(hit).toBeNull()

    const opened = []
    context.on('page', (opened$) => opened.push(opened$.url()))

    await page.mouse.click(x, y)
    await page.waitForTimeout(500)

    expect(opened).toEqual([])
    expect(page.url()).toBe(RAKUTEN_FAVORITES_URL)
  })

  // 判定基準4: クリックしてもメニューは閉じない（TradingView とは正解が違う。SPEC-CS-04）
  test('項目をクリックしてもメニューは閉じない', async ({ page, context, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)
    const menu = await openFirstMenuAsync(page)

    const item = widestPaddingOf(await measureItemsAsync(menu))
    await stubTargetAsync(context, item.href)

    await waitForStubPageAsync(context,
      () => page.mouse.click((item.textRight + item.right) / 2, (item.top + item.bottom) / 2))

    // ホバーが外れるまで開いたまま（マウスは項目の上に置いたまま調べる）
    await expect(menu).toHaveClass(/\bopen\b/)
    await expect(menu).toBeVisible()
  })
})

/**
 * TradingView の `EXCHANGE:CODE` 解釈 (SPEC-TC-07 / SPEC-CS-23)。
 *
 * TradingView 自体は DOM がハッシュ付きクラス名で変わるため自動テスト対象外だが、
 * `parseExchangeSymbol()` は**純粋な文字列処理**で、ブラウザも DOM も要らない。
 * canvas の `aria-label` とウォッチリストの行の属性値の両方がここを通り、
 * 誤った銘柄のリンクを出す唯一の経路になる（FR-19 判定基準 3・6 / ADR-0010）。
 *
 * ビルドが無く `export` が使えない (CON-02) ため、`node:vm` でソースを評価して取り出す
 * （`menuSelectors` の読み出しと同じ仕組み）。読み込み順は `manifest.json` の `js` と同じ。
 */
// 再レビュー M-5: 「行」を属性の有無ではなく値の形で決める (SPEC-CS-23)。
// 属性の有無で決めていたため、チャート内の要素が候補属性を `main` / `8253` のような値で
// 持つと「行だが解釈できない」となり、**チャートの右クリック拡張(FR-04。必須)が全面停止**した
test.describe('tradingview-cs.js: isSymbolShaped', () => {
  const isSymbolShaped = evaluateScripts(
    ['src/urls.js', 'src/tradingview-cs.js'], 'isSymbolShaped')

  test('EXCHANGE:CODE の形だけを行の値と見なす', () => {
    // 形を満たす＝行の値（解釈できるかは別。ここは形だけを見る）
    expect(isSymbolShaped('TSE:8253')).toBe(true)
    expect(isSymbolShaped('NASDAQ:AAPL')).toBe(true)
    expect(isSymbolShaped('TSE_DLY:8253')).toBe(true)
    // 未登録の取引所も「行ではある」。ここで落とすと指数の行がチャート起点になり、
    // チャートの銘柄が出てしまう（判定基準7 違反）ので exchanges は引かない
    expect(isSymbolShaped('SP:SPX')).toBe(true)
    // 大文字の内部識別子も形は満たす。**差分は原理的に消えない**ことを意図として固定する
    // （判定基準7 が「行として認識したうえで捨てる」を要求している以上、
    //   exchanges に無い大文字トークンは必ず差分に残る。ADR-0010 の 2 の追補2）
    expect(isSymbolShaped('MAIN:1')).toBe(true)

    // 形を満たさない＝行ではない（チャート判定へ進む）
    expect(isSymbolShaped('8253')).toBe(false) // コード単独
    expect(isSymbolShaped('main')).toBe(false) // チャート側の要素にありうる値
    expect(isSymbolShaped('pane-1')).toBe(false)
    expect(isSymbolShaped(':AAPL')).toBe(false) // 取引所トークンが無い
    expect(isSymbolShaped('1TSE:8253')).toBe(false) // 数字始まり
    expect(isSymbolShaped('')).toBe(false)
    // 上限（広げすぎの防止）。字種を解釈側と揃えたので小文字を含む識別子は行ではない。
    // 通すと「形は満たすが解釈が絶対に成功しない」値が行として捨てられ、
    // チャートの右クリック拡張（FR-04。必須）が黙って止まる
    expect(isSymbolShaped('main:1')).toBe(false)
    expect(isSymbolShaped('chart:2')).toBe(false)
    expect(isSymbolShaped('pane:0')).toBe(false)
    expect(isSymbolShaped('Widget:1')).toBe(false)
    // 小文字の取引所表記。SPEC-TC-09 が不成立と定めており、解釈側も受理しない
    expect(isSymbolShaped('nyse:aapl')).toBe(false)
    for (const value of [null, undefined, 0, {}]) {
      expect(isSymbolShaped(value)).toBe(false)
    }
  })

  // 下限（狭めすぎの防止）。字種を狭める方向へ倒しすぎると本物の行が行でなくなり、
  // ウォッチリストの右クリック（FR-19）が動かなくなる。
  // 形の判定と解釈の**包含関係**をここで固定する（ADR-0010 の 2 の追補2）
  test('解釈できる値は必ず形を満たす（形の判定は解釈より狭くならない）', () => {
    const parseExchangeSymbol = evaluateScripts(
      ['src/urls.js', 'src/tradingview-cs.js'], 'parseExchangeSymbol')

    for (const value of ['TSE:8253', 'TSE_DLY:8253', 'NASDAQ:AAPL',
      'BATS:AAPL の 1 日 チャート', 'NYSE:F']) {
      // 対照: そもそも解釈できている値であること（空振りしていないことの担保）
      expect(parseExchangeSymbol(value).code, value).not.toBeNull()
      expect(isSymbolShaped(value), value).toBe(true)
    }
  })
})

test.describe('tradingview-cs.js: parseExchangeSymbol', () => {
  const parseExchangeSymbol = evaluateScripts(
    ['src/urls.js', 'src/tradingview-cs.js'], 'parseExchangeSymbol')

  const notFound = { code: null, type: null }

  test('canvas の aria-label と行の属性値で同じ結果になる', () => {
    // 先頭からの前方一致なので、後ろに文字列が続いても続かなくても同じ (SPEC-CS-23)
    expect(parseExchangeSymbol('TSE:7203 の 1 日 チャート')).toEqual({ code: '7203', type: 'jp' })
    expect(parseExchangeSymbol('TSE:7203')).toEqual({ code: '7203', type: 'jp' })
    expect(parseExchangeSymbol('TSE_DLY:7203 の 1 日 チャート')).toEqual({ code: '7203', type: 'jp' })
    expect(parseExchangeSymbol('TSE:135A')).toEqual({ code: '135A', type: 'jp' })
    expect(parseExchangeSymbol('BATS:AAPL の 1 日 チャート')).toEqual({ code: 'AAPL', type: 'us' })
    expect(parseExchangeSymbol('NASDAQ:AAPL')).toEqual({ code: 'AAPL', type: 'us' })
  })

  // 回帰テスト: 米国ティッカーに後続境界が無く、単語の途中を切り出していた。
  // 行の属性値は値全体がシンボルなので、`NYSE:BRK.B` の行が `BRK` のページを開いていた
  test('米国ティッカーは後続境界を見て、切り出せないときは何も返さない', () => {
    // 複合ティッカー（区切り記号を含む）は「誤った銘柄」より「出さない」に倒す (FR-19)
    // 境界の値は Service Worker 側と揃える (FR-08 の適用範囲)
    expect(parseExchangeSymbol('NYSE:BRK.B')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:RDS.A')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK-B')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK/B')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK+B')).toEqual(notFound)
    // 許可列挙にしたので、列挙にない記号・数字・全角の連結記号も落ちる
    expect(parseExchangeSymbol('NYSE:BRK&B')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK_B')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK1')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRK・B')).toEqual(notFound)
    // 長音符2字（日本語 IME でハイフンを打つと出る形）も落ちる
    expect(parseExchangeSymbol('NYSE:BRKーB')).toEqual(notFound)
    expect(parseExchangeSymbol('NYSE:BRKｰB')).toEqual(notFound)
    // 6文字以上の英字列も切り出さない（Service Worker の usCodePattern と同じ扱い）
    expect(parseExchangeSymbol('NASDAQ:ALPHABET')).toEqual(notFound)
    // 5文字までの単独ティッカーはそのまま取れる
    expect(parseExchangeSymbol('NASDAQ:GOOGL')).toEqual({ code: 'GOOGL', type: 'us' })
    expect(parseExchangeSymbol('NYSE:F')).toEqual({ code: 'F', type: 'us' })
  })

  test('取引所を解釈できない・形が合わないものは何も返さない', () => {
    // 市場種別は `EXCHANGE:` からしか決めない（コード単独は取引所が分からない。SPEC-CS-23）
    expect(parseExchangeSymbol('8253')).toEqual(notFound)
    // exchanges に無い取引所（指数・先物・FX・暗号資産など）
    expect(parseExchangeSymbol('XETR:BMW')).toEqual(notFound)
    // 市場と銘柄コードの書式が食い違う
    expect(parseExchangeSymbol('TSE:AAPL')).toEqual(notFound)
    expect(parseExchangeSymbol('NASDAQ:7203')).toEqual(notFound)
    expect(parseExchangeSymbol('NASDAQ:aapl')).toEqual(notFound)
    // 値が無い場合も落ちない
    for (const text of [null, undefined, '']) {
      expect(parseExchangeSymbol(text)).toEqual(notFound)
    }
  })
})

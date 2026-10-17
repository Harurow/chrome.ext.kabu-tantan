import { test, expect } from './fixtures/extension.mjs'
import { evaluateScripts } from '../scripts/selector-check/load-selectors.mjs'
import { STALE_KEYS } from './fixtures/storage.mjs'

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

// --- FR-28 / SPEC-CS-26: 米国株の行 -------------------------------------
// rakuten-cs.js:「お気に入り」（国内株）に米国ティッカーの形の行を混ぜる。
// **このエントリには `us: true` を付けていない**ので何も起きないこと（opt-in）を見る。
// 米国株のお気に入りは別ページ（`info_us_prc_reg_lst.do`）で、
// このページに米国株の行は並ばない（実機で確定。ADR-0014 の 9-2）。
//
// **1.18.0 まではこの HTML を米国株ページの URL でも出していた**が、
// 2026-09-01 の実 DOM で**米国株ページは別テンプレート**だと分かったため分離した
// （ADR-0014 の 9-5）。国内株フィクスチャ側はそのまま——米国ティッカーの行を含むので、
// `us: true` を戻せば落ちる性質は保たれる
const RAKUTEN_FAVORITES_US_HTML = page$('お気に入り', `<body>
  <form id="form">
    <table class="tbl-data-01">
      <tbody>
        <tr><td class="align-C"><div class="mbody"><nobr>7203</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>AAPL</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>T</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>BRK.B</nobr></div></td></tr>
        <tr><td class="align-C"><div class="mbody"><nobr>ALPHABET</nobr></div></td></tr>
      </tbody>
    </table>
  </form>
</body>`)

// rakuten-cs.js:「お気に入り・米国株」「お気に入り編集・米国株」。
// 米国株のお気に入りは**別 URL の別ページ**（ADR-0014 の 9）。
// **URL も DOM も実測**——2026-09-01 に利用者が提示した DevTools の構造を写してある
// （テーブルの id・列の並び・`div.mbody` 直下のテキスト。ADR-0014 の 9-5）。
// 1.18.0 は国内株版と同じ構造だろうと推測していたが、3箇所とも外れていた。
//
// **銘柄名の列に `APPLE INC` を置いてある。** `td div.mbody` を全部渡す案
// （ADR-0014 の 9-6 の案B）だとここに `us APPLE` が成立し、**別銘柄のページを開く**
// （判定基準6・7 違反）。列の位置（`td:nth-of-type(2)`）で絞ったことの回帰テスト。
// 実画面の銘柄名はリンクだが、**リンクにすると直下のテキストノードが無く案Bでも
// 注入されない**＝回帰が効かなくなるため、ここでは直下のテキストにしてある
const RAKUTEN_US_FAVORITES_URL =
  'https://member.rakuten-sec.co.jp/app/info_us_prc_reg_lst.do;BV_SessionID=TEST'
const RAKUTEN_US_FAVORITES_EDIT_URL =
  'https://member.rakuten-sec.co.jp/app/info_us_prc_reg_lst_edit.do;BV_SessionID=TEST'
const usFavoriteRow$ = (ticker, name) => `
        <tr>
          <td width="3%" class="valign-M"><input type="button" value="注文"></td>
          <td width="6%" align="left"><div class="mbody"> ${ticker} </div></td>
          <td width="22.5%" align="left"><div class="mbody">${name}</div></td>
          <td width="6%" align="left"><div class="mbody">米国</div></td>
          <td class="align-R" align="right">123.45</td>
        </tr>`
const RAKUTEN_US_FAVORITES_HTML = page$('お気に入り', `<body>
  <form id="form">
    <table id="pcmm-foreign-stock" class="tbl-data-01">
      <tbody>
        <tr><td>&nbsp;</td><td>ティッカー</td><td>銘柄名</td><td>市場</td><td>現在値</td></tr>
        ${usFavoriteRow$('NVDA', 'エヌビディア')}
        ${usFavoriteRow$('AAPL', 'APPLE INC')}
        ${usFavoriteRow$('T', 'エーティーアンドティー')}
        ${usFavoriteRow$('BRK.B', 'バークシャー・ハサウェイ')}
        ${usFavoriteRow$('ALPHABET', 'アルファベット')}
      </tbody>
    </table>
  </form>
</body>`)

// 同じコードが2つのテキストノードに現れるセル（判定基準10）。
// 1.16.1 までは該当するテキストノードを**すべて**置換していたのでメニューが2つ出た
const RAKUTEN_FAVORITES_DUP_HTML = page$('お気に入り', `<body>
  <form id="form">
    <table class="tbl-data-01">
      <tbody>
        <tr><td class="align-C"><div class="mbody"><nobr>7203<i>／</i>7203</nobr></div></td></tr>
      </tbody>
    </table>
  </form>
</body>`)

// rakuten-cs.js:「保有商品一覧・すべて」。**商品種別で走査対象を絞れる唯一のエントリ**で、
// 判定基準7（株式以外の行に出さない）を自動で固定できるのはここだけ（SPEC-CS-26）。
// ラベル「米国株式」は 2026-08-30 の実機で確認済み（変われば 0 件＝今日と同じに倒れる）
const RAKUTEN_POSSESS_ALL_URL =
  'https://member.rakuten-sec.co.jp/app/ass_all_possess_lst.do;BV_SessionID=TEST'
const RAKUTEN_POSSESS_ALL_HTML = page$('保有商品一覧', `<body>
  <div id="table_possess_data">
    <table class="tbl-bold-border">
      <tbody>
        <tr><td>国内株式</td><td>7203 トヨタ自動車</td></tr>
        <tr><td>米国株式</td><td>AAPL アップル</td></tr>
        <tr><td>投資信託</td><td>eMAXIS Slim 全世界株式</td></tr>
        <tr><td>預り金</td><td>USD 米ドル</td></tr>
      </tbody>
    </table>
  </div>
</body>`)

// rakuten-cs.js:「保有商品一覧・すべて」に米国株の行を並べる。
// **取引所の列を持たない**フィクスチャで、取引所を読み取らなくても成立することも見る
// （判定基準9）。`BRK.B` / `ALPHABET` は後続境界で落ちる側（判定基準8）
const RAKUTEN_POSSESS_ALL_US_HTML = page$('保有商品一覧', `<body>
  <div id="table_possess_data">
    <table class="tbl-bold-border">
      <tbody>
        <tr><td>国内株式</td><td>7203</td></tr>
        <tr><td>米国株式</td><td>AAPL</td></tr>
        <tr><td>米国株式</td><td>T</td></tr>
        <tr><td>米国株式</td><td>BRK.B</td></tr>
        <tr><td>米国株式</td><td>ALPHABET</td></tr>
      </tbody>
    </table>
  </div>
</body>`)

// rakuten-cs.js:「ランキング・売買代金」。`us: true` を付けていないエントリなので、
// 米国ティッカーの形のセルがあっても何も起きない（opt-in が効いていること。ADR-0014 の 1）
const RAKUTEN_RANKING_URL =
  'https://member.rakuten-sec.co.jp/app/market_ranking.do;BV_SessionID=TEST'
const RAKUTEN_RANKING_HTML = page$('ランキング', `<body>
  <div id="str-main-inner">
    <div class="mbody">
      <table class="tbl-data-01">
        <tbody>
          <tr><td>1</td><td>7203</td></tr>
          <tr><td>2</td><td>ETF</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</body>`)

// sbi-cs.js:「ポートフォリオ」に外国株式の行を足す。
// **実画面に外国株式の行が並ぶかは未確認**（保有が無いと確かめられない。FR-28 適用範囲 c）
const SBI_PORTFOLIO_US_HTML = page$('ポートフォリオ', `<body>
  <div class="middleArea2"><div class="middleAreaM2">
    <table><tbody><tr><td>
      <table><tbody><tr><td>
        <table><tbody>
          <tr><td class="mtext">トヨタ自動車</td><td class="mtext">7203</td></tr>
          <tr><td class="mtext">アップル</td><td class="mtext">AAPL</td></tr>
        </tbody></table>
      </td></tr></tbody></table>
    </td></tr></tbody></table>
  </div></div>
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

  // SPEC-ST-03 / NFR-05: サイト廃止で消えた key が storage に残っていても、読み飛ばして残りで作る。
  // ガード（createMenu の `if (!entry)`）が無いと TypeError になり、
  // retrySetup が握って打ち切るのでメニューが1つも出ない（1.16.1 まではこの状態だった）
  test('storage に残った未知のキーは読み飛ばし、残りの遷移先でメニューを作る', async ({ page, context, extensionId, serveFixture }) => {
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.evaluate((keys) => chrome.storage.sync.set({ enableLinkKeys: keys }), STALE_KEYS)
    await options.close()

    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    // フィクスチャの全行に注入される
    await expect(page.locator('span.x-kabu-root')).toHaveCount(3)

    // 未知キーの項目が無く、残りは設定順（externalUrls の定義順ではない）
    const items = page.locator('span.x-kabu-root').first().locator('li.x-kabu-menu-item a')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveAttribute('href', 'https://kabutan.jp/stock/?code=7203')
    await expect(items.nth(1)).toHaveAttribute('href', 'https://minkabu.jp/stock/7203')

    // 3行 × 2項目。どの行にも未知キーの項目が無い
    await expect(page.locator('li.x-kabu-menu-item a')).toHaveCount(6)
  })
})

/**
 * SPEC-CS-25（2-d。FR-25）: 楽天証券・SBI証券のメニュー項目は、行のどこを押しても
 * 文字の上を押したときと同じ結果になる。
 *
 * 実装は `src/style.css` の `li.x-kabu-menu-item > a { display: block }` の1規則だけで、
 * 項目を組み立てる `linkMenu.js` と `style.css` は楽天・SBI の4本すべてに同じ組で注入される
 * （`manifest.json` の `content_scripts`）。よって楽天のフィクスチャで固定すれば
 * SBI 側も同じ規則で動く。TradingView 側（2-a / 2-b / 2-c）は JS の代行という別経路で、
 * 1.20.0 から `tests/tradingview.spec.mjs` がフィクスチャで見ている（ADR-0013 の 4）。
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
 * FR-28 / SPEC-CS-26: 証券会社サイトの一覧で米国株の行からもメニューを開ける。
 *
 * CON-08（自動テストにできない）は **TradingView だけ**の制約で、楽天・SBI は
 * フィクスチャで検証できる。判定基準1〜10 のほぼ全部をここで固定する（ADR-0014 の 8）。
 * 実ページでしか見られないのは3つだけ（米国株の行が実在すること／保有商品一覧の
 * 商品種別ラベルの実測値／SBI に外国株式の行が並ぶか）で、`docs/notes/manual-checklist.md` C-1 / C-3。
 */
test.describe('米国株の行への注入', () => {
  /** 注入されたメニューの元テキストを並び順で取り出す */
  const injectedTextsAsync = (page) =>
    page.locator('span.x-kabu-root').evaluateAll((roots) =>
      roots.map((root) => root.childNodes[0].nodeValue))

  // 判定基準1 / 5 / 6 / 8 / 9
  test('保有商品一覧（すべて）の米国株の行にメニューが出て、国内株の行は変わらない', async ({ page, serveFixture, serviceWorker }) => {
    await serveFixture(page, RAKUTEN_POSSESS_ALL_URL, RAKUTEN_POSSESS_ALL_US_HTML)

    const roots = page.locator('span.x-kabu-root')
    await expect(roots).toHaveCount(3)

    // 判定基準8: `BRK.B`（クラス株）と `ALPHABET`（6文字以上）には注入しない。
    // 前者で `BRK` を開くのは「開かないより悪い」失敗（SPEC-TC-02）
    expect(await injectedTextsAsync(page)).toEqual(['7203', 'AAPL', 'T'])

    // 判定基準5 / 6: 国内株の行は今までどおり（有効な全キーが url1 で並ぶ）
    const jpExpected = await serviceWorker.evaluate(() =>
      externalUrls.map((u) => ({ title: u.title, url: makeUrl(u.url1, '7203') })))
    const jpActual = await roots.nth(0).locator('li.x-kabu-menu-item a').evaluateAll(
      (as) => as.map((a) => ({ title: a.getAttribute('title'), url: a.getAttribute('href') })))
    expect(jpActual).toEqual(jpExpected)
  })

  // 判定基準2 / 3 / 9: 米国株は url3 のみ。取引所は見ないので右クリックと文字列一致する
  test('米国株の項目は url3 を持つサイトだけで、右クリックと同じ URL になる', async ({ page, serveFixture, serviceWorker }) => {
    await serveFixture(page, RAKUTEN_POSSESS_ALL_URL, RAKUTEN_POSSESS_ALL_US_HTML)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(3)

    // 同じ文字列を選択して右クリックしたときの遷移先（getTickerCode は exchange を返さず、
    // getUrl は url3 を選ぶ。SPEC-TC-05）。順序はオプションの並び順のまま
    const expected = await serviceWorker.evaluate(() =>
      externalUrls
        .map((u) => ({ title: u.title, url: getUrl('us', 'AAPL', undefined, u.url1, u.url2, u.url3) }))
        .filter((item) => item.url !== undefined))

    // 米国株のページを持つサイトだけが並ぶ（国内株より少ない）
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan((await serviceWorker.evaluate(() => externalUrls.length)))

    const actual = await page.locator('span.x-kabu-root').nth(1)
      .locator('li.x-kabu-menu-item a').evaluateAll((as) => as.map((a) => ({
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

  // 判定基準4: 遷移先が0件ならメニュー自体を出さない（空の箱を開かない）
  test('url3 を持たないサイトだけが有効なら米国株の行にメニューを出さない', async ({ page, context, extensionId, serveFixture }) => {
    // 日本経済新聞・四季報はどちらも url3 を持たない
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.evaluate(() => chrome.storage.sync.set({
      enableLinkKeys: { 'www.nikkei.com/company': 0, 'shikiho.toyokeizai.net/stocks': 1 }
    }))
    await options.close()

    await serveFixture(page, RAKUTEN_POSSESS_ALL_URL, RAKUTEN_POSSESS_ALL_US_HTML)

    // 国内株の行だけが残る（米国株の行は span ごと作られない）
    await expect(page.locator('span.x-kabu-root')).toHaveCount(1)
    expect(await injectedTextsAsync(page)).toEqual(['7203'])
    await expect(page.locator('ul.x-kabu-body')).toHaveCount(1)
    await expect(page.locator('li.x-kabu-menu-item a')).toHaveCount(2)
  })

  // 判定基準1 / 7: 商品種別で走査対象を絞れる唯一のエントリ
  test('保有商品一覧（すべて）は国内株式・米国株式の行だけに注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_POSSESS_ALL_URL, RAKUTEN_POSSESS_ALL_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(2)
    expect(await injectedTextsAsync(page)).toEqual(['7203 トヨタ自動車', 'AAPL アップル'])

    // 預り金の `USD 米ドル` は形だけ見れば `us USD` が成立する（SPEC-TC-10）。
    // 届かせないのはセレクタの仕事で、抽出規則では防げない
    await expect(page.getByText('USD 米ドル').locator('span.x-kabu-root')).toHaveCount(0)
  })

  // 判定基準1 / 2: SBI ポートフォリオ（実画面に外国株式の行が並ぶかは未確認）
  test('SBI ポートフォリオの外国株式の行にも注入する', async ({ page, serveFixture }) => {
    await serveFixture(page, SBI_PORTFOLIO_URL, SBI_PORTFOLIO_US_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(2)
    expect(await injectedTextsAsync(page)).toEqual(['7203', 'AAPL'])

    const hrefs = await page.locator('span.x-kabu-root').evaluateAll((roots) =>
      roots.map((root) => root.querySelector('a[href*="kabutan.jp"]')?.getAttribute('href')))
    expect(hrefs).toEqual([
      'https://kabutan.jp/stock/?code=7203',
      'https://us.kabutan.jp/stocks/AAPL'
    ])
  })

  // opt-in（ADR-0014 の 1）: `us: true` を付けていないエントリは今日と同じまま
  test('us を付けていないランキングでは米国ティッカーの形のセルに注入しない', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_RANKING_URL, RAKUTEN_RANKING_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(1)
    expect(await injectedTextsAsync(page)).toEqual(['7203'])
  })

  // opt-in（ADR-0014 の 9-2）: お気に入りは米国株が別ページなので `us: true` を付けない。
  // 商品種別で絞れないセレクタなので、利得が無いなら当たる文字列の集合を広げない
  test('お気に入りは us を付けていないので米国ティッカーの形の行に注入しない', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_US_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(1)
    expect(await injectedTextsAsync(page)).toEqual(['7203'])
  })

  // 判定基準1 / 2 / 7 / 8: 米国株のお気に入りは別ページ（1.18.0 で2エントリ追加。ADR-0014 の 9-1）。
  // フィクスチャは 2026-09-01 の実 DOM を写したもの（1.18.1 でセレクタごと差し替えた。9-5）。
  // 編集ページの実 DOM は未確認だが、一覧と同じセレクタを置いてあるので同じ HTML で見る
  test('米国株のお気に入り2ページでは米国ティッカーの行にメニューが出る', async ({ page, serveFixture }) => {
    for (const url of [RAKUTEN_US_FAVORITES_URL, RAKUTEN_US_FAVORITES_EDIT_URL]) {
      await serveFixture(page, url, RAKUTEN_US_FAVORITES_HTML)

      // 判定基準8: `BRK.B`（クラス株）と `ALPHABET`（6文字以上）は落ちる。
      // 実 DOM のティッカーは前後に空白がある（`<div class="mbody"> NVDA </div>`）。
      // 判定は前後の空白を落として行い、置換するテキストノードは元のまま（SPEC-TC-10）
      await expect(page.locator('span.x-kabu-root')).toHaveCount(3)
      expect(await injectedTextsAsync(page), url).toEqual([' NVDA ', ' AAPL ', ' T '])

      // 判定基準2: 取引所を見ずに url3 を使う（SPEC-CS-06）
      const hrefs = await page.locator('span.x-kabu-root').evaluateAll((roots) =>
        roots.map((root) => root.querySelector('a[href*="kabutan.jp"]')?.getAttribute('href')))
      expect(hrefs, url).toEqual([
        'https://us.kabutan.jp/stocks/NVDA',
        'https://us.kabutan.jp/stocks/AAPL',
        'https://us.kabutan.jp/stocks/T'
      ])

      // 判定基準7: 銘柄名の列（`APPLE INC`）と市場の列（`米国`）には届かない。
      // 列の位置で絞らないと `us APPLE` が成立して別銘柄のページを開く（ADR-0014 の 9-6 の案B）
      await expect(page.getByText('APPLE INC').locator('span.x-kabu-root'), url).toHaveCount(0)
    }
  })

  // 遷移先を全部無効にすると、国内株でもメニューを出さない（1.16.1 は空の箱を開いていた）。
  // このとき注入は永久に0件なので、attachAsync 側で早めに切り上げる（NFR-01）
  test('遷移先を全部無効にすると国内株の行にもメニューを出さない', async ({ page, context, extensionId, serveFixture }) => {
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.evaluate(() => chrome.storage.sync.set({ enableLinkKeys: {} }))
    await options.close()

    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)

    await page.waitForTimeout(1500)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(0)
    await expect(page.locator('ul.x-kabu-body')).toHaveCount(0)
  })

  // 判定基準10: 1行につきメニューは1つ
  test('同じコードが2回現れるセルでもメニューは1つ', async ({ page, serveFixture }) => {
    await serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_DUP_HTML)

    await expect(page.locator('span.x-kabu-root')).toHaveCount(1)

    // 再試行のパスが繰り返されても2つ目が生えない（打ち切りだけでは次のパスが置換する）
    await page.waitForTimeout(1200)
    await expect(page.locator('span.x-kabu-root')).toHaveCount(1)
    await expect(page.locator('ul.x-kabu-body')).toHaveCount(1)
  })
})

/**
 * SPEC-TC-10: 注入経路の抽出規則そのもの。
 * `matchInjectionTicker` は純粋な文字列処理なので、ブラウザも DOM も要らない
 * （`parseExchangeSymbol` と同じ仕組みで `node:vm` から呼ぶ。CON-02）。
 */
test.describe('urls.js: matchInjectionTicker', () => {
  const matchInjectionTicker = evaluateScripts(['src/urls.js'], 'matchInjectionTicker')

  // SPEC-TC-10 の具体例表（allowUs が真のとき）
  test('国内株を先に見て、空振りしたときだけ米国株を試す', () => {
    // 順位1: 国内株（非アンカー）
    expect(matchInjectionTicker('7203', true)).toEqual({ code: '7203', type: 'jp' })
    expect(matchInjectionTicker('135A', true)).toEqual({ code: '135A', type: 'jp' })

    // 順位2: 米国株（先頭アンカー + 後続境界）
    expect(matchInjectionTicker('AAPL', true)).toEqual({ code: 'AAPL', type: 'us' })
    expect(matchInjectionTicker('AAPL アップル', true)).toEqual({ code: 'AAPL', type: 'us' })
    expect(matchInjectionTicker('AAPLの決算', true)).toEqual({ code: 'AAPL', type: 'us' })

    // 判定基準8: 後続境界に当たらない形は切り出さない（`BRK` を開かない）
    for (const text of ['BRK.B', 'BRK-B', 'BRK1', 'BRKーB', 'ALPHABET']) {
      expect(matchInjectionTicker(text, true), text).toBeNull()
    }

    // 順位3: どちらにも当たらない
    expect(matchInjectionTicker('投資信託', true)).toBeNull()
    expect(matchInjectionTicker('トヨタ自動車', true)).toBeNull()
  })

  // 判定基準6 / 7 の限界。**抽出は形しか見ない**ので、どの要素に抽出をかけるかを
  // 決めるセレクタ側でしか防げない（SPEC-CS-26 / ADR-0014 の 2・4）
  test('形しか見ないので、届かせてはいけないセルは抽出では防げない', () => {
    // 中国株の5桁コード。順位1（非アンカー）が当たって `0070` になる
    expect(matchInjectionTicker('00700', true)).toEqual({ code: '0070', type: 'jp' })
    // 預り金の通貨。順位2が当たる
    expect(matchInjectionTicker('USD 米ドル', true)).toEqual({ code: 'USD', type: 'us' })
  })

  // opt-in が偽なら 1 と 3 しかない＝今日とバイト単位で同じ結果
  test('allowUs が偽なら米国株は一切成立しない', () => {
    expect(matchInjectionTicker('AAPL', false)).toBeNull()
    expect(matchInjectionTicker('AAPL アップル', false)).toBeNull()
    expect(matchInjectionTicker('USD 米ドル', false)).toBeNull()
    expect(matchInjectionTicker('AAPL', undefined)).toBeNull()

    // 国内株は allowUs に関係なく同じ
    expect(matchInjectionTicker('7203', false)).toEqual({ code: '7203', type: 'jp' })
    expect(matchInjectionTicker('00700', false)).toEqual({ code: '0070', type: 'jp' })
  })

  test('前後の空白を落として判定する', () => {
    expect(matchInjectionTicker('  AAPL  ', true)).toEqual({ code: 'AAPL', type: 'us' })
    expect(matchInjectionTicker('\n 7203 \n', true)).toEqual({ code: '7203', type: 'jp' })
    for (const text of [null, undefined, '']) {
      expect(matchInjectionTicker(text, true)).toBeNull()
    }
  })
})

/**
 * TradingView の `EXCHANGE:CODE` 解釈 (SPEC-TC-07 / SPEC-CS-23)。
 *
 * TradingView のサイト側の DOM はハッシュ付きクラス名で変わるため自動テストでは見ない
 * （拡張が作った DOM は 1.20.0 から `tests/tradingview.spec.mjs` がフィクスチャで見る。CON-08）が、
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

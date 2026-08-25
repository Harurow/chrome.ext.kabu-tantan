import { test, expect } from './fixtures/extension.mjs'

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

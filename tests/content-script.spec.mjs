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
const SBI_PORTFOLIO_HTML = page$('ポートフォリオ', `<body class="vsc-initialized">
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

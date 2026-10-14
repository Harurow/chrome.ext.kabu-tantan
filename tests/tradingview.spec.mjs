/**
 * TradingView の退行を捕まえるフィクスチャ（SPEC-CS-27。FR-26 の段階1・2）。
 *
 * **見ているのは自分たちのコードの退行だけ。**
 * このテストが緑でも「実サイトが壊れていない」根拠にはならない（CON-08 の条件3 /
 * FR-26 判定基準7）。挿入先が実在するかは `npm run check:selectors`（FR-12）が、
 * 見た目とサイト側メニューの挙動は `docs/MANUAL-CHECKLIST.md` が見る。
 *
 * フィクスチャは `menuSelectors` / `watchlistSymbolAttrs` を**実行時に読んで**組み立てる
 * （`tests/fixtures/tradingview.mjs`）。ハッシュ付きクラス名はこのファイルにも出てこない。
 */
import { test, expect } from './fixtures/extension.mjs'
import { domFromSelector, parseCompound, parseSelectorChain } from './fixtures/selector-dom.mjs'
import { loadMenuSelectors, evaluateScripts } from '../scripts/selector-check/load-selectors.mjs'
import {
  TRADINGVIEW_URL,
  CHART_CODE,
  ROW_CODE,
  CHART_MARK,
  ROW_MARK,
  OVERLAP_MARK,
  MENU_BOX_MARK,
  chartLabel,
  tradingViewPageHtml,
  overlapRootHtml,
  contextMenuHtml,
  insertToolbarAsync,
  setChartLabelAsync,
  setWatchlistRowsAsync,
  addChartElementWithRowAttrsAsync,
  CHART_ATTR_MARK
} from './fixtures/tradingview.mjs'
import { STALE_KEYS } from './fixtures/storage.mjs'
import {
  recordAddedNodesAsync,
  addedNodesAsync,
  clickReceiverAsync,
  watchContentScriptAsync
} from './fixtures/probes.mjs'

/**
 * セレクタ → DOM の変換規則（SPEC-CS-27）。
 *
 * **この変換が黙って壊れると、セレクタと合っていないフィクスチャでテストが緑になる。**
 * CON-08 の改訂が最も嫌う状態なので、変換規則自体をここで固定する。
 */
test.describe('セレクタから DOM を組み立てる', () => {
  test('tag / class / id / 属性をそのまま1つの要素にする', () => {
    expect(parseCompound('div.outer'))
      .toEqual({ tag: 'div', id: null, classes: ['outer'], attrs: {} })
    expect(parseCompound('div#root'))
      .toEqual({ tag: 'div', id: 'root', classes: [], attrs: {} })
    expect(parseCompound('a.one.two[data-role="menuitem"][hidden]'))
      .toEqual({ tag: 'a', id: null, classes: ['one', 'two'], attrs: { 'data-role': 'menuitem', hidden: '' } })
    // タグを省いたら div
    expect(parseCompound('.only-class').tag).toBe('div')
  })

  test('空白区切りを子孫チェーンとして入れ子にする', () => {
    expect(parseSelectorChain('div.a span.b').map((spec) => spec.tag)).toEqual(['div', 'span'])
    expect(domFromSelector('div.a span.b', { html: 'x' }))
      .toBe('<div class="a"><span class="b">x</span></div>')
  })

  // jQuery 独自の否定属性セレクタ。CSS には無いので「その属性を付けない」と解釈する
  test('[attr!="v"] はその属性を付けない', () => {
    expect(parseCompound('canvas[aria-hidden!="true"]').attrs).toEqual({})
    expect(domFromSelector('canvas[aria-hidden!="true"]')).toBe('<canvas></canvas>')
  })

  // **黙って無視しないこと自体が要件**（SPEC-CS-27）。
  // 無視すると「セレクタと合っていないフィクスチャ」で緑になり、何も守らなくなる
  test('未対応の記法は例外にする（黙って無視しない）', () => {
    for (const selector of [
      'div.a > div.b', 'div.a, div.b', 'tr td:nth-of-type(2)',
      'div.a + div.b', 'div.a ~ div.b', 'td:contains("国内株式")', 'span:first'
    ]) {
      expect(() => domFromSelector(selector), selector).toThrow(/未対応の記法/)
    }
  })

  // 変換できないセレクタが `menuSelectors` に入ったら、フィクスチャを黙って空振りさせずに落とす
  test('TradingView の検出用セレクタ4つはすべて DOM に直せる', () => {
    const entries = loadMenuSelectors('src/tradingview-cs.js')
    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect(() => domFromSelector(entry.selector), entry.key).not.toThrow()
    }
  })
})

/**
 * 祖先セレクタと検出用セレクタの整合（SPEC-CS-15 / SPEC-CS-23 / SPEC-CS-24）。
 *
 * `closest()` に渡すのは**箱**（`div.context-menu`）と**チャート領域**
 * （`div.chart-gui-wrapper`）で、検出用セレクタが指す**末端**（`table` / `canvas`）ではない。
 * よって `selectorOf()` からは引けず、`src/tradingview-cs.js` にリテラルで持つしかない
 * （先頭を切り出すパーサを `src/` に増やすと、ずれたときの症状が
 * 「`closest()` が何にも一致せず**黙って何も起きない**」になり、いちばん気づけない）。
 *
 * **二重管理をここで固定する。** フィクスチャは `menuSelectors` に追従するので、
 * セレクタを差し替えると**フィクスチャだけが追従して実装が置いていかれる**。
 * その状態は段階1・2 のテストも赤くするが、**原因が「フィクスチャが壊れた」に見える**。
 * ずれた場所を名指しするために、このテストを別に置く
 */
test.describe('祖先セレクタの整合', () => {
  const SOURCE = 'src/tradingview-cs.js'
  const selectorOf = (key) => {
    const entry = loadMenuSelectors(SOURCE).find((found) => found.key === key)
    expect(entry, `menuSelectors に ${key} が無い`).toBeDefined()
    return entry.selector
  }

  /** 子孫チェーンの**先頭の1段**が一致するか（`div.context-menu-x` を通さない） */
  const startsWithCompound = (selector, head) =>
    selector === head || selector.startsWith(`${head} `)

  test('closest() に渡す箱のセレクタが、検出用セレクタ context-menu の先頭と一致する', () => {
    const head = evaluateScripts([SOURCE], 'contextMenuBoxSelector')
    const selector = selectorOf('context-menu')
    expect(startsWithCompound(selector, head), `${selector} / ${head}`).toBe(true)
  })

  test('起点判定で見るチャート領域のセレクタが、検出用セレクタ chart-canvas の先頭と一致する', () => {
    const head = evaluateScripts([SOURCE], 'chartWrapperSelector')
    const selector = selectorOf('chart-canvas')
    expect(startsWithCompound(selector, head), `${selector} / ${head}`).toBe(true)
  })
})

/** 遷移先を1件だけにして、入れ子の項目を一意にする */
const ONLY_SITE_KEY = 'kabutan.jp/stock'

/** オプションの設定を書き換える（Content Script は起動時に読む） */
const setEnableLinkKeysAsync = async (context, extensionId, enableLinkKeys) => {
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.evaluate((keys) => chrome.storage.sync.set({ enableLinkKeys: keys }), enableLinkKeys)
  await options.close()
}

/**
 * フィクスチャを開き、拡張の起動を待ってからオーバーレイ層を作る。
 *
 * **オーバーレイ層は後から足す。** `attach()` は `body` の `childList` を監視して
 * 層の**生成**を待つので、最初から置くと監視が発火しない（SPEC-CS-11 の手順1）。
 * 「株Link」ボタンが出ていることが `attach()` を通過した証拠になる（SPEC-CS-12）
 */
const openChartPageAsync = async (page, serveFixture) => {
  await serveFixture(page, TRADINGVIEW_URL, tradingViewPageHtml())

  await expect(page.locator('div.ktt-tv-kabuLinkMenu')).toHaveCount(1)

  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), overlapRootHtml())
  // MutationObserver のコールバック（マイクロタスク）が走り切るのを待つ
  await page.waitForTimeout(50)
}

/** 要素の中心を右クリックする（`check:selectors` が実サイトで使うのと同じ手段） */
const rightClickAsync = async (page, selector) => {
  const box = await page.locator(selector).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
}

/**
 * 右クリック後に、サイト側の役割としてメニューをオーバーレイ層へ足す（契約4）。
 * 拡張が3行を足すまで待つ
 */
const openContextMenuAsync = async (page, box) => {
  await page.evaluate(([mark, html]) => {
    document.querySelector(`[${mark}]`).insertAdjacentHTML('beforeend', html)
  }, [OVERLAP_MARK, contextMenuHtml(box)])

  await expect(page.locator('tr[data-kabu-tantan]')).toHaveCount(1)
}

/**
 * 親行にホバーして入れ子を開き、最初の項目の `<tr>` を返す。
 *
 * 3行は `await` の前に同期的に足されるが、ホバーのハンドラが付くのは
 * 項目が揃ってから（SPEC-CS-11 の「二重追加の防止」）。
 * 付く前にマウスが乗っていると `mouseenter` を取り逃すので、乗せ直して待つ
 */
const openSubmenuAsync = async (page) => {
  const parentRow = page.locator(`[${MENU_BOX_MARK}] tr[data-role="menuitem"]`).first()
  await expect(parentRow).toContainText('を開く')

  const item = page.locator('div.ktt-tv-subMenu tr[data-role="menuitem"]').first()
  await expect(async () => {
    await page.mouse.move(0, 0)
    await parentRow.hover()
    await expect(item).toBeVisible({ timeout: 500 })
  }).toPass()

  return item
}

/** 差し替えたページの目印。実サイトへ出ていっていないことを題名で確かめる */
const STUB_TITLE = 'stub'

/** 新しいタブが実サイトへ出ていかないよう、その URL だけを差し替える */
const stubTargetAsync = (context, url) =>
  context.route(url, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${STUB_TITLE}</title></head><body></body></html>`
  }))

/** 新しいタブが開くのを待ち、差し替えたページであることまで確かめる */
const waitForStubPageAsync = async (context, clickAsync) => {
  const [opened] = await Promise.all([context.waitForEvent('page'), clickAsync()])
  await opened.waitForLoadState('domcontentloaded')
  expect(await opened.title()).toBe(STUB_TITLE)
  return opened
}

/**
 * 項目の押せる範囲を実測する。
 * `<a>` はインライン要素なので、その矩形が**文字そのもの**の位置になる。
 * 座標を直書きすると、当たり判定の外を押していても気づけなくなる（SPEC-CS-25）
 */
const measureItemAsync = (item) => item.evaluate((row) => {
  const anchor = row.querySelector('a')
  const iconCell = row.querySelector('td[data-icon-cell="true"]')
  const rect = (element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect()
    return { left, right, top, bottom }
  }
  return {
    href: anchor.href,
    rel: anchor.getAttribute('rel'),
    target: anchor.getAttribute('target'),
    row: rect(row),
    text: rect(anchor),
    iconCell: rect(iconCell)
  }
})

/** 「文字の外」の3か所（アイコン列 / 文字の右の余白 / 行の上端寄り） */
const outsideTextPoints = (measured) => ({
  アイコン列: {
    x: (measured.iconCell.left + measured.iconCell.right) / 2,
    y: (measured.text.top + measured.text.bottom) / 2
  },
  文字の右の余白: {
    x: (measured.text.right + measured.row.right) / 2,
    y: (measured.text.top + measured.text.bottom) / 2
  },
  行の上端寄り: {
    x: measured.text.left + 2,
    y: (measured.row.top + measured.text.top) / 2
  }
})

/** 押す場所が本当に文字の外か（空振りしていないことの担保） */
const expectOutsideText = async (page, point, measured) => {
  expect(point.x, JSON.stringify(measured)).toBeGreaterThan(0)
  const hit = await page.evaluate(([x, y]) =>
    document.elementFromPoint(x, y)?.closest('a')?.href ?? null, [point.x, point.y])
  expect(hit, `(${point.x}, ${point.y}) は文字の上だった`).toBeNull()
}

/**
 * 段階1: クリック範囲（FR-25 / SPEC-CS-25）。
 *
 * 行のどこを押しても文字の上と同じ結果になること。TradingView 側の手段は
 * **JS の代行**（行のハンドラで `<a>` のクリックを代行する）で、
 * 楽天・SBI の CSS 方式（`メニュー項目のクリック範囲`）とは別経路（ADR-0013 の 4）。
 */
test.describe('TradingView: 入れ子メニューのクリック範囲', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
  })

  // SPEC-CS-05 / NFR-03: 入れ子の項目も外部リンク。**開く経路は `<a>` の1本だけ**なので
  // （代行クリックも同じ `<a>` を通る。SPEC-CS-25）、ここが落ちると
  // 他社サイトのタブに `window.opener` を渡したまま遷移する。
  // 楽天・SBI 側は `content-script.spec.mjs` が同じ不変条件を見ている
  test('入れ子の項目のリンクは target="_blank" と rel="noopener noreferrer" を持つ',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page)

      const measured = await measureItemAsync(await openSubmenuAsync(page))
      expect(measured.target).toBe('_blank')
      expect(measured.rel).toBe('noopener noreferrer')
    })

  // 1-1 / 1-3: A-11 の2行目・A-5 の3行目。3か所とも同じ事実なので場所ごとに1件ずつ立てる
  for (const spot of ['アイコン列', '文字の右の余白', '行の上端寄り']) {
    test(`チャート起点: 入れ子の項目の${spot}を左クリックすると、文字の上と同じ URL が開く`,
      async ({ page, context, serveFixture }) => {
        await openChartPageAsync(page, serveFixture)
        await rightClickAsync(page, `[${CHART_MARK}]`)
        await openContextMenuAsync(page)

        const measured = await measureItemAsync(await openSubmenuAsync(page))
        expect(measured.href).toContain(CHART_CODE)
        await stubTargetAsync(context, measured.href)

        const point = outsideTextPoints(measured)[spot]
        await expectOutsideText(page, point, measured)

        const opened = await waitForStubPageAsync(context, () => page.mouse.click(point.x, point.y))
        expect(opened.url()).toBe(measured.href)
      })
  }

  // 1-2: A-13 の3行目。起点がウォッチリストの行でも同じ（項目の生成は共通。SPEC-CS-25 の 2-b）
  test('行起点: 入れ子の項目の文字の外を左クリックすると、文字の上と同じ URL が開く',
    async ({ page, context, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${ROW_MARK}]`)
      await openContextMenuAsync(page)

      const measured = await measureItemAsync(await openSubmenuAsync(page))
      // チャート(7203)ではなく右クリックした行(8253)の銘柄であること
      expect(measured.href).toContain(ROW_CODE)
      expect(measured.href).not.toContain(CHART_CODE)
      await stubTargetAsync(context, measured.href)

      const point = outsideTextPoints(measured).アイコン列
      await expectOutsideText(page, point, measured)

      const opened = await waitForStubPageAsync(context, () => page.mouse.click(point.x, point.y))
      expect(opened.url()).toBe(measured.href)
    })

  // 1-5: `delegating`（SPEC-CS-25）。代行で発火した `<a>` のクリックは同じ行へ戻ってくる。
  // 握り潰さないとハンドラが2回走り、他社サイトへ Esc を2回投げる（NFR-01 / CON-03）
  test('文字の外を左クリックしても、メニューを閉じる Esc の送出は1回だけ',
    async ({ page, context, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page)

      const measured = await measureItemAsync(await openSubmenuAsync(page))
      await stubTargetAsync(context, measured.href)

      await page.evaluate(() => {
        window.__escapes = 0
        document.addEventListener('keyup', (e) => {
          if (e.keyCode === 27) {
            window.__escapes++
          }
        })
      })

      const point = outsideTextPoints(measured).アイコン列
      await waitForStubPageAsync(context, () => page.mouse.click(point.x, point.y))

      await page.bringToFront()
      expect(await page.evaluate(() => window.__escapes)).toBe(1)
    })

  // 1-5: 利用者から見えるほうの事実（開く → 閉じる）。
  // 閉じるのは TradingView 自身の役割なので、フィクスチャが Esc を受けて閉じる分だけ演じる
  test('文字の外を左クリックするとメニューが閉じる', async ({ page, context, serveFixture }) => {
    await openChartPageAsync(page, serveFixture)
    await rightClickAsync(page, `[${CHART_MARK}]`)
    await openContextMenuAsync(page)

    const measured = await measureItemAsync(await openSubmenuAsync(page))
    await stubTargetAsync(context, measured.href)

    const point = outsideTextPoints(measured).アイコン列
    await waitForStubPageAsync(context, () => page.mouse.click(point.x, point.y))

    await expect(page.locator(`[${MENU_BOX_MARK}]`)).toHaveCount(0)
  })

  // 1-4: A-2 の2行目。「株Link」ボタンのメニューは行そのものにハンドラが付いており、
  // 1.16.0 でも変更していない（FR-25 判定基準 2-c は非退行の確認）
  //
  // **こちらの項目は `<a href>` を持たない。** `open-url` メッセージを受けた
  // Service Worker がタブを開く（SPEC-CS-12）ので、開く URL は
  // `chrome.tabs.create` を差し替えて見る（実サイトへ出ていかせないため。
  // `context.route` は Service Worker が開いたタブの初回要求には間に合わない）
  test('「株Link」ボタンのメニューも、項目の文字の外を左クリックで同じ URL を開く',
    async ({ page, serviceWorker, serveFixture }) => {
      const expected = await serviceWorker.evaluate(([key, code]) => {
        self.__openedUrls = []
        chrome.tabs.create = (props) => {
          self.__openedUrls.push(props.url)
          return Promise.resolve({})
        }
        return makeUrl(externalUrlsMap[key].url1, code)
      }, [ONLY_SITE_KEY, CHART_CODE])

      await openChartPageAsync(page, serveFixture)
      await page.locator('div.ktt-tv-kabuLinkMenu').click()

      // ボタンのメニュー項目は `<a>` を持たず、行のハンドラが開く（SPEC-CS-12）
      const item = page.locator('div.ktt-tv-menuBack tr[data-role="menuitem"]').first()
      await expect(item).toBeVisible()

      const iconCell = await item.locator('td[data-icon-cell="true"]').boundingBox()
      await page.mouse.click(iconCell.x + iconCell.width / 2, iconCell.y + iconCell.height / 2)

      await expect.poll(() => serviceWorker.evaluate(() => self.__openedUrls))
        .toEqual([expected])
    })
})

/** タブの URL に仕込む秘密値（ページの DOM に現れてはいけない。SPEC-CS-28） */
const BROKER_SECRET = 'KTTSECRET0123'

/**
 * Service Worker の `chrome.tabs.query` / `chrome.tabs.create` を差し替える（SPEC-CS-28）。
 *
 * **差し替えは無しで書けない。** 実タブを開くとテストが楽天証券へ出ていく
 * （CON-10 / 外部リクエストゼロの方針）。開いた URL は `self.__openedUrls` に積む
 * （「株Link」ボタンのテストと同じ手法）。
 * `loggedIn: false` なら `chrome.tabs.query` は常に `[]`（どちらにもログインしていない）
 * @returns {Promise<{ rakuten: string | null, naito: string | null }>} 差し替え後に SW で組み立てた期待 URL
 */
const stubBrokerTabsAsync = (serviceWorker, { loggedIn = true } = {}) =>
  serviceWorker.evaluate(async ([secret, code, loggedIn]) => {
    const tabUrls = loggedIn
      ? {
          'https://member.rakuten-sec.co.jp/*':
            `https://member.rakuten-sec.co.jp/app/home.do;BV_SessionID=${secret}?eventType=init`,
          'https://*.qhit.net/naito/iswebptt2/*':
            `https://example.qhit.net/naito/iswebptt2/stock?qcode=1301&sid=${secret}`
        }
      : {}
    chrome.tabs.query = async ({ url }) => {
      const tabUrl = tabUrls[url]
      return tabUrl == null ? [] : [{ url: tabUrl }]
    }
    self.__openedUrls = []
    chrome.tabs.create = (props) => {
      self.__openedUrls.push(props.url)
      return Promise.resolve({})
    }
    return {
      rakuten: await getRakutenSecUrlAsync('jp', code),
      naito: await getNaitoSecUrlAsync('jp', code)
    }
  }, [BROKER_SECRET, CHART_CODE, loggedIn])

/** 要素の中心を左クリックする */
const clickCenterAsync = async (page, locator) => {
  const box = await locator.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * 証券会社の項目（SPEC-CS-28 / SPEC-MSG-06 / ADR-0016）。
 *
 * 1.20.0 までは右クリック入れ子の「楽天証券で開く」が `<a href="…;BV_SessionID=<id>…">` で、
 * **ログイン中のセッション ID が TradingView のページ DOM に載っていた**（NFR-03）。
 * 項目は `<a>` を持たず、行のクリックで `*:open` を送って Service Worker が開く。
 * 起点はチャート（`CHART_CODE` = 7203。国内株なので両社が出る）
 */
test.describe('TradingView: 証券会社の項目は URL を DOM に出さない', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
  })

  /** 入れ子の中の、ラベルで引いた項目の行 */
  const submenuRow = (page, label) =>
    page.locator('div.ktt-tv-subMenu tr[data-role="menuitem"]').filter({ hasText: label })

  /** チャートを右クリックして入れ子を開く */
  const openBrokerSubmenuAsync = async (page, serveFixture) => {
    await openChartPageAsync(page, serveFixture)
    await rightClickAsync(page, `[${CHART_MARK}]`)
    await openContextMenuAsync(page)
    await openSubmenuAsync(page)
  }

  test('証券会社の項目は href を持たず、セッション ID をページの DOM に出さない',
    async ({ page, serviceWorker, serveFixture }) => {
      await stubBrokerTabsAsync(serviceWorker)
      await openBrokerSubmenuAsync(page, serveFixture)

      for (const label of ['楽天証券で開く', '内藤証券で開く']) {
        const row = submenuRow(page, label)
        await expect(row).toHaveCount(1)
        await expect(row.locator('a')).toHaveCount(0)
        await expect(row.locator('[href]')).toHaveCount(0)
      }

      const html = await page.content()
      for (const secret of [BROKER_SECRET, 'member.rakuten-sec.co.jp', 'qhit.net']) {
        expect(html).not.toContain(secret)
      }
    })

  for (const [spot, target] of [['文字の上', 'span[data-label]'], ['アイコン列', 'td[data-icon-cell]']]) {
    test(`楽天証券の項目の${spot}を左クリックすると、Service Worker が該当銘柄のページを開く`,
      async ({ page, context, serviceWorker, serveFixture }) => {
        const expected = await stubBrokerTabsAsync(serviceWorker)
        expect(expected.rakuten).toContain(CHART_CODE)
        await openBrokerSubmenuAsync(page, serveFixture)

        const opened = []
        context.on('page', (newPage) => opened.push(newPage))
        await clickCenterAsync(page, submenuRow(page, '楽天証券で開く').locator(target))

        await expect.poll(() => serviceWorker.evaluate(() => self.__openedUrls))
          .toEqual([expected.rakuten])
        // <a> 経由ではない（ページ側から新しいタブが開かれない）
        expect(opened).toHaveLength(0)
      })
  }

  test('内藤証券の項目を左クリックすると、Service Worker が該当銘柄のページを開く',
    async ({ page, context, serviceWorker, serveFixture }) => {
      const expected = await stubBrokerTabsAsync(serviceWorker)
      expect(expected.naito).toContain(`qcode=${CHART_CODE}`)
      await openBrokerSubmenuAsync(page, serveFixture)

      const opened = []
      context.on('page', (newPage) => opened.push(newPage))
      await clickCenterAsync(page, submenuRow(page, '内藤証券で開く').locator('span[data-label]'))

      await expect.poll(() => serviceWorker.evaluate(() => self.__openedUrls))
        .toEqual([expected.naito])
      expect(opened).toHaveLength(0)
    })

  // `<a>` が無いので代行クリックがバブルして戻る経路も無い（delegating は不要。SPEC-CS-28）
  test('証券会社の項目を左クリックすると、Esc の送出は1回でメニューが閉じる',
    async ({ page, serviceWorker, serveFixture }) => {
      const expected = await stubBrokerTabsAsync(serviceWorker)
      await openBrokerSubmenuAsync(page, serveFixture)

      await page.evaluate(() => {
        window.__escapes = 0
        document.addEventListener('keyup', (e) => {
          if (e.keyCode === 27) {
            window.__escapes++
          }
        })
      })

      await clickCenterAsync(page, submenuRow(page, '楽天証券で開く').locator('td[data-icon-cell]'))

      // 閉じた後でも送信は取り消されない（送ってから閉じる）
      await expect.poll(() => serviceWorker.evaluate(() => self.__openedUrls))
        .toEqual([expected.rakuten])
      expect(await page.evaluate(() => window.__escapes)).toBe(1)
      await expect(page.locator(`[${MENU_BOX_MARK}]`)).toHaveCount(0)
    })

  test('ログイン済みタブが無ければ証券会社の項目を出さない',
    async ({ page, serviceWorker, serveFixture }) => {
      await stubBrokerTabsAsync(serviceWorker, { loggedIn: false })
      await openBrokerSubmenuAsync(page, serveFixture)

      await expect(page.locator('div.ktt-tv-subMenu tr[data-role="menuitem"]')).not.toHaveCount(0)
      await expect(submenuRow(page, '楽天証券で開く')).toHaveCount(0)
      await expect(submenuRow(page, '内藤証券で開く')).toHaveCount(0)
    })
})

/**
 * 段階2: 縦位置の補正（FR-24 / SPEC-CS-24）。
 *
 * 拡張が3行を足すとメニューは下へ伸びるが、TradingView は伸びたことを知らない。
 * 伸ばした分は拡張が収める。**触るのはインラインの `margin-top` だけ。**
 *
 * メニューの箱の位置と高さは**テスト用のインラインスタイル**で決める（契約6）。
 * サイトの CSS の再現ではないので、数値そのものの妥当性は主張しない。
 */
test.describe('TradingView: 右クリックメニューの縦位置補正', () => {
  const VIEWPORT = { width: 900, height: 600 }

  /** 下端からはみ出す置き方（下端 = 700 > 600） */
  const OVERFLOWING = { left: 24, top: 500, height: 200 }

  /** 補正後の箱を測る */
  const measureMenuAsync = (page) => page.evaluate((mark) => {
    const menu = document.querySelector(`[${mark}]`)
    const { top, bottom } = menu.getBoundingClientRect()
    return { marginTop: menu.style.marginTop, top, bottom, innerHeight: window.innerHeight }
  }, MENU_BOX_MARK)

  /** `margin-top` が書かれるのを待つ（補正は次のフレームで1回だけ走る） */
  const waitForShiftAsync = async (page) => {
    await expect.poll(async () => (await measureMenuAsync(page)).marginTop).toMatch(/^-\d+px$/)
    return measureMenuAsync(page)
  }

  test.beforeEach(async ({ page, context, extensionId }) => {
    await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
    await page.setViewportSize(VIEWPORT)
  })

  // 2-1: A-18 の1行目
  test('下にはみ出すときは margin-top を負にして、箱の下端をウィンドウ内に収める',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page, OVERFLOWING)

      const measured = await waitForShiftAsync(page)
      expect(measured.bottom).toBeLessThanOrEqual(measured.innerHeight)
    })

  // 2-2: A-18 の2行目。上にずれた後でも入れ子が開き、項目から遷移できる
  test('ずらした後でも親行のホバーで入れ子が開き、項目のクリックでページが開く',
    async ({ page, context, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page, OVERFLOWING)
      await waitForShiftAsync(page)

      const measured = await measureItemAsync(await openSubmenuAsync(page))
      await stubTargetAsync(context, measured.href)

      const opened = await waitForStubPageAsync(context, () =>
        page.mouse.click(measured.text.left + 2, (measured.text.top + measured.text.bottom) / 2))
      expect(opened.url()).toBe(measured.href)
    })

  // 2-3: A-18 の3行目。下の見切れを上の見切れに置き換えない（サイト側の項目は上に並ぶ）
  test('ウィンドウより高いメニューでも、上端はウィンドウの外に出さない',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page, { left: 24, top: 100, height: VIEWPORT.height + 100 })

      const measured = await waitForShiftAsync(page)
      expect(measured.top).toBeGreaterThanOrEqual(0)
    })

  // 2-4: A-18 の4行目。下端に掛からない位置では今までと同じ場所に出す
  test('はみ出さない位置では margin-top を触らない', async ({ page, serveFixture }) => {
    await openChartPageAsync(page, serveFixture)
    await rightClickAsync(page, `[${CHART_MARK}]`)
    await openContextMenuAsync(page, { left: 24, top: 100, height: 200 })

    // 補正は次のフレームで走るので、走り終える時間を与えてから見る
    await page.waitForTimeout(300)
    const measured = await measureMenuAsync(page)
    expect(measured.marginTop).toBe('')
    expect(measured.top).toBe(100)
  })

  // 2-5: A-18 の6行目。補正は共通経路にあるので起点による差は無い
  test('ウォッチリストの行を起点にしても同じ補正が掛かる', async ({ page, serveFixture }) => {
    await openChartPageAsync(page, serveFixture)
    await rightClickAsync(page, `[${ROW_MARK}]`)
    await openContextMenuAsync(page, OVERFLOWING)

    const measured = await waitForShiftAsync(page)
    expect(measured.bottom).toBeLessThanOrEqual(measured.innerHeight)
  })

  /**
   * 0件経路（全サイトを無効にし、証券会社も未ログイン）を作る。
   *
   * 補正は**次のフレーム**で走るので、そのままだと 0 件の確定と競合する。
   * 証券会社への問い合わせの応答を遅らせて、**補正 → 0件の確定**の順に固定する
   * （Service Worker のスレッドを塞ぐ。SPEC-SW-06 の応答は同じ）
   */
  const makeMenuEmptyAsync = async (context, extensionId, serviceWorker) => {
    await setEnableLinkKeysAsync(context, extensionId, {})
    await serviceWorker.evaluate((ms) => {
      chrome.runtime.onMessage.addListener((request) => {
        if (request.type === 'rakuten-sec:info') {
          const until = Date.now() + ms
          while (Date.now() < until) { /* 応答を遅らせる */ }
        }
        return false
      })
    }, 300)
  }

  // 2-6: 遷移先が0件で3行を除去する経路（SPEC-CS-24 の手順5）。
  // **ずらしたときだけ書き戻す**ので、痕跡（`margin-top`）が残らない
  test('遷移先が0件で3行を除去するときは margin-top を元に戻す',
    async ({ page, context, extensionId, serviceWorker, serveFixture }) => {
      await makeMenuEmptyAsync(context, extensionId, serviceWorker)
      await openChartPageAsync(page, serveFixture)

      // `margin-top` の書き換えを取りこぼさないよう、メニューを足す前から見張る
      await page.evaluate((marks) => {
        const [overlapMark, boxMark] = marks
        window.__marginTops = []
        new MutationObserver(() => {
          const menu = document.querySelector(`[${boxMark}]`)
          window.__marginTops.push(menu == null ? null : menu.style.marginTop)
        }).observe(document.querySelector(`[${overlapMark}]`),
          { attributes: true, attributeFilter: ['style'], subtree: true })
      }, [OVERLAP_MARK, MENU_BOX_MARK])

      await rightClickAsync(page, `[${CHART_MARK}]`)
      await page.evaluate(([mark, html]) => {
        document.querySelector(`[${mark}]`).insertAdjacentHTML('beforeend', html)
      }, [OVERLAP_MARK, contextMenuHtml({ ...OVERFLOWING, marginTop: '12px' })])

      // 3行は同期的に足され、0件が確定してから取り除かれる
      await expect(page.locator('tr[data-kabu-tantan]')).toHaveCount(1)
      await expect(page.locator('tr[data-kabu-tantan]')).toHaveCount(0)

      const shifted = await page.evaluate(() => window.__marginTops)
      const measured = await measureMenuAsync(page)

      // 対照: 実際にずらしていた（ずらしていなければ書き戻しの経路を通らない）
      expect(shifted.some((value) => /^-\d+px$/.test(value)), JSON.stringify(shifted)).toBe(true)
      // 右クリック前の値に戻っている（拡張の痕跡を残さない）
      expect(measured.marginTop).toBe('12px')
    })

  // **「ずらしていないときは書き戻さない」（SPEC-CS-24 の 🟢6）は検査していない。**
  // `element.style.marginTop = ''` は、その要素が `margin-top` を持たなければ
  // **何も起きず `style` 属性も作られない**（Chromium 実測）。
  // 書き戻しを無条件にしても DOM から区別できないため、落とせるテストが書けない。
  // 実装（`shifted` フラグ）は 1.16.0 から入っている
})

/**
 * storage に残った未知のキー（SPEC-ST-03 / NFR-05。SPEC-CS-18 の検証を兼ねる）。
 *
 * サイト廃止で `externalUrls` から消えた key が storage に残っていても、
 * 入れ子の情報サイトの項目には出さず、残りを設定順に並べる。
 * 既存の describe は `beforeEach` で遷移先を `ONLY_SITE_KEY` の1件にする
 * （縦位置補正の0件経路だけは、テストの中で `{}` に入れ直す）。
 * 未知キーを含む設定は `beforeEach` で入れたいので、別の describe にする
 */
test.describe('TradingView: storage に残った未知のキー', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await setEnableLinkKeysAsync(context, extensionId, STALE_KEYS)
  })

  // ガード（makeLinkItemsAsync の `item != null`）が無いと項目の組み立てで TypeError になり、
  // addTickerMenuAsync の catch が3行ごと取り除くので、親行も入れ子も残らない
  test('未知のキーは入れ子の項目に出さず、残りの遷移先を設定順に並べる',
    async ({ page, serviceWorker, serveFixture }) => {
      // 証券会社の項目を出さない（入れ子を情報サイトの項目だけにする）
      await stubBrokerTabsAsync(serviceWorker, { loggedIn: false })
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page)
      await openSubmenuAsync(page)

      const actual = await page.locator('div.ktt-tv-subMenu tr[data-role="menuitem"] a').evaluateAll(
        (anchors) => anchors.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })))
      const expectedHrefs = await serviceWorker.evaluate(([keys, code]) =>
        keys.map((key) => makeUrl(externalUrlsMap[key].url1, code)),
      [['kabutan.jp/stock', 'minkabu.jp/stock'], CHART_CODE])

      // 未知キーの項目が無く、残りは設定順（externalUrls の定義順ではない）
      expect(actual.map((a) => a.text)).toEqual(['株探/基本情報で開く', 'MINKABU/株価情報トップで開く'])
      expect(actual.map((a) => a.href)).toEqual(expectedHrefs)
    })
})

/** 「株Link」ボタン（SPEC-CS-12） */
const KABU_LINK_BUTTON = 'div.ktt-tv-kabuLinkMenu'
/** 「株Link」ボタンのメニューの項目。メニューは全画面の背景の中に置かれる */
const BUTTON_MENU_ITEMS = 'div.ktt-tv-menuBack tr[data-role="menuitem"]'

/** 銘柄が取れない canvas の値（実サイトでもスクリーナー等へ移るとこう変わる前提。手動確認 A-8 で見る） */
const NOT_A_SYMBOL = 'スクリーナー'

/**
 * Service Worker の `chrome.tabs.create` だけを差し替え、開こうとした URL を `self.__openedUrls` に積む。
 * `chrome.tabs.query` は差し替えない（実際のタブを数えさせるとき用。証券会社の項目は `stubBrokerTabsAsync`）
 */
const stubTabsCreateAsync = (serviceWorker) => serviceWorker.evaluate(() => {
  self.__openedUrls = []
  chrome.tabs.create = (props) => {
    self.__openedUrls.push(props.url)
    return Promise.resolve({})
  }
})

/**
 * 「株Link」ボタンの表示の切り替え（FR-26 の段階5。手動確認 A-8 / A-12）。
 *
 * ボタンの表示は canvas の `aria-label` の監視で切り替わる（SPEC-CS-12）。
 * 銘柄の切り替えや、銘柄の無い画面への移動は、`setChartLabelAsync` で属性を書き換えて演じる
 */
test.describe('TradingView: 「株Link」ボタンの表示', () => {
  // A-8
  test('銘柄が取れない値に変わるとボタンが隠れ、銘柄に戻ると出る（属性が外れたときも同じ）',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      const button = page.locator(KABU_LINK_BUTTON)
      await expect(button).toBeVisible()

      for (const label of [NOT_A_SYMBOL, null]) {
        await setChartLabelAsync(page, label)
        await expect(button, `aria-label: ${label}`).toBeHidden()
        await setChartLabelAsync(page, chartLabel(`TSE:${CHART_CODE}`))
        await expect(button).toBeVisible()
      }
    })

  // A-12。ボタンと canvas の監視は同じ再試行の単位で設置する（SPEC-CS-22 / ADR-0008 の 4）。
  // 分けると「遅れて出たボタンが、銘柄を切り替えても隠れない」状態が作れてしまう（FR-13 判定基準6）
  test('ツールバーが遅れて出ても、再試行で足したボタンは1つで、銘柄の切り替えに追随して隠れる',
    async ({ page, context, extensionId, serviceWorker, serveFixture, externalRequests }) => {
      await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
      await stubTabsCreateAsync(serviceWorker)
      const expected = await serviceWorker.evaluate((key) =>
        makeUrl(externalUrlsMap[key].url3, 'AAPL'), ONLY_SITE_KEY)

      const world = await watchContentScriptAsync(context, page, extensionId, { countIntervals: true })
      await serveFixture(page, TRADINGVIEW_URL, tradingViewPageHtml({ toolbar: false }))
      await world.created
      const button = page.locator(KABU_LINK_BUTTON)

      // 初回（読み込みの 500ms 後）はツールバーが無く空振りし、再試行が回っている
      await expect.poll(() => world.activeIntervalsAsync()).toBe(1)
      await expect(button).toHaveCount(0)

      // ツールバーが現れると、再試行で足されて再試行は止まる
      await insertToolbarAsync(page)
      await expect(button).toHaveCount(1)
      await expect.poll(() => world.activeIntervalsAsync()).toBe(0)

      // 銘柄を切り替えると、ボタンのメニューは切り替えた後の銘柄を開く
      await setChartLabelAsync(page, chartLabel('NASDAQ:AAPL'))
      await button.click()
      await expect(page.locator(BUTTON_MENU_ITEMS)).toHaveCount(1)
      await page.locator(BUTTON_MENU_ITEMS).click()
      await expect.poll(() => serviceWorker.evaluate(() => self.__openedUrls)).toEqual([expected])

      // 銘柄が取れない画面へ移ると隠れる（canvas の監視も再試行の側で張られている）
      await setChartLabelAsync(page, NOT_A_SYMBOL)
      await expect(button).toBeHidden()
      await expect(button).toHaveCount(1)
    })
})

/**
 * 「株Link」ボタンのメニューの中身（FR-26 の段階4 の一部。手動確認 A-7b / B-1）。
 * 項目は `<a>` を持たず、押すと Service Worker がタブを開く（SPEC-CS-12）。
 * どのテストも `chrome.tabs.create` を差し替え、実サイトへの要求を `externalRequests` で検査する
 */
test.describe('TradingView: 「株Link」ボタンのメニュー', () => {
  // A-7b の最終行。米国株で url3 を持たない遷移先だけが有効で、証券会社のタブも無いと遷移先が0件になる。
  // 背景を先に敷く実装に戻ると、透明な全画面の層が残ってページのクリックを吸う（NFR-14）
  test('米国株で遷移先が0件なら、押してもメニューも背景も出ず、ページのクリックがそのまま届く',
    async ({ page, context, extensionId, serviceWorker, serveFixture, externalRequests }) => {
      // 日本経済新聞・四季報はどちらも url3 を持たない
      await setEnableLinkKeysAsync(context, extensionId,
        { 'www.nikkei.com/company': 0, 'shikiho.toyokeizai.net/stocks': 1 })
      await stubBrokerTabsAsync(serviceWorker, { loggedIn: false })
      await openChartPageAsync(page, serveFixture)
      const button = page.locator(KABU_LINK_BUTTON)

      await setChartLabelAsync(page, chartLabel('NASDAQ:AAPL'))
      await recordAddedNodesAsync(page)
      await button.click()
      // Service Worker への問い合わせを待ってから背景を敷くので、その分を待つ
      await page.waitForTimeout(500)

      await expect(page.locator('div.ktt-tv-menuBack')).toHaveCount(0)
      expect(await addedNodesAsync(page)).toEqual([])
      expect(await clickReceiverAsync(page, page.locator(`[${CHART_MARK}] canvas`))).toBe('canvas')

      // 対照: 同じ設定でも国内株なら2件のメニューが出る（0件以外の経路は生きている）
      await setChartLabelAsync(page, chartLabel(`TSE:${CHART_CODE}`))
      await button.click()
      await expect(page.locator(BUTTON_MENU_ITEMS)).toHaveCount(2)
    })

  // B-1（と B-2 の対照）。楽天証券のタブは実際に開く（フィクスチャで差し替える）。
  // `chrome.tabs.query` は差し替えないので、Service Worker が実際のタブを数える（SPEC-MSG-06）
  test('楽天証券のログイン済みタブが無ければ「楽天証券を開く」を出さず、開くと出し、閉じると消す',
    async ({ page, context, serviceWorker, serveFixture, externalRequests }) => {
      await stubTabsCreateAsync(serviceWorker)
      await openChartPageAsync(page, serveFixture)

      /** ボタンのメニューの項目名を読んで、メニューを閉じる */
      const buttonMenuLabelsAsync = async () => {
        await page.locator(KABU_LINK_BUTTON).click()
        const items = page.locator(BUTTON_MENU_ITEMS)
        await expect(items).not.toHaveCount(0)
        const labels = (await items.allTextContents()).map((label) => label.trim())
        // キーを押すとメニューが閉じる（SPEC-CS-12）
        await page.keyboard.press('Escape')
        await expect(page.locator('div.ktt-tv-menuBack')).toHaveCount(0)
        return labels
      }

      expect(await buttonMenuLabelsAsync()).not.toContain('楽天証券を開く')

      const rakuten = await context.newPage()
      await serveFixture(rakuten,
        `https://member.rakuten-sec.co.jp/app/home.do;BV_SessionID=${BROKER_SECRET}?eventType=init`,
        '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>楽天証券</title></head><body></body></html>')
      await page.bringToFront()
      const withTab = await buttonMenuLabelsAsync()
      expect(withTab[0]).toBe('楽天証券を開く')
      // タブの URL（セッション ID）はページに出ない（SPEC-MSG-06）
      expect(await page.content()).not.toContain(BROKER_SECRET)

      await rakuten.close()
      expect(await buttonMenuLabelsAsync()).not.toContain('楽天証券を開く')
    })
})

/**
 * 段階3: 起点の判定（FR-19 / SPEC-CS-23。手動確認 A-13〜A-17 の (a) の 11 行）。
 *
 * ウォッチリストの行を起点にするかは、行の属性の**値の形**（`EXCHANGE:CODE`）で決まる。
 * 指数・FX などの行は形を満たすが解釈できないので、起点を捨てて何も出さない（チャートへ落とさない）。
 * 行の差し替え（スクロール・別のリストへの切り替え）は `setWatchlistRowsAsync` で演じる。
 * サイト側の実 DOM（行の属性名が実在するか・ほかのウィジェットで出ないか）は見ない（CON-08。A-17 の2行目に残る）
 */
test.describe('TradingView: ウォッチリストの行を起点にする（FR-19）', () => {
  /** 行の目印の値（`EXCHANGE:CODE`）で行を選ぶ */
  const rowOf = (symbol) => `[${ROW_MARK}="${symbol}"]`

  /**
   * 右クリックのあとにメニューを足し、拡張が足すかどうかが決まるまで進める。
   * 拡張はメニューの出現の監視（MutationObserver）の中で、3行を同期的に足すか、何もせずに抜ける
   * （SPEC-CS-11 / SPEC-CS-23）。ページの中で1回 `setTimeout` を回せば、その判断は済んでいる。
   * **`addTickerMenuAsync()` が3行を `await` の前に足すことに依存している。** 足す処理が `await` の後ろへ移ると、
   * 「何も出ない」を見るテストは、出るべきものが遅れて出る退行を見逃す（同じテストの最後の「国内株の行なら出る」が空振りを防ぐのは、出ない側だけ）
   */
  const insertContextMenuAndSettleAsync = async (page) => {
    await page.evaluate(([mark, html]) => {
      document.querySelector(`[${mark}]`).insertAdjacentHTML('beforeend', html)
    }, [OVERLAP_MARK, contextMenuHtml()])
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
  }

  /** サイトの役割で Esc を押してメニューを閉じる（拡張の3行もメニューごと消える） */
  const closeContextMenuAsync = async (page) => {
    await page.keyboard.press('Escape')
    await expect(page.locator(`[${MENU_BOX_MARK}]`)).toHaveCount(0)
  }

  /** 入れ子の項目の文言と href */
  const submenuItemsAsync = (page) => page.locator('div.ktt-tv-subMenu tr[data-role="menuitem"] a').evaluateAll(
    (anchors) => anchors.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })))

  test.beforeEach(async ({ serviceWorker }) => {
    // 証券会社の項目を出さない（入れ子を情報サイトの項目だけにする）
    await stubBrokerTabsAsync(serviceWorker, { loggedIn: false })
  })

  // 3-1: A-13 の1行目（FR-19 判定基準 1・2）
  test('国内株の行を右クリックすると、チャートの銘柄ではなく行の銘柄で「<コード> を開く」が出る',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)

      const menu = page.locator(`[${MENU_BOX_MARK}]`)
      await expect(menu).toContainText(`${ROW_CODE} を開く`)
      await expect(menu).not.toContainText(`${CHART_CODE} を開く`)
    })

  // 3-2: A-13 の2行目
  test('国内株の行から入れ子の項目を押すと、行の銘柄のページが新しいタブで開く',
    async ({ page, context, extensionId, serviceWorker, serveFixture }) => {
      await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
      const expected = await serviceWorker.evaluate(([key, code]) =>
        makeUrl(externalUrlsMap[key].url1, code), [ONLY_SITE_KEY, ROW_CODE])
      await stubTargetAsync(context, expected)

      await openChartPageAsync(page, serveFixture)
      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)
      const item = await openSubmenuAsync(page)
      const opened = await waitForStubPageAsync(context, () => item.locator('a').click())

      expect(opened.url()).toBe(new URL(expected).href)
    })

  // 3-3: A-14 の1行目（FR-19 判定基準 6 / FR-07）
  test('米国株の行では「<ティッカー> を開く」になり、入れ子には米国株に対応した遷移先だけが設定順に並ぶ',
    async ({ page, context, extensionId, serviceWorker, serveFixture }) => {
      // 全サイトを定義の逆順で有効にする（定義順と区別して「設定順」を見る）。
      // TradingView の上では TradingView 自身を出さない（FR-07）
      const keys = await serviceWorker.evaluate(() => externalUrls.map((entry) => entry.key).reverse())
      await setEnableLinkKeysAsync(context, extensionId, Object.fromEntries(keys.map((key, index) => [key, index])))
      const expected = await serviceWorker.evaluate(([order, ticker]) => order
        .map((key) => externalUrlsMap[key])
        .filter((entry) => entry.key.indexOf('tradingview.com') !== 0 && entry.url3)
        .map((entry) => ({ text: `${entry.title}で開く`, href: makeUrl(entry.url3, ticker) })), [keys, 'AAPL'])
      expect(expected.length).toBeGreaterThan(1)

      await openChartPageAsync(page, serveFixture)
      await setWatchlistRowsAsync(page, [`TSE:${ROW_CODE}`, 'NASDAQ:AAPL'])
      await rightClickAsync(page, rowOf('NASDAQ:AAPL'))
      await openContextMenuAsync(page)
      await expect(page.locator(`[${MENU_BOX_MARK}]`)).toContainText('AAPL を開く')
      await openSubmenuAsync(page)

      expect(await submenuItemsAsync(page)).toEqual(expected)
    })

  // 3-4: A-14 の2行目
  test('米国株の行から入れ子の項目を押すと、そのティッカーのページが新しいタブで開く',
    async ({ page, context, extensionId, serviceWorker, serveFixture }) => {
      await setEnableLinkKeysAsync(context, extensionId, { [ONLY_SITE_KEY]: 0 })
      const expected = await serviceWorker.evaluate(([key, ticker]) =>
        makeUrl(externalUrlsMap[key].url3, ticker), [ONLY_SITE_KEY, 'AAPL'])
      await stubTargetAsync(context, expected)

      await openChartPageAsync(page, serveFixture)
      await setWatchlistRowsAsync(page, ['NASDAQ:AAPL'])
      await rightClickAsync(page, rowOf('NASDAQ:AAPL'))
      await openContextMenuAsync(page)
      const item = await openSubmenuAsync(page)
      const opened = await waitForStubPageAsync(context, () => item.locator('a').click())

      expect(opened.url()).toBe(new URL(expected).href)
    })

  // 3-5〜3-8: A-15 の4行（FR-19 判定基準 7 / FR-08）
  test('指数・FX・暗号資産・クラス株の行では、拡張の項目を1つも出さず、チャートの銘柄も出さない',
    async ({ page, serveFixture }) => {
      const excluded = ['SP:SPX', 'TVC:NI225', 'FX:USDJPY', 'BINANCE:BTCUSDT', 'NYSE:BRK.B', 'NYSE:BRK-B']

      await openChartPageAsync(page, serveFixture)
      await setWatchlistRowsAsync(page, [...excluded, `TSE:${ROW_CODE}`])
      const menu = page.locator(`[${MENU_BOX_MARK}]`)

      for (const symbol of excluded) {
        await rightClickAsync(page, rowOf(symbol))
        await insertContextMenuAndSettleAsync(page)

        // サイト自身のメニューはそのまま出ている
        await expect(menu, symbol).toHaveCount(1)
        await expect(page.locator('tr[data-kabu-tantan]'), symbol).toHaveCount(0)
        await expect(menu, symbol).not.toContainText('を開く')

        await closeContextMenuAsync(page)
      }

      // 空振りでないことの担保: 同じページで、国内株の行なら出る
      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)
      await expect(menu).toContainText(`${ROW_CODE} を開く`)
    })

  // 3-9: A-16 の1行目（FR-19 判定基準 8）
  test('スクロールで行が作り直されたあとも、右クリックした行の銘柄が出る',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      await setWatchlistRowsAsync(page, [`TSE:${ROW_CODE}`, 'TSE:6758'])
      const menu = page.locator(`[${MENU_BOX_MARK}]`)

      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)
      await expect(menu).toContainText(`${ROW_CODE} を開く`)
      await closeContextMenuAsync(page)

      // スクロールで上の行が消え、見えていなかった行が作られる
      await setWatchlistRowsAsync(page, ['TSE:6758', 'TSE:9984'])
      await rightClickAsync(page, rowOf('TSE:9984'))
      await openContextMenuAsync(page)

      await expect(menu).toContainText('9984 を開く')
      await expect(menu).not.toContainText(`${ROW_CODE} を開く`)
    })

  // 3-10: A-16 の2行目（FR-19 判定基準 8）
  test('別のウォッチリストへ切り替えたあとも、切り替え先の行の銘柄が出る（切り替え前の銘柄は出ない）',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      const menu = page.locator(`[${MENU_BOX_MARK}]`)

      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)
      await expect(menu).toContainText(`${ROW_CODE} を開く`)
      await closeContextMenuAsync(page)

      await setWatchlistRowsAsync(page, ['TSE:4063', 'NASDAQ:MSFT'])
      await rightClickAsync(page, rowOf('TSE:4063'))
      await openContextMenuAsync(page)

      await expect(menu).toContainText('4063 を開く')
      await expect(menu).not.toContainText(`${ROW_CODE} を開く`)
    })

  // 3-12: SPEC-CS-23「チャート起点を構造的に守る」（行と見なすのは値が EXCHANGE:CODE の形のときだけ）
  test('チャートの中の要素が行と同じ名前の属性を形でない値で持っていても、チャートの銘柄を出す',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      const menu = page.locator(`[${MENU_BOX_MARK}]`)

      for (const values of [['main', CHART_CODE], ['nyse:aapl', 'AAPL']]) {
        await page.evaluate((mark) => document.querySelectorAll(`[${mark}]`).forEach((element) => element.remove()), CHART_ATTR_MARK)
        await addChartElementWithRowAttrsAsync(page, values)

        await rightClickAsync(page, `[${CHART_ATTR_MARK}]`)
        await openContextMenuAsync(page)

        await expect(menu, values.join(' / ')).toContainText(`${CHART_CODE} を開く`)
        await closeContextMenuAsync(page)
      }
    })

  // 3-11: A-17 の1行目（FR-04 の非退行）
  test('ウォッチリストの行を使ったあとでも、チャートの右クリックはチャートの銘柄を出す',
    async ({ page, serveFixture }) => {
      await openChartPageAsync(page, serveFixture)
      const menu = page.locator(`[${MENU_BOX_MARK}]`)

      await rightClickAsync(page, rowOf(`TSE:${ROW_CODE}`))
      await openContextMenuAsync(page)
      await closeContextMenuAsync(page)

      await rightClickAsync(page, `[${CHART_MARK}]`)
      await openContextMenuAsync(page)

      await expect(menu).toContainText(`${CHART_CODE} を開く`)
      await expect(menu).not.toContainText(`${ROW_CODE} を開く`)
    })
})

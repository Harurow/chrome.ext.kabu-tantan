import { test, expect } from './fixtures/extension.mjs'
import { STALE_KEYS } from './fixtures/storage.mjs'

const openOptions = async (page, extensionId) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await expect(page.locator('#link-list li.collection-item').first()).toBeVisible()
}

test.describe('オプションページ', () => {
  test('全ての連携サイトが一覧表示される', async ({ page, extensionId, serviceWorker }) => {
    await openOptions(page, extensionId)

    const expected = await serviceWorker.evaluate(() => externalUrls.map((u) => u.key))
    const rendered = await page.locator('#link-list li.collection-item').evaluateAll(
      (items) => items.map((li) => li.id))

    expect(rendered).toEqual(expected)
  })

  test('初期状態では全てのトグルが ON', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    const checkboxes = page.locator('input.link-list-item')
    const total = await checkboxes.count()
    expect(total).toBeGreaterThan(0)
    expect(await page.locator('input.link-list-item:checked').count()).toBe(total)
  })

  // Materialize 2.x で .row が CSS Grid 化し .col が廃止されたため、
  // .sN が .row の直接の子でないとレイアウトが崩れる（回帰テスト）
  test('行がグリッドとして横並びにレイアウトされる', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    const row = page.locator('#link-list li.collection-item').first()
    await expect(row).toHaveCSS('display', 'grid')

    const boxes = await row.locator(':scope > *').evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect()))

    expect(boxes.length).toBe(4)
    // 全ての子が同じ行に並ぶ（縦積みになっていない）
    for (const box of boxes) {
      expect(Math.abs(box.top - boxes[0].top)).toBeLessThan(box.height)
      expect(box.width).toBeGreaterThan(0)
    }
    // 左から右へ重ならずに並ぶ
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].left)
    }
  })

  test('トグルを OFF にして保存すると設定が永続化される', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    const target = page.locator('#link-list li.collection-item').first()
    const targetKey = await target.getAttribute('id')

    // 保存ボタンは変更があるまで隠れている
    const save = page.locator('#save')
    await expect(save).toHaveClass(/scale-out/)

    // Materialize のスイッチは input を視覚的に隠すため、lever をクリックして切り替える
    await target.locator('span.lever').click()
    await expect(target.locator('input.link-list-item')).not.toBeChecked()
    await expect(save).toHaveClass(/scale-in/)

    await save.click()
    await expect(save).toHaveClass(/scale-out/)

    // 保存内容を chrome.storage.sync から直接検証する
    const stored = await page.evaluate(async () => {
      const s = await chrome.storage.sync.get('enableLinkKeys')
      return s.enableLinkKeys
    })
    expect(Object.keys(stored)).not.toContain(targetKey)

    // 再読み込みしても OFF のまま
    // key には '.' や '/' が含まれるため id セレクタではなく属性セレクタで参照する
    await openOptions(page, extensionId)
    await expect(page.locator(`#link-list li[id="${targetKey}"] input.link-list-item`))
      .not.toBeChecked()
  })

  // jQuery UI 1.14.2 の sortable が jQuery 4 上で動くことの検証も兼ねる
  test('ハンドルをドラッグして並び替えた順序が保存される', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    const rows = page.locator('#link-list li.collection-item')
    const before = await rows.evaluateAll((items) => items.map((li) => li.id))

    const firstHandle = rows.first().locator('i.handle')
    const thirdRow = rows.nth(2)

    const from = await firstHandle.boundingBox()
    const to = await thirdRow.boundingBox()

    // sortable の distance: 8 を超えるよう段階的に動かす
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 5, { steps: 10 })
    await page.mouse.up()

    const after = await rows.evaluateAll((items) => items.map((li) => li.id))
    expect(after).not.toEqual(before)
    expect([...after].sort()).toEqual([...before].sort())

    // 並び替えで保存ボタンが有効になり、順序が storage に反映される
    const save = page.locator('#save')
    await expect(save).toHaveClass(/scale-in/)
    await save.click()
    await expect(save).toHaveClass(/scale-out/)

    const stored = await page.evaluate(async () => {
      const s = await chrome.storage.sync.get('enableLinkKeys')
      return Object.keys(s.enableLinkKeys).sort((a, b) => s.enableLinkKeys[a] - s.enableLinkKeys[b])
    })
    expect(stored).toEqual(after)
  })

  test('各行のリンクが url0 を新規タブで開く設定になっている', async ({ page, extensionId, serviceWorker }) => {
    await openOptions(page, extensionId)

    const urlMap = await serviceWorker.evaluate(() =>
      Object.fromEntries(externalUrls.map((u) => [u.key, u.url0])))

    const links = await page.locator('#link-list li.collection-item').evaluateAll(
      (items) => items.map((li) => {
        const a = li.querySelector('a.item-link')
        return { key: li.id, href: a?.getAttribute('href'), rel: a?.getAttribute('rel'), target: a?.getAttribute('target') }
      }))

    for (const link of links) {
      expect(link.href).toBe(urlMap[link.key])
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
    }
  })

  // セキュリティ/プライバシー回帰テスト:
  // 以前は Google Fonts・TradingView・shields.io へ実行時リクエストしていた
  test('外部ホストへ一切リクエストしない', async ({ page, extensionId }) => {
    const external = []
    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith(`chrome-extension://${extensionId}/`) && !url.startsWith('data:')) {
        external.push(url)
      }
    })

    await openOptions(page, extensionId)
    await page.waitForTimeout(500)

    expect(external).toEqual([])
  })

  // フォントはサブセット化してある。アイコンを増やしたときは
  // docs/ARCHITECTURE.md の手順で再サブセットしないとリガチャが効かず文字列のまま表示される
  test('Material Icons がローカル同梱フォントとして読み込まれリガチャが効く', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    await expect(page.locator('i.material-icons.handle').first()).toBeVisible()

    const result = await page.evaluate(async () => {
      await document.fonts.ready

      const measure = (text) => {
        const el = document.createElement('span')
        el.className = 'material-icons'
        el.textContent = text
        el.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'
        document.body.appendChild(el)
        const width = el.getBoundingClientRect().width
        el.remove()
        return width
      }

      return {
        available: document.fonts.check('24px "Material Icons"'),
        widths: Object.fromEntries(
          ['save', 'open_in_new', 'drag_handle', 'show_chart'].map((n) => [n, measure(n)]))
      }
    })

    expect(result.available).toBe(true)

    // リガチャが効けば 1 グリフ (font-size: 24px) に畳まれる。
    // 効かなければ元の文字列がそのまま描画され、桁違いに横長になる
    for (const [name, width] of Object.entries(result.widths)) {
      expect(width, `${name} のリガチャが効いていない`).toBeGreaterThan(0)
      expect(width, `${name} のリガチャが効いていない`).toBeLessThan(40)
    }
  })

  // SPEC-ST-03 / NFR-05: サイト廃止で消えた key が storage に残っていても、その行だけ作らない。
  // ガード（`if (item)`）が無いと createItem(undefined) が TypeError を投げ、
  // 未知キーより後ろの行が1つも作られない
  test('storage に残った未知のキーは行を作らず、有効な行を保存順に並べる', async ({ page, extensionId, serviceWorker }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await page.evaluate((staleKeys) => chrome.storage.sync.set({ enableLinkKeys: staleKeys }), STALE_KEYS)
    await openOptions(page, extensionId)

    // 有効な行が保存順に先に並び、残りは externalUrls の定義順
    const expected = await serviceWorker.evaluate(() => [
      'kabutan.jp/stock',
      'minkabu.jp/stock',
      ...externalUrls.map((u) => u.key).filter((k) => k !== 'kabutan.jp/stock' && k !== 'minkabu.jp/stock')
    ])

    const rendered = await page.locator('#link-list li.collection-item').evaluateAll(
      (items) => items.map((li) => li.id))
    expect(rendered).toEqual(expected)

    const checked = await page.locator('input.link-list-item:checked').evaluateAll(
      (inputs) => inputs.map((input) => input.value))
    expect(checked).toEqual(['kabutan.jp/stock', 'minkabu.jp/stock'])

    expect(pageErrors).toEqual([])
  })

  // SPEC-ST-03 / SPEC-ST-05: 保存は DOM 上の行（input.link-list-item）だけから組み立てるので、
  // 行を持たない未知キーは書き戻されない。順序の値も詰め直される
  test('storage に残った未知のキーは、保存し直すと消える', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    await page.evaluate((staleKeys) => chrome.storage.sync.set({ enableLinkKeys: staleKeys }), STALE_KEYS)
    await openOptions(page, extensionId)

    // 保存ボタンを出すため、トグルを OFF → ON と往復させる（有効な遷移先は変えない）
    const row = page.locator('#link-list li[id="kabutan.jp/stock"]')
    await row.locator('span.lever').click()
    await expect(row.locator('input.link-list-item')).not.toBeChecked()
    await row.locator('span.lever').click()
    await expect(row.locator('input.link-list-item')).toBeChecked()

    const save = page.locator('#save')
    await expect(save).toHaveClass(/scale-in/)
    await save.click()
    await expect(save).toHaveClass(/scale-out/)

    const stored = await page.evaluate(async () => {
      const s = await chrome.storage.sync.get('enableLinkKeys')
      return s.enableLinkKeys
    })
    expect(stored).toEqual({ 'kabutan.jp/stock': 0, 'minkabu.jp/stock': 1 })
  })
})

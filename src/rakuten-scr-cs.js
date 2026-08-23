$(() => {
  setTimeout(attachAsync, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attachAsync = async () => {
  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  // 利用するURLリスト
  // 門を通った後に拡張機能が更新される場合に備えて網(try)も張る
  let keys
  try {
    keys = await getEnableLinkKeysAsync()
  } catch {
    return
  }

  // ページ変更の対応のために監視する
  const target = $('div#resultpanel div.pagenavcontrolbox')[0]
  if (!target) {
    return
  }

  const observer = new MutationObserver(() => {
    // 切断状態では注入を止め、監視も外す(復帰手段が無く、監視を続けても無駄に走るだけ。SPEC-CS-19)
    if (!isExtensionAlive()) {
      observer.disconnect()
      return
    }

    // ページ変更対応
    mutationObserverCallback(keys)
  })

  observer.observe(target, { childList: true })

  // 初期ページ対応
  mutationObserverCallback(keys)
}

/**
 * ページ変更に伴い再度リンクメニューをアタッチ
 * @param { string[] } keys
 */
const mutationObserverCallback = (keys) => {
  // 設定に従い一つづつ試す
  menuSelectors
    .forEach((menuSelector) => {
      $(menuSelector.selector)
        .each((_, element) => attachMenu(element, keys))
    })
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element
 * @param { string[] } keys
 */
const attachMenu = (element, keys) => {
  const text = $(element).text()
  const match = text.trim().match(/[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/g)

  if (!match) {
    return
  }

  const tickerCode = match[0]
  const childNodes = element.childNodes

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i]
    if (node.nodeName !== '#text' || node.nodeValue.indexOf(tickerCode) === -1) {
      continue
    }

    const menu = createMenu(keys, tickerCode, node.nodeValue, true)
    $('ul.x-kabu-body', menu).css({ marginTop: -3 })
    element.replaceChild(menu[0], node)
  }
}

/**
 * 改変情報
 * @type { { title: string, url: string, selector: string }[] }
 */
const menuSelectors = [
  {
    title: 'スーパースクリーナー',
    selector: 'div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a'
  },
]

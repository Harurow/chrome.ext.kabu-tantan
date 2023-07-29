$(() => {
  setTimeout(attachAsync, 1500)
})

/**
 * ページを改変するエントリポイント
 */
const attachAsync = async () => {
  // 利用するURLリスト
  const keys = await getEnableLinkKeysAsync()

  // ページ変更の対応のために監視する
  const target = $('div#root div.App div.Screener div.resultpane')[0]
  if (!target) {
    return
  }
  
  const observer = new MutationObserver(() => {
    // ページ変更対応
    mutationObserverCallback(keys)
  })

  observer.observe(target, { childList: true, subtree: true } )

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
  const match = text.trim().match(/\d{4}/g)

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

    const menu = createMenu(keys, tickerCode, node.nodeValue)
    element.replaceChild(menu[0], node)
  }
}

/**
 * 改変情報
 * @type { { selector: string }[] }
 */
const menuSelectors = [
  {
    title: "スクリーナー",
    selector: 'div#root div.App div.Screener div.resultpane div.ResultListMainDiv table.leftTable tr td.c.fixedtable:nth-of-type(1)'
  }
]

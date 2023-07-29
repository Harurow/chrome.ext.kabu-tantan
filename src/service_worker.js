importScripts('./urls.js')

const remakeContextMenus = async () => {
  // 利用するURLリスト
  const keys = await getEnableLinkKeysAsync()

  // コンテキストメニューを一旦全て削除
  await chrome.contextMenus.removeAll()

  // 有効なURLリストをコンテキストメニューへ追加
  keys.forEach((key) => {
    chrome.contextMenus.create({
      id: key,
      title: externalUrlsMap[key].title,
      contexts: ['selection']
    })
  });
}

/**
 * 文字列から銘柄コードを取得する
 * @param {string} text 解析する文字列
 * @returns {(
 *   { status: false } |
 *   { status: true, type: 'jp', code: string } |
 *   { status: true, type: 'us', code: string, exchange?: 'NASDAQ' | 'NYSE' }
 *  )}
 */
const getTickerCode = (text) => {
  let match = text.match(/^\s*(\d{4})\s*/)
  if (match) {
    return { status: true, type: 'jp', code: match[1] }
  }
  match = text.match(/\s*([A-Z]{1,5})\s*(NASDAQ|NYSE)\s*/)
  if (match) {
    return { status: true, type: 'us', code: match[1], exchange: match[2] }
  }
  match = text.match(/\s*([A-Z]{1,5})\s*/)
  if (match) {
    return { status: true, type: 'us', code: match[1] }
  }
  return { status: false }
}

/**
 * 画面遷移先のURLを作成する
 * @param {'jp' | 'us'} type 国内銘柄か米国銘柄かを表す
 * @param {string} code 銘柄コード
 * @param {'NASDAQ' | 'NYSE' | undefined } exchange 米国株の場合の証券取引所コード
 * @param {string} url1 国内用URL
 * @param {string?} url2 米国用URL（証券取引所コードあり）
 * @param {string?} url3 米国用URL（証券取引所コードなし）
 * @returns { string | undefined } 遷移先URL
 */
const getUrl = (type, code, exchange, url1, url2, url3) => {
  if (type === 'jp') {
    return makeUrl(url1, code)
  } else if (type === 'us' && url2 && exchange) {
    return makeUrl(url2, code, exchange)
  } else if (type === 'us' && url3) {
    return makeUrl(url3, code)
  }
  return undefined
}

chrome.runtime.onInstalled.addListener((details) => {
  remakeContextMenus()

  if (details.reason === 'install' || details.previousVersion < "1.0.9") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage()
    } else {
      window.open(chrome.runtime.getURL('options.html'))
    }
  }
})

chrome.runtime.onStartup.addListener(() => {
  remakeContextMenus()
})

chrome.storage.onChanged.addListener((changes, namespace) => {
  remakeContextMenus()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const key = info.menuItemId
  const selectionText = info.selectionText
  const { status, type, code, exchange } = getTickerCode(selectionText)
  
  if (!status) {
    return
  }
  
  const externalInfo = externalUrlsMap[key]
  if (!externalInfo) {
    console.error(`unknown key: ${key}`)
    return
  }

  const { url1, url2, url3 } = externalInfo
  const url = getUrl(type, code, exchange, url1, url2, url3)

  if (url) {
    chrome.tabs.create({url})
  }
})

chrome.action.onClicked.addListener((tab) => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage()
  } else {
    window.open(chrome.runtime.getURL('options.html'))
  }
})
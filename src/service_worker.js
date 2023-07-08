chrome.contextMenus.create({
  id: 'kabutan',
  title: '株探/基本情報',
  contexts: ['selection']
})

chrome.contextMenus.create({
  id: 'yahoo',
  title: 'Yahoo! ファイナス/掲示板',
  contexts: ['selection']
})

chrome.contextMenus.create({
  id: 'tradingview',
  title: 'TradingView/高機能チャート',
  contexts: ['selection']
})

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  const matches = info.selectionText.match(/\d{4}/g)
  if (!matches) {
    console.log('銘柄コードが見つかりません')
    return
  }

  const tickerCode = matches[0]

  let url = null
  switch (info.menuItemId) {
    case 'kabutan':
      url = `https://kabutan.jp/stock/?code=${tickerCode}`
      break
    case 'yahoo':
      url = `https://finance.yahoo.co.jp/quote/${tickerCode}/bbs`
      break
    case 'tradingview':
      url = `https://jp.tradingview.com/chart/?symbol=TSE%3A${tickerCode}`
      break
  }

  if (url) {
    chrome.tabs.create({url})
  }
})
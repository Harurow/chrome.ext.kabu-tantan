chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'tradingview',
    title: 'TradingView/高機能チャート',
    contexts: ['selection']
  })
  
  chrome.contextMenus.create({
    id: 'kabutan',
    title: '株探/基本情報',
    contexts: ['selection']
  })
  
  chrome.contextMenus.create({
    id: 'minkabu',
    title: 'MINKABU/株価情報トップ',
    contexts: ['selection']
  })
  
  chrome.contextMenus.create({
    id: 'yahoo',
    title: 'Yahoo! ファイナス/掲示板',
    contexts: ['selection']
  })
})

function tokyo(info) {
  const match = info.selectionText.match(/\d{4}/g)
  if (!match) {
    return false
  }

  const tickerCode = match[0]

  let url = null
  switch (info.menuItemId) {
    case 'tradingview':
      url = `https://jp.tradingview.com/chart/?symbol=TSE%3A${tickerCode}`
      break
    case 'kabutan':
      url = `https://kabutan.jp/stock/?code=${tickerCode}`
      break
    case 'minkabu':
      url = `https://minkabu.jp/stock/${tickerCode}`
      break
    case 'yahoo':
      url = `https://finance.yahoo.co.jp/quote/${tickerCode}/bbs`
      break
  }

  if (url) {
    chrome.tabs.create({url})
  }
  return true
}

function newyork1(info) {
  const match = info.selectionText.match(/\s*([A-Z]{1,5})\s*(NASDAQ|NYSE)\s*/)
  if (!match) {
    return false
  }

  let url = null
  switch (info.menuItemId) {
    case 'tradingview':
      url = `https://jp.tradingview.com/chart/?symbol=${match[2]}%3A${match[1]}`
      break
    case 'kabutan':
      url = `https://us.kabutan.jp/stocks/${match[1]}`
      break
    case 'minkabu':
      url = `https://us.minkabu.jp/stocks/${match[1]}`
      break
  }

  if (url) {
    chrome.tabs.create({url})
  }
  return true
}

function newyork2(info) {
  const match = info.selectionText.match(/\s*([A-Z]{1,5})\s*/)
  if (!match) {
    return false
  }

  let url = null
  switch (info.menuItemId) {
    case 'tradingview':
      url = `https://jp.tradingview.com/chart/?symbol=${match[1]}`
      break
    case 'kabutan':
      url = `https://us.kabutan.jp/stocks/${match[1]}`
      break
    case 'minkabu':
      url = `https://us.minkabu.jp/stocks/${match[1]}`
      break
  }

  if (url) {
    chrome.tabs.create({url})
  }
  return true
}

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  tokyo(info) || newyork1(info) || newyork2(info)
})

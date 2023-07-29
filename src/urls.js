/**
 * URLリスト
 * @type { { key: string, title: string, url1: string, url2?: string, url3?: string }[] }
 */
const externalUrls = [
  {
    key: 'tradingview.com/chart',
    title: 'TradingView/スーパーチャート',
    url1: 'https://jp.tradingview.com/chart/?symbol=TSE%3A${code}',
    url2: 'https://jp.tradingview.com/chart/?symbol=${exchange}%3A${code}',
    url3: 'https://jp.tradingview.com/chart/?symbol=${code}'
  },
  {
    key: 'kabutan.jp/stock',
    title: '株探/基本情報',
    url1: 'https://kabutan.jp/stock/?code=${code}',
    url2: 'https://us.kabutan.jp/stocks/${code}',
    url3: 'https://us.kabutan.jp/stocks/${code}'
  },
  {
    key: 'minkabu.jp/stock',
    title: 'MINKABU/株価情報トップ',
    url1: 'https://minkabu.jp/stock/${code}',
    url2: 'https://us.minkabu.jp/stocks/${code}',
    url3: 'https://us.minkabu.jp/stocks/${code}'
  },
  {
    key: 'finance.yahoo.co.jp/',
    title: 'Yahoo!ファイナンス/詳細情報',
    url1: 'https://finance.yahoo.co.jp/quote/${code}.T',
    url2: 'https://finance.yahoo.co.jp/quote/${code}',
    url3: 'https://finance.yahoo.co.jp/quote/${code}',
  },
  {
    key: 'finance.yahoo.co.jp/bbs',
    title: 'Yahoo!ファイナンス/掲示板',
    url1: 'https://finance.yahoo.co.jp/quote/${code}/bbs',
    url2: 'https://finance.yahoo.co.jp/cm/rd/finance/${code}',
    url3: 'https://finance.yahoo.co.jp/cm/rd/finance/${code}'
  },
  {
    key: 'www.nikkei.com/company',
    title: '日本経済新聞',
    url1: 'https://www.nikkei.com/nkd/company/?scode=${code}'
  },
  {
    key: 'shikiho.toyokeizai.net/stocks',
    title: '四季報',
    url1: 'https://shikiho.toyokeizai.net/stocks/${code}'
  },
  {
    key: 'www.buffett-code.com/company',
    title: 'バフェット・コード',
    url1: 'https://www.buffett-code.com/company/${code}/'
  },
  {
    key: 'kabuyoho.ifis.co.jp/report',
    title: '株予報',
    url1: 'https://kabuyoho.ifis.co.jp/index.php?action=tp1&sa=report&bcode=${code}'
  },
  {
    key: 'www.kabuka.jp.net/rating',
    title: '目標株価まとめ',
    url1: 'https://www.kabuka.jp.net/rating/${code}.html'
  },
  {
    key: 'kabuline.com/search',
    title: '株ライン',
    url1: 'https://kabuline.com/search/tw/${code}'
  },
  {
    key: 'karauri.net/',
    title: 'karauri.net',
    url1: 'https://karauri.net/${code}/'
  },
  {
    key: 'tyn-imarket.com/stocks',
    title: 'iMarket',
    url1: 'https://tyn-imarket.com/stocks/search?query=${code}'
  },
  {
    key: 'kabumap.com/base',
    title: '株マップ.com/銘柄基本情報',
    url1: 'https://jp.kabumap.com/servlets/kabumap/Action?SRC=basic/top/base&codetext=${code}'
  },
  {
    key: 'kabubiz.com/riron',
    title: '株Biz/理論株価Web',
    url1: 'https://kabubiz.com/riron/${code:0}000/${code}.php'
  },
  {
    key: 'kabubiz.com/getuji',
    title: '株Biz/月次Web',
    url1: 'https://kabubiz.com/getuji/code/${code}.php'
  },
  {
    key: 'ullet/',
    title: 'Ullet',
    url1: 'https://www.ullet.com/${code}.html'
  },
  {
    key: 'sharedresearch.jp/companies',
    title: 'シェアードリサーチ',
    url1: 'https://sharedresearch.jp/ja/companies/${code}'
  },
  {
    key: 'finance.logmi.jp/',
    title: 'logmi',
    url1: 'https://finance.logmi.jp/companies?query=${code}'
  },
  {
    key: 'holistic-r.org/report',
    title: '証券リサーチセンター',
    url1: 'https://holistic-r.org/report/${code}/'
  }
]

/**
 * URL連想リスト
 * @type { { [key: string]: { key: string, title: string, url1: string, url2?: string, url3?: string } } }
 */
const externalUrlsMap = externalUrls.reduce((acc, cur) => {
  acc[cur.key] = cur
  return acc
}, {})


/**
 * 利用するリンクのキーリストを取得する
 * @returns { { key: string, title: string, url1: string, url2?: string, url3?: string }[] }
 */
const getEnableLinkKeysAsync = async () => {
  // ストレージから利用中のURLリストを取得
  // 未設定の場合は全部有効扱い
  const storage = await chrome.storage.sync.get('enableLinkKeys')
  if (storage.enableLinkKeys) {
    return Object
      .keys(storage.enableLinkKeys)
      .sort((a, b) => storage.enableLinkKeys[a] - storage.enableLinkKeys[b])
  } else {
    return externalUrls.map((i) => i.key)
  }
}

/**
 * URLを生成する
 * @param {string} urlTemplate 
 * @param {string} code 
 * @param {string?} exchange
 * @returns 
 */
const makeUrl = (urlTemplate, code, exchange) => {
  let result =  urlTemplate.replaceAll('${code}', code)
                           .replaceAll('${code:0}', code[0])
  if (exchange) {
    result = result.replaceAll('${exchange}', exchange)
  }
  return result
}
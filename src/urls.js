/**
 * URLリスト
 *   key: 必須 URLを特定するキー
 *   title: 必須 表示するときの名称
 *   url0: 必須 オプションから開くURL。トップページ
 *   url1: 必須 日本銘柄で開くときのURL ${code}
 *   url2: オプション 米国用URL（証券取引所コードあり） ${exchange} ${code}
 *   url3: オプション 米国用URL（証券取引所コードなし） ${code}
 * @type { { key: string, title: string, url1: string, url2?: string, url3?: string }[] }
 */
const externalUrls = [
  {
    key: 'tradingview.com/chart',
    title: 'TradingView/スーパーチャート',
    url0: 'https://jp.tradingview.com/chart/?symbol=NI225',
    url1: 'https://jp.tradingview.com/chart/?symbol=TSE%3A${code}',
    url2: 'https://jp.tradingview.com/chart/?symbol=${exchange}%3A${code}',
    url3: 'https://jp.tradingview.com/chart/?symbol=${code}'
  },
  {
    key: 'minkabu.jp/stock',
    title: 'MINKABU/株価情報トップ',
    url0: 'https://minkabu.jp',
    url1: 'https://minkabu.jp/stock/${code}',
    url2: 'https://us.minkabu.jp/stocks/${code}',
    url3: 'https://us.minkabu.jp/stocks/${code}'
  },
  {
    key: 'kabutan.jp/stock',
    title: '株探/基本情報',
    url0: 'https://kabutan.jp',
    url1: 'https://kabutan.jp/stock/?code=${code}',
    url2: 'https://us.kabutan.jp/stocks/${code}',
    url3: 'https://us.kabutan.jp/stocks/${code}'
  },
  {
    key: 'finance.yahoo.co.jp/bbs',
    title: 'Yahoo!ファイナンス/掲示板',
    url0: 'https://finance.yahoo.co.jp/cm',
    url1: 'https://finance.yahoo.co.jp/quote/${code}/bbs',
    url2: 'https://finance.yahoo.co.jp/cm/rd/finance/${code}',
    url3: 'https://finance.yahoo.co.jp/cm/rd/finance/${code}'
  },
  {
    key: 'finance.yahoo.co.jp/',
    title: 'Yahoo!ファイナンス/詳細情報',
    url0: 'https://finance.yahoo.co.jp',
    url1: 'https://finance.yahoo.co.jp/quote/${code}.T',
    url2: 'https://finance.yahoo.co.jp/quote/${code}',
    url3: 'https://finance.yahoo.co.jp/quote/${code}',
  },
  {
    key: 'www.nikkei.com/company',
    title: '日本経済新聞',
    url0: 'https://www.nikkei.com/nkd/',
    url1: 'https://www.nikkei.com/nkd/company/?scode=${code}'
  },
  {
    key: 'shikiho.toyokeizai.net/stocks',
    title: '四季報',
    url0: 'https://shikiho.toyokeizai.net/',
    url1: 'https://shikiho.toyokeizai.net/stocks/${code}'
  },
  {
    key: 'kabubiz.com/getuji',
    title: '株Biz/月次Web',
    url0: 'https://kabubiz.com/getuji/',
    url1: 'https://kabubiz.com/getuji/code/${code}.php'
  },
  {
    key: 'kabubiz.com/riron',
    title: '株Biz/理論株価Web',
    url0: 'https://kabubiz.com/riron/',
    url1: 'https://kabubiz.com/riron/${code:0}000/${code}.php'
  },
  {
    key: 'kabumap.com/base',
    title: '株マップ.com/銘柄基本情報',
    url0: 'https://jp.kabumap.com',
    url1: 'https://jp.kabumap.com/servlets/kabumap/Action?SRC=basic/top/base&codetext=${code}'
  },
  {
    key: 'kabuyoho.ifis.co.jp/report',
    title: '株予報',
    url0: 'https://kabuyoho.ifis.co.jp/',
    url1: 'https://kabuyoho.ifis.co.jp/index.php?action=tp1&sa=report&bcode=${code}'
  },
  {
    key: 'kabuyoho.jp/',
    title: '株予報Pro',
    url0: 'https://kabuyoho.jp',
    url1: 'https://kabuyoho.jp/reportTop?bcode=${code}'
  },
  {
    key: 'kabuline.com/search',
    title: '株ライン',
    url0: 'https://kabuline.com',
    url1: 'https://kabuline.com/search/tw/${code}'
  },
  {
    key: 'karauri.net/',
    title: 'karauri.net',
    url0: 'https://karauri.net/',
    url1: 'https://karauri.net/${code}/'
  },
  {
    key: 'sharedresearch.jp/companies',
    title: 'シェアードリサーチ',
    url0: 'https://sharedresearch.jp/',
    url1: 'https://sharedresearch.jp/ja/companies/${code}'
  },
  {
    key: 'holistic-r.org/report',
    title: '証券リサーチセンター',
    url0: 'https://holistic-r.org/report/',
    url1: 'https://holistic-r.org/report/${code}/'
  },
  {
    key: 'nikkeiyosoku.com/stock/',
    title: '投資の森',
    url0: 'https://nikkeiyosoku.com/',
    url1: 'https://nikkeiyosoku.com/stock/${code}/'
  },
  {
    key: 'www.buffett-code.com/company',
    title: 'バフェット・コード',
    url0: 'https://www.buffett-code.com/',
    url1: 'https://www.buffett-code.com/company/${code}/'
  },
  {
    key: 'www.kabuka.jp.net/rating',
    title: '目標株価まとめ',
    url0: 'https://www.kabuka.jp.net',
    url1: 'https://www.kabuka.jp.net/rating/${code}.html'
  },
  {
    key: 'ullet/',
    title: 'Ullet',
    url0: 'https://www.ullet.com/',
    url1: 'https://www.ullet.com/${code}.html'
  },
  {
    key: 'finance.logmi.jp/',
    title: 'logmi',
    url0: 'https://finance.logmi.jp/',
    url1: 'https://finance.logmi.jp/companies?query=${code}'
  },
  {
    key: 'moomoo.com/',
    title: 'moomoo証券',
    url0: 'https://www.moomoo.com/ja/quote/jp',
    url1: 'https://www.moomoo.com/ja/stock/${code}-JP',
    url2: 'https://www.moomoo.com/ja/stock/${code}-US',
    url3: 'https://www.moomoo.com/ja/stock/${code}-US'
  }

  // {
  //   key: 'tyn-imarket.com/stocks',
  //   title: 'iMarket',
  //   url0: 'https://tyn-imarket.com/',
  //   url1: 'https://tyn-imarket.com/stocks/search?query=${code}'
  // },
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
 * @returns { string[] }
 */
const getEnableLinkKeysAsync = async () => {
  // ストレージから利用中のURLリストを取得
  // 未設定の場合は全部有効扱い
  const storage = await chrome.storage.sync.get('enableLinkKeys')
  if (storage.enableLinkKeys) {
    // 順序を復元する
    return Object
      .keys(storage.enableLinkKeys)
      .sort((a, b) => storage.enableLinkKeys[a] - storage.enableLinkKeys[b])
  } else {
    // データがない場合は全て有効でデフォルトの順序とする
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
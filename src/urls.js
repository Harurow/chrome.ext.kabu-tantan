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
 * 取引所コード → 市場種別
 * TradingView のシンボル表記 `EXCHANGE:CODE` の解釈に使う
 * 遅延配信の接尾辞 `_DLY`(例 TSE_DLY)は引く前に剥がす。ここには載せない
 * @type { { [key: string]: string } }
 */
const exchanges = {
  TSE: 'jp',
  BATS: 'us',
  NASDAQ: 'us',
  NYSE: 'us',
  AMEX: 'us',
  CBOE: 'us',
  OTC: 'us'
}

/**
 * 米国ティッカーの書式(SPEC-TC-02)。先頭からの前方一致で使う
 *
 * 後続境界は**許可列挙**。「切り出してよい後続」だけを並べ、未知の文字が続けば切り出さない。
 * 害のある記号を並べる禁止列挙だと ASCII 記号・数字が素通りし、`SP500` から
 * `SP`(実在ティッカー)を切り出していた。未知の入力では開かない側に倒す(FR-08。ADR-0009 の 9)
 *  1. 終端 `$`                       `AAPL`
 *  2. 空白 `\s`                      `AAPL Apple Inc.`(半角・全角・改行・タブ)
 *  3. 本文文字(非 ASCII の `\p{L}`)   `AAPLの株価` / `AAPL株`。
 *     全角ラテン `Ａ-Ｚ` と長音符2字(`ー` U+30FC / `ｰ` U+FF70)は除く
 *  4. 終止記号(半角・全角)            `AAPL,` / `AAPL、` / `AAPL）`
 *
 * 3 を「非 ASCII なら許可」にすると全角の連結記号(`＆` `．` `－` `・` やダッシュ類)が
 * 素通りし、`S＆P500` から `S`(SentinelOne)を切り出す。`\p{L}` は連結記号を含まないため
 * この穴が構造的に塞がる(ADR-0009 の 10)。NFKC 正規化は採らない(同 10)
 *
 * 長音符2字は `\p{L}`(Lm)だが除く。**日本語 IME でハイフンを打つと出る**ため、
 * `BRKーB` / `BRKｰB` のように連結記号の代用として実際に打たれる(ADR-0009 の 11)。
 * 例外の基準は「文字かどうか」ではなく「連結記号の代用として実際に打たれるか」なので、
 * 反復記号(`々` `ゝ` `〆`)は許可のまま(`AAPL々` は `us AAPL`)
 *
 * **`u` フラグ必須。** 忘れると `\p{L}` がリテラル `p{L}` になり、例外も lint エラーも
 * 出ないまま 3 だけが死ぬ(テストの `AAPLの株価` が検出する)。
 * また `[\p{L}…]` だけでは ASCII 英字も `\p{L}` に含まれ `BRK.B` が `BR` になるため、
 * 非 ASCII 限定の先読み `(?=[^\x20-\x7E])` と組み合わせる
 *
 * 代償として `AAPL.` / `AAPL-Apple` / `AAPL#` / `AAPL0` は開かなくなる。
 * 空白を挟む `AAPL - Apple Inc.` は落ちない。
 * リテラルは3本(ここ / service_worker.js の優先順位4の直書き /
 * tradingview-cs.js の parseExchangeSymbol)で同じ値にする(FR-08 の適用範囲)。
 * 1.17.0 で service_worker.js から移設し、注入経路(SPEC-TC-10)とも共有する。
 * 通る経路は5本になるがリテラルは増えない(ADR-0014 の 3)
 */
const usCodePattern = /^([A-Z]{1,5})(?=$|[\s,;:!?"'()[\]{}]|(?![Ａ-Ｚａ-ｚーｰ])(?=[^\x20-\x7E])[\p{L}、。，；：！？＂＇（）［］｛｝「」『』【】〈〉《》〔〕‘’“”])/u

/**
 * 注入経路で使う国内銘柄コードの書式(SPEC-TC-06)
 * **アンカー無し**。表のセルなど、サイトが描いた文字列の途中にコードがある想定
 * 共有するオブジェクトなので `g` は付けない(lastIndex を持ち回らないため)
 */
const jpLooseCodePattern = /[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/

/**
 * 注入経路(楽天・SBIのContent Script 4本)で要素のテキストから銘柄コードを取り出す(SPEC-TC-10)
 *
 * **国内株を先に見て、空振りしたときだけ米国株を試す。**
 * この順序が「国内株の抽出結果が今日と1文字も変わらない」ことの保証そのもので、
 * 米国株の抽出が走るのは**今日の実装が何もしていない要素だけ**になる
 * (FR-28 判定基準5。ADR-0014 の 2)
 *
 * 米国株の抽出は `allowUs` が真のときだけ走る。opt-in にしないと、FR-28 が対象外と決めた
 * ページ(ランキング・個別銘柄・スクリーナー)でも大文字トークンに当たった時点でメニューが出て、
 * **別銘柄のページが静かに開く**側の失敗になる(ADR-0014 の 1)
 *
 * 取引所は見ない(判定基準9)。`type: 'us'` に exchange は付かず、URLは常に url3(SPEC-CS-06)
 *
 * 抽出は**形しか見ない**。`00700`(中国株)に順位1が当たり `0070` を返す、
 * `USD 米ドル`(預り金)に順位2が当たるといった形は、どの要素に抽出をかけるか
 * (＝セレクタ)でしか防げない(SPEC-CS-26)
 *
 * @param { string } text 要素のテキスト
 * @param { boolean } allowUs 米国株の抽出を許すか(menuSelectors の us)
 * @returns { { code: string, type: 'jp' | 'us' } | null }
 */
const matchInjectionTicker = (text, allowUs) => {
  const trimmed = (text ?? '').trim()

  // 1. 国内株(非アンカー。複数一致しても先頭の1件)
  const jp = jpLooseCodePattern.exec(trimmed)
  if (jp) {
    return { code: jp[0], type: 'jp' }
  }

  // 2. 米国株(先頭アンカー + 後続境界。SPEC-TC-02)
  if (allowUs === true) {
    const us = usCodePattern.exec(trimmed)
    if (us) {
      return { code: us[1], type: 'us' }
    }
  }

  // 3. どちらも不成立
  return null
}

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
  let result = urlTemplate.replaceAll('${code}', code)
    .replaceAll('${code:0}', code[0])
  if (exchange) {
    result = result.replaceAll('${exchange}', exchange)
  }
  return result
}

/**
 * 拡張機能が生きている(このタブが切断されていない)かを判定する
 * 拡張機能を更新・再読み込みするとそれ以前のタブのContent Scriptは本体から切り離され、
 * chrome.runtime / chrome.storage を触るとTypeErrorになる(SPEC-CS-19)
 * ・存在確認だけを行う(判定自体が例外にならないようにメッセージ送信やstorage読み出しはしない)
 * ・chrome.runtime.id はService Workerが休止していても残るので、休止と切断を取り違えない
 * @returns { boolean }
 */
const isExtensionAlive = () =>
  typeof chrome !== 'undefined' && chrome.runtime != null && chrome.runtime.id != null

/** 設置を試し直す間隔(ミリ秒)。現れてから注入までの遅れの上限(SPEC-CS-22) */
const retrySetupIntervalMs = 500

/** 設置の再試行を打ち切るまでの時間(ミリ秒)。これを過ぎたら対象ページではないとみなす(SPEC-CS-22) */
const retrySetupTimeoutMs = 30000

/**
 * 設置(注入・常設監視の開始)を、成功するまで一定間隔で試す(SPEC-CS-22)
 * ・初回は呼び出し時に同期で1回実行する(現行と同じタイミングで注入が始まる)
 * ・停止は「成功・打ち切り・切断・例外」の4経路。タイマーが存在する場合はすべて同じ stop() を通る
 *   (初回の同期呼び出しで成功・例外になった場合は setInterval を張る前に抜けるため止める対象が無い)
 * ・切断はtickの先頭で判定する。楽天・SBIの4本はkeysをキャッシュするため、
 *   門を置かないと切断後も拡張APIに触れずに注入できてしまう(SPEC-CS-19 / NFR-14)
 * @param { () => boolean } setup 設置を試みる。これ以上の再試行が不要なら true
 * @param { { intervalMs?: number, timeoutMs?: number } } [options] 既定は 500ms / 30000ms
 */
const retrySetup = (setup, options) => {
  const intervalMs = options?.intervalMs ?? retrySetupIntervalMs
  const timeoutMs = options?.timeoutMs ?? retrySetupTimeoutMs
  const startedAt = Date.now()

  let timerId = null

  // 停止処理は1本に集約する(タイマーを張った後の4経路はすべてここを通る)
  const stop = () => {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  /**
   * 設置を1回試す
   * @returns { boolean } これ以上試さないなら true
   */
  const tryOnce = () => {
    try {
      return setup() === true
    } catch {
      // 例外は外へ出さない(他社サイトの処理を止めない。NFR-01)
      // セレクタの誤りなど次のtickで直らない失敗が大半なので、投げ直さず打ち切る
      return true
    }
  }

  // 初回は同期で試す
  if (tryOnce()) {
    return
  }

  timerId = setInterval(() => {
    // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では止める
    if (!isExtensionAlive()) {
      stop()
      return
    }

    // 打ち切りは経過時間で見る(タイマーは背景タブで丸められるため回数では持たない)
    if (Date.now() - startedAt >= timeoutMs) {
      stop()
      return
    }

    if (tryOnce()) {
      stop()
    }
  }, intervalMs)
}

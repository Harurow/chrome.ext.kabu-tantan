importScripts('./urls.js')

const remakeContextMenus = async () => {
  // 利用するURLリスト
  const keys = await getEnableLinkKeysAsync()

  // コンテキストメニューを一旦全て削除
  await chrome.contextMenus.removeAll()

  // 有効なURLリストをコンテキストメニューへ追加
  keys.forEach((key) => {
    if (externalUrlsMap[key]) {
      chrome.contextMenus.create({
        id: key,
        title: externalUrlsMap[key].title,
        contexts: ['selection']
      })
    }
  })
}

/**
 * 国内銘柄コードの書式(SPEC-TC-01)。先頭からの前方一致で使う
 */
const jpCodePattern = /^[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/

// 米国ティッカーの書式(SPEC-TC-02)の `usCodePattern` は urls.js にある。
// 注入経路(SPEC-TC-10)と共有するため 1.17.0 で移設した(ADR-0014 の 3)。
// リテラルは3本のまま(ここの優先順位4の直書き / urls.js / tradingview-cs.js)で、
// 通る経路が5本になる

/**
 * 取引所プレフィックス `EXCHANGE:TICKER` の先頭部分(SPEC-TC-09)
 * `_DLY` は遅延配信の接尾辞。区切りはコロン(前後の空白可)と空白の両方を認める
 *
 * コロンは**半角と全角の両方**を認める(ADR-0009 の 12)。全角だけ通すと
 * `A：Z` が `us A`(Agilent)を開き、半角 `A:Z`(判定基準7 で打ち切り)と食い違う。
 * 全角コロンは日本語入力で普通に打たれるので、長音符2字と同じ基準で扱う
 */
const exchangePrefixPattern = /^\s*([A-Z]+)(_DLY)?(\s*[:：]\s*|\s+)/

/**
 * 区切りがコロンだったか(SPEC-TC-09 の打ち切り判定)
 * **半角だけを見る `includes(':')` では全角コロンが打ち切られない。**
 * 判定は2箇所(未登録の分岐 / 銘柄コードが取れなかった分岐)にあり、
 * 片方だけ直すと `A：Z` が素通りするため、1つの定数を両方から使う(ADR-0009 の 12)
 */
const colonSeparatorPattern = /[:：]/

/**
 * 後置の取引所コード `TICKER EXCHANGE` の書式(SPEC-TC-03)
 * 取引所の集合は `exchanges`(urls.js)の 'us' 登録から組み立てる。
 * 一覧を二重に持たないため、ここに取引所コードを直書きしない(NFR-13)
 * 区切りは `\s+`(1個以上)。`\s*` だと `AAPLNASDAQ` が通ってしまう
 * 末尾の後続境界は**取引所トークン側**なので、ティッカー側の許可列挙(usCodePattern)にしない。
 * 許可列挙にすると `AAPL NASDAQ.` / `AAPL NASDAQ-100` / `AAPL NASDAQ+` / `AAPL NASDAQ&`
 * が落ちる(ADR-0009 の 7・8・9)
 */
const usCodeWithExchangePattern = new RegExp(
  '^\\s*([A-Z]{1,5})\\s+(' +
  Object.keys(exchanges)
    .filter((key) => exchanges[key] === 'us')
    // 一方が他方の接頭辞になっている場合に短い方が先に成立しないよう長い順に並べる
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .join('|') +
  ')(?![A-Za-z])'
)

/**
 * 取引所プレフィックス `EXCHANGE:TICKER` を解釈する(SPEC-TC-09)
 * TradingView のシンボル表記(`NYSE:AAPL` / `TSE:7203`)を選択して右クリックする使い方に対応する
 * @param {string} text 解析する文字列
 * @returns {(
 *   { status: false } |
 *   { status: true, type: 'jp', code: string } |
 *   { status: true, type: 'us', code: string, exchange: string } |
 *   null
 *  )} 本規則が不成立(次の規則へ送る)の場合は null
 */
const matchExchangePrefixedTicker = (text) => {
  const matched = exchangePrefixPattern.exec(text)
  if (!matched) {
    return null
  }

  // '_DLY' を剥がしたトークンで引く。プロトタイプ由来の値を拾わないよう厳密一致で判定する
  const exchange = matched[1]
  const type = exchanges[exchange]
  if (type !== 'jp' && type !== 'us') {
    // 未登録の取引所(FR-08 判定基準7)
    //  - コロン(半角・全角): 打ち切る。`X:Y` は「取引所:銘柄」の記号表記で `X` はティッカーではない。
    //    登録の有無は本拡張の対応範囲の問題であって、`X` がティッカーかどうかとは無関係。
    //    次の規則へ落とすと `SP:SPX`(S&P500 指数の TradingView 表記)が
    //    `SP`(SP Plus Corp)を、`CME:ES1!` が CME Group を開く
    //  - 空白: 次の規則へ送る。記号表記かどうかを区別できるのはコロンだけで、
    //    `SP 500` / `CME Group` は 1.13.0 と同じ `us SP` / `us CME` のままにする
    return colonSeparatorPattern.test(matched[3]) ? { status: false } : null
  }

  const rest = text.slice(matched[0].length)

  if (type === 'jp') {
    const code = jpCodePattern.exec(rest)
    if (code) {
      // 国内株は exchange を返さない(getUrl が jp では exchange を見ない。SPEC-TC-05)
      return { status: true, type, code: code[0] }
    }
  } else {
    const code = usCodePattern.exec(rest)
    if (code) {
      return { status: true, type, code: code[1], exchange }
    }
  }

  // 取引所は引けたが銘柄コードが取れなかった場合、区切りによって扱いを分ける
  //  - コロン(半角・全角): 打ち切る。次の規則へ落とすと `NYSE:` が `us NYSE` になり、
  //    取引所コードそのものを銘柄コードとして返す欠陥に戻る
  //  - 空白: 次の規則へ送る。取引所コードと同じ綴りの実在ティッカーがあるため
  //    (`CBOE Global Markets` は `us CBOE` のままにする)
  return colonSeparatorPattern.test(matched[3]) ? { status: false } : null
}

/**
 * 文字列から銘柄コードを取得する(SPEC-TC-04 の優先順位で判定する)
 * @param {string} text 解析する文字列
 * @returns {(
 *   { status: false } |
 *   { status: true, type: 'jp', code: string } |
 *   { status: true, type: 'us', code: string, exchange?: string }
 *  )}
 */
const getTickerCode = (text) => {
  // 1. 国内4桁(SPEC-TC-01)
  let match = text.match(/^\s*([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])\s*/)
  if (match) {
    return { status: true, type: 'jp', code: match[1] }
  }

  // 2. 取引所プレフィックス(SPEC-TC-09)
  //    コロン区切りで失敗した場合はここで { status: false } を返して打ち切る
  const prefixed = matchExchangePrefixedTicker(text)
  if (prefixed) {
    return prefixed
  }

  // 米国株は「選択範囲の先頭にティッカーが単独で置かれている」場合だけ対象とする。
  //  - 先頭アンカー(^)が無いと文中の大文字並び（例:「株価はNYSEで上昇」）に誤マッチする
  //  - 後続境界が無いと単語や記号表記の途中を拾う。例えば 'Apple Inc. AAPL NASDAQ' から 'A' を、
  //    'BRK.B' / 'BRK-B' から 'BRK' を、'SP500' から 'SP' を取り出してしまい、
  //    別銘柄のページを開くという最悪の失敗をする。境界は許可列挙で、値は usCodePattern と同じ
  //    (3経路で揃える。u フラグを忘れると日本語が続く形だけが黙って落ちる)
  // 3. 米国 + 後置の取引所コード(SPEC-TC-03)
  match = text.match(usCodeWithExchangePattern)
  if (match) {
    return { status: true, type: 'us', code: match[1], exchange: match[2] }
  }
  // 4. 米国のみ(SPEC-TC-02)
  match = text.match(/^\s*([A-Z]{1,5})(?=$|[\s,;:!?"'()[\]{}]|(?![Ａ-Ｚａ-ｚーｰ])(?=[^\x20-\x7E])[\p{L}、。，；：！？＂＇（）［］｛｝「」『』【】〈〉《》〔〕‘’“”])\s*/u)
  if (match) {
    return { status: true, type: 'us', code: match[1] }
  }
  // 5. いずれにも成立しない
  return { status: false }
}

/**
 * 画面遷移先のURLを作成する
 * @param {'jp' | 'us'} type 国内銘柄か米国銘柄かを表す
 * @param {string} code 銘柄コード
 * @param {string | undefined} exchange 米国株の場合の証券取引所コード(`exchanges` のキー)
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

/**
 * `MAJOR.MINOR.PATCH` 形式のバージョン文字列を数値として比較する
 * 文字列比較では '1.9.21' < '1.10.0' の判定を誤るため数値化して比較する
 * @param {string | undefined} a
 * @param {string | undefined} b
 * @returns {number} a が小さければ負、等しければ 0、大きければ正
 */
const compareVersion = (a, b) => {
  const toParts = (v) => String(v ?? '0').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pa = toParts(a)
  const pb = toParts(b)
  const len = Math.max(pa.length, pb.length)

  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

/**
 * インストール・更新時にオプションページを開くかを判定する(SPEC-SW-04)
 * 開くのは初回インストールと、1.0.9未満からの拡張機能の更新だけ。
 * Chrome本体の更新(chrome_update)・共有モジュールの更新では開かない。
 * previousVersionはreason === 'update'のときにしか無いので、比較はその場合に限る
 * (compareVersionはundefinedを'0'として扱うため、そのまま渡すと「開く」になる)
 * @param {{ reason?: string, previousVersion?: string }} details onInstalledの引数
 * @returns {boolean} オプションページを開く場合はtrue
 */
const shouldOpenOptionsPage = (details) => {
  if (details.reason === 'install') {
    return true
  }
  if (details.reason === 'update' && typeof details.previousVersion === 'string') {
    return compareVersion(details.previousVersion, '1.0.9') < 0
  }
  return false
}

// インストール時のイベントハンドラを登録
// 開くかどうかの判定は shouldOpenOptionsPage に任せる(SPEC-SW-04)
chrome.runtime.onInstalled.addListener((details) => {
  remakeContextMenus()

  if (shouldOpenOptionsPage(details)) {
    chrome.runtime.openOptionsPage()
  }
})

// スタートアップイベントハンドラを登録
// コンテキストメニューの再構築を実行
chrome.runtime.onStartup.addListener(() => {
  remakeContextMenus()
})

// ストレージの更新イベントハンドラを登録
// ストレージの更新=利用サイトの変更があったと判断しコンテキストメニューを再構築
chrome.storage.onChanged.addListener((changes, namespace) => {
  remakeContextMenus()
})

// コンテキストメニューのクリックイベントハンドラを登録
// 選択文字列がありその文字列が証券コードとして扱える場合はクリックしたメニューのサイトのURLを開く
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const key = info.menuItemId
  const selectionText = info.selectionText
  const { status, type, code, exchange } = getTickerCode(selectionText)

  if (!status) {
    console.log('銘柄コードが見つかりませんでした')
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
    chrome.tabs.create({ url })
  }
})

// Chrome拡張をクリックした時のイベントハンドラを登録
// オプションページを開く
chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.openOptionsPage()
})

// メッセージを受け取った時のイベントハンドラを登録
// 詳細は個別にコメント
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'rakuten-sec:info') {
    onMessageRakutenSecInfoAsync(request, sendResponse)
    return true
  } else if (request.type === 'rakuten-sec:open') {
    onMessageRakutenSecOpenAsync(request, sendResponse)
    return true
  } else if (request.type === 'naito-sec:info') {
    onMessageNaitoSecInfoAsync(request, sendResponse)
    return true
  } else if (request.type === 'naito-sec:open') {
    onMessageNaitoSecOpenAsync(request, sendResponse)
    return true
  } else if (request.type === 'open-url') {
    onMessageOpenUrlAsync(request, sendResponse)
  }

  return false
})

// 証券会社のURL(楽天証券のBV_SessionID入り / 内藤証券のログイン済みタブの丸写し)は
// Service Workerの外に出さない。応答は有無(available)だけにし、URLはtabs.createにだけ使う
// (SPEC-MSG-06 / ADR-0016)

/**
 * 楽天証券の情報取得時のメッセージ処理
 * @param {*} request リクエスト情報
 * @param {*} sendResponse レスポンスコールバック
 */
const onMessageRakutenSecInfoAsync = async (request, sendResponse) => {
  const { code, type } = request.data

  // 楽天証券のURLが組み立てられるか(ログイン済みタブがあるか)だけを返す
  const url = await getRakutenSecUrlAsync(type, code)

  sendResponse?.({ type: request.type, data: { available: url !== null } })
}

/**
 * 楽天証券を開く時のメッセージ処理
 * URLは:infoの時点のものを持ち越さず、ここで組み立て直す
 * @param {*} request リクエスト情報
 * @param {*} sendResponse レスポンスコールバック
 */
const onMessageRakutenSecOpenAsync = async (request, sendResponse) => {
  const { code, type } = request.data

  // 楽天証券のURLを取得する
  const url = await getRakutenSecUrlAsync(type, code)

  // 楽天証券ページを開く
  if (url !== null) {
    chrome.tabs.create({ url })
  }

  sendResponse?.({ type: request.type, data: { available: url !== null } })
}

/**
 * 内藤証券の情報取得時のメッセージ処理
 * @param {*} request リクエスト情報
 * @param {*} sendResponse レスポンスコールバック
 */
const onMessageNaitoSecInfoAsync = async (request, sendResponse) => {
  const { code, type } = request.data

  // 内藤証券のURLが組み立てられるか(ログイン済みタブがあるか)だけを返す
  const url = await getNaitoSecUrlAsync(type, code)

  sendResponse?.({ type: request.type, data: { available: url !== null } })
}

/**
 * 内藤証券を開く時のメッセージ処理
 * URLは:infoの時点のものを持ち越さず、ここで組み立て直す
 * @param {*} request リクエスト情報
 * @param {*} sendResponse レスポンスコールバック
 */
const onMessageNaitoSecOpenAsync = async (request, sendResponse) => {
  const { code, type } = request.data

  // 内藤証券のURLを取得する
  const url = await getNaitoSecUrlAsync(type, code)

  // 内藤証券ページを開く
  if (url !== null) {
    chrome.tabs.create({ url })
  }

  sendResponse?.({ type: request.type, data: { available: url !== null } })
}

/**
 * URLを開く時のメッセージ処理
 * @param {*} request リクエスト情報
 * @param {*} sendResponse レスポンスコールバック
 */
const onMessageOpenUrlAsync = async (request, sendResponse) => {
  const response = { type: request.type, data: null }
  const { url } = request.data

  // ページを開く
  if (url) {
    chrome.tabs.create({ url })
  }

  sendResponse?.(response)
}

/**
 * ログイン済みの楽天証券サイトからセッションIDを取得しURLを取得する
 * @param {'jp' | 'us'} type
 * @param {string} code
 */
const getRakutenSecUrlAsync = async (type, code) => {
  // メンバーページのURLからセッションIDを取得し銘柄に対応したページ遷移先のURLを構築する
  const tabs = await chrome.tabs.query({ url: 'https://member.rakuten-sec.co.jp/*' })

  const sessionIdRegex = /[;?&]BV_SessionID=([^?&]+)/
  let sessionId = null
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]
    const matchedSessionId = sessionIdRegex.exec(tab.url)
    if (matchedSessionId) {
      sessionId = matchedSessionId[1]
      break
    }
  }

  let url = null
  if (sessionId) {
    switch (type) {
      case 'jp':
        url = `https://member.rakuten-sec.co.jp/app/info_jp_prc_stock.do;BV_SessionID=${sessionId}?eventType=init&dscrCd=${code}&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01`
        break
      case 'us':
        url = `https://member.rakuten-sec.co.jp/app/info_us_prc_stock.do;BV_SessionID=${sessionId}?eventType=init&tickerCd=${code}&chartType=&l-id=mem_us_fu_a_a`
        break
    }
  }

  return url
}

/**
 * ログイン済みの内藤証券の国内株マーケットのURLから指定した銘柄コードのURLを取得する
 * @param {'jp' | 'us'} type
 * @param {string} code 銘柄コード
 */
const getNaitoSecUrlAsync = async (type, code) => {
  // 個別銘柄のページを開いていればそのURLをコピーして銘柄コードを変えたページを返す
  const tabs = await chrome.tabs.query({ url: 'https://*.qhit.net/naito/iswebptt2/*' })
  const qcodeRegex = /([;?&]qcode=)([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])/

  let url = null
  if (type === 'jp') {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i]
      if (qcodeRegex.test(tab.url)) {
        url = tab.url.replace(qcodeRegex, `$1${code}`)
        break
      }
    }
  }

  return url
}

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

// インストール時のイベントハンドラを登録
// 初回インストールまたは、1.0.9未満からの更新の場合はオプションページを開く
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

// Chrome拡張をクリックした時のイベントハンドラを登録
// オプションページを開く
chrome.action.onClicked.addListener((tab) => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage()
  } else {
    window.open(chrome.runtime.getURL('options.html'))
  }
})

// メッセージを受け取った時のイベントハンドラを登録
// 詳細は個別にコメント
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 楽天証券のサイトURLを取得
  if (request.type === 'rakuten-sec:info') {
    const { tickerCode, country } = request.data
    const response = { type: request.type, data: { rakutenUrl: null, naitoUrl: null } }

    // 楽天証券のメンバーページを探す
    // メンバーページのURLからセッションIDを取得し銘柄に対応したページ遷移先のURLを構築する
    chrome.tabs.query({url: 'https://member.rakuten-sec.co.jp/*'}, (rakutenTabs) => {
      const sessionIdRegex = new RegExp('[;?&]BV_SessionID=([^?&]+)')
      for (let i = 0; i < rakutenTabs.length; i++) {
        const tab = rakutenTabs[i]
        const matchedSessionId = sessionIdRegex.exec(tab.url)
        if (matchedSessionId) {
          const sessionId = matchedSessionId[1]
          switch (country) {
            case 'jp':
              response.data.rakutenUrl = `https://member.rakuten-sec.co.jp/app/info_jp_prc_stock.do;BV_SessionID=${sessionId}?eventType=init&dscrCd=${tickerCode}&marketCd=1&chartPeriod=1&dscrCd=6526&gmn=J&smn=01&lmn=01&fmn=01`
              break
            case 'us':
              response.data.rakutenUrl = `https://member.rakuten-sec.co.jp/app/info_us_prc_stock.do;BV_SessionID=${sessionId}?eventType=init&tickerCd=${tickerCode}&chartType=&l-id=mem_us_fu_a_a`
              break
          }
          break
        }
      }

      if (country === 'jp') {
        // 内藤証券の国内株マーケットページを探す
        // 個別銘柄のページを開いていればそのURLをコピーして銘柄コードを変えたページを返す
        chrome.tabs.query({ url: 'https://*.qhit.net/naito/iswebptt2/*'}, (naitoTabs) => {
          const qcodeRegex = new RegExp('([;?&]qcode=)([0-9]{4})')
          for (let i = 0; i < naitoTabs.length; i++) {
            const tab = naitoTabs[i]
            if (qcodeRegex.test(tab.url)) {
              response.data.naitoUrl = tab.url.replace(qcodeRegex, `$1${tickerCode}`)
              break
            }
          }
          sendResponse(response)
        })
      } else {
        sendResponse(response)
      }
    })

    // tabs.queryのコールバックでsendResponseを実行するのでtrueを返す
    return true
  }

  return false
})

$(() => {
  setTimeout(attach, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attach = () => {
  // bodyを監視し子要素にオーバーラップレイヤーができるのを監視する
  const body = $('body')[0]
  const bodyObserver = new MutationObserver(() => {
    if (bodyObserverCallback()) {
      bodyObserver.disconnect()
    }
  })
  bodyObserver.observe(body, { childList: true })

  // canvasを監視し属性が変わったら追加したボタンの状態を更新させる
  const canvas = $('div.chart-gui-wrapper canvas[aria-hidden!="true"]')[0]
  if (canvas) {
    const canvasObserver = new MutationObserver(canvasObserverCallback)
    canvasObserver.observe(canvas, { attributes: true })
  
    // 楽天証券などのボタンを追加
    createButtons()
  }
}

/**
 * bodyタグの更新を監視する
 * コンテキストメニュー用のレイヤーが作成されていれば、そのレイヤーを監視する
 * コンテキストメニューレイヤーが作成された場合はメニューを拡張する
 * @returns { boolean } オブサーバを切断するか
 */
const bodyObserverCallback = () => {
  // オーバーラップレイヤーを監視しコンテキストメニューの構築を監視する
  const overlapManagerRoot = $('div#overlap-manager-root')[0]
  if (!overlapManagerRoot) {
    return false
  }

  const overlapManagerRootObserver = new MutationObserver((mutions) => {
    mutions.forEach((mution) => {
      if (mution.type === 'childList') {
        if (mution.addedNodes.length > 0) {
          attachMenu()
        }
      }
    })
  })
  
  overlapManagerRootObserver.observe(overlapManagerRoot, { childList: true })

  attachMenu()

  return true
}

/**
 * メニューを解析して拡張する
 */
const attachMenu = () => {
  // コンテキストメニューから銘柄コード(数値4桁)を取得する
  // 銘柄コードが取得できたらメニューを追加する
  const overlapManagerRoot = $('div#overlap-manager-root')
  if (overlapManagerRoot.length !== 1 || $('tr[data-kabu-tantan]').length > 0) {
    return
  }

  const ctxMenu = $('div.menu-Tx5xMZww.context-menu.menuWrap-Kq3ruQo8 > div > div[data-name="menu-inner"] > table', overlapManagerRoot)
  // 選択された銘柄リストからコードを取得
  const firstMenuItemText = $('tr:first td:eq(1) div span:first', ctxMenu).text()

  if (/^[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/.test(firstMenuItemText)) {
    addTokyoTickerAsync(ctxMenu, firstMenuItemText.slice(0, 4))
  } else if (/^[A-Z]{1,5}/.test(firstMenuItemText)) {
    addNewyorkTicker(ctxMenu, firstMenuItemText.match(/^[A-Z]{1,5}/g)[0])
  }
}

/**
 * メニューのセパレータ
 * @returns {JQuery<HTMLElement>}
 */
const makeMenuSeparator = () => {
  return $(`
  <tr class="row-DFIg7eOh" data-kabu-tantan>
    <td>
      <div class="line-DFIg7eOh"></div>
    </td>
    <td>
      <div class="line-DFIg7eOh"></div>
    </td>
  </tr>`)
}

/**
 * メニューを作成する
 * @param {string} title 
 * @param {string} url 
 * @returns {JQuery<HTMLElement>}
 */
const makeMenuItem = (title, url) => {
  return $(`
  <tr class="item-GJX1EXhk interactive-GJX1EXhk normal-GJX1EXhk">
    <td class="iconCell-GJX1EXhk" data-icon-cell="true"></td>
    <td>
      <div class="content-GJX1EXhk">
        <span class="label-GJX1EXhk" data-label="true">
          <div class="wrapper-NLkHhUu3">
            <a style="color: var(--tv-color-popup-element-text); width: 100%;" title="${title}" target="_blank" rel="noopener noreferrer" href="${url}">${title}</a>
          </div>
        </span>
      </div>
    </td>
  </tr>
  <tr class="subMenu-GJX1EXhk">
    <td></td>
  </tr>`)
  .click(() => {
    // クリックした場合はメニューが消えるように'ESC'キーを押したことにして消す
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 27 }))
  })
}

/**
 * 国内株用のメニューを作成する
 * @param {JQuery<HTMLElement>} ctxMenu 
 * @param {string} code 
 */
const addTokyoTickerAsync = async (ctxMenu, code) => {
  const items = await getEnableLinkKeysAsync()
  const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type: 'jp' } })
  const noitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code } })

  ctxMenu.append(makeMenuSeparator())

  // 楽天証券にログインしている時は楽天証券メニューを追加
  if (rakutenResponse.data.rakutenUrl) {
    const title = `${code} を楽天証券で開く`
    const url = rakutenResponse.data.rakutenUrl
    ctxMenu.append(makeMenuItem(title, url))
  }

  // 内藤証券の国内株式マーケット情報で個別銘柄を開いている時はメニューを追加
  if (noitoResponse.data.naitoUrl) {
    const title = `${code} を内藤証券で開く`
    const url = noitoResponse.data.naitoUrl
    ctxMenu.append(makeMenuItem(title, url))
  }

  // 各サイトのメニューを追加
  items.forEach((key) => {
    if (key.indexOf('tradingview.com') !== 0) {
      const item = externalUrlsMap[key]
      const title = `${code} を${item.title}で開く`
      const url = makeUrl(item.url1, code)
      ctxMenu.append(makeMenuItem(title, url))
    }
  })
}

/**
 * 米国株用のメニューを作成する
 * @param {JQuery<HTMLElement>} ctxMenu 
 * @param {string} code 
 */
const addNewyorkTicker = async (ctxMenu, code) => {
  const items = await getEnableLinkKeysAsync()
  const response = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type: 'us' } })

  ctxMenu.append(makeMenuSeparator())

  // urlがある場合は楽天証券メニューを追加
  if (response.data.rakutenUrl) {
    const title = `${code} を楽天証券で開く`
    const url = response.data.rakutenUrl
    ctxMenu.append(makeMenuItem(title, url))
  }

  // 各サイトのメニューを追加
  items.forEach((key) => {
    if (key.indexOf('tradingview.com') !== 0) {
      const item = externalUrlsMap[key]
      if (item.url3) {
        const title = `${code} を${item.title}で開く`
        const url = makeUrl(item.url3, code)
        ctxMenu.append(makeMenuItem(title, url))
      }
    }
  })
}

/**
 * 銘柄コード情報を持っているcanvasタグのコールバック
 * 楽天証券ボタンの表示/非表示を切り替える
 */
const canvasObserverCallback = () => {
  updateButtons()
}

/**
 * ボタンの表示・非表示を切り替える
 */
const updateButtons = async () => {
  const rakuten = $('div.ktt-rakuten-sec')
  const naito = $('div.ktt-naito-sec')
  const kabutan = $('div.ktt-kabutan')
  const minkabu = $('div.ktt-minkabu')
  const yahoo = $('div.ktt-yahoo')

  // 銘柄コードが取得できた場合、かつ、楽天証券のURLが取得できればボタンを表示
  const { code, type } = getTickerCode()

  if (code == null) {
    // 銘柄コードが取得できなかったので全部非表示
    updateVisible(rakuten, false)
    updateVisible(naito, false)
    updateVisible(kabutan, false)
    updateVisible(minkabu, false)
    updateVisible(yahoo, false)
    return
  }

  const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type } })
  const naitoResponse = type === 'jp'
    ? await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code } })
    : { data: { naitoUrl: null } }

  // 楽天証券にログインしている時は楽天証券ボタンを表示
  // 内藤証券の国内株マーケットを開いている場合はボタンを表示
  updateVisible(rakuten, rakutenResponse.data.rakutenUrl)
  updateVisible(naito, naitoResponse.data.naitoUrl)
  updateVisible(kabutan, true)
  updateVisible(minkabu, true)
  updateVisible(yahoo, true)
}

/**
 * ボタン(jQuery)の表示・非表示を切り替える
 * @param {JQuery} button 
 * @param {boolean} condition 
 */
const updateVisible = (button, condition) => {
  if (condition) {
    button.show()
  } else {
    button.hide()
  }
}

/**
 * ボタンを追加
 * ・楽天証券 : 楽天証券にログインしてる時だけ有効なボタン
 * ・内藤証券 : 内藤証券にログインし、国内株マーケットの個別銘柄を開いている時だけ有効なボタン
 */
const createButtons = () => {
  // 楽天証券ボタンを作成
  const rakuten = makeChartButton('楽天証券', 'ktt-rakuten-sec')
    .click(async () => {
      const { code, type } = getTickerCode()
      if (code) {
        const response = await chrome.runtime.sendMessage({ type: 'rakuten-sec:open', data: { code, type } })
        if (response.data.rakutenUrl === null) {
          alert('楽天証券にログインしてください')
        }
      }
    })

  // 内藤証券ボタンを作成
  const naito = makeChartButton('内藤証券', 'ktt-naito-sec')
    .click(async () => {
      const { code, type } = getTickerCode()
      if (code && type === 'jp') {
        const response = await chrome.runtime.sendMessage({ type: 'naito-sec:open', data: { code } })
        if (response.data.naitoUrl === null) {
          alert('内藤証券の国内株マーケットの個別銘柄のページを開いてください')
        }
      }
    })

    // 汎用ボタン作成
  const makeButton = (title, className, key) => {
    return makeChartButton(title, className)
      .click(() => {
        const { code, type } = getTickerCode()
        if (code) {
          const item = externalUrlsMap[key]
          const url = makeUrl(type === 'us' ? item.url3 : item.url1, code)
          chrome.runtime.sendMessage({ type: 'open-url', data: { url } })
        }
      })
  }

  // 株探, みんかぶ, Yahoo!
  const kabutan = makeButton('株探', 'ktt-kabutan', 'kabutan.jp/stock')
  const minkabu = makeButton('みんかぶ', 'ktt-minkabu', 'minkabu.jp/stock')
  const yahoo = makeButton('Yahoo!', 'ktt-yahoo', 'finance.yahoo.co.jp/bbs')

  // 各ボタンを追加する
  $('div.container-hw_3o_pb .buttonsWrapper-hw_3o_pb.notAvailableOnMobile-hw_3o_pb.withoutBg-hw_3o_pb')
    .append(rakuten)
    .append(naito)
    .append(kabutan)
    .append(minkabu)
    .append(yahoo)

  // 初回のボタン状態を設定
  updateButtons()
}

/**
 * 銘柄コードを取得
 * @returns 取得した銘柄コード、取得できない場合はnull
 */
const getTickerCode = () => {
  const canvas = $('div.chart-gui-wrapper canvas[aria-hidden!="true"]')
  if (canvas) {
    const ariaLabel = canvas.attr('aria-label')
    if (ariaLabel) {
      if (ariaLabel.startsWith('TSE:')) {
        const regex = new RegExp('(TSE:)([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])')
        if (regex.test(ariaLabel)) {
          const code = regex.exec(ariaLabel)[2]
          return { code: code, type: 'jp' }
        }
      } else if (ariaLabel.startsWith('BATS:')) {
        const regex = new RegExp('(BATS:)([A-Z]{1,5})')
        if (regex.test(ariaLabel)) {
          const code = regex.exec(ariaLabel)[2]
          return { code: code, type: 'us' }
        }
      }
    }
  }

  return { code: null, type: null }
}

/**
 * TradingViewのボタンを作る
 * @param {string} title 
 * @param {string} className 
 * @returns jQueryで作ったボタン
 */
const makeChartButton = (title, className) => {
  return $(`
  <div class="apply-common-tooltip button-hw_3o_pb buyButton-hw_3o_pb ${className}" style="color: skyblue; border-color: skyblue;">
    <span class="buttonText-hw_3o_pb">${title}</span>
  </div>`)
  .hide()
}

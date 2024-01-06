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
  const firstMenuItemText = $('tr:first td:eq(1) div span:first', ctxMenu).text()

  const { code, type } = getTickerCode()

  if (type === 'jp') {
    addTokyoTickerAsync(ctxMenu, code)
  } else if (type === 'us') {
    addNewyorkTicker(ctxMenu, code)
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

  ctxMenu.append(makeMenuSeparator())

  chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { type: 'jp', code: code } }, (response) => {
    // 楽天証券にログインしている時は楽天証券メニューを追加
    if (response.data.rakutenUrl) {
      const title = `${code} を楽天証券で開く`
      const url = response.data.rakutenUrl
      ctxMenu.append(makeMenuItem(title, url))
    }

    // 内藤証券の国内株式マーケット情報で個別銘柄を開いている時はメニューを追加
    if (response.data.naitoUrl) {
      const title = `${code} を内藤証券で開く`
      const url = response.data.naitoUrl
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
  })
}

/**
 * 米国株用のメニューを作成する
 * @param {JQuery<HTMLElement>} ctxMenu 
 * @param {string} code 
 */
const addNewyorkTicker = async (ctxMenu, code) => {
  const items = await getEnableLinkKeysAsync()

  ctxMenu.append(makeMenuSeparator())

  chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { type: 'us', code: code } }, (response) => {
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
  })
}

/**
 * 銘柄コード情報を持っているcanvasタグのコールバック
 * 楽天証券ボタンの表示/非表示を切り替える
 */
const canvasObserverCallback = () => {
  const rakuten = $('div.rakuten-sec')

  // 銘柄コードが取得できた場合、かつ、楽天証券のURLが取得できればボタンを表示
  const { code, type } = getTickerCode()
  if (code) {
    chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { type, code } }, (response) => {
      // 楽天証券にログインしている時は楽天証券メニューを追加
      if (response.data.rakutenUrl) {
        rakuten.show()
      } else {
        rakuten.hide()
      }
    })
  } else {
    rakuten.hide()
  }
}

/**
 * ボタンを追加
 * ・楽天証券 : 楽天証券にログインしてる時だけ有効なボタン。
 */
const createButtons = () => {
  // 楽天証券ボタンを作成
  const rakuten = $(`
    <div class="apply-common-tooltip button-hw_3o_pb sellButton-hw_3o_pb rakuten-sec">
      <span class="buttonText-hw_3o_pb">楽天証券</span>
    </div>`)
    .hide()
    .click(() => {
      const { code, type } = getTickerCode()
      if (code) {
        chrome.runtime.sendMessage({ type: 'rakuten-sec:open', data: { code, type } }, (response) => {
          if (response.data.rakutenUrl === null) {
            alert('楽天証券にログインしてください')
          }
        })
      }
    })

  // 楽天証券ボタンを追加する
  $('div.container-hw_3o_pb .buttonsWrapper-hw_3o_pb.notAvailableOnMobile-hw_3o_pb.withoutBg-hw_3o_pb')
    .append(rakuten)
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
  return null
}

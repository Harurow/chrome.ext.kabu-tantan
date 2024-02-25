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
  
    // 株リンクメニューを追加
    createKabuLinkMenu()
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
  const noitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code, type: 'jp' } })

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
  updateKabuLinkMenu()
}

/**
 * ボタンの表示・非表示を切り替える
 */
const updateKabuLinkMenu = async () => {
  const { code } = getTickerCode()
  
  $('.ktt-tv-kabuLinkMenu').each(function() {
    updateVisible($(this), code)
  })
}

/**
 * ボタン(jQuery)の表示・非表示を切り替える
 * @param {*} element 
 * @param {boolean} condition 
 */
const updateVisible = (element, condition) => {
  if (condition) {
    element.show()
  } else {
    element.hide()
  }
}

/**
 * 連携ボタンを追加
 * ・楽天証券 : 楽天証券にログインしてる時だけ有効なボタン
 * ・内藤証券 : 内藤証券にログインし、国内株マーケットの個別銘柄を開いている時だけ有効なボタン
 */
const createKabuLinkMenu = async () => {
  // TradingViewへのメニュー挿入位置
  const container = $('div.container-hw_3o_pb')

  const buttonsWrapper =
    $('<div>', {
      class: 'buttonsWrapper-hw_3o_pb notAvailableOnMobile-hw_3o_pb withoutBg-hw_3o_pb column-hw_3o_pb'
    }).appendTo(container)

  $(`<div class="ktt-tv-kabuLinkMenu">
    <span>株Link</span>
  </div>`)
  .appendTo(buttonsWrapper)
  .click(async (e) => {
    // 銘柄コードを取得
    const { code, type } = getTickerCode()

    // 銘柄コードが取得できなかったので株Linkを追加しない
    if (code == null) {
      return
    }

    // 株Linkをクリックした場合、メニューを表示
    // キー入力された場合はキャンセル扱い

    // body要素
    const body = $('body')

    // メニュー表示中にキーボードを押すとキャンセル
    const keydown = (e) => {
      e.preventDefault()
      clearMenu()
    }

    // メニューをクリア
    const clearMenu = () => {
      body[0].removeEventListener('keydown', keydown)
      background.remove()
    }

    // キーボードイベントを追加
    body[0].addEventListener('keydown', keydown)

    // 背景
    const background = $('<div>', {
      class: 'ktt-tv-menuBack'
    })
    .click((e) => {
      // 背景クリックはキャンセル
      clearMenu()
    })
    .appendTo(body)
  
    // メニューの全体
    const menuBody = $(`
      <div class="menu-Tx5xMZww context-menu menuWrap-Kq3ruQo8" style="position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;">
        <div class="scrollWrap-Kq3ruQo8" style="overflow-y: auto;">
          <div class="menuBox-Kq3ruQo8" data-name="menu-inner">
            <table>
              <tbody>
              </tbody>
            </table>
          </div>
        </div>
      </div>`)
    
    // メニュー項目を構築する
    const createMenuItem = (title) => $(`
      <tr data-role="menuitem" class="accessible-rm8yeqY4 item-GJX1EXhk interactive-GJX1EXhk normal-GJX1EXhk" tabindex="-1">
        <td class="iconCell-GJX1EXhk" data-icon-cell="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"></svg>
        </td>
        <td>
          <div class="content-GJX1EXhk">
            <span class="label-GJX1EXhk" data-label="true">${title}</span>
          </div>
        </td>
      </tr>`)

    // メニュー項目の追加先要素
    const tbody = $('tbody', menuBody)

    // 証券会社のメニューを追加したか
    let isAppendedSecMenuItem = false

    // 楽天証券にログインしている時は楽天証券のURLが取得できる
    const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type } })

    // 楽天証券メニューを追加
    if (rakutenResponse.data.rakutenUrl) {
      createMenuItem('楽天証券を開く')
      .click(async (e) => {
        // 楽天証券のページを開く
        const response = await chrome.runtime.sendMessage({ type: 'rakuten-sec:open', data: { code, type } })
        if (response.data.rakutenUrl === null) {
          alert('楽天証券にログインしてください')
        }
      })
      .appendTo(tbody)
      isAppendedSecMenuItem = true
    }
    
    // 内藤証券にログインしている時は内藤証券のURLが取得できる
    const naitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code, type } })

    // 内藤証券メニューを追加
    if (naitoResponse.data.naitoUrl) {
      createMenuItem('内藤証券を開く')
      .click(async (e) => {
        // 内藤証券のページを開く
        const response = await chrome.runtime.sendMessage({ type: 'naito-sec:open', data: { code, type } })
        if (response.data.naitoUrl === null) {
          alert('内藤証券にログインしてください')
        }
      })
      .appendTo(tbody)
      isAppendedSecMenuItem = true
    }

    // 証券会社メニューがある場合はセパレータを追加
    if (isAppendedSecMenuItem) {
      $(`<tr class="row-DFIg7eOh"><td><div class="line-DFIg7eOh"></div></td><td><div class="line-DFIg7eOh"></div></td></tr>`)
      .appendTo(tbody)
    }
    
    // 有効になってる外部連携リンクをメニューに追加する
    const keys = await getEnableLinkKeysAsync()
    keys.forEach((key) => {
      if (key.indexOf('tradingview.com') !== 0) {
        const item = externalUrlsMap[key]
        createMenuItem(`${item.title}で開く`)
          .click(() => {
            const item = externalUrlsMap[key]
            const url = makeUrl(type === 'us' ? item.url3 : item.url1, code)
            chrome.runtime.sendMessage({ type: 'open-url', data: { url } })
          })
          .appendTo(tbody)
      }
    })

    menuBody.appendTo(background)
  })
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
      if (ariaLabel.startsWith('TSE:') || ariaLabel.startsWith('TSE_DLY:')) {
        const regex = new RegExp('(TSE(_DLY)?:)([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])')
        if (regex.test(ariaLabel)) {
          const code = regex.exec(ariaLabel)[3]
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

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
    if (mutationObserverCallback()) {
      bodyObserver.disconnect()
    }
  })

  bodyObserver.observe(body, { childList: true })
}

/**
 * bodyタグの更新を監視する
 * コンテキストメニュー用のレイヤーが作成されていれば、そのレイヤーを監視する
 * コンテキストメニューレイヤーが作成された場合はメニューを拡張する
 * @returns { boolean } オブサーバを切断するか
 */
const mutationObserverCallback = () => {
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

  if (/^\d{4}/.test(firstMenuItemText)) {
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
}

/**
 * 国内株用のメニューを作成する
 * @param {JQuery<HTMLElement>} ctxMenu 
 * @param {string} code 
 */
const addTokyoTickerAsync = async (ctxMenu, code) => {
  const items = await getEnableLinkKeysAsync()

  ctxMenu.append(makeMenuSeparator())

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

  ctxMenu.append(makeMenuSeparator())

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

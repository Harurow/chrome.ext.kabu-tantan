$(function () {
  setTimeout(hooks, 500)
})

/**
 * ページを改変するエントリポイント
 */
function hooks () {
  // bodyを監視し子要素にオーバーラップレイヤーができるのを監視する
  const body = $('body')[0]
  const bodyObserver = new MutationObserver(() => {
    if (bodyObserverCallback()) {
      bodyObserver.disconnect()
    }
  })

  bodyObserver.observe(body, { childList: true })
}

function bodyObserverCallback () {
  // オーバーラップレイヤーを監視しコンテキストメニューの構築を監視する

  const overlapManagerRoot = $('div#overlap-manager-root')[0]
  if (!overlapManagerRoot) {
    return false
  }

  const overlapManagerRootObserver = new MutationObserver((mutions) => {
    mutions.forEach((mution) => {
      if (mution.type === 'childList') {
        if (mution.addedNodes.length > 0) {
          hookMenu()
        }
      }
    })
  })

  overlapManagerRootObserver.observe(overlapManagerRoot, { childList: true })

  hookMenu()

  return true
}

const selectedClassName = 'selected-IEe5qpW4'

function hookMenu () {
  // コンテキストメニューから銘柄コード(数値4桁)を取得する
  // 銘柄コードが取得できたらメニューを追加する
  const overlapManagerRoot = $('div#overlap-manager-root')
  if (overlapManagerRoot.length !== 1 || $('tr[data-kabu-tantan]').length > 0) {
    return
  }

  const ctxMenu = $('div.menu-Tx5xMZww.context-menu.menuWrap-Kq3ruQo8 > div > div[data-name="menu-inner"] > table', overlapManagerRoot)
  const firstMenuItemText = $('tr:first td:eq(1) div span:first', ctxMenu).text()

  if (!/^\d{4}/.test(firstMenuItemText)) {
    return
  }

  const tickerCode = firstMenuItemText.slice(0, 4)

  const yahoo = `${tickerCode} をYahoo!ファイナンスで開く`
  const kabutan = `${tickerCode} を株探で開く`

  const menuItem = $(`
  <tr class="row-DFIg7eOh">
    <td>
      <div class="line-DFIg7eOh"></div>
    </td>
    <td>
      <div class="line-DFIg7eOh"></div>
    </td>
  </tr>
  <tr class="item-GJX1EXhk interactive-GJX1EXhk normal-GJX1EXhk">
    <td class="iconCell-GJX1EXhk" data-icon-cell="true"></td>
    <td>
      <div class="content-GJX1EXhk">
        <span class="label-GJX1EXhk" data-label="true">
          <div class="wrapper-NLkHhUu3">
            <a style="color: var(--tv-color-popup-element-text); width: 100%;" title="${yahoo}" target="_blank" rel="noopener noreferrer" href="https://finance.yahoo.co.jp/quote/${tickerCode}/bbs">${yahoo}</a>
          </div>
        </span>
      </div>
    </td>
  </tr>
  <tr class="subMenu-GJX1EXhk">
    <td></td>
  </tr>
  <tr class="item-GJX1EXhk interactive-GJX1EXhk normal-GJX1EXhk">
    <td class="iconCell-GJX1EXhk" data-icon-cell="true"></td>
    <td>
      <div class="content-GJX1EXhk">
        <span class="label-GJX1EXhk" data-label="true">
          <div class="wrapper-NLkHhUu3">
            <a style="color: var(--tv-color-popup-element-text); width: 100%;" title="${kabutan}" target="_blank" rel="noopener noreferrer" href="https://kabutan.jp/stock/?code=${tickerCode}">${kabutan}</a>
          </div>
        </span>
      </div>
    </td>
  </tr>
  <tr class="subMenu-GJX1EXhk" data-kabu-tantan>
    <td></td>
  </tr>`)

  ctxMenu.append(menuItem)
}

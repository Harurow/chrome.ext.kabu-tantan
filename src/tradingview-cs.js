$(() => {
  setTimeout(attach, 500)
})

/** チャート上で contextmenu が発生してから、メニューの拡張を許す猶予(ミリ秒) */
const chartContextMenuGraceMs = 1500

/** チャート上で最後に contextmenu が発生した時刻。未発生は 0 */
let chartContextMenuAt = 0

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

  // 右クリックの起点を記録する
  // TradingView は右クリック以外でも同じメニュー要素を使うため、
  // チャート上の右クリック直後だけメニューを拡張する
  // (ウォッチリスト等から開いたメニューはチャートと別銘柄になりうる)
  // チャート外を右クリックした場合は記録を捨てる
  // (直前のチャート右クリックが猶予内に残っていても拡張させない)
  document.addEventListener('contextmenu', (e) => {
    chartContextMenuAt = $(e.target).closest('div.chart-gui-wrapper').length > 0 ? Date.now() : 0
  }, true)

  // canvasを監視し属性が変わったら追加したボタンの状態を更新させる
  const canvas = $(selectorOf('chart-canvas'))[0]
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
  const overlapManagerRoot = $(selectorOf('overlap-root'))[0]
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
 * 条件を1つでも満たさない場合はDOMを一切変更しない
 */
const attachMenu = () => {
  // オーバーラップレイヤーが1つだけ、かつ未追加であること
  const overlapManagerRoot = $(selectorOf('overlap-root'))
  if (overlapManagerRoot.length !== 1 || $('tr[data-kabu-tantan]').length > 0) {
    return
  }

  // チャート上の右クリックを起点にしたメニューだけを拡張する
  if (Date.now() - chartContextMenuAt > chartContextMenuGraceMs) {
    return
  }

  // 入れ子メニュー等で2件以上ヒットしうるため、先頭の1件だけを対象にする
  const ctxMenu = $(selectorOf('context-menu'), overlapManagerRoot).first()
  if (ctxMenu.length === 0) {
    return
  }

  // 銘柄コードはメニューの文言ではなくチャートのcanvasから取得する
  const { code, type } = getTickerCode()
  if (code == null) {
    return
  }

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
  <tr class="${tvMimicClasses.separatorRow}" data-kabu-tantan>
    <td>
      <div class="${tvMimicClasses.separatorLine}"></div>
    </td>
    <td>
      <div class="${tvMimicClasses.separatorLine}"></div>
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
  <tr class="${tvMimicClasses.item}">
    <td class="${tvMimicClasses.iconCell}" data-icon-cell="true"></td>
    <td>
      <div class="${tvMimicClasses.content}">
        <span class="${tvMimicClasses.label}" data-label="true">
          <a style="color: var(--tv-color-popup-element-text); width: 100%;" title="${title}" target="_blank" rel="noopener noreferrer" href="${url}">${title}</a>
        </span>
      </div>
    </td>
  </tr>
  <tr class="${tvMimicClasses.subMenu}">
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
  // 区切り線はawaitの前に付ける
  // 区切り行が持つdata-kabu-tantanが二重追加のガードになるため、
  // 応答待ちの間にattachMenu()がもう一度通っても追加されない
  ctxMenu.append(makeMenuSeparator())

  const items = await getEnableLinkKeysAsync()
  const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type: 'jp' } })
  const noitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code, type: 'jp' } })

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
  // 区切り線はawaitの前に付ける(addTokyoTickerAsyncと同じ理由)
  ctxMenu.append(makeMenuSeparator())

  const items = await getEnableLinkKeysAsync()
  const response = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type: 'us' } })

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

  $('.ktt-tv-kabuLinkMenu').each(function () {
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
  const container = $(selectorOf('toolbar-container'))

  const buttonsWrapper =
    $('<div>', {
      class: tvMimicClasses.buttonsWrapper
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
      <div class="${tvMimicClasses.menuWrap}" style="position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;">
        <div class="${tvMimicClasses.scrollWrap}" style="overflow-y: auto;">
          <div class="${tvMimicClasses.menuBox}">
            <table>
              <tbody>
              </tbody>
            </table>
          </div>
        </div>
      </div>`)

      // メニュー項目を構築する
      const createMenuItem = (title) => $(`
      <tr data-role="menuitem" class="${tvMimicClasses.accessible} ${tvMimicClasses.item}" tabindex="-1">
        <td class="${tvMimicClasses.iconCell}" data-icon-cell="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"></svg>
        </td>
        <td>
          <div class="${tvMimicClasses.content}">
            <span class="${tvMimicClasses.label}" data-label="true">${title}</span>
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
        $(`<tr class="${tvMimicClasses.separatorRow}"><td><div class="${tvMimicClasses.separatorLine}"></div></td><td><div class="${tvMimicClasses.separatorLine}"></div></td></tr>`)
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
 * チャートのcanvasのaria-label(`EXCHANGE:CODE の 1 日 チャート`)を解析する
 * @returns {{ code: string, type: string }} 取得した銘柄コード、取得できない場合はcode/typeともにnull
 */
const getTickerCode = () => {
  const notFound = { code: null, type: null }

  const canvas = $(selectorOf('chart-canvas'))
  const ariaLabel = canvas.attr('aria-label')
  if (!ariaLabel) {
    return notFound
  }

  // 取引所トークンを取り出す('_DLY'は遅延配信の接尾辞なので剥がしてから引く)
  const matched = /^([A-Z]+)(_DLY)?:/.exec(ariaLabel)
  if (!matched) {
    return notFound
  }

  const type = exchanges[matched[1]]
  const rest = ariaLabel.slice(matched[0].length)

  if (type === 'jp') {
    const code = /^[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/.exec(rest)
    if (code) {
      return { code: code[0], type }
    }
  } else if (type === 'us') {
    const code = /^[A-Z]{1,5}/.exec(rest)
    if (code) {
      return { code: code[0], type }
    }
  }

  return notFound
}

/**
 * 改変情報（検出用セレクタ）
 * TradingView は DOM がハッシュ付きクラス名で頻繁に変わるため、
 * 検出用セレクタは1箇所にまとめて `key` で引く。
 * ここが唯一の情報源で、`npm run check:selectors` もこの値を読む。
 * @type { { key: string, title: string, selector: string }[] }
 */
const menuSelectors = [
  {
    key: 'chart-canvas',
    title: 'チャート canvas',
    selector: 'div.chart-gui-wrapper canvas[aria-hidden!="true"]'
  },
  {
    key: 'toolbar-container',
    title: 'ツールバー挿入先',
    selector: 'div.container-OH8c8Nc3'
  },
  {
    key: 'overlap-root',
    title: 'オーバーレイレイヤー',
    selector: 'div#overlap-manager-root'
  },
  {
    key: 'context-menu',
    title: '右クリックメニュー',
    selector: 'div.context-menu table'
  }
]

/**
 * key に対応する検出用セレクタを取得する
 * @param { string } key
 * @returns { string }
 */
const selectorOf = (key) => menuSelectors.find((menuSelector) => menuSelector.key === key).selector

/**
 * TradingView の見た目に合わせるための模倣用クラス（検証対象外 / 採取日: 2026-08-23）
 * ハッシュ部分は TradingView のリリースで変わる。壊れても見た目が崩れるだけで機能は落ちない。
 * 更新手順は docs/ARCHITECTURE.md「TradingView の模倣用クラスを更新する」
 * @type { Record<string, string> }
 */
const tvMimicClasses = {
  // ツールバーに挿すボタンの器
  buttonsWrapper: 'buttonsWrapper-OH8c8Nc3 notAvailableOnMobile-OH8c8Nc3 withoutBg-OH8c8Nc3',
  // メニュー項目
  item: 'item-WSeXSXQB interactive-WSeXSXQB normal-WSeXSXQB',
  iconCell: 'iconCell-WSeXSXQB',
  content: 'content-WSeXSXQB',
  label: 'label-WSeXSXQB',
  subMenu: 'subMenu-WSeXSXQB',
  // 区切り線
  separatorRow: 'row-tEFkH1Rx',
  separatorLine: 'line-tEFkH1Rx',
  // キーボード操作に対応した項目
  accessible: 'accessible-JcN4DqBB',
  // 「株Link」ボタンから開く自前メニューの枠
  menuWrap: 'menu-IqFTXspI context-menu menuWrap-lBIxIwtz',
  scrollWrap: 'scrollWrap-lBIxIwtz',
  menuBox: 'menuBox-lBIxIwtz'
}

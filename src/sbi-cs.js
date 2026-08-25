$(() => {
  setTimeout(attach, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attach = async () => {
  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  // 利用するURLリスト
  // 門を通った後に拡張機能が更新される場合に備えて網(try)も張る
  let keys
  try {
    keys = await getEnableLinkKeysAsync()
  } catch {
    return
  }

  // 描画が遅れて注入対象が後から現れる場合に備え、静止するまで試し直す(SPEC-CS-22)
  // URLで対象を絞らないため(SPEC-CS-09)、対象外ページでは30秒間セレクタを評価し続ける
  // ただしDOMは一切変更しない(NFR-01)
  retrySetup(() => attachPass(keys))
}

/**
 * 注入パスを1回走らせる
 * 「1件でも注入できたら成功」にすると段階的に描画される表で
 * 一部の行だけ注入して止まるため、静止(新規注入が0件)を成功条件にする(SPEC-CS-22)
 * @param { string[] } keys
 * @returns { boolean } 静止したか
 */
const attachPass = (keys) => {
  const before = $('span.x-kabu-root').length

  // 設定に従い一つづつ試す
  menuSelectors
    .forEach((menuSelector) => {
      $(menuSelector.selector)
        .each((_, element) => attachMenu(element, keys))
    })

  const after = $('span.x-kabu-root').length

  // 累計1件以上注入し、かつ直近のパスの新規注入が0件なら静止した
  return after > 0 && after === before
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element
 * @param { string[] } keys
 */
const attachMenu = (element, keys) => {
  // 注入済みメニューの内側は対象にしない(二重注入の防止。SPEC-CS-22)
  // 注入したメニュー項目の<a>が検出用セレクタに再びヒットするため
  if ($(element).closest('span.x-kabu-root').length > 0) {
    return
  }

  const text = $(element).text()
  const match = text.trim().match(/[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/g)

  if (!match) {
    return
  }

  const tickerCode = match[0]
  const childNodes = element.childNodes

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i]
    if (node.nodeName !== '#text' || node.nodeValue.indexOf(tickerCode) === -1) {
      continue
    }

    const menu = createMenu(keys, tickerCode, node.nodeValue)
    element.replaceChild(menu[0], node)
  }
}

/**
 * 改変情報
 * @type { { selector: string }[] }
 */
const menuSelectors = [
  {
    title: '個別銘柄',
    selector: 'div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal'
  },
  {
    title: 'ポートフォリオ',
    selector: 'div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)'
  }
]

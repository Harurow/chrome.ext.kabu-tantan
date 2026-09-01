/**
 * ドロップダウンメニューを作成する
 *
 * 国内株は `url1`、米国株は `url3` を使う(SPEC-CS-06)。
 * 米国株では `url3` を持たないサイトを落とすため、項目が0件になりうる。
 * **0件ならメニュー自体を作らない**(`null` を返す。FR-28 判定基準4)。
 * 空の箱がホバーで開くのは利用者から見れば故障で、TradingView 側の先例
 * (遷移先が1つも無ければメニューも背景も出さない。SPEC-CS-11)に揃えた
 *
 * @param { string [] } keys
 * @param {string} code
 * @param {string} text
 * @param {boolean} [nonStyle]
 * @param {'jp' | 'us'} [type] 既定は 'jp'
 * @returns {JQuery<HTMLElement> | null} 項目が0件なら null
 */
const createMenu = (keys, code, text, nonStyle, type) => {
  const menuBody = $('<ul>', { class: 'x-kabu-body' })
    .css({
      padding: '3px 6px',
      textAlign: 'left',
      zIndex: 999999,
    })

  // URLリストからリンクを作成
  let count = 0
  keys.forEach((key) => {
    // storage に残った未知のキー(廃止済みの key)は読み飛ばす
    const entry = externalUrlsMap[key]
    if (!entry) {
      return
    }

    // 米国株は取引所を見ない。常に url3(判定基準9。ADR-0014 の 6)
    const urlTemplate = type === 'us' ? entry.url3 : entry.url1
    if (!urlTemplate) {
      return
    }

    menuBody.append(createMenuItem(entry.title, makeUrl(urlTemplate, code)))
    count++
  })

  if (count === 0) {
    return null
  }

  const menu = $('<span>', { class: 'x-kabu-root' })
    .css({ display: nonStyle ? undefined : 'inline-block' })
    .append(document.createTextNode(text))
    .append(menuBody)
    .hover(
      () => { menuBody.addClass('open') },
      () => { menuBody.removeClass('open') }
    )

  return menu
}

/**
 * メニューアイテム(リンク)を作成する
 * @param {string} title メニューアイテムのタイトル
 * @param {string} url リンクのURL
 * @returns {JQuery<HTMLElement>}
 */
const createMenuItem = (title, url) => {
  return $('<li>', { class: 'x-kabu-menu-item' })
    .css({ margin: '3px 6px' })
    .append($('<a>', {
      title,
      target: '_blank',
      rel: 'noopener noreferrer',
      href: url,
      text: title
    }))
}

/**
 * ドロップダウンメニューを作成する
 * @param { string [] } keys
 * @param {string} code 
 * @param {string} text 
 * @param {boolean} nonStyle
 * @returns {JQuery<HTMLElement>}
 */
const createMenu = (keys, code, text, nonStyle) => {
  const menuBody = $('<ul>', { 'class': 'x-kabu-body' })
    .css({
      padding: '3px 6px',
      textAlign: 'left',
      zIndex: 999999,
    })

  // URLリストからリンクを作成
  keys.forEach((key) => {
    const { title, url1 } = externalUrlsMap[key]
    const url = makeUrl(url1, code)
    menuBody.append(createMenuItem(title, url))
  })

  const menu = $('<span>', { 'class': 'x-kabu-root' })
    .css({ display: nonStyle ? undefined : 'inline-block' } )
    .append(text)
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
  return $('<li>', { 'class': 'x-kabu-menu-item' })
    .css({ margin: '3px 6px' })
    .append($('<a>', {
      title,
      target: '_blank',
      rel: 'noopener noreferrer',
      href: url,
      text: title
    }))
}

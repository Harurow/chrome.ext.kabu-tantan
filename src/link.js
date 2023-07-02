/**
 * ドロップダウンメニューを作成する
 * @param {string} tickerCode 
 * @returns {JQuery<HTMLElement>}
 */
function createDropDownMenu (tickerCode) {
  const dropDownMenu = $('<ul class="x-kabu">')
    .css('padding', '3px 8px')
    .css('text-align', 'left')

  gotoLinks.forEach((linkSetting) => {
    const link = $('<a>')
      .text(linkSetting.title)
      .attr('title', linkSetting.title)
      .attr('target', '_blank')
      .attr('rel', 'noopener noreferrer')
      .attr('href', linkSetting.url.replace('{}', tickerCode))
    const list = $('<li class="x-kabu-menu-item">')
      .css('margin', '3px 6px')
      .append(link)
    dropDownMenu.append(list)
  })

  return dropDownMenu
}

/**
 * 要素のメニューをアタッチする
 * @param {JQuery<HTMLElement>} elem
 * @param {JQuery<HTMLElement} dropDownMenu 
 */
function attachDropDownMenu (elem, dropDownMenu) {
  const children = elem[0].childNodes
  if (children && children.length > 1) {
    for (let i = 0; i < children.length; i++) {
      const node = children[i]
      if (node.nodeName === '#text' && /\d{4}/.test(node.nodeValue.trim())) {
        const mainMenu = $('<span class="x-kabu-root">')
          .text(node.nodeValue)
          .css('display', 'inline-block')
          .append(dropDownMenu)
          .hover(
            function () {
              dropDownMenu.addClass('open')
            },
            function () {
              dropDownMenu.removeClass('open')
            }
          )
        elem[0].replaceChild(mainMenu[0], node)
        break
      }
    }
  } else {
    const mainMenu = $('<span class="x-kabu-root">')
      .text(elem.text())
      .css('display', 'inline-block')
      .append(dropDownMenu)
      .hover(
        function () {
          dropDownMenu.addClass('open')
        },
        function () {
          dropDownMenu.removeClass('open')
        }
      )
    elem.html(mainMenu)
  }
}

/**
 * リンク先の設定
 * @type { title: string, url: string }[]
 */
const gotoLinks = [
  {
    title: 'TradingView/高機能チャート',
    url: 'https://jp.tradingview.com/chart/?symbol=TSE%3A{}'
  },
  {
    title: '株探/基本情報',
    url: 'https://kabutan.jp/stock/?code={}'
  },
  {
    title: '株探/チャート',
    url: 'https://kabutan.jp/stock/chart?code={}'
  },
  {
    title: '株探/時系列',
    url: 'https://kabutan.jp/stock/kabuka?code={}'
  },
  {
    title: '株探/ニュース',
    url: 'https://kabutan.jp/stock/news?code={}'
  },
  {
    title: '株探/決算',
    url: 'https://kabutan.jp/stock/finance?code={}'
  },
  {
    title: '株探/大株主',
    url: 'https://kabutan.jp/stock/holder?code={}'
  },
  {
    title: 'Yahoo! ファイナス/掲示板',
    url: 'https://finance.yahoo.co.jp/quote/{}/bbs'
  }
]

$(function () {
  setTimeout(hooks, 300)
})

/**
 * ページを改変するエントリポイント
 */
function hooks () {
  // 設定に従い一つづつ試す
  hookSettings
    .forEach(hook)
}

/**
 * ページを改変する
 * @param {{ selector: string }} hookSetting
 */
function hook (hookSetting) {
  $(hookSetting.selector)
    .each(function () {
      const elem = $(this)
      const text = elem.text().trim()

      const matches = text.match(/\d{4}/g)
      if (!matches) {
        return
      }

      const tickerCode = matches[matches.length - 1]

      build(elem, tickerCode)
    })
}

/**
 * 要素に対して外部リンクを紐づける
 * @param {JQuery<HTMLElement>} elem
 * @param {string} tickerCode
 */
function build (elem, tickerCode) {
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

/**
 * 改変情報
 * @type { selector: string }[]
 */
const hookSettings = [
  {
    selector: 'div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal'
  },
  {
    selector: 'body.vsc-initialized div.middleArea2 div.middleAreaM2 table table table tr td.mtext'
  }
]

$(function () {
  setTimeout(hooks, 500)
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

      // 一致した最後の数字4桁を銘柄コードとして扱う
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
  const dropDownMenu = createDropDownMenu(tickerCode)
  attachDropDownMenu(elem, dropDownMenu)
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

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
  // セレクタにマッチしたものをひとつづつ確認
  $(hookSetting.selector)
    .each(function () {
      // 該当要素の文字列に数値4桁があれば銘柄コードとして採用
      // 複数ある場合は最後の該当数値を利用する

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
  const dropDownMenu = createDropDownMenu(tickerCode)
  attachDropDownMenu(elem, dropDownMenu)
}

/**
 * 改変情報
 * @type { selector: string }[]
 */
const hookSettings = [
  {
    title: "個別銘柄",
    selector: 'div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal'
  },
  {
    title: 'ポートフォリオ',
    selector: 'body.vsc-initialized div.middleArea2 div.middleAreaM2 table table table tr td.mtext'
  }
]

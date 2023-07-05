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
 * @param {{ title: string, url: string, selector: string }} hookSetting
 */
function hook (hookSetting) {
  if (location.href.indexOf(hookSetting.url) === -1) {
    return
  }

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
 * @type { title: string, url: string, selector: string }[]
 */
const hookSettings = [
  {
    title: 'お気に入り',
    url: '/app/info_jp_prc_reg_lst.do;',
    selector: 'form#form table.tbl-data-01 td.align-C div.mbody nobr'
  },
  {
    title: '保有商品一覧・すべて',
    url: '/app/ass_all_possess_lst.do;',
    selector: 'div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td'
  },
  {
    title: '保有商品一覧・国内株式',
    url: '/app/ass_jp_stk_possess_lst.do;',
    selector: 'table#poss-tbl-sp tr td table tr td nobr'
  },
  {
    title: 'ランキング・売買代金',
    url: '/app/market_ranking.do',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td'
  },
  {
    title: 'ランキング・出来高',
    url: '/app/market_ranking_volume.do',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td'
  },
  {
    title: 'ランキング・値上り・値下り',
    url: '/app/market_ranking_change.do',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td'
  },
  {
    title: 'ランキング・信用残',
    url: '/app/market_ranking_debit.do',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td'
  },
  {
    title: 'ランキング・楽天内',
    url: '/app/market_ranking_rakuten.do',
    selector: `div#daily-ranking table.tbl-data-01 tr td.align-C,
               div#weekly-ranking table.tbl-data-01 tr td.align-C,
               div#daily-ranking-margin table.tbl-data-01 tr td.align-C,
               div#margin-oneday-ranking table.tbl-data-01 tr td.align-C,
               div#sor-ranking table.tbl-data-01 tr td.align-C`
  },
  {
    title: '国内株式・個別銘柄',
    url: '/app/info_jp_prc_stock.do',
    selector: 'div#line1 h1.hdg-l1-01-title span:first'
  },
  {
    title: '国内株式・株価検索',
    url: '/app/info_jp_prc_search.do',
    selector: 'div#line1 h1.hdg-l1-01-title span:first'
  }
]

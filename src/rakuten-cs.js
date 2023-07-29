$(() => {
  setTimeout(attachAsync, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attachAsync = async () => {
  // 利用するURLリスト
  const keys = await getEnableLinkKeysAsync()

  // 設定に従い一つづつ試す
  menuSelectors
    .filter((menuSelector) => (location.href.indexOf(menuSelector.url) !== -1))
    .forEach((menuSelector) => {
      $(menuSelector.selector)
        .each((_, element) => attachMenu(element, keys))
    })
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element 
 * @param { string[] } keys
 */
const attachMenu = (element, keys) => {
  const text = $(element).text()
  const match = text.trim().match(/\d{4}/g)

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
 * @type { { title: string, url: string, selector: string }[] }
 */
const menuSelectors = [
  {
    title: 'お気に入り',
    url: '/app/info_jp_prc_reg_lst.do;',
    selector: 'form#form table.tbl-data-01 td.align-C div.mbody nobr'
  },
  {
    title: 'お気に入り編集',
    url: '/app/info_jp_prc_reg_lst_edit.do;',
    selector: 'form table.tbl-data-01 td.align-C div.mbody nobr'
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
    url: '/app/market_ranking.do;',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)'
  },
  {
    title: 'ランキング・出来高',
    url: '/app/market_ranking_volume.do;',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)'
  },
  {
    title: 'ランキング・値上り・値下り',
    url: '/app/market_ranking_change.do;',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)'
  },
  {
    title: 'ランキング・信用残',
    url: '/app/market_ranking_debit.do;',
    selector: 'div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)'
  },
  {
    title: 'ランキング・積立',
    url: '/app/market_ranking_reserve.do;',
    selector: 'div#str-main-inner table table.tbl-data-01 tr td:nth-of-type(2)'
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

$(() => {
  setTimeout(attachAsync, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attachAsync = async () => {
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

  // URLが一致する対象だけを見る
  const targets = menuSelectors
    .filter((menuSelector) => (location.href.indexOf(menuSelector.url) !== -1))

  // 一致するものが無ければ再試行そのものを始めない(SPEC-CS-14 / SPEC-CS-22)
  if (targets.length === 0) {
    return
  }

  // 描画が遅れて注入対象が後から現れる場合に備え、静止するまで試し直す(SPEC-CS-22)
  retrySetup(() => attachPass(targets, keys))
}

/**
 * 注入パスを1回走らせる
 * 「1件でも注入できたら成功」にすると段階的に描画される表で
 * 一部の行だけ注入して止まるため、静止(新規注入が0件)を成功条件にする(SPEC-CS-22)
 * @param { { title: string, url: string, selector: string }[] } targets
 * @param { string[] } keys
 * @returns { boolean } 静止したか
 */
const attachPass = (targets, keys) => {
  const before = $('span.x-kabu-root').length

  // 設定に従い一つづつ試す
  targets.forEach((menuSelector) => {
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

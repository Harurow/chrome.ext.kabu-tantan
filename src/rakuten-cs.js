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

  // 遷移先が1件も無ければ、どのページでも注入するものが無い(CLAUDE.md の共通パターン)
  // 1.17.0 で createMenu が0件のとき null を返すようになったため、この門が無いと
  // 静止条件(累計1件以上)が永久に偽になり、30秒間セレクタを評価し続ける(NFR-01)
  if (keys.length === 0) {
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
 * @param { { title: string, url: string, selector: string, us?: boolean }[] } targets
 * @param { string[] } keys
 * @returns { boolean } 静止したか
 */
const attachPass = (targets, keys) => {
  const before = $('span.x-kabu-root').length

  // 設定に従い一つづつ試す
  targets.forEach((menuSelector) => {
    $(menuSelector.selector)
      .each((_, element) => attachMenu(element, keys, menuSelector.us === true))
  })

  const after = $('span.x-kabu-root').length

  // 累計1件以上注入し、かつ直近のパスの新規注入が0件なら静止した
  return after > 0 && after === before
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element
 * @param { string[] } keys
 * @param { boolean } allowUs 米国株の抽出を許すか(menuSelectors の us。SPEC-CS-26)
 */
const attachMenu = (element, keys, allowUs) => {
  // 注入済みメニューの内側は対象にしない(二重注入の防止。SPEC-CS-22)
  // 注入したメニュー項目の<a>が検出用セレクタに再びヒットするため
  if ($(element).closest('span.x-kabu-root').length > 0) {
    return
  }

  // 注入済みの要素も対象にしない(1行1メニュー。FR-28 判定基準10)
  // 最初のテキストノードで打ち切るため、同じコードが2回現れるセルでは
  // 未置換のテキストノードが残る。再試行(SPEC-CS-22)やMutationObserverでパスは
  // 繰り返されるので、打ち切りだけでは次のパスが2つ目を置換してしまう
  if ($('span.x-kabu-root', element).length > 0) {
    return
  }

  // 国内株を先に見て、空振りしたときだけ米国株を試す(SPEC-TC-10)
  const ticker = matchInjectionTicker($(element).text(), allowUs)

  if (!ticker) {
    return
  }

  const childNodes = element.childNodes

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i]
    if (node.nodeName !== '#text' || node.nodeValue.indexOf(ticker.code) === -1) {
      continue
    }

    // 遷移先が0件ならメニューを出さない(SPEC-CS-06 / FR-28 判定基準4)
    const menu = createMenu(keys, ticker.code, node.nodeValue, false, ticker.type)
    if (menu) {
      element.replaceChild(menu[0], node)
    }

    // 1行につきメニューは1つ。最初のテキストノードで打ち切る(FR-28 判定基準10)
    break
  }
}

/**
 * 改変情報
 * `us` は米国株の抽出を許すかどうか(opt-in。SPEC-CS-26 / ADR-0014 の 1)。
 * 省略したエントリは国内株のみで、今日とバイト単位で同じ結果になる
 * @type { { title: string, url: string, selector: string, us?: boolean }[] }
 */
const menuSelectors = [
  {
    title: 'お気に入り',
    url: '/app/info_jp_prc_reg_lst.do;',
    // us は付けない。米国株のお気に入りは別ページ(info_us_prc_reg_lst.do)で、
    // このページに米国株の行は並ばない(実機で確定。ADR-0014 の 9-2)。
    // 商品種別で絞れないセレクタなので、利得が無いなら opt-in しない
    selector: 'form#form table.tbl-data-01 td.align-C div.mbody nobr'
  },
  {
    // 米国株のお気に入りは国内株とは別ページ(実機で確定。ADR-0014 の 9-1)。
    // **url は実測**(利用者が提示したアドレスバー)。**推測なのは selector だけ**で、
    // 国内株版と対称なテンプレートだろうと見て写した(⚠️ 実 DOM 未確認)。
    // 対称だから推測したのではなく、提示された値がたまたま対称だっただけなので、
    // 推測を測定に見せない(ADR-0011 の 13 の教訓)
    //
    // 外れ方は2分岐で、benign なのは片方だけ(SPEC-CS-26)
    //   - 空振り(構造が違う)      → 0 件＝今日と同じ。害が無い
    //   - 別のセルを拾う          → **誤ったメニューが出る**。市場名・通貨・区分などの
    //                               1〜5文字の大文字トークンに usCodePattern が成立する
    // 後者は実機の目視でしか気づけない。出たらこのセレクタを絞る(抽出規則は動かさない)
    title: 'お気に入り・米国株',
    url: '/app/info_us_prc_reg_lst.do;',
    selector: 'form#form table.tbl-data-01 td.align-C div.mbody nobr',
    // 商品種別で絞れないので、判定基準7(株式以外の行に出さない)は目視でしか担保できない
    // (SPEC-CS-26「判定基準7 が構造で担保できないエントリ」)
    us: true
  },
  {
    title: 'お気に入り編集',
    url: '/app/info_jp_prc_reg_lst_edit.do;',
    // us は付けない。理由はお気に入りと同じ(ADR-0014 の 9-2)
    selector: 'form table.tbl-data-01 td.align-C div.mbody nobr'
  },
  {
    // 同上。**url は実測で、推測なのは selector だけ**。外れ方の2分岐も同じ
    title: 'お気に入り編集・米国株',
    url: '/app/info_us_prc_reg_lst_edit.do;',
    selector: 'form table.tbl-data-01 td.align-C div.mbody nobr',
    us: true
  },
  {
    title: '保有商品一覧・すべて',
    url: '/app/ass_all_possess_lst.do;',
    // 許すラベルは「国内株式」と「米国株式」だけ。「外国株式」「株式」は中国株式・
    // アセアン株式を含みうる。そこへ届くと `00700` に国内株の非アンカー抽出が当たり
    // `0070` を開く(判定基準6違反)。「米国株式」は2026-08-30の実機で確認済みで、
    // ラベルが変われば0件＝今日と同じに倒れる(SPEC-CS-26)
    selector: `div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td,
               div#table_possess_data table.tbl-bold-border tr > td:contains("米国株式") + td`,
    us: true
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

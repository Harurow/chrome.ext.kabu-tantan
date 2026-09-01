$(() => {
  setTimeout(attach, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attach = async () => {
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

  // 描画が遅れて注入対象が後から現れる場合に備え、静止するまで試し直す(SPEC-CS-22)
  // URLで対象を絞らないため(SPEC-CS-09)、対象外ページでは30秒間セレクタを評価し続ける
  // ただしDOMは一切変更しない(NFR-01)
  retrySetup(() => attachPass(keys))
}

/**
 * 注入パスを1回走らせる
 * 「1件でも注入できたら成功」にすると段階的に描画される表で
 * 一部の行だけ注入して止まるため、静止(新規注入が0件)を成功条件にする(SPEC-CS-22)
 * @param { string[] } keys
 * @returns { boolean } 静止したか
 */
const attachPass = (keys) => {
  const before = $('span.x-kabu-root').length

  // 設定に従い一つづつ試す
  menuSelectors
    .forEach((menuSelector) => {
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
 * `us` は米国株の抽出を許すかどうか(opt-in。SPEC-CS-26 / ADR-0014 の 1)
 * @type { { title: string, selector: string, us?: boolean }[] }
 */
const menuSelectors = [
  {
    title: '個別銘柄',
    selector: 'div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal'
  },
  {
    title: 'ポートフォリオ',
    // セレクタは変えない。構造だけで拾っているので、外国株式の行が同じ表に並ぶなら
    // 既に届いている(FR-28 適用範囲 c。実画面は未確認)
    selector: 'div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)',
    us: true
  }
]

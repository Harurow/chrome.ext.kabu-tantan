$(() => {
  setTimeout(attach, 500)
})

/** contextmenu が発生してから、メニューの拡張を許す猶予(ミリ秒) */
const contextMenuGraceMs = 1500

/** 入れ子メニュー(サブメニュー)を閉じるまでの遅延(ミリ秒) */
const submenuCloseDelayMs = 150

/**
 * 右クリックメニューの**箱**のセレクタ(SPEC-CS-15 の `context-menu` の先頭部分)
 *
 * `closest()` に渡すのは箱で、検出用セレクタ `div.context-menu table` が指す
 * **末端の table ではない**。よって `selectorOf('context-menu')` からは引けず、
 * ここに書くしかない(先頭を切り出すパーサをsrcに増やすと、ずれたときの症状が
 * 「closest()が何にも一致せず黙って何も起きない」になり、いちばん気づけない)。
 * **二重管理を放置しないため、`selectorOf('context-menu')` がこの値で始まることを
 * 自動テストで固定してある**(tests/tradingview.spec.mjs「祖先セレクタの整合」)
 */
const contextMenuBoxSelector = 'div.context-menu'

/**
 * チャート領域のセレクタ(SPEC-CS-15 の `chart-canvas` の先頭部分)
 *
 * 右クリックの起点判定(SPEC-CS-23)で見る**祖先**で、検出用セレクタが指す
 * **canvas ではない**。理由と担保は contextMenuBoxSelector と同じ
 */
const chartWrapperSelector = 'div.chart-gui-wrapper'

/**
 * ウォッチリストの行が銘柄を持つ属性の候補(推測値 / 実サイト未確認。SPEC-CS-23)
 * 近い順に見て、最初に `EXCHANGE:CODE` として解釈できた値を採る。
 * 変更するのはこの配列だけでよい(行の判定にも同じ配列から作ったセレクタを使う)
 *
 * `data-symbol` は候補に入れない(再レビュー M-5。ADR-0010 の 2 の追補)。
 * 名前が汎用的すぎてチャート側の要素に付いている可能性が高く、
 * 当たると FR-04(必須)のチャート右クリックが止まりかねない
 * @type { string[] }
 */
const watchlistSymbolAttrs = ['data-symbol-full', 'data-symbol-short']

/** 行の目印セレクタ。属性名を直書きせず候補配列から組み立てる(menuSelectors の `watchlist-row` に載せ、`selectorOf()` で引く) */
const watchlistRowSelector = watchlistSymbolAttrs.map((attr) => `[${attr}]`).join(',')

/**
 * 値が `EXCHANGE:CODE` の**形**か(SPEC-CS-23「「行」の定義は属性の有無ではなく値の形」)
 *
 * 取引所トークンらしき語＋コロンだけを見る純粋関数。
 * **`exchanges` を引かない。** 引くと `SP:SPX`(未登録の取引所)が「行ではない」になり、
 * チャート起点へ落ちて**指数の行にチャートの銘柄が出る**(FR-08 判定基準7 違反)。
 * 「取引所として妥当か」は解釈側(parseExchangeSymbol)の仕事で、ここは形だけを見る
 *
 * **字種は parseExchangeSymbol() の取引所トークン(`/^([A-Z]+)(_DLY)?:/`)と揃えて大文字のみにする。**
 * 広げると「形は満たすが解釈が絶対に成功しない」値(`main:1` / `nyse:aapl` など)まで行と見なされ、
 * 捨てられた結果**チャートの右クリック拡張(FR-04。必須)が止まる**(ADR-0010 の 2 の追補2)。
 * 逆に狭めすぎると本物の行が行でなくなり FR-19 が動かないため、
 * 「解釈できる値は必ず形を満たす」という包含関係をテストで固定してある
 * @param {string | null | undefined} text 候補属性の値
 * @returns { boolean }
 */
const isSymbolShaped = (text) =>
  typeof text === 'string' && /^[A-Z][A-Z0-9_]*:/.test(text)

/**
 * 直近の右クリックの起点(SPEC-CS-23)
 * 記録は常に1件。起点が同時に2つ存在しないので、チャートと行の取り違えが起きない
 * @type {{ kind: 'row' | 'chart' | null, at: number, code: string | null, type: string | null }}
 */
let contextMenuOrigin = { kind: null, at: 0, code: null, type: null }

/**
 * 起点を捨てた状態を作る(未発生・破棄はどちらも at: 0。常に猶予外になる)
 * @returns {{ kind: null, at: 0, code: null, type: null }}
 */
const discardedOrigin = () => ({ kind: null, at: 0, code: null, type: null })

/**
 * ページを改変するエントリポイント
 */
const attach = () => {
  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  // 監視も張らない(注入できず、他社サイト上で無駄に走るだけ。NFR-01)
  if (!isExtensionAlive()) {
    return
  }

  // bodyを監視し子要素にオーバーラップレイヤーができるのを監視する
  const body = $('body')[0]
  const bodyObserver = new MutationObserver(() => {
    if (bodyObserverCallback()) {
      bodyObserver.disconnect()
    }
  })
  bodyObserver.observe(body, { childList: true })

  // 右クリックの起点を記録する(SPEC-CS-23)
  // TradingView は右クリック以外でも同じメニュー要素を使うため、
  // 有効な起点(ウォッチリストの行 / チャート)の右クリック直後だけメニューを拡張する
  // ツールバー・銘柄検索・余白を右クリックした場合は記録を捨てる
  // (直前の右クリックが猶予内に残っていても拡張させない)
  // キャプチャ段階で受けるのはサイト側が stopPropagation() しても届くようにするため
  document.addEventListener('contextmenu', (e) => {
    contextMenuOrigin = resolveContextMenuOrigin(e.target)
  }, true)

  // canvas監視とボタンは1単位で設置する(SPEC-CS-22 / ADR-0008 の 4)
  // 分けると「ボタンはあるが銘柄切替に追随しない」状態が作れてしまう(FR-13 判定基準6)
  // 両方が揃うまで試し直し、揃わなければ30秒で打ち切る
  retrySetup(setupKabuLinkMenu)
}

/**
 * 右クリックの発生元から起点を解決する(SPEC-CS-23「起点の判定」)
 * 行の判定をチャートより先に行う。優先順位はこの時点で決まり、
 * attachMenu() は記録された1件しか見ない(起点が同時に2つ存在しない)
 * @param {EventTarget | null} target contextmenu の発生元
 * @returns {{ kind: 'row' | 'chart' | null, at: number, code: string | null, type: string | null }}
 */
const resolveContextMenuOrigin = (target) => {
  const row = findRowTickerCode(target)
  if (row) {
    // 行だが銘柄を解釈できない(指数・先物・FX・暗号資産など)場合は捨てる。
    // チャートへ落とすと「その行と違う銘柄のリンク」が出る(FR-04 違反)
    if (row.code == null) {
      return discardedOrigin()
    }
    return { kind: 'row', at: Date.now(), code: row.code, type: row.type }
  }

  if ($(target).closest(chartWrapperSelector).length > 0) {
    return { kind: 'chart', at: Date.now(), code: null, type: null }
  }

  return discardedOrigin()
}

/**
 * 発生元から祖先方向へ行の目印を探し、銘柄コードを取り出す(SPEC-CS-23)
 * 目印を持つ要素を近い順に見て、最初に解釈できた値を採る。
 * 子孫方向へは探さない(別の行の銘柄を拾ってしまう)
 *
 * **セレクタは粗い絞り込みでしかなく、行と見なすのは値が `EXCHANGE:CODE` の形のときだけ**
 * (再レビュー M-5)。属性の有無で決めると、チャート内の要素が候補属性を
 * `main` / `8253` のような値で持っていた場合に「行だが解釈できない」となり、
 * **チャートの右クリック拡張(FR-04。必須)が全面的に止まる**
 * @param {EventTarget | null} target contextmenu の発生元
 * @returns {{ code: string | null, type: string | null } | null}
 *   形の値がどこにも無ければ null(行ではない → チャート判定へ)、
 *   形はあって解釈できなければ code/type ともに null(捨てる)
 */
const findRowTickerCode = (target) => {
  let element = $(target).closest(selectorOf('watchlist-row'))[0]
  if (!element) {
    return null
  }

  // 形の値を1つでも見たか。見ていなければ「行ではない」としてチャート判定へ送る
  let shaped = false

  while (element) {
    for (const attr of watchlistSymbolAttrs) {
      const value = element.getAttribute(attr)
      // 形を満たさない値(コード単独の 8253 やチャート側の main など)は行の値と見なさない
      if (!isSymbolShaped(value)) {
        continue
      }
      shaped = true
      // 市場種別は `EXCHANGE:` からしか決めない。
      // 未登録の取引所(例 SP:SPX)は解釈に失敗させ、次の候補へ送る
      // (「4桁なら国内株」と当てにいくと米国株の行で誤ったリンクを出す)
      const parsed = parseExchangeSymbol(value)
      if (parsed.code != null) {
        return parsed
      }
    }
    const parent = element.parentElement
    element = parent ? $(parent).closest(selectorOf('watchlist-row'))[0] : undefined
  }

  return shaped ? { code: null, type: null } : null
}

/**
 * canvasの監視と「株Link」ボタンを設置する(SPEC-CS-12 / SPEC-CS-22)
 * bodyの監視(オーバーレイレイヤー待ち)は常設監視なので再試行の対象にしない
 * @returns { boolean } 設置が済んだか
 */
const setupKabuLinkMenu = () => {
  // 設置済み(二重注入の防止。SPEC-CS-22)
  if ($('.ktt-tv-kabuLinkMenu').length > 0) {
    return true
  }

  const canvas = $(selectorOf('chart-canvas'))[0]
  const container = $(selectorOf('toolbar-container'))[0]
  if (!canvas || !container) {
    return false
  }

  // canvasを監視し属性が変わったら追加したボタンの状態を更新させる
  const canvasObserver = new MutationObserver(() => {
    // 切断状態では監視を外す(復帰手段が無く、監視を続けても無駄に走るだけ。SPEC-CS-19)
    if (!isExtensionAlive()) {
      canvasObserver.disconnect()
      return
    }
    canvasObserverCallback()
  })
  canvasObserver.observe(canvas, { attributes: true })

  // 株リンクメニューを追加
  createKabuLinkMenu(container)

  return true
}

/**
 * bodyタグの更新を監視する
 * コンテキストメニュー用のレイヤーが作成されていれば、そのレイヤーを監視する
 * コンテキストメニューレイヤーが作成された場合はメニューを拡張する
 * @returns { boolean } オブサーバを切断するか
 */
const bodyObserverCallback = () => {
  // オーバーラップレイヤーを監視しコンテキストメニューの構築を監視する
  const overlapManagerRoot = $(selectorOf('overlap-root'))[0]
  if (!overlapManagerRoot) {
    return false
  }

  const overlapManagerRootObserver = new MutationObserver((mutions) => {
    // 切断状態では監視を外す(復帰手段が無く、監視を続けても無駄に走るだけ。SPEC-CS-19)
    if (!isExtensionAlive()) {
      overlapManagerRootObserver.disconnect()
      return
    }

    mutions.forEach((mution) => {
      if (mution.type === 'childList') {
        if (mution.addedNodes.length > 0) {
          attachMenu()
        }
      }
    })
  })

  overlapManagerRootObserver.observe(overlapManagerRoot, { childList: true })

  attachMenu()

  return true
}

/**
 * メニューを解析して拡張する
 * 条件を1つでも満たさない場合はDOMを一切変更しない
 */
const attachMenu = () => {
  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  // オーバーラップレイヤーが1つだけ、かつ未追加であること
  const overlapManagerRoot = $(selectorOf('overlap-root'))
  if (overlapManagerRoot.length !== 1 || $('tr[data-kabu-tantan]').length > 0) {
    return
  }

  // 有効な起点(ウォッチリストの行 / チャート)の右クリック直後だけ拡張する
  // 捨てた記録(at: 0)は常に猶予外になる
  const origin = contextMenuOrigin
  if (Date.now() - origin.at > contextMenuGraceMs) {
    return
  }

  // 入れ子メニュー等で2件以上ヒットしうるため、先頭の1件だけを対象にする
  const ctxMenu = $(selectorOf('context-menu'), overlapManagerRoot).first()
  if (ctxMenu.length === 0) {
    return
  }

  // 銘柄コードはメニューの文言ではなく起点から取得する(SPEC-CS-23)
  // 行: 右クリック時に確定済みの値を使う
  //     (ウォッチリストは仮想スクロールで行が差し替わるためDOMをたどり直さない)
  // チャート: canvasのaria-label(SPEC-TC-07)
  const { code, type } = origin.kind === 'row' ? origin : getTickerCode()
  if (code == null) {
    return
  }

  addTickerMenuAsync(ctxMenu, code, type)
}

/**
 * メニューのセパレータ
 * @param {boolean} marked 二重追加防止の目印(data-kabu-tantan)を付けるか
 * @returns {JQuery<HTMLElement>}
 */
const makeMenuSeparator = (marked = false) => {
  return $(`
  <tr class="${tvMimicClasses.separatorRow}"${marked ? ' data-kabu-tantan' : ''}>
    <td>
      <div class="${tvMimicClasses.separatorLine}"></div>
    </td>
    <td>
      <div class="${tvMimicClasses.separatorLine}"></div>
    </td>
  </tr>`)
}

/**
 * 入れ子メニューを開くための親行を作成する
 * ラベルは銘柄コードだけで、遷移先サイトは入れ子(サブメニュー)に出す
 * 親行自体はリンクではない(ホバーで入れ子を開くだけ)
 * @param {string} code 銘柄コード(文字種は正規表現で制限済み)
 * @returns {JQuery<HTMLElement>}
 */
const makeSubmenuParentRow = (code) => {
  // 矢印のsvgはTradingViewの実測値(検証対象外 / 採取日: 2026-08-23)
  return $(`
  <tr class="${tvMimicClasses.accessible} ${tvMimicClasses.item}" data-role="menuitem" tabindex="-1">
    <td class="${tvMimicClasses.iconCell}" data-icon-cell="true"></td>
    <td>
      <div class="${tvMimicClasses.content}">
        <span class="${tvMimicClasses.label}" data-label="true">${code} を開く</span>
        <span class="${tvMimicClasses.arrowIcon}" data-submenu-arrow="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 16" width="10" height="16">
            <path d="M.6 1.4l1.4-1.4 8 8-8 8-1.4-1.4 6.389-6.532-6.389-6.668z"></path>
          </svg>
        </span>
      </div>
    </td>
  </tr>`)
}

/**
 * 入れ子メニューの受け皿行を作成する
 * TradingView自身と同じく、この行のtdの中に入れ子メニューを描画する
 * (親メニューが閉じられると受け皿ごと消えるため後始末が要らない)
 * @returns {JQuery<HTMLElement>}
 */
const makeSubmenuHolderRow = () => {
  return $(`
  <tr class="${tvMimicClasses.subMenu}">
    <td></td>
  </tr>`)
}

/**
 * 入れ子メニューの項目を作成する
 * 入れ子の中のtrにはdata-kabu-tantanを付けない
 * (二重追加の判定がdocument全体検索なので、付けると次の右クリックが拡張されなくなる)
 * @param {string} code 銘柄コード(文字種は正規表現で制限済み)
 * @param {{ title: string, url: string }} item タイトルとURL(externalUrls / makeUrl 由来)
 * @returns {JQuery<HTMLElement>}
 */
const makeMenuItem = (code, item) => {
  const row = $(`
  <tr class="${tvMimicClasses.accessible} ${tvMimicClasses.item}" data-role="menuitem" tabindex="-1">
    <td class="${tvMimicClasses.iconCell}" data-icon-cell="true"></td>
    <td>
      <div class="${tvMimicClasses.content}">
        <span class="${tvMimicClasses.label}" data-label="true">
          <a style="color: var(--tv-color-popup-element-text); width: 100%;" title="${code} を${item.title}" target="_blank" rel="noopener noreferrer" href="${item.url}">${item.title}</a>
        </span>
      </div>
    </td>
  </tr>`)

  // 代行クリックで発火した<a>のクリックは、この行まで再びバブルしてくる。
  // そのときは何もしない(Escを二重に投げてサイト側の他の動作を誘発しないため)
  let delegating = false

  return row.click((event) => {
    if (delegating) {
      return
    }

    // 文字(<a>)の外(アイコン列・右の余白・上下の余白)を押した場合は<a>のクリックを代行する
    // (開く経路は<a>の1本のままにする。URL・target・relを2箇所で持たない。SPEC-CS-25)
    const anchor = row.find('a')[0]
    if (anchor != null && event.target.closest?.('a') !== anchor) {
      delegating = true
      try {
        anchor.click()
      } finally {
        delegating = false
      }
    }

    // クリックした場合はメニューが消えるように'ESC'キーを押したことにして消す
    // (閉じるのは開いた後。先に閉じると<a>がDOMから外れ、代行クリックが空振りする)
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 27 }))
  })
}

/**
 * 入れ子メニューの証券会社の項目を作成する(SPEC-CS-28)
 * 証券会社のURLはセッションIDを含むためページのDOMに置かない(NFR-03)。
 * <a>を持たず、行のクリックで*:openを送ってService Workerに開かせる
 * (「株Link」ボタンと同じ経路。<a>が無いので代行クリックもdelegatingも要らない)
 * 入れ子の中のtrにはdata-kabu-tantanを付けない(makeMenuItemと同じ理由)
 * @param {string} code 銘柄コード(文字種は正規表現で制限済み)
 * @param {{ title: string, message: { type: string, data: { code: string, type: string } } }} item
 *   タイトル(固定文言)とクリック時に送るメッセージ
 * @returns {JQuery<HTMLElement>}
 */
const makeBrokerMenuItem = (code, item) => {
  const row = $(`
  <tr class="${tvMimicClasses.accessible} ${tvMimicClasses.item}" data-role="menuitem" tabindex="-1">
    <td class="${tvMimicClasses.iconCell}" data-icon-cell="true"></td>
    <td>
      <div class="${tvMimicClasses.content}">
        <span class="${tvMimicClasses.label}" data-label="true" title="${code} を${item.title}">${item.title}</span>
      </div>
    </td>
  </tr>`)

  return row.click(() => {
    // jQueryはハンドラの返り値のPromiseを見ないため、拒否は必ずここで握る
    // 右クリック時点でログインを確かめて項目を出しているのでalertは出さない(FR-06)
    openBrokerAsync(item.message, null).catch(() => {})
    // 送った後に閉じる(右クリック側の閉じ方。SPEC-CS-17)
    // 送信は最初のawaitより前に済んでいるので、行がDOMから外れても取り消されない
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 27 }))
  })
}

/**
 * 情報サイトの項目リストを作成する
 * オプションで設定された並び順を保つ
 * @param {string} code 銘柄コード
 * @param {string} type 'jp' または 'us'
 * @returns {Promise<{ title: string, url: string }[]>}
 */
const makeLinkItemsAsync = async (code, type) => {
  const keys = await getEnableLinkKeysAsync()

  return keys
    // TradingView上でTradingViewを開いても意味がないので除外する
    .filter((key) => key.indexOf('tradingview.com') !== 0)
    .map((key) => externalUrlsMap[key])
    // 米国株では米国株に対応したサイト(url3を持つサイト)だけを残す
    .filter((item) => item != null && (type !== 'us' || item.url3))
    .map((item) => ({
      title: `${item.title}で開く`,
      url: makeUrl(type === 'us' ? item.url3 : item.url1, code)
    }))
}

/**
 * 証券会社の項目リストを作成する
 * ログインしていない場合はavailableがfalseなので項目は出ない(エラーは出さない)
 * URLは受け取らない。クリック時に送る*:openメッセージを持たせる(SPEC-CS-28 / SPEC-MSG-06)
 * @param {string} code 銘柄コード
 * @param {string} type 'jp' または 'us'
 * @returns {Promise<{ title: string, message: { type: string, data: { code: string, type: string } } }[]>}
 */
const makeBrokerItemsAsync = async (code, type) => {
  const items = []

  // 楽天証券にログインしている時は楽天証券の個別銘柄ページを開ける
  const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type } })
  if (rakutenResponse.data.available === true) {
    items.push({ title: '楽天証券で開く', message: { type: 'rakuten-sec:open', data: { code, type } } })
  }

  // 内藤証券は国内株のみ対応しているため、米国株では問い合わせない
  if (type === 'jp') {
    const naitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code, type } })
    if (naitoResponse.data.available === true) {
      items.push({ title: '内藤証券で開く', message: { type: 'naito-sec:open', data: { code, type } } })
    }
  }

  return items
}

/**
 * 右クリックメニューに拡張の行を追加する(国内株・米国株の共通処理)
 * 追加するのは常に3行(区切り行・親行・受け皿行)で、遷移先サイトは入れ子に出す
 * @param {JQuery<HTMLElement>} ctxMenu
 * @param {string} code
 * @param {string} type 'jp' または 'us'
 */
const addTickerMenuAsync = async (ctxMenu, code, type) => {
  // 3行はawaitの前に同期的に追加する
  // 区切り行が持つdata-kabu-tantanが二重追加のガードになるため、
  // 応答待ちの間にattachMenu()がもう一度通っても追加されない
  // (親行のラベルに必要なのはcodeだけなのでawaitの前に組み立てられる)
  const separatorRow = makeMenuSeparator(true)
  const parentRow = makeSubmenuParentRow(code)
  const holderRow = makeSubmenuHolderRow()
  ctxMenu.append(separatorRow).append(parentRow).append(holderRow)

  // 縦位置の補正で書き換える前のmargin-topを控えておく(3行を取り除くときに元へ戻す)
  // 検出用セレクタ(context-menu)はtableを指すので、その外側のdivを基準にする
  const ctxMenuBox = ctxMenu.closest(contextMenuBoxSelector)[0]
  const savedMarginTop = ctxMenuBox?.style.marginTop ?? ''
  // ずらしたときだけ真になる。これで囲まないと、補正が走る前に0件・例外へ入った場合に
  // 触っていないインラインスタイルを書き戻してしまう(style=""が残る)
  let shifted = false

  // 追加した3行をまとめて取り除く(メニューに拡張の痕跡を残さない)
  const removeRows = () => {
    separatorRow.remove()
    parentRow.remove()
    holderRow.remove()
    // ずらした場合だけmargin-topを元に戻す(位置の痕跡も残さない。SPEC-CS-24)
    if (shifted && ctxMenuBox != null) {
      ctxMenuBox.style.marginTop = savedMarginTop
      shifted = false
    }
  }

  // 3行を足した分だけメニューは下へ伸びる。TradingViewは伸びたことを知らないので
  // 位置を直さず、下端付近では追加行が画面の外に出る(ホバーできず入れ子も開けない)。
  // サイト側が位置を決め終える前に測らないよう、次のフレームで1回だけ補正する(SPEC-CS-24)
  requestAnimationFrame(() => {
    shifted = fitContextMenuIntoWindow(separatorRow)
  })

  // 証券会社と情報サイトは互いに独立しているので並行に取得する
  let items
  try {
    items = await Promise.all([makeBrokerItemsAsync(code, type), makeLinkItemsAsync(code, type)])
  } catch {
    // 応答が得られない場合(拡張の更新でタブが切り離された、メッセージポートが閉じた等)は
    // ホバーしても何も出ない死んだ行が残らないように取り除く
    removeRows()
    return
  }

  const [brokerItems, linkItems] = items

  // 遷移先が1つも無い場合も取り除く(区切り線だけが残らないようにする)
  if (brokerItems.length === 0 && linkItems.length === 0) {
    removeRows()
    return
  }

  bindSubmenu(parentRow, holderRow, code, brokerItems, linkItems)
}

/**
 * 3行を足して下へ伸びた右クリックメニューを画面内に収める(SPEC-CS-24)
 *
 * 触るのはサイト側メニューの**インラインのmargin-topだけ**。
 * top / transform は読まないし書かない(サイト側がどちらで位置決めしていても、
 * 負のmargin-topは箱をそのまま上へずらす。ADR-0012 の 2)。
 * 入れ子の配置(positionSubmenu)とは触ってよい範囲が違うので別関数にしてある
 * @param {JQuery<HTMLElement>} addedRow 追加した行(存在確認と親メニューの引き当てに使う)
 * @returns {boolean} 実際にずらしたか(呼び出し側が後始末の要否を決める)
 */
const fitContextMenuIntoWindow = (addedRow) => {
  // 0件・例外で3行を取り除いた後なら何もしない
  if (addedRow[0]?.isConnected !== true) {
    return false
  }

  // 検出用セレクタ(context-menu)はtableを指すので、その外側のdivを基準にする
  const menu = addedRow.closest(contextMenuBoxSelector)[0]
  if (menu == null) {
    return false
  }

  const rect = menu.getBoundingClientRect()

  // 下端に掛からない位置では今までと同じ場所に出す(常に上へ寄せない)
  // 端数は下端を切らない側(切り上げ)に倒す
  const overflow = Math.ceil(rect.bottom - window.innerHeight)
  if (overflow <= 0) {
    return false
  }

  // 上端は画面の外に出さない(サイト側の項目は上に並んでいるため)
  // 端数は下端を切らない側(切り捨て)に倒す
  const shift = Math.min(overflow, Math.floor(rect.top))
  if (shift <= 0) {
    return false
  }

  menu.style.marginTop = `-${shift}px`
  return true
}

/**
 * 親行のホバーで入れ子メニューを開閉できるようにする
 * TradingViewのサブメニュー開閉APIは拡張から呼べないため開閉は自前で持つ
 * @param {JQuery<HTMLElement>} parentRow
 * @param {JQuery<HTMLElement>} holderRow
 * @param {string} code 銘柄コード
 * @param {{ title: string, message: { type: string, data: { code: string, type: string } } }[]} brokerItems
 * @param {{ title: string, url: string }[]} linkItems
 */
const bindSubmenu = (parentRow, holderRow, code, brokerItems, linkItems) => {
  // 状態は「開いている入れ子の参照」と「遅延クローズのタイマー」の2つだけ
  let submenu = null
  let closeTimerId = 0

  const cancelClose = () => {
    if (closeTimerId !== 0) {
      clearTimeout(closeTimerId)
      closeTimerId = 0
    }
  }

  // 「親行と入れ子の両方から外れて submenuCloseDelayMs 経過」で閉じる
  // (親行から入れ子へ移る途中の隙間や、親行の下端を横切る動きで閉じないようにするため)
  const reserveClose = () => {
    cancelClose()
    closeTimerId = setTimeout(() => {
      closeTimerId = 0
      if (submenu !== null) {
        submenu.remove()
        submenu = null
      }
    }, submenuCloseDelayMs)
  }

  parentRow
    .on('mouseenter', () => {
      cancelClose()
      if (submenu !== null) {
        return
      }
      // 開き直しのたびに作り直す(開いた状態は保持しない)
      submenu = openSubmenu(parentRow, holderRow, code, brokerItems, linkItems)
      submenu
        .on('mouseenter', cancelClose)
        .on('mouseleave', reserveClose)
    })
    .on('mouseleave', reserveClose)
}

/**
 * 入れ子メニューを受け皿行のtdの中に描画する
 * @param {JQuery<HTMLElement>} parentRow
 * @param {JQuery<HTMLElement>} holderRow
 * @param {string} code 銘柄コード
 * @param {{ title: string, message: { type: string, data: { code: string, type: string } } }[]} brokerItems
 * @param {{ title: string, url: string }[]} linkItems
 * @returns {JQuery<HTMLElement>} 描画した入れ子メニュー
 */
const openSubmenu = (parentRow, holderRow, code, brokerItems, linkItems) => {
  // 位置決めはインラインスタイルで持つ
  // (模倣用クラスがTradingViewの改修で死んでも項目の選択と遷移は動く)
  const submenu = $(`
  <div class="${tvMimicClasses.menuWrap} ktt-tv-subMenu" style="position: fixed; left: 0; top: 0; z-index: 500;">
    <div class="${tvMimicClasses.scrollWrap}" style="overflow-y: auto;">
      <div class="${tvMimicClasses.menuBox}">
        <table>
          <tbody>
          </tbody>
        </table>
      </div>
    </div>
  </div>`)

  const tbody = $('tbody', submenu)

  // 証券会社 → 区切り線 → 情報サイト の順に並べる
  // 証券会社はURLをDOMに置かない専用の項目にする(SPEC-CS-28)
  brokerItems.forEach((item) => makeBrokerMenuItem(code, item).appendTo(tbody))

  if (brokerItems.length > 0 && linkItems.length > 0) {
    makeMenuSeparator().appendTo(tbody)
  }

  linkItems.forEach((item) => makeMenuItem(code, item).appendTo(tbody))

  submenu.appendTo($('td', holderRow).first())
  positionSubmenu(submenu, parentRow)

  return submenu
}

/**
 * 入れ子メニューの位置を決める
 * 親メニューの右・親行の高さに合わせ、画面からはみ出す場合だけ補正する
 * @param {JQuery<HTMLElement>} submenu
 * @param {JQuery<HTMLElement>} parentRow
 */
const positionSubmenu = (submenu, parentRow) => {
  // 検出用セレクタ(context-menu)はtableを指すので、その外側のdivを基準にする
  const parentMenu = parentRow.closest(contextMenuBoxSelector)[0] ?? parentRow[0]
  const menuRect = parentMenu.getBoundingClientRect()
  const rowRect = parentRow[0].getBoundingClientRect()
  const { width, height } = submenu[0].getBoundingClientRect()
  const { innerWidth, innerHeight } = window

  let left = menuRect.right
  let top = rowRect.top

  // 画面右端にはみ出す場合は左側に展開する
  // (はみ出したままだと項目が画面外に出て選択できない)
  if (left + width > innerWidth) {
    left = menuRect.left - width
  }
  if (left < 0) {
    left = 0
  }

  if (height > innerHeight) {
    // 画面より高い場合は画面内に収め、scrollWrapのoverflow-yでスクロールさせる
    top = 0
    // 高さを絞るのはscrollWrapだけにする(外枠にpaddingがあるとその分はみ出すため)
    // scrollWrapは直下の子(模倣用クラスの中身に依存しないよう位置で引く)
    submenu.children().first().css('max-height', `${innerHeight}px`)
  } else if (top + height > innerHeight) {
    top = innerHeight - height
  }

  submenu.css({ left: `${left}px`, top: `${top}px` })
}

/**
 * 銘柄コード情報を持っているcanvasタグのコールバック
 * 楽天証券ボタンの表示/非表示を切り替える
 */
const canvasObserverCallback = () => {
  updateKabuLinkMenu()
}

/**
 * ボタンの表示・非表示を切り替える
 */
const updateKabuLinkMenu = async () => {
  const { code } = getTickerCode()

  $('.ktt-tv-kabuLinkMenu').each(function () {
    updateVisible($(this), code)
  })
}

/**
 * ボタン(jQuery)の表示・非表示を切り替える
 * @param {*} element
 * @param {boolean} condition
 */
const updateVisible = (element, condition) => {
  if (condition) {
    element.show()
  } else {
    element.hide()
  }
}

/**
 * 連携ボタンを追加
 * ・楽天証券 : 楽天証券にログインしてる時だけ有効なボタン
 * ・内藤証券 : 内藤証券にログインし、国内株マーケットの個別銘柄を開いている時だけ有効なボタン
 * 挿入先は呼び出し側で存在を確認済みのものを受け取る(SPEC-CS-22)
 * 空集合にappendTo()すると黙って何もしないため、失敗が見えなくなる
 * @param { HTMLElement } container TradingViewへのメニュー挿入位置(toolbar-container)
 */
const createKabuLinkMenu = (container) => {
  const buttonsWrapper =
    $('<div>', {
      class: tvMimicClasses.buttonsWrapper
    }).appendTo(container)

  $(`<div class="ktt-tv-kabuLinkMenu">
    <span>株Link</span>
  </div>`)
    .appendTo(buttonsWrapper)
    .click((e) => {
      // jQueryはハンドラの返り値のPromiseを見ない
      // 捕まえないと未処理の拒否になるため、非同期処理は別関数に閉じて自前で握る
      openKabuLinkMenuAsync(e.clientX, e.clientY).catch(() => {})
    })
}

/**
 * 「株Link」ボタンのメニューを開く(SPEC-CS-12)
 * 問い合わせが終わるまでDOMを一切変更しない
 * (背景を先に敷くと、失敗したときに透明な全画面レイヤーが残りページのクリックを吸う。NFR-14)
 * @param {number} x メニューを出すx座標
 * @param {number} y メニューを出すy座標
 */
const openKabuLinkMenuAsync = async (x, y) => {
  // 銘柄コードが取得できない場合はメニューを出さない
  const { code, type } = getTickerCode()
  if (code == null) {
    return
  }

  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  // 証券会社の応答と情報サイトの項目を得る(この時点ではDOMを作らない)
  // 門を通った後に切断される場合に備えて網(try)も張る
  // 注意: Promise.allなので片方が失敗するとメニューごと出ない
  // 現状はSWがネットワークを叩かない(storageとcookieだけ)ため実害が無い前提
  // 将来queryBrokerAsync側にネットワーク取得が入ったらallSettledに分けること
  let brokers
  let linkItems
  try {
    [brokers, linkItems] = await Promise.all([
      queryBrokerAsync(code, type),
      makeLinkItemsAsync(code, type)
    ])
  } catch {
    return
  }

  const hasBroker = brokers.hasRakuten || brokers.hasNaito

  // 遷移先が1つも無い場合はメニューも背景も出さない
  // (米国株で url3 を持つサイトを全て無効にし、かつ証券会社が未ログインだと起こりうる)
  if (!hasBroker && linkItems.length === 0) {
    return
  }

  // body要素
  const body = $('body')

  // メニュー表示中にキーボードを押すとキャンセル
  const keydown = (e) => {
    e.preventDefault()
    clearMenu()
  }

  // メニューをクリア
  const clearMenu = () => {
    body[0].removeEventListener('keydown', keydown)
    background.remove()
  }

  // キーボードイベントを追加
  body[0].addEventListener('keydown', keydown)

  // 背景
  const background = $('<div>', {
    class: 'ktt-tv-menuBack'
  })
    .click(() => {
      // 背景クリックはキャンセル
      clearMenu()
    })
    .appendTo(body)

  // メニューの全体
  const menuBody = $(`
  <div class="${tvMimicClasses.menuWrap}" style="position: fixed; left: ${x}px; top: ${y}px;">
    <div class="${tvMimicClasses.scrollWrap}" style="overflow-y: auto;">
      <div class="${tvMimicClasses.menuBox}">
        <table>
          <tbody>
          </tbody>
        </table>
      </div>
    </div>
  </div>`)

  // メニュー項目の追加先要素
  const tbody = $('tbody', menuBody)

  // 楽天証券メニューを追加(ラベル・開き方・未ログイン時のalertは右クリック側と揃えない。SPEC-CS-12)
  if (brokers.hasRakuten) {
    makeButtonMenuItem('楽天証券を開く')
      .click(() => {
        // jQueryはハンドラの返り値のPromiseを見ないため、拒否は必ずここで握る
        openBrokerAsync({ type: 'rakuten-sec:open', data: { code, type } }, '楽天証券').catch(() => {})
      })
      .appendTo(tbody)
  }

  // 内藤証券メニューを追加
  if (brokers.hasNaito) {
    makeButtonMenuItem('内藤証券を開く')
      .click(() => {
        // jQueryはハンドラの返り値のPromiseを見ないため、拒否は必ずここで握る
        openBrokerAsync({ type: 'naito-sec:open', data: { code, type } }, '内藤証券').catch(() => {})
      })
      .appendTo(tbody)
  }

  // 証券会社と情報サイトの両方がある場合だけセパレータを追加する
  // (情報サイトが0件のときに末尾へ区切り線だけが残らないようにする)
  if (hasBroker && linkItems.length > 0) {
    makeMenuSeparator().appendTo(tbody)
  }

  // 有効になってる外部連携リンクをメニューに追加する
  // 並び順・絞り込み・未知キーの扱いは右クリックメニューと同じ関数に任せる(FR-07)
  linkItems.forEach((item) => {
    makeButtonMenuItem(item.title)
      .click(() => {
        // URLはメニューの組み立て時に確定している
        // jQueryはハンドラの返り値のPromiseを見ないため、拒否は必ずここで握る
        openUrlAsync(item.url).catch(() => {})
      })
      .appendTo(tbody)
  })

  menuBody.appendTo(background)
}

/**
 * 「株Link」ボタン用のメニュー項目を作成する
 * @param {string} title 表示する文言(externalUrlsまたは固定文言)
 * @returns {JQuery<HTMLElement>}
 */
const makeButtonMenuItem = (title) => $(`
  <tr data-role="menuitem" class="${tvMimicClasses.accessible} ${tvMimicClasses.item}" tabindex="-1">
    <td class="${tvMimicClasses.iconCell}" data-icon-cell="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"></svg>
    </td>
    <td>
      <div class="${tvMimicClasses.content}">
        <span class="${tvMimicClasses.label}" data-label="true">${title}</span>
      </div>
    </td>
  </tr>`)

/**
 * 「株Link」ボタン用に証券会社へ問い合わせる
 * 応答(開けるか)だけを返し、DOMは作らない(SPEC-CS-12)
 * 内藤証券は米国株ではavailableがfalseになるが、現行の振る舞いを変えないため問い合わせ自体は行う
 * @param {string} code 銘柄コード
 * @param {string} type 'jp' または 'us'
 * @returns {Promise<{ hasRakuten: boolean, hasNaito: boolean }>}
 */
const queryBrokerAsync = async (code, type) => {
  // 楽天証券にログインしている時は楽天証券のページを開ける
  const rakutenResponse = await chrome.runtime.sendMessage({ type: 'rakuten-sec:info', data: { code, type } })

  // 内藤証券にログインしている時は内藤証券のページを開ける
  const naitoResponse = await chrome.runtime.sendMessage({ type: 'naito-sec:info', data: { code, type } })

  return {
    hasRakuten: rakutenResponse.data.available === true,
    hasNaito: naitoResponse.data.available === true
  }
}

/**
 * 証券会社のページを開く(「株Link」ボタンと右クリック入れ子の証券会社項目で共有)
 * URLはService Workerが組み立てて開く。Content Scriptは開けたかどうかだけを受け取る(SPEC-MSG-06)
 * 開けなかった場合、alertLabelが文字列ならalertで知らせる(「株Link」ボタンの現行の振る舞いのまま)
 * @param {{ type: string, data: { code: string, type: string } }} message 送る*:openメッセージ
 * @param {string | null} alertLabel 未ログイン時に出す証券会社名。nullならalertを出さない
 */
const openBrokerAsync = async (message, alertLabel) => {
  // メニューを開いた後に拡張機能が更新された場合は何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  try {
    const response = await chrome.runtime.sendMessage(message)
    if (response.data.available !== true && typeof alertLabel === 'string') {
      alert(`${alertLabel}にログインしてください`)
    }
  } catch {
    // 応答が得られない場合は何もしない(NFR-14)
  }
}

/**
 * 情報サイトのURLを新しいタブで開く(「株Link」ボタンのメニュー用)
 * @param {string} url 組み立て済みのURL
 */
const openUrlAsync = async (url) => {
  // メニューを開いた後に拡張機能が更新された場合は何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  try {
    await chrome.runtime.sendMessage({ type: 'open-url', data: { url } })
  } catch {
    // 応答が得られない場合は何もしない(NFR-14)
  }
}

/**
 * 銘柄コードを取得
 * チャートのcanvasのaria-label(`EXCHANGE:CODE の 1 日 チャート`)を解析する
 * @returns {{ code: string, type: string }} 取得した銘柄コード、取得できない場合はcode/typeともにnull
 */
const getTickerCode = () => {
  return parseExchangeSymbol($(selectorOf('chart-canvas')).attr('aria-label'))
}

/**
 * `EXCHANGE:CODE` 形式の文字列から銘柄コードを取り出す(SPEC-TC-07 の 1〜3)
 * 先頭からの前方一致。米国株だけは後続境界を見る(下記)。
 * canvasのaria-label(`TSE:7203 の 1 日 チャート`)と
 * ウォッチリストの行の属性値(`TSE:8253`)の両方がこの関数を通る(SPEC-CS-23 / NFR-13)
 * @param {string | null | undefined} text 解析する文字列
 * @returns {{ code: string, type: string }} 取得した銘柄コード、取得できない場合はcode/typeともにnull
 */
const parseExchangeSymbol = (text) => {
  const notFound = { code: null, type: null }

  if (!text) {
    return notFound
  }

  // 取引所トークンを取り出す('_DLY'は遅延配信の接尾辞なので剥がしてから引く)
  const matched = /^([A-Z]+)(_DLY)?:/.exec(text)
  if (!matched) {
    return notFound
  }

  // exchangesに載っていない取引所(指数・先物・FX・暗号資産など)はここで落ちる
  const type = exchanges[matched[1]]
  const rest = text.slice(matched[0].length)

  if (type === 'jp') {
    const code = /^[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/.exec(rest)
    if (code) {
      return { code: code[0], type }
    }
  } else if (type === 'us') {
    // 後続境界を付ける。境界が無いと単語や記号表記の途中を切り出して別銘柄になる。
    // ここは行の属性値(値全体がシンボル)も通るため、`NYSE:BRK.B` / `NYSE:BRK-B` /
    // `NYSE:BRK&B` / `NYSE:BRK1`から`BRK`を返してはならない。
    // 境界は「切り出してよい後続だけを許す」許可列挙(終端 / 空白 / 非 ASCII の `\p{L}` /
    // 終止記号)。`\p{L}` からは全角ラテンと長音符2字(`ー` `ｰ`)を除く(`NYSE:BRKーB` 対策)。
    // **`u` フラグ必須**で、忘れると `\p{L}` がリテラルになり日本語が続く形だけが
    // 黙って落ちる。取れない場合は「何も出さない」に倒す(FR-19)。
    // 実装は Service Worker の usCodePattern と共有しないが、境界の値だけは揃える
    // (FR-08 の適用範囲。規則の正本は SPEC-TC-02。ADR-0009 の 3・9・10)
    const code = /^[A-Z]{1,5}(?=$|[\s,;:!?"'()[\]{}]|(?![Ａ-Ｚａ-ｚーｰ])(?=[^\x20-\x7E])[\p{L}、。，；：！？＂＇（）［］｛｝「」『』【】〈〉《》〔〕‘’“”])/u.exec(rest)
    if (code) {
      return { code: code[0], type }
    }
  }

  return notFound
}

/**
 * 改変情報（検出用セレクタ）
 * TradingView は DOM がハッシュ付きクラス名で頻繁に変わるため、
 * 検出用セレクタは1箇所にまとめて `key` で引く。
 * ここが唯一の情報源で、`npm run check:selectors` もこの値を読む。
 * @type { { key: string, title: string, selector: string }[] }
 */
const menuSelectors = [
  {
    key: 'chart-canvas',
    title: 'チャート canvas',
    selector: 'div.chart-gui-wrapper canvas[aria-hidden!="true"]'
  },
  {
    key: 'toolbar-container',
    title: 'ツールバー挿入先',
    selector: 'div.container-OH8c8Nc3'
  },
  {
    key: 'overlap-root',
    title: 'オーバーレイレイヤー',
    selector: 'div#overlap-manager-root'
  },
  {
    key: 'context-menu',
    title: '右クリックメニュー',
    selector: 'div.context-menu table'
  },
  {
    // 属性名は直書きせず、候補配列から組み立てた値をそのまま載せる(変えるのは watchlistSymbolAttrs だけでよい)。
    // 実サイトの行が今も候補属性を持つかを `npm run check:selectors` に数えさせるために載せている(FR-27 判定基準1)
    key: 'watchlist-row',
    title: 'ウォッチリストの行',
    selector: watchlistRowSelector
  }
]

/**
 * key に対応する検出用セレクタを取得する
 * @param { string } key
 * @returns { string }
 */
const selectorOf = (key) => menuSelectors.find((menuSelector) => menuSelector.key === key).selector

/**
 * TradingView の見た目に合わせるための模倣用クラス（検証対象外 / 採取日: 2026-08-23）
 * ハッシュ部分は TradingView のリリースで変わる。壊れても見た目が崩れるだけで機能は落ちない。
 * 更新手順は docs/notes/architecture.md「TradingView の模倣用クラスを更新する」
 * @type { Record<string, string> }
 */
const tvMimicClasses = {
  // ツールバーに挿すボタンの器
  buttonsWrapper: 'buttonsWrapper-OH8c8Nc3 notAvailableOnMobile-OH8c8Nc3 withoutBg-OH8c8Nc3',
  // メニュー項目
  item: 'item-WSeXSXQB interactive-WSeXSXQB normal-WSeXSXQB',
  iconCell: 'iconCell-WSeXSXQB',
  content: 'content-WSeXSXQB',
  label: 'label-WSeXSXQB',
  subMenu: 'subMenu-WSeXSXQB',
  arrowIcon: 'arrowIcon-WSeXSXQB',
  // 区切り線
  separatorRow: 'row-tEFkH1Rx',
  separatorLine: 'line-tEFkH1Rx',
  // キーボード操作に対応した項目
  accessible: 'accessible-JcN4DqBB',
  // 「株Link」ボタンから開く自前メニューの枠
  menuWrap: 'menu-IqFTXspI context-menu menuWrap-lBIxIwtz',
  scrollWrap: 'scrollWrap-lBIxIwtz',
  menuBox: 'menuBox-lBIxIwtz'
}

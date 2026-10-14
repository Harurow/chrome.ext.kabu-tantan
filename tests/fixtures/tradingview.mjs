/**
 * TradingView のフィクスチャ（SPEC-CS-27）。
 *
 * **セレクタ文字列とクラス名をここに書かない。**`src/tradingview-cs.js` の
 * `menuSelectors`（SPEC-CS-15）と `watchlistSymbolAttrs`（SPEC-CS-23）を**実行時に読み**、
 * `domFromSelector()` で DOM に直す。セレクタを差し替えればフィクスチャは自動で追従する
 * （CON-08 の条件1・2）。
 *
 * **このフィクスチャで実サイトの生存は分からない**（CON-08 の条件3 / FR-26 判定基準7）。
 * 再現しているのは「拡張が依存すると宣言している構造」だけで、
 * 挿入先が実在するか・見た目が揃っているかは `npm run check:selectors` と手動確認が見る。
 */
import { loadMenuSelectors, evaluateScripts } from '../../scripts/selector-check/load-selectors.mjs'
import { domFromSelector } from './selector-dom.mjs'

const SOURCE = 'src/tradingview-cs.js'

/** 検出用セレクタ（実行時に読む。SPEC-CS-15） */
const menuSelectors = loadMenuSelectors(SOURCE)
const selectorOf = (key) => {
  const found = menuSelectors.find((entry) => entry.key === key)
  if (!found) {
    throw new Error(`${SOURCE} の menuSelectors に "${key}" がありません`)
  }
  return found.selector
}

/** ウォッチリストの行が銘柄を持つ属性の候補（実行時に読む。SPEC-CS-23） */
const watchlistSymbolAttrs = evaluateScripts([SOURCE], 'watchlistSymbolAttrs')

export const TRADINGVIEW_URL = 'https://jp.tradingview.com/chart/'

/** チャートの銘柄（canvas の aria-label。SPEC-TC-07） */
export const CHART_CODE = '7203'
/** ウォッチリストの行の銘柄（チャートとは別の銘柄にして起点の取り違えを検出する） */
export const ROW_CODE = '8253'

/**
 * テスト用の目印。**拡張もサイトも見ない属性**で、
 * テストが座標を測るためだけに付ける（`ktt-tv-` を書かないための代替）
 */
export const CHART_MARK = 'data-test-chart'
export const ROW_MARK = 'data-test-watchlist-row'
/** ウォッチリストの器。行を差し替えるときの手がかり（`setWatchlistRowsAsync`） */
export const WATCHLIST_MARK = 'data-test-watchlist'
export const OVERLAP_MARK = 'data-test-overlap-root'
export const MENU_BOX_MARK = 'data-test-menu-box'

/**
 * 右クリックメニューの器に当てるテスト用スタイル（契約6）。
 *
 * **サイトの CSS の再現ではない。** 実サイトでは項目の行に高さがあり、
 * アイコン列にも幅があるので「文字の外」を押せる。フィクスチャにはサイトの CSS が無く、
 * 素のままでは行が文字と同じ大きさになって**押す場所が作れない**。
 * 数値の妥当性は主張せず、`<a>` の外側に面積があるという条件だけを作る。
 * 当てる先は**拡張自身が付ける属性**（`data-role` / `data-icon-cell`。SPEC-CS-16）で、
 * ハッシュ付きクラス名は使わない
 */
const MENU_TEST_STYLE = `
    [${MENU_BOX_MARK}] { position: fixed; left: 24px; top: 80px; }
    [${MENU_BOX_MARK}] table { width: 240px; table-layout: fixed; border-collapse: collapse; }
    [${MENU_BOX_MARK}] td { padding: 0; }
    [${MENU_BOX_MARK}] tr[data-role="menuitem"] { height: 28px; }
    [${MENU_BOX_MARK}] td[data-icon-cell="true"] { width: 28px; }`

/**
 * canvas の `aria-label`（SPEC-TC-07 の形）
 * @param {string} symbol `EXCHANGE:CODE`
 */
export const chartLabel = (symbol) => `${symbol} の 1 日 チャート`

/** 契約1: チャート領域の中に canvas があり、`aria-label` が `EXCHANGE:CODE …` の形 */
const chartHtml = () => domFromSelector(selectorOf('chart-canvas'), {
  rootAttrs: { [CHART_MARK]: '' },
  rootStyle: 'position: fixed; left: 0; top: 40px; right: 280px; bottom: 0;',
  leafAttrs: { 'aria-label': chartLabel(`TSE:${CHART_CODE}`) },
  leafStyle: 'display: block; width: 100%; height: 100%;'
})

/**
 * 契約2: ツールバーに挿入先の要素がある（空の器）。
 * ページに最初から置かず、後から足すこともできる（`insertToolbarAsync`）
 */
export const toolbarHtml = () => domFromSelector(selectorOf('toolbar-container'), {
  rootStyle: 'position: fixed; left: 0; top: 0; width: 240px; height: 36px; z-index: 2;'
})

/**
 * 契約5: ウォッチリストの行が `EXCHANGE:CODE` 形式の属性を持つ。
 * 属性名は `watchlistSymbolAttrs` から読む。先頭の候補に `EXCHANGE:CODE`、
 * 残りにコード単独を入れる（SPEC-CS-23 の表）。
 * 行の目印（`ROW_MARK`）の値はその行の `EXCHANGE:CODE` で、テストが行を選ぶのに使う
 * @param {string} symbol `EXCHANGE:CODE`（例 `TSE:8253` / `NASDAQ:AAPL` / `SP:SPX`）
 */
const watchlistRowHtml = (symbol) => {
  const code = symbol.slice(symbol.indexOf(':') + 1)
  const attrs = watchlistSymbolAttrs
    .map((attr, index) => `${attr}="${index === 0 ? symbol : code}"`)
    .join(' ')

  return `<div ${ROW_MARK}="${symbol}" ${attrs} style="height: 32px;"><span>${code}</span></div>`
}

const watchlistHtml = () =>
  `<div ${WATCHLIST_MARK} style="position: fixed; right: 0; top: 40px; width: 260px; bottom: 0; z-index: 2;">
    ${watchlistRowHtml(`TSE:${ROW_CODE}`)}
  </div>`

/**
 * サイト側の役割その5: ウォッチリストの行を差し替える。
 * 実サイトのウォッチリストは、スクロールで画面外の行を作り直し、別のリストへ切り替えると行ごと入れ替わる（FR-19 判定基準8）。
 * どちらも「右クリックしたときに DOM にある行」が変わることなので、器の中身を丸ごと差し替えて演じる
 * @param {import('@playwright/test').Page} page
 * @param {string[]} symbols 上から並べる行の `EXCHANGE:CODE`
 */
export const setWatchlistRowsAsync = (page, symbols) => page.evaluate(([mark, html]) => {
  document.querySelector(`[${mark}]`).innerHTML = html
}, [WATCHLIST_MARK, symbols.map(watchlistRowHtml).join('')])

/** チャートの中に置く、候補属性を持つ要素の目印（`addChartElementWithRowAttrsAsync`） */
export const CHART_ATTR_MARK = 'data-test-chart-attr'

/**
 * サイト側の役割その6: チャートの中の要素が、ウォッチリストの行と同じ名前の属性を、**形でない値**で持つ。
 * 実サイトのチャート内の要素が `data-symbol-*` を `main` や `7203` のような値で持つ場合を演じる（SPEC-CS-23「残る差分」）。
 * 拡張は値が `EXCHANGE:CODE` の形のときだけ行と見なすので、ここを右クリックしてもチャートの起点になる
 * @param {import('@playwright/test').Page} page
 * @param {string[]} values `watchlistSymbolAttrs` の順に入れる値（例 `['main', '7203']`）
 */
export const addChartElementWithRowAttrsAsync = (page, values) => page.evaluate(([chartMark, mark, html]) => {
  document.querySelector(`[${chartMark}]`).insertAdjacentHTML('beforeend', html)
  return mark
}, [CHART_MARK, CHART_ATTR_MARK, `<div ${CHART_ATTR_MARK} ${watchlistSymbolAttrs
  .map((attr, index) => `${attr}="${values[index] ?? ''}"`)
  .join(' ')} style="position: absolute; left: 40px; top: 40px; width: 120px; height: 40px;"></div>`])

/** 契約3: オーバーレイ層 `#overlap-manager-root`（`body` 直下） */
export const overlapRootHtml = () => domFromSelector(selectorOf('overlap-root'), {
  rootAttrs: { [OVERLAP_MARK]: '' }
})

/**
 * 契約4: 右クリックの**後**、オーバーレイ層の**子として**メニューが現れる。
 * ここだけがサイト側の役割で、テストが最小限に演じる。
 * **メニューの中身（サイト自身の項目）は再現しない**（拡張は中身を読まない）
 *
 * 契約6。位置と高さはテストが決める（数値の妥当性は主張しない）。
 * 何も渡さなければ `style` 属性を持たない（既定の位置はスタイルシート側にある）。
 *
 * > **「触っていない要素に `style` 属性を作らない」を見るテストは無い**（SPEC-CS-24 の 🟢6）。
 * > `style` 属性を持たない要素に `element.style.marginTop = ''` しても
 * > **属性は作られない**（Chromium 実測）ので、書き戻しを無条件にしても DOM に差が出ず、
 * > 落とせるテストが書けない。`tests/tradingview.spec.mjs` の段階2 の末尾に同じ注記がある
 *
 * @param {object} [box]
 * @param {number} [box.left]
 * @param {number} [box.top]
 * @param {number} [box.height] 指定すると箱の高さが固定される（段階2 で使う）
 * @param {string} [box.marginTop] 右クリック前から入っている `margin-top`（段階2 の 2-6 で使う）
 */
export const contextMenuHtml = ({ left, top, height, marginTop } = {}) => {
  const style = [
    left == null ? null : `left: ${left}px`,
    top == null ? null : `top: ${top}px`,
    height == null ? null : `height: ${height}px`,
    marginTop == null ? null : `margin-top: ${marginTop}`
  ].filter(Boolean).join('; ')

  return domFromSelector(selectorOf('context-menu'), {
    rootAttrs: { [MENU_BOX_MARK]: '' },
    rootStyle: style === '' ? null : `${style};`
  })
}

/**
 * ページ本体。**オーバーレイ層は含めない。**
 * `attach()` は `body` の `childList` を監視して層の**生成**を待つので、
 * 最初から置くと監視が発火せず、以降どの右クリックでもメニューが拡張されない
 *
 * @param {object} [options]
 * @param {boolean} [options.toolbar] 偽ならツールバー（ボタンの挿入先）を置かない。
 *   起動時（読み込みの 500ms 後）にはまだツールバーが無く、遅れて現れるページを作る（SPEC-CS-22。手動確認 A-12 / G-6）
 */
export const tradingViewPageHtml = ({ toolbar = true } = {}) => `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>TradingView フィクスチャ</title>
  <style>
    body { margin: 0; font: 13px sans-serif; }${MENU_TEST_STYLE}
  </style>
</head>
<body>
  ${toolbar ? toolbarHtml() : ''}
  ${chartHtml()}
  ${watchlistHtml()}
  <script>
    /* サイト側の役割その2: Esc でメニューを閉じる（SPEC-CS-17「閉じる契機」）。
       拡張はリスナを足さず、TradingView 自身が閉じるのに任せている。
       契約4 と同じで、テストはサイトの役割を最小限だけ演じる */
    document.addEventListener('keyup', (e) => {
      if (e.keyCode === 27) {
        document.querySelectorAll('[${MENU_BOX_MARK}]').forEach((menu) => menu.remove())
      }
    })
  </script>
</body>
</html>`

/**
 * サイト側の役割その3: ツールバーを後から出す（読み込みが遅いときの再現。手動確認 A-12 / G-6）。
 * `tradingViewPageHtml({ toolbar: false })` と組で使う
 * @param {import('@playwright/test').Page} page
 */
export const insertToolbarAsync = (page) =>
  page.evaluate((html) => document.body.insertAdjacentHTML('afterbegin', html), toolbarHtml())

/**
 * サイト側の役割その4: チャートの銘柄を切り替える（canvas の `aria-label` を書き換える。SPEC-TC-07）。
 * 実サイトでも銘柄の切り替えや、銘柄の無い画面（スクリーナー等）への移動でこの属性が変わる**前提**で演じている。
 * 前提そのものは確かめていない（手動確認 A-8 で見る）。`null` を渡すと属性ごと外す
 * @param {import('@playwright/test').Page} page
 * @param {string | null} label `chartLabel('NASDAQ:AAPL')` のような値、または銘柄でない値
 */
export const setChartLabelAsync = (page, label) => page.evaluate(([mark, value]) => {
  const canvas = document.querySelector(`[${mark}] canvas`)
  if (value == null) {
    canvas.removeAttribute('aria-label')
  } else {
    canvas.setAttribute('aria-label', value)
  }
}, [CHART_MARK, label])

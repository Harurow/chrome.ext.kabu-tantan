/**
 * 検証ターゲット表 (SPEC-SC-04, 05, 06)。
 *
 * **検出用セレクタをここに書いてはならない** (SPEC-SC-02 / NFR-13)。
 * 検出用セレクタは `src/*-cs.js` の `menuSelectors` が唯一の情報源で、
 * このファイルは「どのページをどう開き、到達したことをどう判定するか」だけを持つ。
 *
 * `key` は `menuSelectors` の `key ?? title` と一致させる。
 * ここでのページ識別セレクタは検出用セレクタの祖先から起こした値で、
 * 実測で外れが判明したら**このファイルだけ**を直す。
 */

/** 楽天証券のオリジン。14対象すべての組み立て URL で共用する (SPEC-SC-06) */
export const RAKUTEN_ORIGIN = 'https://member.rakuten-sec.co.jp'

// 個別銘柄・株価検索は銘柄の指定が要る（トヨタ自動車で確認する）
const RAKUTEN_STOCK_QUERY =
  '?eventType=init&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01'

/**
 * 楽天証券の遷移先 URL を組み立てる。
 * パスは `menuSelectors[].url`（URL 部分一致に使っている値）から作り、
 * セッション借用文字列を連結する (SPEC-SC-06)。
 * @param { string } query
 */
const rakutenUrl = (query = '') => (ctx) => {
  const url = ctx.entry.url ?? ''
  const path = url.endsWith(';') ? url.slice(0, -1) : url
  return `${RAKUTEN_ORIGIN}${path}${ctx.session}${query}`
}

// ランキング系はページ骨格が共通
const RAKUTEN_RANKING_PAGE = 'div#str-main-inner div.mbody table.tbl-data-01'

/**
 * 楽天証券の対象（14ページすべて。セレクタが同じでもページ単位で見る。FR-12）。
 *
 * お気に入り2・保有商品一覧2 の直打ちがエラー画面に飛ばされていた原因は
 * **組み立てる URL にクエリが無かったこと**だと分かったため 1.18.0 で直打ちに戻し、
 * **1.18.1 の実サイト実行**で 4対象とも ✅ になったのを見てポータルのリンクをたどる機構を撤去した
 * (SPEC-SC-06「楽天証券4ページのクエリ」/ ADR-0011 の 13)。
 * クエリは 2026-08-30 に利用者が提示したアドレスバーの写しで、
 * **対象ごとに違うので共有定数にしない・実測どおりに写して推測で削らない**（規則1・2）。
 */
const rakutenTargets = [
  {
    key: 'お気に入り',
    pageSelectors: ['form#form table.tbl-data-01'],
    requiresUserData: true,
    query: '?eventType=init&gmn=J&smn=01&lmn=01&fmn=02'
  },
  {
    // 米国株のお気に入りは**別ページ**（実機で確定。ADR-0014 の 9）。
    // クエリは未実測で、そのページを開くことだけを意味する `eventType=init` に絞る（推測）。
    // 外れてもエラー画面＝⚠️ で、今日（対象ですらない）より悪くならない。
    // ページ識別セレクタは実サイト実行で「識別 0 件・検出 2 件」となり、国内株版の
    // `form#form table.tbl-data-01` が当たらないと分かったため実測の表 id に差し替えた
    key: 'お気に入り・米国株',
    pageSelectors: ['table#pcmm-foreign-stock'],
    requiresUserData: true,
    query: '?eventType=init'
  },
  {
    key: 'お気に入り編集',
    pageSelectors: ['form table.tbl-data-01'],
    requiresUserData: true,
    query: '?eventType=init&pageNumber=1'
  },
  {
    // クエリは同上（未実測。国内株版の `pageNumber=1` は写さない）。
    // ページ識別セレクタは**一覧ページと同じ表**。国内株版を写したままだと、
    // 別の要素にたまたま当たって識別 1 件を返し、`ページ識別セレクタの見直しが必要` の
    // 警告すら出ないまま「祖先ではない識別セレクタ」が残る（SPEC-SC-05 の自己検出の限界）
    key: 'お気に入り編集・米国株',
    pageSelectors: ['table#pcmm-foreign-stock'],
    requiresUserData: true,
    query: '?eventType=init'
  },
  {
    key: '保有商品一覧・すべて',
    pageSelectors: ['div#table_possess_data'],
    requiresUserData: true,
    // 空値（`type=` / `sub_type=` / `local=`）も実測どおり持つ。「空だから要らない」は当て推量
    query: '?eventType=directInit&type=&sub_type=&local=&gmn=S&smn=01&lmn=01&fmn=01'
  },
  {
    // パスだけが違い、クエリは保有商品一覧・すべてと同一（実測）
    key: '保有商品一覧・国内株式',
    pageSelectors: ['table#poss-tbl-sp'],
    requiresUserData: true,
    query: '?eventType=directInit&type=&sub_type=&local=&gmn=S&smn=01&lmn=01&fmn=01'
  },
  { key: 'ランキング・売買代金', pageSelectors: [RAKUTEN_RANKING_PAGE] },
  { key: 'ランキング・出来高', pageSelectors: [RAKUTEN_RANKING_PAGE] },
  { key: 'ランキング・値上り・値下り', pageSelectors: [RAKUTEN_RANKING_PAGE] },
  { key: 'ランキング・信用残', pageSelectors: [RAKUTEN_RANKING_PAGE] },
  { key: 'ランキング・積立', pageSelectors: ['div#str-main-inner table table.tbl-data-01'] },
  {
    key: 'ランキング・楽天内',
    pageSelectors: ['div#daily-ranking, div#weekly-ranking, div#daily-ranking-margin, div#margin-oneday-ranking, div#sor-ranking']
  },
  { key: '国内株式・個別銘柄', pageSelectors: ['div#line1 h1.hdg-l1-01-title'], query: RAKUTEN_STOCK_QUERY },
  {
    // 検証ツールの対象外。**壊れていない**（2026-09-01 に利用者が実機で確認し、
    // `span.x-kabu-root` が入りメニューも開いた）。検索は POST でアドレスが変わらないため
    // ツールでは検索結果画面に到達できず、フォーム送信は CON-10 で行わない。
    // 定義ごと消さずに理由を持たせる ── 消すと結果ファイルから「なぜ無いのか」が読めなくなる。
    // `excluded` を外せば検証が復活する（`query` / `pageSelectors` はそのまま残してある）
    key: '国内株式・株価検索',
    pageSelectors: ['div#line1 h1.hdg-l1-01-title'],
    query: RAKUTEN_STOCK_QUERY,
    excluded: '検索が POST でアドレスが変わらず、ツールでは検索結果画面に到達できない（フォーム送信は行わない。CON-10）。注入の確認は人が行う'
  }
].map(({ query, ...target }) => ({
  reach: 'goto',
  url: rakutenUrl(query),
  settleMs: 2000,
  ...target
}))

/**
 * @type { {
 *   site: string,
 *   label: string,
 *   source: string,
 *   login: string | null,
 *   injected: string,
 *   targets: object[]
 * }[] }
 */
export const sites = [
  {
    site: 'rakuten',
    label: '楽天証券',
    source: 'src/rakuten-cs.js',
    login: 'https://member.rakuten-sec.co.jp/',
    injected: 'span.x-kabu-root',
    prepare: [
      '楽天証券にログインする（14ページはツールが自動で開く）',
      'ログイン後の画面のタブを閉じずに Enter を押す（このタブからセッションを借りる）',
      'お気に入り（国内株・米国株の両方）に1銘柄以上、可能なら国内株式を1銘柄以上保有した口座で実行する（0件だと「破損」と区別できない）'
    ],
    targets: rakutenTargets
  },

  {
    site: 'rakuten-scr',
    label: '楽天スーパースクリーナー',
    source: 'src/rakuten-scr-cs.js',
    login: null,
    injected: 'span.x-kabu-root',
    prepare: [
      'スーパースクリーナーを開き、**検索を実行して結果一覧を表示した状態**にする'
    ],
    targets: [
      {
        key: 'スーパースクリーナー',
        reach: 'tab',
        frameUrl: 'hs.trkd-asia.com/rakutensecscr',
        pageSelectors: ['div#resultpanel div.resulttablebox'],
        settleMs: 3000
      }
    ]
  },

  {
    site: 'sbi',
    label: 'SBI証券',
    source: 'src/sbi-cs.js',
    login: 'https://site1.sbisec.co.jp/ETGate/',
    injected: 'span.x-kabu-root',
    prepare: [
      'SBI証券にログインし、**国内株式の個別銘柄ページ**を開く',
      '別のタブで**ポートフォリオ**を開く'
    ],
    targets: [
      {
        key: '個別銘柄',
        reach: 'tab',
        frameUrl: 'sbisec.co.jp/ETGate',
        pageSelectors: ['div#main div.mgt15 div.trHead01 table.tbl01'],
        settleMs: 3000
      },
      {
        key: 'ポートフォリオ',
        reach: 'tab',
        frameUrl: 'sbisec.co.jp/ETGate',
        pageSelectors: ['div.middleArea2 div.middleAreaM2'],
        settleMs: 3000
      }
    ]
  },

  {
    site: 'sbi-scr',
    label: 'SBI銘柄スクリーニング',
    source: 'src/sbi-scr-cs.js',
    login: null,
    injected: 'span.x-kabu-root',
    prepare: [
      '銘柄スクリーニングを開き、**検索を実行して結果一覧を表示した状態**にする'
    ],
    targets: [
      {
        key: 'スクリーナー',
        reach: 'tab',
        frameUrl: 'graph.sbisec.co.jp/sbiscreener',
        pageSelectors: ['div#root div.App div.Screener div.resultpane'],
        settleMs: 3000
      }
    ]
  },

  {
    site: 'tradingview',
    label: 'TradingView',
    source: 'src/tradingview-cs.js',
    login: null,
    injected: 'div.ktt-tv-kabuLinkMenu',
    // 公開チャートはログイン不要。ログインしなくても必ず実施する (FR-16)
    prepare: [],
    targets: [
      {
        key: 'chart-canvas',
        reach: 'goto',
        url: () => 'https://jp.tradingview.com/chart/?symbol=TSE%3A7203',
        pageSelectors: ['#header-toolbar-symbol-search, canvas'],
        settleMs: 5000,
        extra: 'tv-symbol'
      },
      {
        key: 'toolbar-container',
        reach: 'after',
        pageSelectors: ['#header-toolbar-symbol-search, canvas']
      },
      {
        // 行は数えるだけで、右クリックしない（CON-10 の許容表に無い）。
        // 拡張は行に何も足さないので、注入は数えない（右クリックで足す行は context-menu が数える）。
        // 公開チャートはログインしなくてもウォッチリストを出している（2026-10-15 に 18 行を確かめた）
        key: 'watchlist-row',
        reach: 'after',
        pageSelectors: ['#header-toolbar-symbol-search, canvas'],
        injected: false
      },
      {
        key: 'overlap-root',
        reach: 'after',
        // 右クリックしないとオーバーレイレイヤーは生成されない (CON-10 の許容操作)
        action: 'context-menu',
        pageSelectors: ['#header-toolbar-symbol-search, canvas']
      },
      {
        key: 'context-menu',
        reach: 'after',
        pageSelectors: ['div#overlap-manager-root'],
        injected: 'tr[data-kabu-tantan]',
        // 親行と入れ子のあいだの隙間を測る（入れ子は開かない。SPEC-SC-11）
        extra: 'tv-submenu-gap'
      }
    ]
  }
]

/** `--only` に指定できるサイトキー */
export const siteKeys = sites.map((site) => site.site)

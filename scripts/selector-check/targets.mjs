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

/** 楽天証券のオリジン。組み立て URL とポータルのリンク探索 (SPEC-SC-26) で共用する */
export const RAKUTEN_ORIGIN = 'https://member.rakuten-sec.co.jp'

/**
 * 「そのページを開く」ことだけを意味するクエリ (SPEC-SC-26 のアンカーの資格 6)。
 *
 * 楽天証券の `.do` は**同一パスのクエリで操作を切り替える**（`eventType` が `init` 以外も取りうる）。
 * ポータルのリンクをたどるとき、ここに挙げたキーだけで構成されるクエリ（またはクエリ無し）以外は
 * 資格を満たさないものとして採らない。**許可列挙**なので、知らないキーが1つでもあれば落ちる。
 *
 * | 種類 | キー | 判断 |
 * | --- | --- | --- |
 * | `pinned` | `eventType` | サイトが**操作の種類をこのキーで表している**と読めるため、値を `init` に固定したまま緩めない |
 * | `anyValue` | `gmn` / `fmn` / `lmn` / `smn` | グローバル／第1／大／小メニューの階層。**どのメニューから来たか**を表すだけで遷移先の内容も状態も変えない |
 * | `anyValue` | `l-id` | リンク識別子（流入元のトラッキング）。同上 |
 *
 * `local` / `type` / `sub_type` は 2026-08-30 の実測で観測したが**許さない**。「表示の絞り込み」と
 * 読めるだけで確証が無く、同一パスで**操作**を切り替える可能性を否定できない
 * （CON-10「判断がつかないものは採らない」。ADR-0011 の 11）。
 *
 * 組み立て URL の `eventType=init` と**同じ情報源**にするため、下の `RAKUTEN_STOCK_QUERY` は
 * `pinned` から作る。
 */
export const RAKUTEN_OPEN_QUERY = {
  pinned: { eventType: 'init' },
  anyValue: ['gmn', 'fmn', 'lmn', 'smn', 'l-id']
}

// 個別銘柄・株価検索は銘柄の指定が要る（トヨタ自動車で確認する）
const RAKUTEN_STOCK_QUERY =
  `?${new URLSearchParams(RAKUTEN_OPEN_QUERY.pinned)}&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01`

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
 * お気に入り2・保有商品一覧2 は 1.15.0 で `reach: 'link'` にしていたが、
 * 直打ちがエラー画面に飛ばされていた原因は**組み立てる URL にクエリが無かったこと**だと
 * 分かったため 1.18.0 で `reach: 'goto'` に戻した (SPEC-SC-06「楽天証券4ページのクエリ」/
 * ADR-0011 の 13)。クエリは 2026-08-30 に利用者が提示したアドレスバーの写しで、
 * **対象ごとに違うので共有定数にしない・実測どおりに写して推測で削らない**（規則1・2）。
 *
 * リンク経由の機構（`links.mjs`・資格審査・診断3種）は**消さない**。
 * 実測で通ることが確認できるまで、`reach` の1語で往復できる状態に保つ（ADR-0011 の 13 の段取り4）。
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
    // 外れてもエラー画面＝⚠️ で、今日（対象ですらない）より悪くならない
    key: 'お気に入り・米国株',
    pageSelectors: ['form#form table.tbl-data-01'],
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
    // 同上（未実測。国内株版の `pageNumber=1` は写さない）
    key: 'お気に入り編集・米国株',
    pageSelectors: ['form table.tbl-data-01'],
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
  { key: '国内株式・株価検索', pageSelectors: ['div#line1 h1.hdg-l1-01-title'], query: RAKUTEN_STOCK_QUERY }
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
    // `reach: 'link'` の対象が使うサイト固有の値 (SPEC-SC-26「値は「検証中のサイト定義」から引く」)。
    // 1.18.0 で `reach: 'link'` の対象は 0 件になったが、`reach` の1語で戻せるように残す
    // 組み立て URL と同じ定数を渡すので値がずれようがない (NFR-13)。
    // check.mjs はここから引く（定数を名指しで import しない）ため、
    // 他サイトに `reach: 'link'` を付けても楽天のオリジンでハブを走査してしまうことがない
    link: { origin: RAKUTEN_ORIGIN, openQuery: RAKUTEN_OPEN_QUERY },
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
        injected: 'tr[data-kabu-tantan]'
      }
    ]
  }
]

/** `--only` に指定できるサイトキー */
export const siteKeys = sites.map((site) => site.site)

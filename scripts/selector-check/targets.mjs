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

const RAKUTEN_ORIGIN = 'https://member.rakuten-sec.co.jp'

// 個別銘柄・株価検索は銘柄の指定が要る（トヨタ自動車で確認する）
const RAKUTEN_STOCK_QUERY = '?eventType=init&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01'

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

/** 楽天証券の対象（12ページすべて。セレクタが同じでもページ単位で見る。FR-12） */
const rakutenTargets = [
  { key: 'お気に入り', pageSelectors: ['form#form table.tbl-data-01'], requiresUserData: true },
  { key: 'お気に入り編集', pageSelectors: ['form table.tbl-data-01'], requiresUserData: true },
  { key: '保有商品一覧・すべて', pageSelectors: ['div#table_possess_data'], requiresUserData: true },
  { key: '保有商品一覧・国内株式', pageSelectors: ['table#poss-tbl-sp'], requiresUserData: true },
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
      '楽天証券にログインする（12ページはツールが自動で開く）',
      'お気に入りに1銘柄以上、可能なら国内株式を1銘柄以上保有した口座で実行する（0件だと「破損」と区別できない）'
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
        settleMs: 500
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
        settleMs: 500
      },
      {
        key: 'ポートフォリオ',
        reach: 'tab',
        frameUrl: 'sbisec.co.jp/ETGate',
        // `body.vsc-initialized` は含めない。含めると SPEC-SC-12 の切り分けができなくなる
        pageSelectors: ['div.middleArea2 div.middleAreaM2'],
        settleMs: 500,
        extra: 'vsc-initialized'
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
        settleMs: 500
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

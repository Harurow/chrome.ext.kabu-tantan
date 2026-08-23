# SPEC-CS: 各サイトへのメニュー注入

実装: `src/rakuten-cs.js`, `src/rakuten-scr-cs.js`, `src/sbi-cs.js`, `src/sbi-scr-cs.js`, `src/linkMenu.js`, `src/tradingview-cs.js`

> **すべてサイト側の DOM 構造に強く依存する。** サイト改修で無言のうちに効かなくなる。
> 動かない報告があれば、まず対象サイトの実 DOM を確認すること（CON-03）。

## SPEC-CS-01 共通の起動シーケンス

```javascript
$(() => {
  setTimeout(attachAsync, <待機ms>)
})
```

| Content Script | 待機 | MutationObserver |
|---------------|------|-----------------|
| `rakuten-cs.js` | 500ms | なし |
| `rakuten-scr-cs.js` | 500ms | あり |
| `sbi-cs.js` | 500ms | なし |
| `sbi-scr-cs.js` | **1500ms** | あり |

固定待機はサイト側の描画完了を待つため。SBIスクリーナーは React 製で描画が遅く 1500ms。

> 弱点: 固定待機なので、回線やマシンが遅いと注入に失敗する。リトライ機構は無い。

- 要件: FR-02, FR-03, NFR-09, FR-13（未達）
- 検証: `auto`（楽天・SBI の注入テスト）

## SPEC-CS-02 メニュー注入の手順

`attachMenu(element, keys)`

1. 要素のテキストから国内銘柄コードを抽出（SPEC-TC-06）。無ければ何もしない
2. 要素の子ノードを走査し、**銘柄コードを含むテキストノード**を探す
3. そのテキストノードを `createMenu()` が返す `<span class="x-kabu-root">` で置換する

テキストノードのみを対象とするため、既存の要素構造・イベントを壊さない。

- 要件: FR-02, FR-03, CON-03
- 検証: `auto`（`楽天証券 Content Script › お気に入りの銘柄コードにリンクメニューを注入する`）

## SPEC-CS-03 メニューの DOM 構造

`linkMenu.js` の `createMenu(keys, code, text, nonStyle)`

```html
<span class="x-kabu-root">
  元のテキスト
  <ul class="x-kabu-body">
    <li class="x-kabu-menu-item"><a title="…" target="_blank" rel="noopener noreferrer" href="…">…</a></li>
    …
  </ul>
</span>
```

- `<ul>` はインラインスタイルで `padding: 3px 6px` / `text-align: left` / `z-index: 999999`
- `<span>` は `display: inline-block`（`nonStyle` が真なら付けない）
- `<li>` はインラインスタイルで `margin: 3px 6px`
- **元のテキストは `document.createTextNode()` で挿入する。**
  jQuery の `.append(文字列)` は文字列を HTML としてパースするため、
  対象サイト上の利用者入力（銘柄メモ等）に `<img onerror=…>` が含まれると
  証券会社のオリジンでスクリプトが実行されうる

- 要件: FR-02, FR-03, NFR-03
- 検証: `auto`（`メニュー項目が銘柄コード入りの外部リンクになっている`）

## SPEC-CS-04 メニューの開閉

`hover` で `<ul>` に `open` クラスを付け外しする。CSS 側で `display: none` / `block` を切り替える。

- 要件: FR-02, FR-03
- 検証: `auto`（`楽天証券 Content Script › ホバーでメニューが開く`）

## SPEC-CS-05 外部リンクの属性

すべてのメニュー項目に `target="_blank"` と `rel="noopener noreferrer"` を付ける。

- 要件: NFR-03
- 検証: `auto`（`メニュー項目が銘柄コード入りの外部リンクになっている`）

## SPEC-CS-06 メニュー項目は国内 URL のみ

`createMenu` は `url1` のみを使う。楽天・SBI は国内株ページしか対象にしていないため。

- 要件: FR-02, FR-03
- 検証: `auto`（同上）

## SPEC-CS-07 楽天証券の対象ページ（12セレクタ）

`location.href` に `url` が含まれるものだけを適用する。

| 対象 | URL 部分一致 | セレクタ |
|------|-------------|---------|
| お気に入り | `/app/info_jp_prc_reg_lst.do;` | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り編集 | `/app/info_jp_prc_reg_lst_edit.do;` | `form table.tbl-data-01 td.align-C div.mbody nobr` |
| 保有商品一覧・すべて | `/app/ass_all_possess_lst.do;` | `div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td` |
| 保有商品一覧・国内株式 | `/app/ass_jp_stk_possess_lst.do;` | `table#poss-tbl-sp tr td table tr td nobr` |
| ランキング・売買代金 | `/app/market_ranking.do;` | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・出来高 | `/app/market_ranking_volume.do;` | 同上 |
| ランキング・値上り値下り | `/app/market_ranking_change.do;` | 同上 |
| ランキング・信用残 | `/app/market_ranking_debit.do;` | 同上 |
| ランキング・積立 | `/app/market_ranking_reserve.do;` | `div#str-main-inner table table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・楽天内 | `/app/market_ranking_rakuten.do` | `div#daily-ranking / #weekly-ranking / #daily-ranking-margin / #margin-oneday-ranking / #sor-ranking` の `table.tbl-data-01 tr td.align-C` |
| 国内株式・個別銘柄 | `/app/info_jp_prc_stock.do` | `div#line1 h1.hdg-l1-01-title span:first` |
| 国内株式・株価検索 | `/app/info_jp_prc_search.do` | 同上 |

`:contains()` と `:first` は jQuery 独自セレクタ（jQuery 4.0.0 でも利用可能）。

- 要件: FR-02
- 検証: `auto`（お気に入りのみ）／`manual`（残り11ページ）

## SPEC-CS-08 楽天スーパースクリーナー

- 注入先: `https://hs.trkd-asia.com/rakutensecscr/*`（iframe、`all_frames: true`）
- セレクタ: `div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a`
- `div#resultpanel div.pagenavcontrolbox` を `MutationObserver({ childList: true })` で監視し、
  ページ送りのたびに再注入する
- 監視対象が見つからなければ何もせず終了する
- `createMenu(..., nonStyle = true)` で呼び、`ul.x-kabu-body` に `margin-top: -3px` を追加する

- 要件: FR-02
- 検証: `manual`

## SPEC-CS-09 SBI証券（2セレクタ）

URL による絞り込みは**行わない**。両セレクタを常に試す。

| 対象 | セレクタ |
|------|---------|
| 個別銘柄 | `div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal` |
| ポートフォリオ | `body.vsc-initialized div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)` |

> `body.vsc-initialized` は SBI 側ではなく**ブラウザ拡張が付けるクラス**に見える。
> 環境によっては付かず、ポートフォリオで動作しない可能性がある（要調査）。

- 要件: FR-03
- 検証: `auto`（ポートフォリオ）／`manual`（個別銘柄）

## SPEC-CS-10 SBI銘柄スクリーニング

- 注入先: `https://graph.sbisec.co.jp/sbiscreener/*`（iframe、`all_frames: true`）
- セレクタ: `div#root div.App div.Screener div.resultpane div.ResultListMainDiv table.leftTable tr td.c.fixedtable:nth-of-type(1)`
- `div#root div.App div.Screener div.resultpane` を
  `MutationObserver({ childList: true, subtree: true })` で監視して再注入する

- 要件: FR-03
- 検証: `manual`

## SPEC-CS-11 TradingView: 右クリックメニュー拡張

1. `body` を監視して `div#overlap-manager-root` の生成を待つ
2. 生成されたら、そのレイヤーの `childList` を監視する
3. メニューが作られるたびに `attachMenu()` を呼ぶ
4. メニュー1行目のテキストから銘柄コードを判定し、区切り線＋各サイトの項目を追加する
5. `tr[data-kabu-tantan]` が既にあれば二重追加しない

- 楽天証券・内藤証券の項目は `:info` メッセージで URL が得られた場合のみ追加する
- `tradingview.com` で始まるキーは除外する（TradingView 上で TradingView を開かない）
- 米国株では `url3` を持つサイトのみ追加する

- 要件: FR-04, CON-08
- 検証: `manual`（**自動テスト対象外**。TradingView でチャートを右クリック）

## SPEC-CS-12 TradingView: 「株Link」ボタン

`div.container-hw_3o_pb` にボタンを追加する。

- クラス: `ktt-tv-kabuLinkMenu`
- クリックで全画面の透明レイヤー `ktt-tv-menuBack` を敷き、その上にメニューを出す
- 背景クリックまたはキー入力でキャンセルする
- チャートの `canvas` の属性変化を監視し、銘柄コードが取れないときはボタンを隠す

- 要件: FR-04, CON-08
- 検証: `manual`（**自動テスト対象外**）

## SPEC-CS-13 スタイルのクラス接頭辞

| 接頭辞 | 用途 | 定義ファイル |
|--------|------|------------|
| `x-kabu-` | 楽天・SBI のメニュー | `src/style.css` |
| `ktt-tv-` | TradingView のボタン・レイヤー | `src/tradingview-cs.css` |

接頭辞が無いクラス（`theme-dark`, `chart-widget__top--themed-light`, `apply-common-tooltip`,
`button-hw_3o_pb` 等）は**対象サイト側の定義**。grep でヒットしなくても消してはいけない。

- 要件: CON-03
- 検証: `manual`（`CLAUDE.md`「CSS を消すときの鉄則」に従う）

## SPEC-CS-14 対象外ページでは何もしない

セレクタに一致する要素が無い、または URL 条件に合わない場合、DOM を一切変更しない。

- 要件: NFR-01, CON-03
- 検証: `auto`（`楽天証券 Content Script › 対象外のページにはメニューを注入しない`）

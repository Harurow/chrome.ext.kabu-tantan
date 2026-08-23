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
| --- | --- | --- |
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
| --- | --- | --- |
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
セレクタは `rakuten-cs.js` の `menuSelectors` が唯一の情報源（SPEC-SC-02）。

- 要件: FR-02
- 検証: `auto`（お気に入りのみ）／`半自動`（`npm run check:selectors`。12ページの検出用セレクタの生存）

## SPEC-CS-08 楽天スーパースクリーナー

- 注入先: `https://hs.trkd-asia.com/rakutensecscr/*`（iframe、`all_frames: true`）
- セレクタ: `div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a`
- `div#resultpanel div.pagenavcontrolbox` を `MutationObserver({ childList: true })` で監視し、
  ページ送りのたびに再注入する
- 監視対象が見つからなければ何もせず終了する
- `createMenu(..., nonStyle = true)` で呼び、`ul.x-kabu-body` に `margin-top: -3px` を追加する

- 要件: FR-02
- 検証: `半自動`（検索を実行した結果一覧のタブを開いたまま `npm run check:selectors`。
  検出用セレクタの生存）／`manual`（メニューの見た目・動作）

## SPEC-CS-09 SBI証券（2セレクタ）

URL による絞り込みは**行わない**。両セレクタを常に試す。

| 対象 | セレクタ |
| --- | --- |
| 個別銘柄 | `div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal` |
| ポートフォリオ | `body.vsc-initialized div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)` |

> `body.vsc-initialized` は SBI 側ではなく**ブラウザ拡張が付けるクラス**に見える。
> 環境によっては付かず、ポートフォリオで動作しない可能性がある。
> SPEC-SC-12 が実サイトで実測して白黒をつける（2026-08-23 時点で**未実施**）。

- 要件: FR-03
- 検証: `auto`（ポートフォリオ）／`半自動`（`npm run check:selectors`。2ページの検出用セレクタの生存と
  `body.vsc-initialized` の追加検査）／`manual`（個別銘柄の見た目・動作）

## SPEC-CS-10 SBI銘柄スクリーニング

- 注入先: `https://graph.sbisec.co.jp/sbiscreener/*`（iframe、`all_frames: true`）
- セレクタ: `div#root div.App div.Screener div.resultpane div.ResultListMainDiv table.leftTable tr td.c.fixedtable:nth-of-type(1)`
- `div#root div.App div.Screener div.resultpane` を
  `MutationObserver({ childList: true, subtree: true })` で監視して再注入する

- 要件: FR-03
- 検証: `半自動`（検索を実行した結果一覧のタブを開いたまま `npm run check:selectors`。
  検出用セレクタの生存）／`manual`（メニューの見た目・動作）

## SPEC-CS-11 TradingView: 右クリックメニュー拡張

> 2026-08-23 の TradingView 側 DOM 改修に追随して作り直した（1.10.1）。
> 旧実装との差分は下記の対比表に残す。設計判断は [ADR-0002](../adr/0002-tradingview-dom-repair.md)。

使うセレクタは `menuSelectors`（SPEC-CS-15）から `selectorOf('overlap-root')` /
`selectorOf('context-menu')` で引く。

1. `body` を監視して `div#overlap-manager-root` の生成を待つ
2. 生成されたら、そのレイヤーの `childList` を監視する
3. `document` の `contextmenu` を**キャプチャ段階**で監視し、発生元がチャート内なら発生時刻を保持する（後述「起点の判定」）
4. メニューが作られるたびに `attachMenu()` を呼ぶ
5. `attachMenu()` は次を上から順に判定し、1つでも満たさなければ **DOM を一切変更しない**

   | # | 条件 | 満たさないとき |
   | --- | --- | --- |
   | 1 | `selectorOf('overlap-root')` がちょうど1件 | 何もしない |
   | 2 | `tr[data-kabu-tantan]` が0件 | 何もしない（二重追加の防止。後述） |
   | 3 | 直近 1500ms 以内に**チャート上で** `contextmenu` が発生している | 何もしない |
   | 4 | `selectorOf('context-menu')` が1件以上 | 何もしない。2件以上なら**先頭の1件だけ**を対象にする |
   | 5 | `getTickerCode()`（SPEC-TC-07）が `code` を返す | 何もしない（区切り線も追加しない） |

6. 満たしたら、対象テーブルの末尾に区切り線＋各サイトの項目を追加する
   （`type === 'jp'` → `addTokyoTickerAsync()`、`'us'` → `addNewyorkTicker()`）

### 銘柄コードの取得元

**メニューのテキストを読まない。** チャート canvas の `aria-label` から取る（SPEC-TC-07）。

| | 旧（〜1.10.0） | 新（1.10.1〜） |
| --- | --- | --- |
| 取得元 | メニュー1行目 `tr:first td:eq(1) div span:first` のテキスト | canvas の `aria-label` |
| 国内株の判定 | テキスト先頭が4桁コード | `TSE:` / `TSE_DLY:` 接頭辞 |
| 米国株の判定 | テキスト先頭が `[A-Z]{1,5}` | `BATS:` / `NASDAQ:` / `NYSE:` 等の接頭辞（SPEC-EL-09） |

変更理由: TradingView がメニュー構成を変え、**1行目に銘柄が出なくなった**
（2026-08-23 実測。1行目は「チャート表示をリセット」。`7203` は8行目以降にしか現れない）。
セレクタを直すだけでは旧方式は動かなかった。メニュー文言に依存しない経路へ寄せ、
ボタン側（SPEC-CS-12）と取得元を揃えてある。

**米国株の退行は無い。** 未ログインの TradingView は米国株の提供元を BATS に置き換えるため、
`NASDAQ:AAPL` を指定しても `aria-label` は `BATS:AAPL …` になる（2026-08-23 実測）。
ログイン済みで `NASDAQ:` / `NYSE:` のまま表示される場合に備え、SPEC-TC-07 で接頭辞を拡張してある。

### 起点の判定

旧実装は「メニュー1行目が銘柄コードで始まるか」が**結果的にフィルタ**として働き、
チャートの右クリック以外で開くメニューには項目を追加しなかった。
取得元を canvas に移すとこのフィルタが消えるため、**代わりに起点で絞る**。

- `document` の `contextmenu`（`capture: true`）で、`event.target` が
  `div.chart-gui-wrapper` の内側かを判定する

  | 発生元 | 保持する時刻 |
  | --- | --- |
  | チャートの内側 | `Date.now()` |
  | チャートの外側 | **`0`（それまでの記録を捨てる）** |

  外側で**捨てる**のが必須。上書きしないと「チャートを右クリック → 1.5秒以内にウォッチリストを右クリック」で
  チャート側の銘柄のリンクが出る
- `attachMenu()` は保持した時刻が **1500ms 以内**のときだけ動く（`chartContextMenuGraceMs`）
- ウォッチリスト・ツールバー等から開いたメニューには追加しない。
  それらは canvas の銘柄と一致せず、**別銘柄のリンクを出してしまう**ため

`div.chart-gui-wrapper` は `chart-canvas` セレクタ（SPEC-CS-15）と同じ、ハッシュを含まないクラス。
検出用セレクタとしては括り出さない（`menuSelectors` に足すと SPEC-SC-02 の対象が増え、
`targets.mjs` にページ識別セレクタの追加が要るため。ADR-0002 の 3 を参照）。

### 二重追加の防止

条件2 の目印 `tr[data-kabu-tantan]` は**区切り行に付ける**。
`addTokyoTickerAsync()` / `addNewyorkTicker()` は、設定の読み出し・`:info` メッセージの
`await` に入る**前に**、区切り行を同期的に追加する。

`await` の後に追加すると、同じ `MutationObserver` のバッチで `attachMenu()` が2回呼ばれたとき、
2回目が条件2 をすり抜けて項目が二重に並ぶ。**同期的に追加することで2回目を即座に弾く。**

### 追加する項目

- 楽天証券・内藤証券の項目は `:info` メッセージで URL が得られた場合のみ追加する
- `tradingview.com` で始まるキーは除外する（TradingView 上で TradingView を開かない）
- 米国株では `url3` を持つサイトのみ追加する

### 既知の制限

`getTickerCode()` は**最初にヒットした canvas しか見ない**（SPEC-TC-07）。
複数チャートレイアウトでは、右クリックしたチャートではなく左上のチャートの銘柄になる。
**実サイトでは未確認。**

- 要件: FR-04, FR-07, CON-08
- 検証: `半自動`（`npm run check:selectors -- --only=tradingview` で `overlap-root` /
  `context-menu` が ✅。参考値として「注入」列の `tr[data-kabu-tantan]` が 1 件以上になる。
  ただし注入列は判定条件にしない。SPEC-SC-09）／
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-5, A-6, A-7, A-9, A-10）

## SPEC-CS-12 TradingView: 「株Link」ボタン

> 2026-08-23 の DOM 改修に追随して挿入先を差し替えた（1.10.1）。SPEC-CS-11 と同じ経緯。

`selectorOf('toolbar-container')`（`div.container-OH8c8Nc3`。SPEC-CS-15）の下に
`<div>`（模倣用クラス。SPEC-CS-16）を挿し、その中にボタンを置く。

- クラス: `ktt-tv-kabuLinkMenu`
- クリックで全画面の透明レイヤー `ktt-tv-menuBack` を敷き、その上にメニューを出す
- 背景クリックまたはキー入力でキャンセルする
- チャートの `canvas`（`selectorOf('chart-canvas')`）の属性変化を監視し、
  銘柄コードが取れないときはボタンを隠す
- `tradingview.com` で始まるキーは除外する（SPEC-CS-11 と同じ）
- **米国株でも `url3` の有無で絞り込まない**（SPEC-CS-11 と異なる）。
  米国株非対応のサイトも項目として並び、クリックすると `makeUrl(undefined, code)` で
  例外になり何も開かない

> 既知の不整合（**今回の修正では直さない**）: 右クリックメニュー（SPEC-CS-11）は `url3` で絞るが、
> ボタンメニューは絞らない。FR-07「米国株に対応しないサイトは出さない」を満たしていない。
> DOM 破損の修正とは独立した論点なので、別タスクに残す。

### 挿入先が見えない場合の扱い

`div.container-OH8c8Nc3` は買/売ボタンを内包するツールバーで、**未ログインでは
子要素に `blockHidden-wVrpb0RA` が付き、コンテナ自体の幅・高さが 0** になる（2026-08-23 実測）。

| 観点 | 判定手段 |
| --- | --- |
| 挿入先が存在するか | `npm run check:selectors -- --only=tradingview`（ログイン不要） |
| ボタンが**見えるか** | 手動確認 `docs/MANUAL-CHECKLIST.md` A-1（**TradingView にログインして実施する**） |

セレクタがヒットしていてボタンが見えない場合、原因は挿入先の選択であって
セレクタの破損ではない。挿入先の見直しが要る（ADR-0002 の 4 に候補を残す）。

- 要件: FR-04, CON-08
- 検証: `半自動`（`npm run check:selectors -- --only=tradingview` で `toolbar-container` が ✅。
  参考値として「注入」列の `div.ktt-tv-kabuLinkMenu` が 1 件以上）／
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-1〜A-4, A-7b, A-8, A-9）

### 既知の制限（ボタンの消失）

- **ボタンが消えることがある（実機観測、未解決）。** 2026-08-23、ログイン済み環境で
  「ボタンが出たり消えたりする」観測が利用者から報告された。lead がログイン済み DOM を
  直接確認したところ、ページ表示直後・時間足切替・SPA 銘柄切替・フルリロードのいずれでも
  ボタンは残っており、売買ボタン設定 OFF でも表示される。消える操作は未特定。
  `createKabuLinkMenu()` は `attach()` から**1回だけ**呼ばれるため、挿入先の
  `container`（SPEC-CS-15 `toolbar-container`）が TradingView 側で再生成されると
  追随できない、というのが有力な仮説。再注入には `MutationObserver` での監視が要り、
  DOM 追随（ADR-0002）とは独立した設計判断になるため別タスクとする。
  右クリックメニュー（SPEC-CS-11）はメニュー生成のたびに走るので影響しない。
  **C-1（チャート外右クリックで記録を捨てる）修正後の再確認（同日、ログイン済み）では
  利用者から「直っていそう」と報告あり。** 再現しなくなった場合は消失自体が C-1 の
  副作用だった可能性があるが、因果は未特定のまま。再発時にこの節を起点に調査する。

## SPEC-CS-13 スタイルのクラス接頭辞

| 接頭辞 | 用途 | 定義ファイル |
| --- | --- | --- |
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

## SPEC-CS-15 TradingView の検出用セレクタ定義

`tradingview-cs.js` の**検出用セレクタ4つ**は、ファイル末尾の `const menuSelectors` にまとめてある。
他の Content Script と同じ形で、`npm run check:selectors`（SPEC-SC）もこの配列を読む。

> **2件を 1.10.1 で差し替えた。** 「旧」列は 2026-08-23 に実サイトで 0 件だった値。

| `key` | `title` | セレクタ（新） | 旧 |
| --- | --- | --- | --- |
| `chart-canvas` | チャート canvas | `div.chart-gui-wrapper canvas[aria-hidden!="true"]` | 変更なし |
| `toolbar-container` | ツールバー挿入先 | `div.container-OH8c8Nc3` | `div.container-hw_3o_pb`（**0件**） |
| `overlap-root` | オーバーレイレイヤー | `div#overlap-manager-root` | 変更なし |
| `context-menu` | 右クリックメニュー | `div.context-menu table` | `div.menu-Tx5xMZww.context-menu.menuWrap-Kq3ruQo8 > div > div[data-name="menu-inner"] > table`（**0件**） |

参照は `const selectorOf = (key) => menuSelectors.find((m) => m.key === key).selector` 経由。
**置換箇所は6箇所**（`attach()` / `bodyObserverCallback()` / `attachMenu()` ×2 /
`createKabuLinkMenu()` / `getTickerCode()`）。

### `context-menu` をハッシュ非依存にした理由

`context-menu` は TradingView 側でハッシュを付けずに使われている**意味のあるクラス**で、
`menu-IqFTXspI` / `menuWrap-lBIxIwtz` のようなビルド由来の識別子と違い、
リリースのたびには変わらない。中間の `div[data-name="menu-inner"]` は現行 DOM から消えており、
実経路（`div.context-menu > div.scrollWrap-… > div.menuBox-… > table`）は
ハッシュ2つに依存する。子孫結合子まで緩めて `div.context-menu table` にする。

代償: 入れ子メニュー等で 2 件以上ヒットしうる。**先頭の1件だけを対象にする**（SPEC-CS-11 の条件4）。

- **模倣用クラス**（`item-WSeXSXQB` 等）は `menuSelectors` に入れない。検証対象外（FR-12）。
  定義場所は SPEC-CS-16
- `menuSelectors` は `tradingview-cs.js` 内で実際に使われる。検証専用の定数ではない（FR-12「やらないこと」）

- 要件: FR-04, FR-12, NFR-13
- 検証: `auto`（SPEC-SC-16 の `セレクタ定義` 5件）／
  `半自動`（`npm run check:selectors -- --only=tradingview` で**4対象すべてが ✅** になること）

## SPEC-CS-16 TradingView の模倣用クラス定義

> 1.10.1 で新設。

自前で組み立てるメニュー項目・区切り線・ボタンの器を TradingView の見た目に合わせるためのクラスは、
`tradingview-cs.js` の**1つの定数**（`tvMimicClasses`）にまとめ、HTML 文字列からはそれを参照する。

```javascript
/** TradingView の見た目に合わせるための模倣用クラス（検証対象外 / 採取日: 2026-08-23）
 *  ハッシュ部分は TradingView のリリースで変わる。壊れても見た目が崩れるだけで機能は落ちない。
 *  更新手順は docs/ARCHITECTURE.md「TradingView の模倣用クラスを更新する」 */
const tvMimicClasses = { ... }
```

| 用途 | キー | 値（1.10.1〜） | 旧（〜1.10.0） |
| --- | --- | --- | --- |
| ボタンの器 | `buttonsWrapper` | `buttonsWrapper-OH8c8Nc3 notAvailableOnMobile-OH8c8Nc3 withoutBg-OH8c8Nc3` | `…-hw_3o_pb` ＋ `column-hw_3o_pb` |
| メニュー項目 `<tr>` | `item` | `item-WSeXSXQB interactive-WSeXSXQB normal-WSeXSXQB` | `…-GJX1EXhk` |
| アイコン `<td>` | `iconCell` | `iconCell-WSeXSXQB` | `iconCell-GJX1EXhk` |
| 項目の内側 `<div>` | `content` | `content-WSeXSXQB` | `content-GJX1EXhk` |
| ラベル `<span>` | `label` | `label-WSeXSXQB` | `label-GJX1EXhk` |
| サブメニュー行 | `subMenu` | `subMenu-WSeXSXQB` | `subMenu-GJX1EXhk` |
| 区切り行 `<tr>` | `separatorRow` | `row-tEFkH1Rx` | `row-DFIg7eOh` |
| 区切り線 `<div>` | `separatorLine` | `line-tEFkH1Rx` | `line-DFIg7eOh` |
| キーボード操作対応 `<tr>` | `accessible` | `accessible-JcN4DqBB` | `accessible-rm8yeqY4` |
| 自前メニューの外枠 | `menuWrap` | `menu-IqFTXspI context-menu menuWrap-lBIxIwtz` | `menu-Tx5xMZww context-menu menuWrap-Kq3ruQo8` |
| 自前メニューのスクロール層 | `scrollWrap` | `scrollWrap-lBIxIwtz` | `scrollWrap-Kq3ruQo8` |
| 自前メニューの箱 | `menuBox` | `menuBox-lBIxIwtz` | `menuBox-Kq3ruQo8` |

**廃止した模倣用クラス:**

| 旧 | 扱い | 理由 |
| --- | --- | --- |
| `column-hw_3o_pb` | **付けない** | 現行 DOM の `column-_dNFqqJs` / `column-Jzp_i6cf` は別系統で、買/売ボタン用とは限らない。推測で当てない |
| `wrapper-NLkHhUu3`（リンクを包む `<div>`） | **要素ごと省略し、`<a>` を `span.label-…` の直下に置く** | 現行 DOM に `wrapper-` 接頭辞の後継が存在しない。TradingView 自身がこの階層をやめている |

`menuBox` に付けていた `data-name="menu-inner"` 属性も、現行 DOM に無いので付けない。

- **検証対象外（FR-12）。** ハッシュが変わっても `npm run check:selectors` は検出しない。
  崩れたことに気づく手段は手動確認 `docs/MANUAL-CHECKLIST.md` A-9 / A-10 のみ
- 値が古くなっても**機能は落ちない**（見た目だけが TradingView と揃わなくなる）。
  これは意図した設計であり、模倣用クラスを検証対象に格上げしない理由でもある（ADR-0002 の 6）

- 要件: FR-04, FR-12（検証対象外の側）
- 検証: `manual`（`docs/MANUAL-CHECKLIST.md` A-9「テーマ切り替え」・
  A-10「追加項目が TradingView の項目と同じ見た目か」）

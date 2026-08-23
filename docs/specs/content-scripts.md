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

> 設計判断は [ADR-0003](../adr/0003-tradingview-submenu.md)。2026-08-23 の DOM 改修への追随は [ADR-0002](../adr/0002-tradingview-dom-repair.md)。

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

6. 満たしたら `addTickerMenuAsync(ctxMenu, code, type)` を呼ぶ

### メニュー直下に追加する行

**追加する行は常に3行**（区切り行1・親行1・受け皿行1）。有効な遷移先サイトの件数が増減しても
この3行は変わらない。サイトの一覧は親行の入れ子（SPEC-CS-17）に出す。

| 順 | 行 | 内容 |
| --- | --- | --- |
| 1 | 区切り行 | `tr.{separatorRow}[data-kabu-tantan]`。TradingView 自身の項目との境目 |
| 2 | 親行 | `tr.{accessible}.{item}[data-role="menuitem"][tabindex="-1"]`。ラベルは「`<code>` を開く」＋右向き矢印 |
| 3 | 受け皿行 | `tr.{subMenu}` の直下に空の `<td>`。高さ0。入れ子はこの `<td>` の中に描画する |

クラス名は模倣用クラス `tvMimicClasses`（SPEC-CS-16）から引く。親行の DOM は次の形。

```html
<tr class="{accessible} {item}" data-role="menuitem" tabindex="-1">
  <td class="{iconCell}" data-icon-cell="true"></td>
  <td>
    <div class="{content}">
      <span class="{label}" data-label="true">7203 を開く</span>
      <span class="{arrowIcon}" data-submenu-arrow="true"><svg …矢印…></svg></span>
    </div>
  </td>
</tr>
<tr class="{subMenu}"><td></td></tr>
```

- 親行のラベルは国内株・米国株とも `` `${code} を開く` ``（例:「7203 を開く」「AAPL を開く」）
- 矢印 `<svg>` は TradingView 実測値をそのまま埋め込む（SPEC-CS-16）
- **親行自体はリンクではない。** クリックしても遷移しない（ホバーで入れ子を開くだけ）
- **入れ子の中の `<tr>` に `data-kabu-tantan` を付けてはならない。** 条件2 の判定は
  `$('tr[data-kabu-tantan]')` の document 全体検索なので、付けると入れ子を閉じるまで
  次の右クリックで拡張されなくなる

> 手順 2（証券会社）と 3（情報サイト）の取得は `Promise.all` で**並行**に行う。どちらかが失敗すればまとめて後始末する（下記）。

### 追加する順序と 0 件のときの扱い

`addTickerMenuAsync(ctxMenu, code, type)` は国内株・米国株の共通処理（旧実装の
`addTokyoTickerAsync()` / `addNewyorkTicker()` を1本に統合したもの）。

1. 区切り行・親行・受け皿行を**同期的に**追加する（`await` の前。後述「二重追加の防止」）
2. `makeBrokerItemsAsync(code, type)`（SPEC-CS-18）で証券会社の項目を得る
3. `makeLinkItemsAsync(code, type)`（SPEC-CS-18）で情報サイトの項目を得る
4. 次のいずれかなら、1 で追加した3行をすべて除去して終了する
   （FR-18 判定基準6。メニューに拡張の痕跡を残さない。区切り線だけが残ることもない）

   | 事由 | 起きる状況 |
   | --- | --- |
   | 2 と 3 が**どちらも 0 件** | 全サイトを無効にし、かつ楽天証券・内藤証券が未ログイン |
   | 2 または 3 が**例外で終わった** | 拡張を更新・再読み込みした後の古いタブで `chrome.runtime.sendMessage` が `Extension context invalidated` になる、`chrome.storage.sync` の読み出しが失敗する 等 |

   > 例外を捕まえずに抜けると、同期追加済みの3行が**除去されないまま残る**。
   > 「`7203` を開く ▶」が出るのにホバーしても何も開かない状態になるため、
   > 例外時も 0 件と同じ後始末をする。
5. 0 件でなければ、項目の配列を親行に保持し、ホバーで入れ子を開けるようにする（SPEC-CS-17）

> 4 で除去すると `tr[data-kabu-tantan]` が消えて二重追加の防止が解ける。
> ただし次に `attachMenu()` が通っても同じ 0 件判定になり、また除去されるだけなので害はない。

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

条件2 の目印 `tr[data-kabu-tantan]` は**区切り行に付ける**（現行から変えない。
`npm run check:selectors` の「注入」列がこの属性を数えるため。SPEC-SC-09）。

`addTickerMenuAsync()` は、設定の読み出し・`:info` メッセージの `await` に入る**前に**、
区切り行・親行・受け皿行の3行を同期的に追加する。

`await` の後に追加すると、同じ `MutationObserver` のバッチで `attachMenu()` が2回呼ばれたとき、
2回目が条件2 をすり抜けて項目が二重に並ぶ。**同期的に追加することで2回目を即座に弾く。**

> 親行のラベルに必要なのは `code` だけで、これは条件5 の時点で確定している。
> よって3行とも `await` の前に組み立てられる。**入れ子の中身だけが `await` に依存する。**

### 入れ子に出す項目

順序は次のとおり。並び順の根拠は FR-18 判定基準4。

| 順 | 項目 | 出る条件 |
| --- | --- | --- |
| 1 | `楽天証券で開く` | `rakuten-sec:info` が URL を返したとき（ログイン中） |
| 2 | `内藤証券で開く` | `naito-sec:info` が URL を返したとき（国内株かつログイン中） |
| 3 | 区切り線 | 1 か 2 のどちらかが出ていて、かつ 4 が1件以上あるとき |
| 4 | 情報サイト（`〈サイト名〉で開く`） | オプションで有効。並び順は**オプションの並び順**（SPEC-ST-01） |

- 項目の生成規則（`tradingview.com` の除外、米国株の `url3` 絞り込み）は SPEC-CS-18
- 開閉・配置・見た目は SPEC-CS-17

### 既知の制限

`getTickerCode()` は**最初にヒットした canvas しか見ない**（SPEC-TC-07）。
複数チャートレイアウトでは、右クリックしたチャートではなく左上のチャートの銘柄になる。
**実サイトでは未確認。**

- 要件: FR-04, FR-06, FR-07, FR-18, CON-08
- 検証: `半自動`（`npm run check:selectors -- --only=tradingview` で `overlap-root` /
  `context-menu` が ✅。参考値として「注入」列の `tr[data-kabu-tantan]` が **1 件**になる。
  ただし注入列は判定条件にしない。SPEC-SC-09）／
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-5, A-6, A-7, A-9, A-10, A-11）

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

> 1.10.1 で新設。1.11.0 で `arrowIcon` を追加した（FR-18 / SPEC-CS-17）。

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
| サブメニューの受け皿行 | `subMenu` | `subMenu-WSeXSXQB` | `subMenu-GJX1EXhk` |
| サブメニューの矢印 `<span>` | `arrowIcon` | `arrowIcon-WSeXSXQB` | （旧は使用せず） |
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

### クラス名以外の模倣資産

`tvMimicClasses` はクラス名（文字列）だけを持つ。次の2つはクラス名ではないため定数に入れず、
HTML 文字列に直書きする。**採取日・更新手順の扱いは模倣用クラスと同じ**（検証対象外・崩れても機能は落ちない）。

| 対象 | 値（2026-08-23 実測） | 使う場所 |
| --- | --- | --- |
| サブメニュー矢印の `<svg>` | `viewBox="0 0 10 16" width="10" height="16"`、`<path d="M.6 1.4l1.4-1.4 8 8-8 8-1.4-1.4 6.389-6.532-6.389-6.668z">` | 親行（SPEC-CS-11） |
| サブメニュー本体の `z-index` | `500` | 入れ子の配置（SPEC-CS-17） |

### 属性の模倣

TradingView 自身が付けている属性のうち、次を同じ位置に付ける。

| 属性 | 付ける要素 |
| --- | --- |
| `data-role="menuitem"` / `tabindex="-1"` | 親行、入れ子の各項目 |
| `data-icon-cell="true"` | アイコン `<td>` |
| `data-label="true"` | ラベル `<span>` |
| `data-submenu-arrow="true"` | 矢印 `<span>` |

> **キーボード操作は模倣しない**（FR-18 スコープ外）。`data-role` / `tabindex` は見た目と構造を
> 揃えるために付けるだけで、拡張はキー入力を処理しない。TradingView 側のキーボード移動が
> これらを拾って親メニューの操作が壊れないかは**未確認**。手動確認 A-11 で見る。

- **検証対象外（FR-12）。** ハッシュが変わっても `npm run check:selectors` は検出しない。
  崩れたことに気づく手段は手動確認 `docs/MANUAL-CHECKLIST.md` A-9 / A-10 のみ
- 値が古くなっても**機能は落ちない**（見た目だけが TradingView と揃わなくなる）。
  これは意図した設計であり、模倣用クラスを検証対象に格上げしない理由でもある（ADR-0002 の 6）

- 要件: FR-04, FR-12（検証対象外の側）
- 検証: `manual`（`docs/MANUAL-CHECKLIST.md` A-9「テーマ切り替え」・
  A-10「追加項目が TradingView の項目と同じ見た目か」）

## SPEC-CS-17 TradingView: 右クリックメニューの入れ子（サブメニュー）

> 1.11.0 で新設（FR-18）。設計判断は [ADR-0003](../adr/0003-tradingview-submenu.md)。

SPEC-CS-11 の親行にホバーしたとき、受け皿行の `<td>` の中に自前のメニューを描画する。
**TradingView のサブメニュー開閉 API は拡張から呼べない**（CON-03）ため、開閉は拡張が自前で持つ。

### 描画先

受け皿行 `tr.{subMenu} > td` の**中**に描画する。`overlap-manager-root` 直下や `body` 直下ではない。

| 描画先にした理由 | |
| --- | --- |
| 後始末が不要 | TradingView が親メニューを閉じると受け皿行ごと消えるので、入れ子も同時に消える |
| 自前の監視に引っかからない | `overlap-root` の監視は `childList` のみで `subtree: false`。受け皿 `<td>` 内の追加では `attachMenu()` が再入しない |
| TradingView 自身と同じ位置 | 実測（2026-08-23）で TradingView のサブメニューも受け皿 `<td>` 内に描画される |

### DOM

```html
<div class="{menuWrap} ktt-tv-subMenu" style="position: fixed; left: Xpx; top: Ypx; z-index: 500;">
  <div class="{scrollWrap}" style="overflow-y: auto;">
    <div class="{menuBox}">
      <table><tbody>
        <!-- 項目 -->
        <tr data-role="menuitem" class="{accessible} {item}" tabindex="-1">
          <td class="{iconCell}" data-icon-cell="true"></td>
          <td><div class="{content}">
            <span class="{label}" data-label="true">
              <a style="color: var(--tv-color-popup-element-text); width: 100%;"
                 title="7203 を株探/基本情報で開く" target="_blank" rel="noopener noreferrer"
                 href="https://kabutan.jp/stock/?code=7203">株探/基本情報で開く</a>
            </span>
          </div></td>
        </tr>
        <!-- 区切り線 -->
        <tr class="{separatorRow}"><td><div class="{separatorLine}"></div></td><td><div class="{separatorLine}"></div></td></tr>
      </tbody></table>
    </div>
  </div>
</div>
```

- 項目の `<tr>` は SPEC-CS-11 の親行と同形。**`data-kabu-tantan` は付けない**（SPEC-CS-11 参照）
- 項目は `<a href>` による直接遷移。`open-url` メッセージは使わない（現行の右クリックメニューと同じ）
- 入れ子の項目には受け皿行（`tr.{subMenu}`）を付けない。受け皿が要るのは矢印付きの親行だけ
- `<a>` のラベルは「`〈サイト名〉で開く`」。銘柄コードは親行にあるため項目からは省く。
  `title` 属性には「`〈code〉 を〈サイト名〉で開く`」を入れ、ツールチップで銘柄を確認できるようにする
- 項目クリック時に `document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 27 }))` を投げ、
  TradingView に親メニューを閉じさせる（現行の `makeMenuItem()` と同じ）

### 自前クラス `ktt-tv-subMenu`

模倣用クラス（`{menuWrap}` 等）は TradingView のリリースで死ぬ前提（SPEC-CS-16）。
死ぬと入れ子の背景・影が消えて**チャート上に文字が浮く**見た目になり、読みにくくなる。
保険として自前クラス `ktt-tv-subMenu` を併記し、`src/tradingview-cs.css` に最小限を置く。

| プロパティ | 値 | 目的 |
| --- | --- | --- |
| `background` | `var(--tv-color-popup-background, var(--color-popup-background))` | 背景の抜けを塞ぐ |
| `border-radius` | `6px` | TradingView 自身のメニューに合わせる |
| `box-shadow` | `0 2px 4px rgb(0 0 0 / 20%)` | 前後関係を出す |

- **色の直値を書かない。** ダークテーマで変数が死んだときに白背景＋明色文字になり、
  変数なしより読めなくなるため。変数名ごと変わった場合は `<a>` の文字色も同時に死ぬので、
  手動確認 A-10 / A-11 で気づく
- **変数のフォールバックは TradingView 自身と同じ2段にする。**
  `--tv-color-popup-background` は**現行の TradingView では未定義**で（`html` にも当該要素にも無い。
  2026-08-23 実測）、TradingView 自身も `.menuWrap-… { background-color: var(--tv-color-popup-background, var(--color-popup-background)) }`
  と書いてフォールバック側から色を得ている。
  **変数を1つしか書かないと invalid at computed-value time で `transparent` になり**、
  `div.ktt-tv-subMenu`（詳細度 0,1,1）が `.menuWrap-…`（0,1,0）に勝つため
  **TradingView 自身の背景まで打ち消す**。保険のつもりが、模倣用クラスが生きている状態を壊す
- 位置決め（`position` / `left` / `top` / `z-index`）は**インラインスタイル**で指定する。
  模倣用クラスが死んでも位置は正しく、**項目の選択と遷移は動く**（FR-18 の「崩れても動くこと」）

> **詳細度で勝つ副作用に注意。** `div.ktt-tv-subMenu` は `.menuWrap-…` に勝つので、
> ここに書いた値は模倣用クラスが生きていても**常に適用される**。
> TradingView 側の実測値と揃っていないプロパティを足すと、保険どころか見た目を崩す。
> `border-radius` を `6px` にしているのはこのため（TradingView 実測値）。

### 配置

開いた直後に1回だけ測って補正する。基準は TradingView 実測（2026-08-23）。

| 値 | 算出 |
| --- | --- |
| `left` | 親メニュー `div.context-menu` の `getBoundingClientRect().right` |
| `top` | 親行 `<tr>` の `getBoundingClientRect().top` |
| `z-index` | `500`（実測値） |

描画後に入れ子自身の矩形（`w` / `h`）を測り、次の順で補正する。

| # | 条件 | 補正 |
| --- | --- | --- |
| 1 | `left + w > innerWidth` | `left = 親メニューの left - w`（**左側に展開する**） |
| 2 | 1 の結果が `< 0` | `left = 0` |
| 3 | `h > innerHeight` | `top = 0`、`max-height = innerHeight` を **`{scrollWrap}` に付ける**（外枠には付けない。`overflow-y: auto` は `{scrollWrap}` にあるため） |
| 4 | `top + h > innerHeight` | `top = innerHeight - h` |

- 縦にはみ出す場合は**スクロールを許容する**（TradingView 自身と同じ扱い。FR-18 で利用者が決定）
- 横は**左側に反転する**。はみ出しを許容すると項目が画面外に出て選択できず、
  FR-18 判定基準5（項目をクリックすると開く）を満たさなくなるため（ADR-0003 の 4）
- **TradingView 自身が画面右端でどうしているかは未確認。** 見た目が揃わない可能性がある

**既知の制限（1.11.0 では直していない）:** 左側に反転したとき、入れ子が親メニューに
**約 5px 重なる**ことがある。補正を横（1・2）→ 縦（3・4）の順で行うため、
横の判定に使う幅が **`max-height` 適用前（縦スクロールバー出現前）の値**になるのが原因。
**項目はすべて画面内にあり、クリックできる**（FR-18 判定基準5・7 は満たす）ため、
見た目のずれとして残す。直すには幅の測定を `max-height` 適用後に行う必要がある。

**既知の制限（模倣用クラスが機能に効く唯一の箇所）:** 受け皿行に付けている
`tvMimicClasses.subMenu`（`subMenu-WSeXSXQB`。TradingView 側の CSS）に、
TradingView が将来 `display: none`（開くまで隠す実装）を入れると、
**`display: none` の祖先は `position: fixed` の子孫も隠す**ため、入れ子が表示されなくなる。
「模倣用クラスが死んでも機能は落ちない」（SPEC-CS-16 / FR-18 / CON-03）が破れる**唯一の経路**。
現行 DOM の受け皿行は `display: table-row` / 高さ 0 で、隠す指定は入っていない（2026-08-23 実測）。
起きた場合は受け皿行から当該クラスを外す（受け皿は空の `<td>` があれば足りる）。
気づく手段は手動確認 A-11 のみ。

### 開閉

状態は「開いている入れ子の参照」と「遅延クローズのタイマー」の2つだけ。

| 対象 | イベント | 動作 |
| --- | --- | --- |
| 親行 | `mouseenter` | タイマーを解除。開いていなければ描画する |
| 親行 | `mouseleave` | 遅延クローズを予約する |
| 入れ子本体 | `mouseenter` | タイマーを解除 |
| 入れ子本体 | `mouseleave` | 遅延クローズを予約する |

- 遅延クローズは **150ms**（`submenuCloseDelayMs`）。親行から入れ子へ移る途中の数 px の隙間や、
  親行の下端を横切る動きで閉じないようにするため。
  **「親行と入れ子の両方から外れて 150ms 経過」が閉じる条件**であり、`mouseleave` 単独では閉じない
- 開き直しのたびに DOM を作り直す。開いた状態を保持しない
- 親メニューが TradingView に閉じられたとき: 受け皿行ごと DOM から消えるため入れ子も消える。
  **拡張側の後始末は不要。** 予約済みタイマーが発火しても、detached な要素への `remove()` は無害

### 閉じる契機（Esc / 外クリック）

**拡張は `keydown` / `click` のリスナを `document` に追加しない。** TradingView 自身が
Esc キーと外クリックで親メニューを閉じ、それに伴って入れ子も消える（上記のとおり）。

| FR-18 判定基準 | 実現方法 |
| --- | --- |
| 8. Esc で閉じる | TradingView が親メニューを閉じる → 受け皿ごと入れ子が消える |
| 9. 外クリックで閉じる | 同上 |

- リスナを増やさない理由: 解除漏れが残ると、メニューを閉じた後もキー入力を拾い続ける（CON-03）
- **想定したリスクは顕在化しなかった。** 入れ子は `position: fixed` で視覚的には親メニューの外に出るため、
  TradingView の外クリック判定が座標ベースだと**項目をクリックした瞬間に親メニューが閉じて遷移できない**
  懸念があった。**未ログイン・ログイン（楽天証券）の両環境の実測（1.11.0 / 2026-08-23）で遷移できた**
  （`<a>` に仕込んだリスナで mousedown / mouseup / click がすべて発火し、`defaultPrevented: false`）ので、
  TradingView の判定は DOM の包含関係ベースと見てよい（入れ子は親メニューの子孫）。
  再発した場合は入れ子の `mousedown` で
  `stopPropagation()` する対処に切り替える

### 要件との対応

| FR-18 判定基準 | 満たす箇所 |
| --- | --- |
| 1. 直下は常に1行（区切り線を除く） | SPEC-CS-11「メニュー直下に追加する行」 |
| 2. ラベルが「`<code>` を開く」 | SPEC-CS-11。親行ラベル。銘柄名は出さない |
| 3. ホバーで入れ子が開く | 本節「開閉」 |
| 4. 入れ子の並び（証券会社 → 区切り線 → 情報サイト） | SPEC-CS-11「入れ子に出す項目」／SPEC-CS-18（オプションの並び順を保つ） |
| 5. クリックで新しいタブに開く | `<a target="_blank" rel="noopener noreferrer">` |
| 6. 0 件なら直下の1行ごと出さない | SPEC-CS-11「追加する順序と 0 件のときの扱い」 |
| 7. 収まらない場合は入れ子内をスクロールできる | 本節「配置」の補正3（`max-height` ＋ `{scrollWrap}` の `overflow-y: auto`） |
| 8. Esc で閉じる / 9. 外クリックで閉じる | 本節「閉じる契機」 |
| 10. 見た目が TradingView と揃う | SPEC-CS-16 の模倣用クラス＋本節「自前クラス」。判定は目視（A-10 / A-11） |

- 要件: FR-04, FR-06, FR-09, FR-18, CON-03, CON-08
- 検証: `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-11。見た目は A-10）

## SPEC-CS-18 TradingView: メニュー項目リストの生成

> 1.11.0 で新設（FR-18）。

メニューに並べる項目の決定を、DOM 生成から切り離した2つの関数にまとめる。
どちらも `{ title, url }[]` を返し、DOM を作らない。

### `makeLinkItemsAsync(code, type)` — 情報サイト

1. `getEnableLinkKeysAsync()`（SPEC-ST-01）で有効なキーを**設定された並び順のまま**取得する
2. `key` が `tradingview.com` で始まるものを除外する（TradingView 上で TradingView を開かない）
3. `externalUrlsMap[key]` が `undefined` のもの（**未知キー**）を落とす（後述）
4. `type === 'us'` のとき、**`url3` を持つサイトだけを残す**（FR-07）
5. 各要素を次の形にする

   | フィールド | 値 |
   | --- | --- |
   | `title` | `` `${item.title}で開く` `` |
   | `url` | `makeUrl(type === 'us' ? item.url3 : item.url1, code)` |

#### 未知キーのガード（NFR-05）

`chrome.storage.sync` に、`externalUrls` から削除済みの `key` が残っていることがある
（サイト廃止時。SPEC-ST-03）。`externalUrlsMap[key]` が `undefined` のまま `item.url1` を読むと
**`TypeError` で `addTickerMenuAsync()` が止まり、同期追加済みの3行が除去されずにメニューへ残る**。
「`7203` を開く ▶」が出るのにホバーしても何も開かない状態になる。

`item != null` で落とす。実測（2026-08-23）で、storage に未知キーを混ぜても
残りの項目が正しく並び、全滅した場合は3行が除去されることを確認した。

> **`linkMenu.js` は同じ問題を未ガードのまま抱えている**（SPEC-ST-03 の既知の弱点）。
> こちらは楽天証券・SBI証券の Content Script が停止する経路で、別タスク。

### `makeBrokerItemsAsync(code, type)` — 証券会社（FR-06）

| 順 | 問い合わせ | 出す条件 | `title` |
| --- | --- | --- | --- |
| 1 | `rakuten-sec:info`（`{ code, type }`） | `data.rakutenUrl` が非 null | `楽天証券で開く` |
| 2 | `naito-sec:info`（`{ code, type }`） | `type === 'jp'` かつ `data.naitoUrl` が非 null | `内藤証券で開く` |

- **米国株では内藤証券に問い合わせない**（内藤証券は国内株のみ。SPEC-SW-07）。
  現行の `addNewyorkTicker()` も問い合わせていない
- ログインしていなければ URL が返らず、項目が出ない（エラーを出さない。FR-06）

### 問い合わせのタイミング

**`:info` の問い合わせは右クリック時に行う。ホバー時ではない**（ADR-0003 の 3）。

| | 右クリック時（採用） | ホバー時 |
| --- | --- | --- |
| 発生回数 | 右クリック1回につき1〜2回 | 入れ子を開くたびに1〜2回 |
| 入れ子が開く速さ | 同期的に開ける（項目は保持済み） | 応答待ちのあいだ空になる |
| 0 件判定（SPEC-CS-11 の 4） | 右クリック時に確定する | 確定できない |

### SPEC-CS-12 との関係

「株Link」ボタンのメニュー（SPEC-CS-12）も同じ規則を必要とするが、**1.11.0 では移行していない**
（FR-18 のスコープ外。ADR-0003 の 5）。ボタン側が `makeLinkItemsAsync()` を使うようになった時点で、
FR-07 の既知の不整合（ボタンメニューが `url3` で絞らない）は自動的に解消する。
**移行は別タスク**であり、それまで SPEC-CS-12 の記述と手動確認 A-7b は現状のまま据え置く。

- 要件: FR-06, FR-07, FR-09, FR-18, NFR-05
- 検証: `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-7, A-11。
  未知キーのガードは storage に存在しない `key` を書き込んで右クリックする手順）

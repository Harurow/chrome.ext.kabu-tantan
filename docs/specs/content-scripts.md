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

| Content Script | 待機 | エントリポイント | MutationObserver |
| --- | --- | --- | --- |
| `rakuten-cs.js` | 500ms | `attachAsync` | なし |
| `rakuten-scr-cs.js` | 500ms | `attachAsync` | あり（`document.body`。SPEC-CS-08） |
| `sbi-cs.js` | 500ms | `attach`（※） | なし |
| `sbi-scr-cs.js` | **1500ms** | `attachAsync` | あり（`document.body`。SPEC-CS-10） |
| `tradingview-cs.js` | 500ms | `attach` | あり（`body` / オーバーレイ / canvas） |

固定待機はサイト側の描画完了を待つため。SBIスクリーナーは React 製で描画が遅く 1500ms。

※ `sbi-cs.js` のエントリポイントだけ `async` でありながら `Async` 接尾辞が無い
（命名規則からの逸脱。`CLAUDE.md`「命名規則」）。改名は利用者から見える変更が無いため別タスクとする。
仕様書には**実際の名前**を書く。

**5本すべて、エントリポイントの先頭に切断状態の門（`isExtensionAlive()`）を置く**（SPEC-CS-19）。
門を通らなければ DOM も監視も一切作らない。

**楽天・SBI の非スクリーナー2本には、もう1つ門がある**（1.17.0）。
有効な遷移先が0件（`keys.length === 0`）なら `retrySetup()` を始めずに打ち切る。
理由と、スクリーナー2本に置かない判断は SPEC-CS-26「注入件数と再試行の関係」。

> 固定待機だけでは、回線やマシンが遅いと注入に失敗する。**1.13.0 で再試行を入れた**（SPEC-CS-22）。
> 固定待機はそのまま残し、待機が明けた後に**成功するか 30 秒経つまで試し直す**（FR-13）。
> 上表の「待機」と「エントリポイント」は 1.12.2 から変えていない。

- 要件: FR-02, FR-03, NFR-09, FR-13, NFR-14
- 検証: `auto`（楽天・SBI の注入テスト）／`manual`（門は `docs/MANUAL-CHECKLIST.md` G）

## SPEC-CS-02 メニュー注入の手順

`attachMenu(element, keys, allowUs)`（楽天・SBI の4本すべて同じ形）

**先に2つの門を通す。どちらかに当たれば何もしない。**

| # | 門 | 何を防ぐか |
| --- | --- | --- |
| G1 | 対象要素が `span.x-kabu-root` の**内側**にある（`$(element).closest(…)`） | 注入したメニュー項目の `<a>` が検出用セレクタに再びヒットして入れ子に注入されること（1.13.0。FR-13 判定基準3） |
| G2 | 対象要素が `span.x-kabu-root` を**内側に持つ**（`$('span.x-kabu-root', element)`） | 同じ要素へ2つ目のメニューが入ること（1.17.0。**FR-28 判定基準10**） |

1. 要素のテキストから銘柄コードと市場を抽出（`matchInjectionTicker`。SPEC-TC-06 / SPEC-TC-10）。
   無ければ何もしない。`allowUs` は `menuSelectors` の `us === true` を渡す（SPEC-CS-26）
2. 要素の子ノードを走査し、**銘柄コードを含むテキストノード**を探す
3. **最初に見つかった1件**について `createMenu()` を呼び、`<span class="x-kabu-root">` で置換する。
   **項目が 0 件なら `null` が返るので置換しない**（SPEC-CS-06）
4. 置換の成否にかかわらず、そこで**打ち切る**（`break`。1行1メニュー）

テキストノードのみを対象とするため、既存の要素構造・イベントを壊さない。

> **G2 が要る理由（1.17.0 の実測。developer の発見）。** 手順 4 で打ち切るため、
> 同じコードが2回現れるセルでは**未置換のテキストノードが残る**。
> 楽天・SBI の注入パスは再試行（SPEC-CS-22）と `MutationObserver`（SPEC-CS-08 / SPEC-CS-10）で
> **繰り返し走る**ので、打ち切りだけでは**次のパスが2つ目を置換してメニューが2つになる**。
>
> **1.16.1 まではこう書いていた: 「置換後の子ノードはテキストノードではないので、
> 同じ要素を再走査しても2度目の置換は起きない」。これは打ち切りを入れた時点で成り立たない。**
> 二重注入の防止は G1・G2 の2つが担う（構造的な性質に頼らない）。
> **G2 を外すと `同じコードが2回現れるセルでもメニューは1つ` が落ちることを実測で確認済み。**

- 要件: FR-02, FR-03, CON-03, FR-13, FR-28
- 検証: `auto`（`楽天証券 Content Script › お気に入りの銘柄コードにリンクメニューを注入する` /
  `同じ銘柄コードに二重注入しない`（G1）/ `米国株の行への注入 › 同じコードが2回現れるセルでもメニューは1つ`（G2））

## SPEC-CS-03 メニューの DOM 構造

`linkMenu.js` の `createMenu(keys, code, text, nonStyle, type)`
（`type` は `'jp'` / `'us'`。既定は `'jp'`。1.17.0 で追加。SPEC-CS-06）

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
- `<li>` はインラインスタイルで `margin: 3px 6px`（**この隙間は押せない**。SPEC-CS-25 判定基準6）
- **元のテキストは `document.createTextNode()` で挿入する。**
  jQuery の `.append(文字列)` は文字列を HTML としてパースするため、
  対象サイト上の利用者入力（銘柄メモ等）に `<img onerror=…>` が含まれると
  証券会社のオリジンでスクリプトが実行されうる

> **項目のどこを押せるかは SPEC-CS-25**（FR-25）。`<a>` は `display: block` で `<li>` の
> 内容ボックスいっぱいに広がる（1.16.0）。DOM 構造・クラス名は変えていない。

- 要件: FR-02, FR-03, NFR-03
- 検証: `auto`（`メニュー項目が銘柄コード入りの外部リンクになっている`。
  **押せる範囲**は `メニュー項目のクリック範囲` の3件。SPEC-CS-25）

## SPEC-CS-04 メニューの開閉

`hover` で `<ul>` に `open` クラスを付け外しする。CSS 側で `display: none` / `block` を切り替える。

- **項目をクリックしてもメニューは閉じない**（ホバーが外れるまで開いたまま）。
  TradingView の右クリックメニューは閉じるが、**サイトによって正解が違う**ため揃えない
  （FR-25 判定基準4）
- 要件: FR-02, FR-03
- 検証: `auto`（`楽天証券 Content Script › ホバーでメニューが開く`。
  **クリックで閉じないこと**は `メニュー項目のクリック範囲 › 項目をクリックしてもメニューは閉じない`）

## SPEC-CS-05 外部リンクの属性

すべてのメニュー項目に `target="_blank"` と `rel="noopener noreferrer"` を付ける。

- 要件: NFR-03
- 検証: `auto`（`メニュー項目が銘柄コード入りの外部リンクになっている`）

## SPEC-CS-06 メニュー項目の遷移先 URL（国内株は `url1`、米国株は `url3`）

> 1.17.0 で改訂（FR-28）。1.16.1 までの題は「メニュー項目は国内 URL のみ」で、`url1` しか使わなかった。
> **同じ主題の改訂であって ID の再利用ではない。**

`createMenu(keys, code, text, nonStyle, type)` は、有効キーの並び順を保ったまま項目を組み立てる。

| `type` | 使う URL | 並ぶ遷移先 |
| --- | --- | --- |
| `'jp'` | `url1` | 有効な全キー（現行のまま） |
| `'us'` | **`url3`** | **`url3` を持つキーだけ**（現在6件） |

- **`url2` は使わない。** 注入経路は取引所を読み取らない（FR-28 判定基準 9。ADR-0014 の 6）
- `externalUrlsMap[key]` が引けないキー（storage に残った未知のキー）は**読み飛ばす**。
  現行は分割代入で例外になる
- **項目が0件なら `createMenu` は `null` を返す**（FR-28 判定基準 4）。呼び出し側は置換しない。
  TradingView 側の先例（遷移先が1つも無ければメニューも背景も出さない。SPEC-CS-11）に揃えた。
  国内株でも同じで、遷移先を全部無効にすると**空の箱が開く**現行の挙動が無くなる

> **右クリックと同じ URL になる。** 同じ文字列を選択して右クリックすると
> `getTickerCode` は `exchange` を返さず、`getUrl` は `url3` を選ぶ（SPEC-TC-05）。
> **注入メニューの `href` と右クリックで開く URL は文字列として一致する**（FR-28 判定基準 2）。

- 要件: FR-02, FR-03, FR-07, FR-28
- 検証: `auto`（`メニュー項目が銘柄コード入りの外部リンクになっている`＝国内株側。
  米国株側は SPEC-CS-26 のフィクスチャで、`getUrl('us', code, undefined, …)` の結果と突き合わせる）

## SPEC-CS-07 楽天証券の対象ページ（14セレクタ）

> **1.18.0 で米国株のお気に入り2ページを足して 12 → 14 にした**（FR-28。**適用範囲 a の訂正**。
> 2026-08-30 の実機確認）。**国内株のお気に入り2ページから `us: true` を外したのは 1.17.0**
> （レビューで前倒し。ADR-0014 の 9-1 / 9-2）。
>
> **1.18.1 でセレクタを実 DOM に合わせた。** 1.18.0 で入れた米国株2ページのセレクタは
> 国内株版の写しで、**2026-09-01 の実 DOM で3箇所とも外れていた**（ADR-0014 の 9-5）。
>
> **FR-28 の「やらないこと」と食い違う。** そこには「注入対象ページを増やすことは求めない
> （2026-08-30 に確定）」とあるが、**その確定は「お気に入りは混在する」という外れた前提の上に立っていた**。
> **要件の訂正は analyst が行う**（12ページを14にするか、米国株ページを検証ツールの対象外にするか。
> 依頼済み）。本仕様は実機で確かめた事実に従う。

`location.href` に `url` が含まれるものだけを適用する。

**`米` 列は米国株の抽出を許すエントリ**（`us: true`。1.17.0 で追加。SPEC-CS-26）。
**空欄は付けていない**（打ち消し線は使わない。版ごとの経過は SPEC-CS-26 の表）。

| 対象 | 米 | URL 部分一致 | セレクタ |
| --- | --- | --- | --- |
| お気に入り | | `/app/info_jp_prc_reg_lst.do;` | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |
| **お気に入り・米国株** | **✔** | `/app/info_us_prc_reg_lst.do;`（**実測**） | `table#pcmm-foreign-stock tr > td:nth-of-type(2) div.mbody`（**実測。2026-09-01**。SPEC-CS-26） |
| お気に入り編集 | | `/app/info_jp_prc_reg_lst_edit.do;` | `form table.tbl-data-01 td.align-C div.mbody nobr` |
| **お気に入り編集・米国株** | **✔** | `/app/info_us_prc_reg_lst_edit.do;`（**実測**） | 一覧ページと同じと**推測**（**⚠️ 実 DOM 未確認**。外れれば 0 件。SPEC-CS-26） |
| 保有商品一覧・すべて | **✔** | `/app/ass_all_possess_lst.do;` | `div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td`<br>`, div#table_possess_data table.tbl-bold-border tr > td:contains("米国株式") + td`（1.17.0 で追加。**ラベルは 2026-08-30 の実機で確認済み**） |
| 保有商品一覧・国内株式 | | `/app/ass_jp_stk_possess_lst.do;` | `table#poss-tbl-sp tr td table tr td nobr` |
| ランキング・売買代金 | | `/app/market_ranking.do;` | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・出来高 | | `/app/market_ranking_volume.do;` | 同上 |
| ランキング・値上り値下り | | `/app/market_ranking_change.do;` | 同上 |
| ランキング・信用残 | | `/app/market_ranking_debit.do;` | 同上 |
| ランキング・積立 | | `/app/market_ranking_reserve.do;` | `div#str-main-inner table table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・楽天内 | | `/app/market_ranking_rakuten.do` | `div#daily-ranking / #weekly-ranking / #daily-ranking-margin / #margin-oneday-ranking / #sor-ranking` の `table.tbl-data-01 tr td.align-C` |
| 国内株式・個別銘柄 | | `/app/info_jp_prc_stock.do` | `div#line1 h1.hdg-l1-01-title span:first` |
| 国内株式・株価検索 | | `/app/info_jp_prc_search.do` | 同上 |

`:contains()` と `:first` は jQuery 独自セレクタ（jQuery 4.0.0 でも利用可能）。
セレクタは `rakuten-cs.js` の `menuSelectors` が唯一の情報源（SPEC-SC-02）。

> **1.17.0 まではエントリを 12 件に保っていた**（保有商品一覧・すべては**カンマで足した**）。
> `scripts/selector-check/targets.mjs` と `key ?? title` で1対1に対応させてあるため
> （SPEC-SC-05）、件数を増やすと検証ツール側に追随が要るからである。
> 代償として、カンマを含むセレクタは「手がかり」で段階ごとに分解されない（ADR-0014 の 4）。
>
> **1.18.0 でこの前提は崩れた（ADR-0014 の 9-3）。** 米国株のお気に入りは**別 URL の別ページ**で、
> `url` がエントリごとに1つしか持てない以上**カンマでは足せなかった**。
> **エントリは 12 → 14 になり、`targets.mjs` も同版で追随した**（下記）。

### 12 → 14 の波及（1.18.0 で完了）

| 影響先 | 対応 |
| --- | --- |
| `scripts/selector-check/targets.mjs` | 楽天証券の対象を2件追加（`key` は `お気に入り・米国株` / `お気に入り編集・米国株`）。**どちらも `requiresUserData: true`**（登録0件を破損と誤報しない） |
| `tests/selector-defs.spec.mjs` | `EXPECTED_COUNTS['src/rakuten-cs.js']` を 14 に。1対1のテストは通る |
| `prepare` の文面 | 「お気に入り（**国内株・米国株の両方**）に1銘柄以上」に変更 |
| FR-12 / FR-23 | 「楽天証券の**全12ページ**」という数え方が **14** になる。**要件側の訂正は analyst に依頼済み** |
| 到達性 | 米国株のお気に入りも**ログインとポータル経由の到達**が要る（国内株版と同じ課題。検証ツールの方式見直しは別担当） |

- 要件: FR-02, FR-28
- 検証: `auto`（国内株のお気に入り ＋ **米国株のお気に入り2ページ**。SPEC-CS-26）／
  `半自動`（`npm run check:selectors`。**14ページ**の検出用セレクタの生存）

## SPEC-CS-08 楽天スーパースクリーナー

- 注入先: `https://hs.trkd-asia.com/rakutensecscr/*`（iframe、`all_frames: true`）
- セレクタ: `div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a`
- **`document.body` を `MutationObserver({ childList: true, subtree: true })` で監視**し、
  結果一覧の出現・ページ送りのたびに再注入する（`setupObserver()`）
- **コールバックは 200ms でデバウンス**する（`observerDebounceMs`）。
  デバウンスが明けて DOM を変える直前にも切断状態の門を置く（SPEC-CS-19）
- 監視の設置は `retrySetup()` 経由（SPEC-CS-22）。`document.body` は必ず取れるので実質初回で成功する
- 常設監視は打ち切らない。外すのは切断を検知したときだけ（SPEC-CS-19）
- 設置直後に初期パスを 1 回走らせる（`mutationObserverCallback(keys)`）
- `createMenu(..., nonStyle = true)` で呼び、`ul.x-kabu-body` に `margin-top: -3px` を追加する
  - **`createMenu` は `null` を返しうる**（項目0件。SPEC-CS-06）。
    本サイトだけが戻り値へ追加でスタイルを当てるため、**`null` を確かめてから触る**

> **1.12.2 まではこうではなかった（1.13.0 で変更。SPEC-CS-22 / FR-13）。** 監視対象は
> `div#resultpanel div.pagenavcontrolbox`、オプションは `{ childList: true }` のみで、
> **監視対象が見つからなければ何もせず終了していた**（`return`）。この `return` は廃止した。
>
> 理由: 人が検索を実行するのは実行直前で、**ページを開いてから検索するまでの時間に上限が無い**（FR-15）。
> 器（結果一覧）の出現を再試行（30 秒で打ち切り）で待つと間に合わず、
> タイマーは背景タブで丸められるため更に不利になる。`document.body` は `$()` の時点で必ず取れるので
> 空振りが消え、`MutationObserver` は背景タブでも丸められない（ADR-0008 の 3）。
>
> 注入パスは冪等なので、パス自身の DOM 変更が次のパスを呼んでも、そのパスは何も注入せず変更も生まない。
> **本サイトは実測で失敗していない**（注入 50 件）が、SBI銘柄スクリーニングと同じ仕掛けである以上
> 片方にだけ欠陥を残さない（FR-13 の適用範囲）。

- 要件: FR-02, FR-13
- 検証: `auto`（`スクリーナー Content Script › 楽天スーパースクリーナー: 後から現れた結果一覧に注入する`。
  固定待機の後に現れた結果一覧に注入し、2 度目の注入が起きないこと）／
  `半自動`（検索を実行した結果一覧のタブを開いたまま `npm run check:selectors`。
  検出用セレクタの生存）／`manual`（メニューの見た目・動作）

## SPEC-CS-09 SBI証券（2セレクタ）

URL による絞り込みは**行わない**。両セレクタを常に試す。

| 対象 | 米 | セレクタ |
| --- | --- | --- |
| 個別銘柄 | | `div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal` |
| ポートフォリオ | **✔** | `div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)` |

**`米` 列は米国株の抽出を許すエントリ**（`us: true`。1.17.0 で追加。SPEC-CS-26）。
**セレクタは変えていない。** 構造だけで拾っているので、外国株式の行が同じ表に並ぶなら既に届いている
（FR-28 適用範囲 c。**外国株式を保有していないと実画面で確かめられないため未確認のまま残す**）。

> ポートフォリオのセレクタは 1.12.1 まで `body.vsc-initialized` と空白で始まっていた。
> これは SBI証券が出力するクラスではなく、**Video Speed Controller（別の Chrome 拡張）が
> `<body>` に付けるクラス**で、当該拡張を入れていない環境では常に 0 件になっていた（CON-11）。
> **1.12.2 で先頭の `body.vsc-initialized` と直後の空白だけを削った。以降は 1 文字も変えていない。**
> 削った文字列は 2026-08-23 の実サイト実測で 24 件ヒットしている
> （3回目版 `git show e0d3c5e:docs/SELECTOR-CHECK.md`。SPEC-SC-13「引用にはリビジョンを添える」）。
> 同種の混入が他に無いことの点検と再発防止は SPEC-CS-21。

- 要件: FR-03, FR-21, FR-28, CON-11
- 検証: `auto`（`SBI証券 Content Script › ポートフォリオの銘柄コードにリンクメニューを注入する`。
  **フィクスチャ `SBI_PORTFOLIO_HTML` は素の `<body>`**（1.12.1 までの `<body class="vsc-initialized">`
  から当該クラスを外した）。付けたままだと依存が残っていてもテストが通り、FR-21 判定基準1 を担保できない）／
  `半自動`（`npm run check:selectors -- --only=sbi`。ポートフォリオが ✅ かつ「注入」が 1 件以上。
  `reach: 'tab'` の対象で、人が先に開いたページを見るため固定待機と競合しない。
  4回目版の実測は識別 1 / ヒット 24 / **注入 2**。「注入」列を条件にしてよい対象の切り分けは SPEC-SC-09）／
  `manual`（**株リンク以外の拡張機能を入れていない Chrome** での目視。FR-21 判定基準1・2）

## SPEC-CS-10 SBI銘柄スクリーニング

- 注入先: `https://graph.sbisec.co.jp/sbiscreener/*`（iframe、`all_frames: true`）
- セレクタ: `div#root div.App div.Screener div.resultpane div.ResultListMainDiv table.leftTable tr td.c.fixedtable:nth-of-type(1)`
- **`document.body` を `MutationObserver({ childList: true, subtree: true })` で監視**して再注入する。
  デバウンス・再試行経由の設置・切断時のみ外すこと・初期パスは SPEC-CS-08 と**同一の作り**
  （`setupObserver()` / `observerDebounceMs` / `mutationObserverCallback()`）

> **1.12.2 まではこうではなかった（1.13.0 で変更。SPEC-CS-22 / FR-13）。** 監視対象は
> `div#root div.App div.Screener div.resultpane` で、無ければ `return` していた。
> 理由と代償は SPEC-CS-08 の同じ注記（ADR-0008 の 3）。
>
> **1.12.2 までの注入 0 件の実測はここに帰着する。** 1500ms の固定待機の時点で `div.resultpane` が無いと
> 監視を張らずに `return` するため、その後どれだけ検索・ページ送りしても注入されなかった
> （2026-08-23 / 2026-08-24 の 2 日とも ヒット 50 / 注入 0。FR-12「注入 0 件の切り分け」）。
> **実サイトでの再確認は済んでいない**（FR-13 判定基準5 の連続 2 回。SPEC-SC-25）。

- 要件: FR-03, FR-13
- 検証: `auto`（`スクリーナー Content Script › SBI銘柄スクリーニング: 後から現れた結果一覧に注入する`。
  上記「注入 0 件」の経路の回帰テスト）／
  `半自動`（検索を実行した結果一覧のタブを開いたまま `npm run check:selectors`。
  検出用セレクタの生存）／`manual`（メニューの見た目・動作）

## SPEC-CS-11 TradingView: 右クリックメニュー拡張

> 設計判断は [ADR-0003](../adr/0003-tradingview-submenu.md)。2026-08-23 の DOM 改修への追随は [ADR-0002](../adr/0002-tradingview-dom-repair.md)。

使うセレクタは `menuSelectors`（SPEC-CS-15）から `selectorOf('overlap-root')` /
`selectorOf('context-menu')` で引く。

1. `body` を監視して `div#overlap-manager-root` の生成を待つ
2. 生成されたら、そのレイヤーの `childList` を監視する
3. `document` の `contextmenu` を**キャプチャ段階**で監視し、発生元が有効な起点（ウォッチリストの行 / チャート）なら起点と発生時刻を保持する（後述「起点の判定」・SPEC-CS-23）
4. メニューが作られるたびに `attachMenu()` を呼ぶ
5. `attachMenu()` は次を上から順に判定し、1つでも満たさなければ **DOM を一切変更しない**

   | # | 条件 | 満たさないとき |
   | --- | --- | --- |
   | 1 | `isExtensionAlive()` が真（SPEC-CS-19） | 何もしない（切断状態。NFR-14） |
   | 2 | `selectorOf('overlap-root')` がちょうど1件 | 何もしない |
   | 3 | `tr[data-kabu-tantan]` が0件 | 何もしない（二重追加の防止。後述） |
   | 4 | 直近 1500ms 以内に**有効な起点で** `contextmenu` が発生している（`contextMenuOrigin`） | 何もしない |
   | 5 | `selectorOf('context-menu')` が1件以上 | 何もしない。2件以上なら**先頭の1件だけ**を対象にする |
   | 6 | 起点に応じた銘柄が取れる（行なら記録済みの `code`、チャートなら `getTickerCode()`。SPEC-CS-23） | 何もしない（区切り線も追加しない） |

   > 条件 4・6 は 1.15.0 で FR-19 に合わせて広げた（SPEC-CS-23）。条件 1・2・3・5 と手順 6 は変えていない。
   >
   > 条件1 は起動時の門（SPEC-CS-01）とは別に、メニューが作られるたびに評価する。
   > ページを開いた後に拡張機能が更新される経路がこれで塞がる（SPEC-CS-19）。

6. 満たしたら `addTickerMenuAsync(ctxMenu, code, type)` を呼ぶ

### メニュー直下に追加する行

> **追加した分だけメニューは下へ伸びる。** 画面の下寄りで右クリックすると
> ウィンドウの外にはみ出すため、縦位置を補正する（**SPEC-CS-24**。FR-24。1.16.0）。

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
- **入れ子の中の `<tr>` に `data-kabu-tantan` を付けてはならない。** 条件3 の判定は
  `$('tr[data-kabu-tantan]')` の document 全体検索なので、付けると入れ子を閉じるまで
  次の右クリックで拡張されなくなる

> 手順 2（証券会社）と 3（情報サイト）の取得は `Promise.all` で**並行**に行う。どちらかが失敗すればまとめて後始末する（下記）。
> `allSettled` にしない理由は SPEC-CS-12 の「`Promise.all` の前提」と同じ。

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

**メニューのテキストを読まない。** 起点で決まる（SPEC-CS-23）。

| 起点 | 取得元 |
| --- | --- |
| チャート | チャート canvas の `aria-label`（`getTickerCode()` → `parseExchangeSymbol()`。SPEC-TC-07） |
| ウォッチリストの行（1.15.0〜） | 右クリック時に記録済みの `code` / `type`（行の属性を同じ `parseExchangeSymbol()` で解釈した結果） |

以下はチャート起点の経緯（1.10.1 の変更）。

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

> **1.15.0 で FR-19 に合わせて拡張した。** 判定の全体は
> [SPEC-CS-23](#spec-cs-23-tradingview-ウォッチリストの行からの右クリックfr-19)。
> 本節は SPEC-CS-11 側から見た要約に留める。

旧実装は「メニュー1行目が銘柄コードで始まるか」が**結果的にフィルタ**として働き、
チャートの右クリック以外で開くメニューには項目を追加しなかった。
取得元を canvas に移すとこのフィルタが消えるため、**代わりに起点で絞る**。

- `document` の `contextmenu`（`capture: true`）で受け、`resolveContextMenuOrigin(e.target)` が
  **行 → チャート → 捨てる**の順に起点を解決する（SPEC-CS-23）
- 記録は `contextMenuOrigin`（`{ kind, at, code, type }`）**1件のみ**。
  有効な起点でなければ `at: 0` にして**それまでの記録を捨てる**

  | 発生元 | `kind` | `at` |
  | --- | --- | --- |
  | ウォッチリストの行（銘柄を解釈できた） | `'row'` | `Date.now()` |
  | ウォッチリストの行（解釈できない。指数・FX 等） | `null` | **`0`** |
  | チャート（`div.chart-gui-wrapper` の内側） | `'chart'` | `Date.now()` |
  | ツールバー・銘柄検索・余白 | `null` | **`0`** |

  捨てるのが必須。上書きしないと「有効な起点を右クリック → 1.5秒以内に別の場所を右クリック」で
  前の銘柄のリンクが出る
- `attachMenu()` は記録した時刻が **1500ms 以内**のときだけ動く（`contextMenuGraceMs`。
  チャート・行で共通の1定数）
- ツールバー・銘柄検索・行を特定できない余白から開いたメニューには追加しない。
  それらは銘柄を特定できず、**別銘柄のリンクを出してしまう**ため（FR-04）

`div.chart-gui-wrapper` は `chart-canvas` セレクタ（SPEC-CS-15）と同じ、ハッシュを含まないクラス。
行の目印（`watchlistSymbolAttrs`）ともども、検出用セレクタとしては括り出さない
（`menuSelectors` に足すと SPEC-SC-02 の対象が増え、`targets.mjs` にページ識別セレクタの追加が要るため。
ADR-0002 の 3 ／ ADR-0010 の 6）。

### 二重追加の防止

条件3 の目印 `tr[data-kabu-tantan]` は**区切り行に付ける**（現行から変えない。
`npm run check:selectors` の「注入」列がこの属性を数えるため。SPEC-SC-09）。

`addTickerMenuAsync()` は、設定の読み出し・`:info` メッセージの `await` に入る**前に**、
区切り行・親行・受け皿行の3行を同期的に追加する。

`await` の後に追加すると、同じ `MutationObserver` のバッチで `attachMenu()` が2回呼ばれたとき、
2回目が条件3 をすり抜けて項目が二重に並ぶ。**同期的に追加することで2回目を即座に弾く。**

> 親行のラベルに必要なのは `code` だけで、これは条件6 の時点で確定している。
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
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-5, A-6, A-7, A-9, A-10, A-11。
  ウォッチリスト起点は A-13〜A-17。SPEC-CS-23）

## SPEC-CS-12 TradingView: 「株Link」ボタン

> 2026-08-23 の DOM 改修に追随して挿入先を差し替えた（1.10.1）。SPEC-CS-11 と同じ経緯。
> 1.12.0 で「メニューの組み立て」を FR-07 / NFR-14 に合わせて作り直した。

`selectorOf('toolbar-container')`（`div.container-OH8c8Nc3`。SPEC-CS-15）の下に
`<div>`（模倣用クラス。SPEC-CS-16）を挿し、その中にボタンを置く。

- クラス: `ktt-tv-kabuLinkMenu`
- クリックで `openKabuLinkMenuAsync(x, y)` を呼ぶ。メニューと背景 `ktt-tv-menuBack` は
  **問い合わせが終わってから**作る（後述「メニューの組み立て」）
- 背景クリックまたはキー入力でキャンセルする
- チャートの `canvas`（`selectorOf('chart-canvas')`）の属性変化を監視し、
  銘柄コードが取れないときはボタンを隠す

### ボタンの注入（起動時）

> 1.13.0 で**再試行単位**に変えた（SPEC-CS-22 / FR-13）。1.12.2 までは `attach()` の中で
> `selectorOf('chart-canvas')` が 1 件以上あるときだけ 1 回試し、挿入先（`toolbar-container`）が
> 0 件なら `appendTo()` が黙って何もしないまま終わっていた。

`attach()` は `retrySetup(setupKabuLinkMenu)` を呼ぶ。`setupKabuLinkMenu()` が
**canvas 監視とボタンの設置を 1 単位**で行い、両方が揃うまで 500ms ごとに試し直す（30 秒で打ち切り）。

| # | `setupKabuLinkMenu()` の手順 | 満たさないとき |
| --- | --- | --- |
| 1 | `$('.ktt-tv-kabuLinkMenu').length > 0` なら**設置済み**として `true` を返す（二重注入の防止。FR-13 判定基準3） | 未設置なので手順 2 へ |
| 2 | `$(selectorOf('chart-canvas'))[0]` と `$(selectorOf('toolbar-container'))[0]` を取る | どちらかが `undefined` なら `false`（再試行に回す） |
| 3 | canvas を `MutationObserver({ attributes: true })` で監視する | — |
| 4 | `createKabuLinkMenu(container)` で `buttonsWrapper`（模倣用クラス）と `div.ktt-tv-kabuLinkMenu` を DOM に追加し、`true` を返す | — |

- **canvas 監視とボタンは 1 単位。** 分けると「ボタンはあるが銘柄切替に追随しない」状態が作れてしまい、
  **FR-13 判定基準6 が落ちたまま判定基準5 を通る**（判定基準5 は注入された要素の数しか見ない）。
  1 単位にすると「ボタンがあるなら canvas 監視もある」が構造的な不変条件になる（ADR-0008 の 4）
- `createKabuLinkMenu(container)` は**確認済みの `container` を受け取る**。
  空集合への `appendTo()` で黙って失敗する経路は無い。**この関数は chrome API を触らない**
- **本項が解くのは「起動時に一度も作られない」経路だけ。** 下の「既知の制限（ボタンの消失）」
  （一度作られた後に消える）は解かない（ADR-0008 の 4 の末尾）

> **挿入先が複数ある場合の振る舞いが 1.13.0 で変わった（未確認）。** `container` を
> `$(selectorOf('toolbar-container'))[0]` で**先頭 1 件**に絞るため、`div.container-OH8c8Nc3` が
> 2 件以上あるページではボタンが**先頭のツールバーにだけ**付く。1.12.2 までは jQuery の
> `appendTo(集合)` が要素を複製して**全件**に付けていた。実測は 4 版とも ヒット 1 件のため
> 現物での差は観測されていない。**手動確認 A-12 の「2つ以上並んでいないか」は重複しか見ず、
> この逆方向（付くべき 2 つ目が付かない）は検出しない。** 複数ヒットが観測されたら、
> どちらが正しいかを要件（FR-04）に戻して決める。

切断状態では注入しない。判定は `attach()` の先頭の門（SPEC-CS-01 / SPEC-CS-19）が行う。
注入時点で門を通していないと、押しても何も起きないボタンが恒久的に残る
（`openKabuLinkMenuAsync` の門が効くため無反応。NFR-14 判定基準2 に抵触）。

> 判断の根拠は [ADR-0005](../adr/0005-disconnected-tab-guard.md) の 6。

### メニューの組み立て（FR-07 / NFR-14）

ボタンのクリックハンドラは `openKabuLinkMenuAsync(x, y)` を呼ぶだけで、非同期処理はその関数に閉じる。
`openKabuLinkMenuAsync()` は次の順に進む。**`await` が終わるまで DOM を一切変更しない。**

| # | 手順 | 満たさないとき |
| --- | --- | --- |
| 1 | `getTickerCode()`（SPEC-TC-07）が `code` を返す | 何もしない |
| 2 | `isExtensionAlive()` が真（SPEC-CS-19） | 何もしない（切断状態。NFR-14） |
| 3 | 証券会社に問い合わせる（`queryBrokerAsync()`。下記「証券会社の項目」） | 例外なら何もしない（NFR-14） |
| 4 | `makeLinkItemsAsync(code, type)`（SPEC-CS-18）で情報サイトの項目を得る | 例外なら何もしない（NFR-14） |
| 5 | 3 と 4 が**どちらも 0 件**なら何もしない | — |
| 6 | 背景 `ktt-tv-menuBack` を敷き、メニュー本体を組み立てて表示する | — |

- **手順 3・4 の前に背景・メニューを作らない。** 1.11.0 までは背景を先に敷いてから `await` していたため、
  切断状態では例外で処理が止まり、**透明な全画面レイヤーが残ってページのクリックを吸っていた**（NFR-14 判定基準2）
- 手順 3・4 は `Promise.all` で**並行**に実行し、全体を1つの `try` で囲む（網。SPEC-CS-19）
- 手順 5 は FR-07 の絞り込みで新たに到達しうる状態。
  米国株を表示し、`url3` を持つサイトをすべて無効にし、かつ証券会社が未ログインだと 0 件になる。
  この場合に空のメニューを出さない（SPEC-CS-11 の 0 件時の扱いと揃える）
- 見た目・開閉の作り（`ktt-tv-menuBack` / `tvMimicClasses` による `menuWrap` → `scrollWrap` → `menuBox` → `table`）は変えない。
  入れ子化（SPEC-CS-17）はしない（FR-07「やらないこと」）
- 項目の `<tr>` は `makeButtonMenuItem(title)` が作る（右クリック側の `makeMenuItem()` とは別関数。
  ボタン側の項目は `<a href>` を持たず、ラベルだけを置いてクリックハンドラで開く）

#### クリックハンドラの拒否の扱い

**jQuery はクリックハンドラの返り値の Promise を見ない。** 非同期関数を呼ぶハンドラは
**すべて** `.catch(() => {})` で拒否を握る。握らないと切断状態などで
`Unhandled promise rejection` が他社サイトのコンソールに出る（NFR-14 判定基準1）。

| ハンドラ | 呼ぶ関数 | 握る場所 |
| --- | --- | --- |
| 「株Link」ボタン | `openKabuLinkMenuAsync(x, y)` | ハンドラ内 |
| メニュー項目「楽天証券を開く」 | `openBrokerAsync('rakuten-sec:open', …)` | ハンドラ内 |
| メニュー項目「内藤証券を開く」 | `openBrokerAsync('naito-sec:open', …)` | ハンドラ内 |
| メニュー項目（情報サイト） | `openUrlAsync(item.url)` | ハンドラ内 |

呼ばれる側（`openBrokerAsync()` / `openUrlAsync()`）にも `try` / `catch` の網があるが、
**握る場所を呼び出し側にも置く**。網より外側で拒否が起きた場合を拾えないため。

#### `Promise.all` の前提

`Promise.all` は**片方が失敗すると両方の結果を捨てる**。証券会社の応答が取れないだけで
情報サイトの項目まで出なくなる。現状これを許容できるのは、Service Worker が
`rakuten-sec:info` / `naito-sec:info` で**ネットワークを叩かず、開いているタブの URL
（`chrome.tabs.query`）しか読まない**ため（SPEC-SW-06 / SPEC-SW-07）。
情報サイト側も `chrome.storage.sync` を読むだけ（SPEC-CS-18）。
残る失敗要因は「切断状態」だけで、そのときは両方が同時に失敗する。

| 変更 | 必要な対応 |
| --- | --- |
| `queryBrokerAsync()` 側にネットワーク取得が入る | `Promise.allSettled` に分け、**取れた側だけでメニューを組む** |
| `makeLinkItemsAsync()` 側にネットワーク取得が入る | 同上 |

右クリックメニュー（SPEC-CS-11 手順2・3）も同じ前提に立つ。`src/tradingview-cs.js` の
該当箇所にこの注意をコードコメントとして残してある。

#### 情報サイトの項目

`makeLinkItemsAsync(code, type)`（SPEC-CS-18）の戻り値をそのまま項目にする。
キーを自前で走査していた 1.11.0 までの実装を置き換えた。

| 観点 | 1.11.0 まで | 1.12.0 |
| --- | --- | --- |
| 米国株の絞り込み | しない。`url3` を持たないサイトも並び、クリックすると `makeUrl(undefined, code)` が例外になり何も開かない | `url3` を持つサイトだけを残す（FR-07 判定基準1） |
| 未知キー（storage に残った廃止済み `key`） | `externalUrlsMap[key]` が `undefined` のまま `item.title` を読み `TypeError` になる | 落とす（NFR-05。SPEC-CS-18 の未知キーのガード） |
| `tradingview.com` の除外 | する | する（変更なし） |
| 並び順 | オプションの並び順（SPEC-ST-01） | 同じ（変更なし。FR-07 判定基準3） |
| ラベル | `` `${item.title}で開く` `` | 同じ（変更なし） |
| `makeUrl()` の評価時点 | クリック時 | **メニュー組み立て時**（`makeLinkItemsAsync` が返す `url` を使う） |
| クリック時の動作 | `open-url` メッセージを送る | 同じ（送る `url` が組み立て済みになるだけ）。切断状態では送らない（SPEC-CS-19） |

右クリックメニュー（SPEC-CS-11）と**同じ関数**を使うため、
「同じ銘柄でボタンと右クリックの情報サイト項目が同じ集合・同じ順序になる」（FR-07 判定基準4）が
実装の構造として保証される。並びの一致を別に検査する仕掛けは持たない。

#### 証券会社の項目（**変えない**）

FR-07「やらないこと」に従い、**ラベル・開き方・未ログイン時の振る舞いを変えない**。
`makeBrokerItemsAsync()`（SPEC-CS-18）に寄せ**ない**。理由は右クリック側と作りが違うため。

ただし手順 6 で DOM を作るには、**「問い合わせ（手順 3）」と「項目の DOM 生成（手順 6）」を分ける**必要がある。
1.11.0 までは `:info` の応答を見たその場で項目を `appendTo(tbody)` しており、`tbody` の存在が前提だった。
手順 3（`queryBrokerAsync()`）は**応答（`rakutenUrl` / `naitoUrl` が非 null か）だけを返し、DOM を作らない**。
クリック時に `:open` を送って `alert()` を出す作りはそのまま残す
（`openBrokerAsync()`。切断状態では送らない。SPEC-CS-19）。

| 観点 | ボタン（1.11.0 から変えない） | 右クリック（`makeBrokerItemsAsync`） |
| --- | --- | --- |
| ラベル | `楽天証券を開く` / `内藤証券を開く` | `楽天証券で開く` / `内藤証券で開く` |
| 開き方 | クリック時に `rakuten-sec:open` / `naito-sec:open` を送る | 取得済み URL を `open-url` で開く |
| 未ログイン時 | `:open` の応答が `null` なら `alert()` を出す | 項目自体が出ない |
| 米国株での内藤証券 | **問い合わせる**（`type` を渡すので URL は返らない） | 問い合わせない |

> ラベルと開き方を揃えるのは**別タスク**。要件（FR-07「やらないこと」）で明示的にスコープ外にしてある。
> 寄せると未ログイン時の `alert()` が消えるという利用者から見える変更になるため、要件の再確認が要る。

#### 区切り線

区切り線は「証券会社の項目が1件以上**かつ**情報サイトの項目が1件以上」のときだけ出す。
1.11.0 までは情報サイト側の件数を見ていなかったが、手順 4 の絞り込みで情報サイトが 0 件になりうるため、
**末尾に区切り線だけが残る**状態を防ぐ（SPEC-CS-11 の入れ子と同じ規則）。

生成は `makeMenuSeparator()`（SPEC-CS-11 / SPEC-CS-17 と同じ関数）に寄せた。
**DOM は 1.11.0 と完全に同一ではない。** `makeMenuSeparator()` はテンプレート文字列が複数行のため、
`<tr>` / `<td>` の中に**空白テキストノードが入る**（1.11.0 の直書きは1行で空白ノードが無かった）。
`<tr>` / `<td>` / `<div>` の構成とクラスは同じで、**描画結果は変わらない**（2026-08-23 reviewer 検証）。

### 挿入先が見えない場合の扱い

`div.container-OH8c8Nc3` は買/売ボタンを内包するツールバーで、**未ログインでは
子要素に `blockHidden-wVrpb0RA` が付き、コンテナ自体の幅・高さが 0** になる（2026-08-23 実測）。

| 観点 | 判定手段 |
| --- | --- |
| 挿入先が存在するか | `npm run check:selectors -- --only=tradingview`（ログイン不要） |
| ボタンが**見えるか** | 手動確認 `docs/MANUAL-CHECKLIST.md` A-1（**TradingView にログインして実施する**） |

セレクタがヒットしていてボタンが見えない場合、原因は挿入先の選択であって
セレクタの破損ではない。挿入先の見直しが要る（ADR-0002 の 4 に候補を残す）。

#### 「注入」列を判定条件にしない

`npm run check:selectors` の「注入」列（TradingView は `div.ktt-tv-kabuLinkMenu`）は
**ボタンが実際に作られたか**を数える参考値で、セレクタの健全性とは独立に 0 件になる。

| 版 | `toolbar-container` のヒット | 注入 | 読み |
| --- | --- | --- | --- |
| 1回目版（1.10.0 / `6fb2511`） | **0**（旧セレクタが破損） | 0 | セレクタ破損。挿入先が無いので当然 |
| 2回目版（1.11.0 / `fcd0d9a`） | 1 | 1 | 正常 |
| 3回目版（1.12.1 / `e0d3c5e`） | 1 | 1 | 正常 |
| 4回目版（1.12.2 / 本コミットの `docs/SELECTOR-CHECK.md`） | 1 | **0** | **セレクタは健全。注入だけが空振り** |

4回目版が 0 件になった理由は、**1.12.2 までの** `createKabuLinkMenu()` の起動方式にある。

1. `$(() => setTimeout(attach, 500))` で**500ms 後に1回だけ**走った（SPEC-CS-01）
2. `attach()` は `selectorOf('chart-canvas')` が 0 件なら `createKabuLinkMenu()` を呼ばなかった
3. 呼ばれても `appendTo($(selectorOf('toolbar-container')))` は空集合なら黙って何もしなかった
4. どちらの空振りも**再試行しなかった**（FR-13 未達）

**1.13.0 でこの 4 点はすべて解消した**（上の「ボタンの注入（起動時）」）。
それでも本節を残すのは、実サイトでの再測（FR-13 判定基準5）がまだ済んでいないため。

同じ実行で右クリックメニューは注入 1 件（`tr[data-kabu-tantan]`）。
そちらは `MutationObserver` でメニューが開くたびに走るため、拡張機能が生きていること・
設定が空でないこと・銘柄コードが取れることが確定している。
`src/tradingview-cs.js` は 1.12.0 以降無変更で、**退行ではない**。

したがって「注入 1 件以上」は **FR-13 判定基準5 の合格を確認するまで条件にしない**。
半自動で見るのは `toolbar-container` が ✅ になること（＝挿入先が存在すること）までとし、
**ボタンが実在するか・見えるかは手動確認 A-1 で見る**（SPEC-SC-09 / SPEC-SC-18 も同じ扱い）。

> **SPEC-CS-22（1.13.0）で前提が変わった。** FR-13 判定基準5 (a) は
> TradingView の 3 対象が**連続 2 回とも注入 1 件以上**になることを求めており、
> 再試行が入ったことでそれが満たせるようになった（**実サイトでの確認は未実施**）。
> **本節の検証欄は FR-13 判定基準5 の合格を確認するまで変えない**
> （変えるのは FR-13 判定基準5 の合格を確認した後。判定・終了コードに「注入」列を使わない方針
> （SPEC-SC-09）は FR-12 側の判断であり、本節の変更では動かさない）。

- 要件: FR-04, FR-06, FR-07, FR-09, NFR-05, NFR-14, CON-08
- 検証: `半自動`（`npm run check:selectors -- --only=tradingview` で `toolbar-container` が ✅。
  **判定条件はこれだけで、「注入」列は条件にしない**。理由は直前の節）／
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-1〜A-4, A-7b, A-8, A-9。
  切断状態は G-2（メニューを出さない）・G-5（ボタンを注入しない））

#### FR-07 の手動確認手順

実施用の手順は `docs/MANUAL-CHECKLIST.md` **A-7b**（1.12.0 で書き換え済み）。下表はその根拠。

| # | 操作 | 期待 |
| --- | --- | --- |
| 1 | `TSE:7203` を表示して「株Link」を押す | 有効にした情報サイトが**すべて**並ぶ（現行と同じ一覧。判定基準2） |
| 2 | 1 の並びをオプションページの並び順と見比べる | 一致する（判定基準3） |
| 3 | 同じ状態でチャートを右クリックし、入れ子の情報サイト項目と 1 を見比べる | **同じ集合・同じ順序**（判定基準4） |
| 4 | `NASDAQ:AAPL`（未ログインでは `BATS:AAPL`）を表示して「株Link」を押す | `url3` を持つサイトだけが並ぶ。`url3` を持つのは6サイトだが自サイト（`tradingview.com/chart`）が除外され、2026-08-23 実測では **5件**（判定基準1。除外は SPEC-CS-18 の 2・4） |
| 5 | 4 の各項目をクリックする | すべて新しいタブでその銘柄のページが開く。**何も開かない項目が 0 件**（判定基準1） |
| 6 | 4 の状態で右クリックの入れ子と見比べる | 同じ集合・同じ順序（判定基準4） |
| 7 | 米国株を表示し、TradingView で並ぶ5サイト（`url3` を持つのは6サイトだが `tradingview.com/chart` は除外される。SPEC-CS-18 の 2・4）をオプションですべて無効にして「株Link」を押す（未ログイン） | メニューも背景も出ない。ページのクリックが吸われない |

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
- **これとは別に、4回目版（2026-08-24 23:16 / 1.12.2）で注入 0 件が観測された**
  （上の「「注入」列を判定条件にしない」）。こちらは**起動時に一度も作られなかった**場合で、
  「一度作られた後に消える」本項とは別経路。**どちらもリトライ・再注入が無いこと（FR-13）に帰着する。**
- **SPEC-CS-22（1.13.0）が解いたのは後者だけ。** 「起動時に一度も作られない」は再試行で解けるが、
  本項（一度作られた後に消える）はタブの寿命いっぱいの常設監視が要り、別タスクのまま残る。
  **FR-13 の実装後にボタンの消失が再発したら、本項を起点に調査する**（ADR-0008 の 4）

### 既知の制限（証券会社と情報サイトが心中する）

手順 3・4 は `Promise.all` なので、**片方が失敗するとメニューごと出ない**。

| 観点 | 内容 |
| --- | --- |
| 現状で実害が無い理由 | `queryBrokerAsync()` が呼ぶ Service Worker は `chrome.storage` と `chrome.cookies` しか触らず、ネットワークを叩かない。失敗する経路は切断状態だけで、そのときは情報サイト側（`chrome.storage.sync`）も同時に失敗する |
| 破れる条件 | 証券会社側にネットワーク取得（HTTP リクエスト）が入ったとき。証券会社サイトの不調でメニュー全体が出なくなる |
| そのときの直し方 | `Promise.allSettled` に分け、**成功した側だけで**メニューを組み立てる |

**現時点では `Promise.all` のままとする**（分けると 0 件判定と後始末の分岐が増え、
今は起こらない事象のために複雑さを先払いすることになるため）。`src/tradingview-cs.js` の
該当箇所にこの条件をコメントで残してある。

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
**置換箇所は6箇所**（`setupKabuLinkMenu()` ×2 / `bodyObserverCallback()` / `attachMenu()` ×2 /
`getTickerCode()`）。1.12.2 までは `attach()` と `createKabuLinkMenu()` に 1 箇所ずつあったが、
1.13.0 で両方 `setupKabuLinkMenu()` に移した（SPEC-CS-12）。

### `context-menu` をハッシュ非依存にした理由

`context-menu` は TradingView 側でハッシュを付けずに使われている**意味のあるクラス**で、
`menu-IqFTXspI` / `menuWrap-lBIxIwtz` のようなビルド由来の識別子と違い、
リリースのたびには変わらない。中間の `div[data-name="menu-inner"]` は現行 DOM から消えており、
実経路（`div.context-menu > div.scrollWrap-… > div.menuBox-… > table`）は
ハッシュ2つに依存する。子孫結合子まで緩めて `div.context-menu table` にする。

代償: 入れ子メニュー等で 2 件以上ヒットしうる。**先頭の1件だけを対象にする**（SPEC-CS-11 の条件5）。

- **模倣用クラス**（`item-WSeXSXQB` 等）は `menuSelectors` に入れない。検証対象外（FR-12）。
  定義場所は SPEC-CS-16
- `menuSelectors` は `tradingview-cs.js` 内で実際に使われる。検証専用の定数ではない（FR-12「やらないこと」）

- 要件: FR-04, FR-12, NFR-13
- 検証: `auto`（SPEC-SC-16 の `セレクタ定義` 8件）／
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
>
> **項目のクリック範囲は SPEC-CS-25**（FR-25。1.16.0）。行のどこを押しても文字の上と同じ結果になる。

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
  1.10.0 までの `addNewyorkTicker()` も問い合わせていなかった
- ログインしていなければ URL が返らず、項目が出ない（エラーを出さない。FR-06）

### 問い合わせのタイミング

**`:info` の問い合わせは右クリック時に行う。ホバー時ではない**（ADR-0003 の 3）。

| | 右クリック時（採用） | ホバー時 |
| --- | --- | --- |
| 発生回数 | 右クリック1回につき1〜2回 | 入れ子を開くたびに1〜2回 |
| 入れ子が開く速さ | 同期的に開ける（項目は保持済み） | 応答待ちのあいだ空になる |
| 0 件判定（SPEC-CS-11 の 4） | 右クリック時に確定する | 確定できない |

### SPEC-CS-12 との関係

`makeLinkItemsAsync()` は**右クリックメニューとボタンメニューの共有**とする（FR-07）。

| 関数 | 右クリック（SPEC-CS-11） | ボタン（SPEC-CS-12） |
| --- | --- | --- |
| `makeLinkItemsAsync()` | 使う | **使う**（1.12.0 で移行） |
| `makeBrokerItemsAsync()` | 使う | **使わない**（証券会社の項目はスコープ外。SPEC-CS-12。ボタン側は `queryBrokerAsync()`） |

1.11.0 ではボタン側が未移行で、FR-07 の「米国株に対応しないサイトを出さない」を満たしていなかった。
1.12.0 の移行でこの不整合と未知キーの `TypeError`（NFR-05）が同時に解消した。
移行にあたり `makeLinkItemsAsync()` の**引数と戻り値は変えていない**。ボタン側の都合で分岐を足さない。

- 要件: FR-06, FR-07, FR-09, FR-18, NFR-05
- 検証: `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-7, A-11。
  未知キーのガードは storage に存在しない `key` を書き込んで右クリックする手順）

## SPEC-CS-19 切断状態（Extension context invalidated）での振る舞い

> 1.12.0 で新設（NFR-14）。設計判断は [ADR-0005](../adr/0005-disconnected-tab-guard.md)。

拡張機能を更新・再読み込みすると、それ以前に開いていたタブの Content Script は
拡張機能本体から切り離される（以下**切断状態**）。切断状態では Content Script の
`chrome.runtime` / `chrome.storage` が `undefined` になり、触ると
`TypeError: Cannot read properties of undefined (reading 'sendMessage')` になる。

### 生存判定 `isExtensionAlive()`

置き場所は **`src/urls.js`**。5本の Content Script すべてと Service Worker が読む唯一の共有ファイルであり、
`linkMenu.js` は TradingView に読み込まれないため使えない（SPEC-MF-06、`docs/ARCHITECTURE.md`「モジュール共有の仕組み」）。

```javascript
const isExtensionAlive = () =>
  typeof chrome !== 'undefined' && chrome.runtime != null && chrome.runtime.id != null
```

- **存在確認だけを行う。** メッセージ送信・storage 読み出しを試さない（判定自体が例外にならないこと）
- `chrome.runtime.id` は切断状態で失われる。**Service Worker が休止していても値は残る**ため、
  休止（CON-01）と切断を取り違えない
- `eslint.config.mjs` の `sharedGlobals` に追加済み（未追加だと `no-undef` になる）
- `npm run validate` の読み込み順検証の対象（`urls.js` は全 Content Script の先頭で読まれる）

### 適用範囲（NFR-14 判定基準4 の調査結果）

**5本の Content Script すべてが対象。** 「問い合わせ」は `chrome.runtime.sendMessage` だけでなく
`getEnableLinkKeysAsync()` 経由の `chrome.storage.sync.get`（`src/urls.js`）も含む。

| Content Script | 切断状態で走る拡張 API | 1.11.0 での症状 | 門の位置 |
| --- | --- | --- | --- |
| `tradingview-cs.js` | `sendMessage` 6箇所（`makeBrokerItemsAsync()` ×2 / `queryBrokerAsync()` ×2 / `openBrokerAsync()` / `openUrlAsync()`） ＋ storage | 右クリックのたびに3行を追加 → 例外 → 3行を除去。ボタンでは背景レイヤーが残る | **7箇所**（`attach()` の先頭 / **canvas 監視コールバック（1.13.0）** / オーバーレイ監視コールバック / SPEC-CS-11 条件1 / SPEC-CS-12 手順2 / `openBrokerAsync()` / `openUrlAsync()`） |
| `rakuten-scr-cs.js` | 起動時に storage 1回。`MutationObserver` のコールバックは**キャッシュ済みの `keys`** を使い API を呼ばない | 例外は出ない。ただしページ送りのたびに `span.x-kabu-root` を追加し続ける（判定基準2 に抵触） | **3箇所**（`attachAsync` の先頭 / 監視コールバック / デバウンス発火直後） |
| `sbi-scr-cs.js` | 同上 | 同上 | 同上 |
| `rakuten-cs.js` | 起動時に storage 1回のみ | 通常は無症状（切断状態のタブでは既に実行済み）。**拡張機能をページ読み込み直後 500ms 以内に再読み込みすると例外になる**（開発中に踏む） | 1箇所（`attachAsync` の先頭） |
| `sbi-cs.js` | 同上（待機は 500ms） | 同上 | 1箇所（`attach()` の先頭。**`attachAsync` ではない**。SPEC-CS-01） |

> **上表に加えて、5本すべてが `retrySetup()` の tick 先頭の門を共有する**（`src/urls.js`。SPEC-CS-22）。
> スクリーナー2種の「デバウンス発火直後」は 1.13.0 で足した3つ目の門で、
> 200ms 束ねるあいだに切断されうる（コールバック時は生存・注入時は切断）窓を塞ぐ。

### 起動時の門（`attach()` / `attachAsync()` の先頭）

**5本すべて、エントリポイントの先頭で判定する**（SPEC-CS-01）。これが最初の門で、
通らなければ **DOM も `MutationObserver` も一切作らない**（NFR-14 判定基準2 ／ NFR-01）。

TradingView だけ、起動時に DOM を追加する処理（`createKabuLinkMenu()`。SPEC-CS-12）を持つ。
`createKabuLinkMenu()` 自体は chrome API を触らないので例外にはならないが、
**押しても何も起きない「株Link」ボタンが恒久的に残る**（`openKabuLinkMenuAsync` の門が効くため無反応）。
判定基準2 に抵触するため、`attach()` の先頭でも判定する。

| 観点 | 内容 |
| --- | --- |
| 踏む条件 | ページ読み込みから **500ms 以内**（`setTimeout(attach, 500)` の発火前）に拡張機能を更新・再読み込みする |
| 頻度 | 開発中は起こる。利用者はウェブストアの自動更新で稀に起こりうる |
| 門が無い場合の症状 | 「株Link」ボタンだけが残り、押しても無反応。タブを再読み込みするまで消えない |

> 起動時の門は**他の門の代わりにならない**。実際に多いのは「正常に注入した後に拡張機能が更新される」経路で、
> そちらは SPEC-CS-11 条件1・SPEC-CS-12 手順2・監視コールバックの門が受け持つ。

### 二重の守り

| 層 | 置き場所 | 満たす判定基準 |
| --- | --- | --- |
| **門** | DOM を変更する前・`await` に入る前の `isExtensionAlive()` | 2（要素を一切追加しない） |
| **網** | `await` を挟む処理の `try` / `catch` | 1（例外を出さない）。門を通った後に更新された場合を拾う |

門だけでは足りない。判定から `await` の完了までのあいだに拡張機能が更新されうるため、
**網を外さない**（`addTickerMenuAsync()` の既存の `try` / `catch` はこの網にあたる。SPEC-CS-11）。
網が発火したときは、門と同じく「痕跡を残さず終わる」。

### 監視の停止

切断状態を検知した `MutationObserver` のコールバックは、**自分の監視を `disconnect()` してから抜ける**。
復帰する手段が無く（NFR-14「やらないこと」）、監視を続けても他社サイト上で無駄な処理が走り続けるだけのため（NFR-01）。

本拡張が張る `MutationObserver` は次の4種。**例外は無い。4種とも切断状態で外れる**（1.13.0 で canvas 監視も揃えた）。

| 監視 | 置き場所 | 切断時 |
| --- | --- | --- |
| スクリーナーの `document.body` 監視（SPEC-CS-08 / SPEC-CS-10） | `rakuten-scr-cs.js` / `sbi-scr-cs.js` | コールバック先頭とデバウンス発火直後の門で `disconnect()` |
| オーバーレイ監視（SPEC-CS-11） | `tradingview-cs.js` | コールバック先頭の門で `disconnect()` |
| `body` 監視（オーバーレイレイヤー待ち。SPEC-CS-11） | `tradingview-cs.js` | **門は無い。** オーバーレイを見つけた時点で自ら `disconnect()` して役目を終える（恒久的には残らない） |
| **canvas 監視**（ボタンの表示切替。SPEC-CS-12） | `tradingview-cs.js` | コールバック先頭の門で `disconnect()`（**1.13.0**。1.12.0〜1.12.2 は門も `disconnect()` も無く、タブの寿命まで残っていた） |

#### canvas 監視を揃えた理由（1.13.0。architect 判断 2026-08-25。ADR-0008 の 10）

> 1.13.0 でこの監視は `retrySetup()` の `setup()`（`setupKabuLinkMenu()`）の中で張るようになったため、
> **FR-13 判定基準4「切断状態を検知したら、再試行を停止し、そのために張った監視も外すこと」に直接かかる。**
> 他の3種と同じ形（コールバック先頭の門 → `disconnect()`）に揃えた。
>
> 揃える前でも実害は自前の `.ktt-tv-kabuLinkMenu` の show/hide だけで、**要素を追加しないため
> NFR-14 判定基準2 は破っていなかった**（1.13.0 のリリースを止める欠陥ではなかった）。
> それでも揃えたのは、本節の規則を「本拡張が張る監視はすべて切断で外れる」という
> 例外なしの不変条件に保つため（例外を1つ残すと、次に監視を足す人がどちらに倣うか決められない）。
>
> 実装形は SPEC-CS-22 の「canvas 監視の切断時の停止」。
> 手動確認は `docs/MANUAL-CHECKLIST.md` **G-7**（1.13.0 で新設。SPEC-CS-22 の検証表 9）。

再試行のタイマーも同じ規則に従う（1.13.0。SPEC-CS-22 / FR-13 判定基準4）。
**tick の先頭で `isExtensionAlive()` を判定し、偽なら `clearInterval` して止める。**

楽天・SBI の 4 本は起動時に読んだ `keys` をキャッシュして使うため、
**切断後も拡張 API に触れずに注入できてしまう**。ADR-0005 の 4 で
「実害が無くても判定基準2 を優先して止める」と決めた経路と同じものが、
再試行によって時間方向に広がる。門を tick ごとに置かないと NFR-14 判定基準2 が破れる。
手動確認は `docs/MANUAL-CHECKLIST.md` **G-6**（1.13.0 で新設。SPEC-CS-22 の検証表 8）。

### 通知・復帰はしない

バナー・ダイアログ・再注入・タブの再読み込みのいずれも行わない（NFR-14「やらないこと」）。
切断状態では**何もしないことが正しい振る舞い**。

### 既知の劣化（判定基準2 を優先した結果）

切断状態のスクリーナーでページ送りすると、新しい行にメニューが付かなくなる。
1.11.0 まではキャッシュ済みの `keys` で注入でき、注入されたメニューは `<a href>` だけなので
切断状態でも動いていた。**NFR-14 判定基準2（要素を一切追加しない）を優先してこれを止めた。**
既に注入済みのメニューは残り、クリックすれば開く（DOM から取り除きはしない）。

#### 手動確認との対応

手順は `docs/MANUAL-CHECKLIST.md` **セクション G**（1.12.0 で新設）。下表が対応。

| 項目 | 手動確認 | 判定基準 |
| --- | --- | --- |
| 右クリックメニューを拡張しない（SPEC-CS-11 条件1） | G-1 | 1, 2 |
| 「株Link」のメニュー・背景を出さない（SPEC-CS-12 手順2） | G-2 | 1, 2 |
| スクリーナーのページ送りで注入しない・監視を外す | G-3 | 1, 2 |
| タブを再読み込みすれば元に戻る | G-4 | 3 |
| **起動時に「株Link」ボタンを注入しない** | G-5 | 2 |
| **切断後に現れた行に注入しない（再試行の停止）** | G-6 | 2 |
| **切断後に canvas 監視が外れ、ボタンの表示が更新されなくなる** | G-7 | 1, 3 |

- 要件: NFR-14, NFR-01, NFR-05, CON-01, CON-03
- 検証: `manual`（**自動テストにできない**。拡張機能の再読み込みは Playwright から再現できず、
  切断状態は Chrome の内部状態のため。`docs/MANUAL-CHECKLIST.md` G-1〜G-7。
  加えて、TradingView には自動テストが無いため、canvas 監視に門を足した 1.13.0 では
  **A-8**（銘柄が無い画面でボタンが隠れる）で正常時の非退行を見る。判定基準3）／
  `auto`（楽天・SBI の**正常時の退行が無いこと**は既存の注入テストが担保する。判定基準3）

## SPEC-CS-20 楽天証券・国内株式・株価検索は破損していなかった（記録）

> **結論が出た（2026-09-01）。破損は無かった。** 本節は 1.19.0 まで
> **「破損調査（FR-20）」の調査手順と仮説**を置いていた。**その前提ごと消えたので記録に置き換える。**
> **節を消さない**——「セレクタが 0 件でも破損とは限らない」という教訓が、この場所にある価値だから。

### 実機で確かめたこと（2026-09-01。利用者）

楽天証券にログインし、株価検索で `7733` を検索した結果画面。

```html
<div id="line1">
  <h1 class="hdg-l1-01-title">
    <span>
      <span class="x-kabu-root">     ← 注入されている
        " オリンパス (7733)"
```

| 確かめたこと | 結果 |
| --- | --- |
| `div#line1` / `h1.hdg-l1-01-title` の実在 | **どちらも実在する**（セレクタは正しい） |
| メニューの注入 | `span.x-kabu-root` が入っている |
| メニューの表示 | **完全に開く**（遷移先が全部並んだ画面を確認） |

**SPEC-CS-07 の「国内株式・株価検索」のエントリは 1文字も変えていない。**
初版から動いており、**直すべきものは無かった。**

### なぜ「破損」に見えていたか

**検証ツールが結果画面に到達できていなかった。** 株価検索は**検索が POST でアドレスが変わらず**、
結果画面へは**フォーム送信でしか行けない**。フォーム送信は行わないと決めている（CON-10）ため、
ツールは**検索前のフォーム画面**を見て「セレクタが 0 件だから破損」と判定していた。

| 時期 | 出ていた記号 | 実際 |
| --- | --- | --- |
| 〜1.12.1 | ⚠️（未到達） | 拡張は正常 |
| 1.12.2〜1.19.0 | **❌（破損）** | 同上。**FR-22（到達判定）を入れたことで ⚠️ から ❌ に変わった** |
| **FR-30 の実装後**（現在） | **`👤`（対象外）** | 同上。**判定できないと認めて人に回した**（FR-30 / SPEC-SC-10 / ADR-0015） |

**❌ に変わったのは「到達判定がエラー画面の目印しか持たない」ため**（SPEC-SC-24）。
別の**正常な**ページに着いた場合も「到達した」と数えるので、
**着いた先が違うことは見抜けない**（当時の仮説 3b がこれで、**これが当たりだった**）。

### 何を間違えたか（記録。同じ形を繰り返さないため）

| # | 誤り | 実際 |
| --- | --- | --- |
| 1 | 「セレクタが 0 件 ＝ 破損」と読んだ | **到達できていなければ 0 件になるのは当たり前。**「判定できない」と「判定して駄目」は別 |
| 2 | 6つの仮説を立てて絞り込んだ | 仮説の当たりは **3b（エラーではない別のページに着いている）**。**ツールでは分けられない**と自分で書いておきながら、人が実サイトを見る手順を1年近く回さなかった |
| 3 | **人の運用に担保を預けた** | FR-22 は「**❌ を見たら人が題名を読む**」運用を前提に置いた。**その運用がそのとおり抜けた。**「毎回出る異常表示を、毎回人が正しく読み替える」は続かない |

**費やしたもの:** FR-20 の起票、本節（調査手順）の作成、実行のたびの再確認、次バッチ表の1位。
**実在した破損はゼロ。**

> **教訓は FR-30 に引き継いだ**（「到達できていないページを破損と報告しない」）。
> **恒久的な異常表示を作らない**——毎回同じ ❌ が出れば人は読み飛ばし、
> **本物の破損が埋もれる**（現に `npm run check:selectors` の終了コードが恒久的に失敗になっていた）。

### いまどう担保しているか

| 手段 | 内容 |
| --- | --- |
| 検証ツール | **対象外（`👤`）。** `targets.mjs` の `excluded` に理由を持たせ、**定義は消さない**（SPEC-SC-10 / SPEC-SC-04）。`excluded` を外せば検証が復活する |
| 人 | **`docs/MANUAL-CHECKLIST.md` の C-1b**（`rakuten-cs.js` の `menuSelectors` か `manifest.json` を変えたときに実施）。FR-30 判定基準7 |

**自動化を試みる前に CON-10 を変える判断が要る。** C-1b の冒頭に同じ注意を置いてある
（**理由を書かないと、次の担当が自動化を試みる**）。

- 要件: FR-02, FR-12, **FR-30**（FR-20 は 2026-09-01 に取り下げ）
- 検証: `manual`（`docs/MANUAL-CHECKLIST.md` **C-1b**）。
  **`半自動` は無い**（ツールの対象外。上表）。自動テストも無い（実サイトの POST 遷移が要る）

## SPEC-CS-21 検出用セレクタが依存してよいクラス（CON-11 の点検とガード）

> 点検は 2026-08-23 に実施（下表）。機械的ガード（G1・G2）は 1.12.2 で実装済み。
> 判断の記録は [ADR-0007](../adr/0007-con11-audit-scope.md)。

### 点検の範囲

**`src/*-cs.js` の `menuSelectors` に載る検出用セレクタ 20 件だけ**を対象とする。

| 対象 | 含める | 理由 |
| --- | --- | --- |
| `menuSelectors[].selector`（5ファイル・20件） | ✓ | 壊れると機能が消える。0 件でも画面上は「何も起きない」だけで気づけない |
| `src/*.css` のセレクタ | — | 壊れても見た目が崩れるだけで機能は残る（FR-12 の検証対象と同じ線引き）。`tradingview-cs.css` の `html.theme-dark` は TradingView 自身のテーマクラスで、機械判定に掛けると誤検知にしかならない（CON-03） |
| `tvMimicClasses`（模倣用クラス。SPEC-CS-16） | — | 同上 |
| `scripts/selector-check/targets.mjs` の `pageSelectors` | — | ツール側のページ識別セレクタ。壊れても拡張機能の動作は変わらない（SPEC-SC-04）。ただし他拡張クラスが混ざると検証ツールが恒久的に ⚠️ を出し続けるため、⚠️ が続く対象では `targets.mjs` 側を疑う |

### 点検結果（2026-08-23 / 1.12.1 の全 20 件）

| ファイル | 件数 | セレクタの起点 | 他拡張由来の混入 | 判定の根拠 |
| --- | --- | --- | --- | --- |
| `src/rakuten-cs.js` | 12 | `form` / `form#form` / `div#table_possess_data` / `table#poss-tbl-sp` / `div#str-main-inner` / `div#daily-ranking` ほか / `div#line1` | 無し | 楽天証券の命名（`hdg-` / `tbl-` / `str-` 接頭辞、`mbody`、`nobr`）で一貫する。`body` / `html` を起点にするものが無い |
| `src/rakuten-scr-cs.js` | 1 | `div#resultpanel` | 無し | スクリーナー画面（`resulttablebox` / `datarow`）の命名で一貫する |
| `src/sbi-cs.js` | 2 | `div#main` / **`body.vsc-initialized`** | **1件** | ポートフォリオのみ。Video Speed Controller が付けるクラス（`657f366` で混入。1.12.2 で除去済み。SPEC-CS-09） |
| `src/sbi-scr-cs.js` | 1 | `div#root` | 無し | React アプリの構造（`div.App` / `div.Screener` / `div.ResultListMainDiv`） |
| `src/tradingview-cs.js` | 4 | `div.chart-gui-wrapper` / `div.container-OH8c8Nc3` / `div#overlap-manager-root` / `div.context-menu` | 無し | ハッシュ付きクラスは TradingView 自身の生成物（CON-08）。実サイトで 4 件とも ✅（2026-08-23） |

**混入は `body.vsc-initialized` の 1 件のみ。** 他の 19 件は再点検不要とし、以後は下記のガードで守る。

### 機械的ガード

| # | 規則 | 実装 | 判定 |
| --- | --- | --- | --- |
| G1 | 検出用セレクタは **`body` / `html` を起点にしない**（`body` / `html` にクラス・属性・`id` を付けた条件を含まない） | `tests/selector-defs.spec.mjs` 19 | カンマ区切りの断片ごとに先頭を `/^\s*(body\|html)\b/i` で弾き、加えてセレクタ全体を `/(^\|[\s>+~,(])(body\|html)[.#[:]/i` で弾く（起点でなくても `body.foo` のように条件を付けた形を含む） |
| G2 | 検出用セレクタに**既知の他拡張クラス**が現れない | `tests/selector-defs.spec.mjs` 20 | 小文字化した文字列に否定リスト7件のいずれかが**部分一致**しないこと |

- **主は G1。** 他拡張が印を付ける場所は `<body>` / `<html>` に集中する（CON-11）。
  対象5サイトの検出用セレクタはどれも `body` / `html` を起点にする必要が無い
- **従は G2。** 名前の列挙は原理的に網羅できないため、G1 の補助として置く。初期値は次の 7 件。
  実例を観測したら足す

  ```js
  const FOREIGN_EXTENSION_CLASSES = [
    'vsc-initialized',   // Video Speed Controller（実際に混入していた）
    'grammarly-',        // Grammarly
    'gsc-',              // Google 系ウィジェット
    '__web-inspector',   // DevTools 系
    'translated-ltr',    // Google 翻訳
    'translated-rtl',    // Google 翻訳
    'darkreader'         // Dark Reader
  ]
  ```

- G1 に当たるセレクタが本当に必要になったら、テストを 1 箇所直す。
  **そのとき「本当にサイト側のクラスか」を必ず確認する**（CON-11 / CON-03）

### 実 DOM からセレクタを起こすときの手順（人が行う）

| # | 手順 |
| --- | --- |
| 1 | **株リンクだけを入れた Chrome**（他の拡張機能を無効にしたプロファイル）で対象ページを開く |
| 2 | その状態の DOM でセレクタを組み立てる |
| 3 | `<body>` / `<html>` に付いたクラスは使わない（G1） |
| 4 | サイトの他ページにも同じクラスが出るかを見る。1ページにしか無いクラスは疑う |

- 要件: CON-11, FR-21, FR-03, FR-02, FR-04
- 検証: `auto`（`セレクタ定義 › …` 19・20。`npm test`）／
  `manual`（新しいセレクタを足すときに上記手順を踏むこと）

---

## SPEC-CS-22 注入の再試行（共通）

> 1.13.0 で実装した（FR-13）。設計判断は [ADR-0008](../adr/0008-injection-retry.md)。
> canvas 監視の切断時の停止（SPEC-CS-19「監視の停止」／下の検証表 9）も同版で入った。

固定待機（SPEC-CS-01）が明けた時点で注入対象が無くても、**現れるまで一定時間試し直す**。

### 用語

| 語 | 意味 | 寿命 | 打ち切り |
| --- | --- | --- | --- |
| **再試行** | 設置（注入・常設監視の開始）が空振りしたときに繰り返す処理 | 成功・打ち切り・切断まで | あり（30 秒） |
| **常設監視** | 設置後にページの変化へ追随する `MutationObserver` | タブの寿命 | なし（切断時のみ外す。SPEC-CS-19） |

FR-13 判定基準2 の「再試行のために張った監視も外す」は**再試行側**への要求として満たす。
本仕様では再試行をタイマーで駆動するため `clearInterval` が対応する。
常設監視は FR-13 が新設するものではなく、切断時に外す既存の規則（ADR-0005 の 4）をそのまま保つ。

### 共有ヘルパー `retrySetup()`

置き場所は **`src/urls.js`**。5本の Content Script すべてが読む唯一の共有ファイル
（`isExtensionAlive()` と同じ理由。SPEC-CS-19 / CON-02）。
`importScripts('./urls.js')` により Service Worker からも見えるため、**自動テストで直接叩ける**。

次は**宣言だけの抜粋**。実物（`src/urls.js`）は関数本体に加えて、定数の JSDoc と
`retrySetup()` の JSDoc の補足行（停止の 4 経路・切断判定の理由・SPEC 参照）を持つ。
その補足行は下表と本節の注記に対応する。

```javascript
const retrySetupIntervalMs = 500
const retrySetupTimeoutMs = 30000

/**
 * 設置(注入・常設監視の開始)を、成功するまで一定間隔で試す
 * @param { () => boolean } setup 設置を試みる。これ以上の再試行が不要なら true
 * @param { { intervalMs?: number, timeoutMs?: number } } [options] 既定は 500ms / 30000ms
 */
const retrySetup = (setup, options) => { /* … */ }
```

| 挙動 | 内容 |
| --- | --- |
| 初回 | **呼び出し時に同期で 1 回** `setup()` を実行する（現行と同じタイミングで注入が始まる） |
| 継続 | `setup()` が偽なら `intervalMs` ごとに呼び直す |
| 停止 | 下表の 4 経路。**タイマーが存在する場合はすべて同じ `stop()`（`clearInterval`）を通る** |

| 停止経路 | 条件 | 要件 |
| --- | --- | --- |
| 成功 | `setup()` が真 | FR-13 判定基準1 |
| 打ち切り | 初回から `timeoutMs` 経過 | FR-13 判定基準2 |
| 切断 | tick の先頭で `isExtensionAlive()` が偽 | FR-13 判定基準4 / NFR-14 判定基準2 |
| 例外 | `setup()` が例外を投げた（外へ出さない） | NFR-01 |

- **切断の判定を毎 tick 行う。** 楽天・SBI の 4 本は起動時に読んだ `keys` をキャッシュして使うため、
  切断後も拡張 API に触れずに注入できてしまう（ADR-0005 の 4 と同じ経路を時間方向に広げる）
- **打ち切りは経過時間で見る。** タイマーは背景タブで 1 秒以上に丸められるため、
  回数で持つと待つ時間が環境で変わる
- **`options` は既定値を持つ。** 5本の呼び出し側は指定しない。小さい値を渡すのは自動テストだけ
- **`stop()` を通らない停止が 1 つある。** 初回の同期呼び出しで成功または例外になった場合は
  `setInterval` を張る前に `return` するため `stop()` を通らない。
  **止めるべきタイマーが存在しないので放置は起きない**（`src/*.js` 中の `setInterval` は
  `urls.js` の 1 箇所、`clearInterval` も 1 箇所）。
  「4 経路とも同じ停止処理を通る」はタイマーが張られた後の話として読む

### サイトごとの再試行単位と成功条件

| Content Script | `setup()` がやること | 成功条件 |
| --- | --- | --- |
| `rakuten-cs.js` | URL が一致する `menuSelectors` で注入パスを 1 回走らせる | **累計 1 件以上注入**かつ**そのパスの新規注入が 0 件**（静止） |
| `sbi-cs.js` | 全 `menuSelectors` で注入パスを 1 回走らせる | 同上 |
| `rakuten-scr-cs.js` | 常設監視（SPEC-CS-08）を張り、初期パスを走らせる | 監視を張れた |
| `sbi-scr-cs.js` | 常設監視（SPEC-CS-10）を張り、初期パスを走らせる | 監視を張れた |
| `tradingview-cs.js` | `chart-canvas` と `toolbar-container` が**両方**あれば canvas 監視とボタンを作る（SPEC-CS-12） | 両方あって設置した／既にボタンがある |

**静止を成功条件にする理由（楽天・SBI の 2 本）:** 「1 件でも注入できたら成功」にすると、
表が段階的に描画される場合に一部の行だけ注入して止まり、**注入 < ヒット**が残る。
FR-13 判定基準5 (c) が「注入 = ヒット」を課す 8 対象を直接壊すため、
**新規注入が 0 件になる tick を 1 回見てから**止める。

新規注入の判定は `$('span.x-kabu-root').length` をパスの前後で比べる
（`attachMenu()` の戻り値を変えない）。

> **残る限界（静止条件そのものの弱点）。** 「新規注入 0 件のパスを 1 回見たら止める」ため、
> **行が時間を空けて 2 回に分かれて現れると、2 回目の行には注入されない。**
> 例: t=0 に行が現れ、t=500 のパスで注入 → t=1000 のパスで `after === before` が成立して停止 →
> t=1200 に現れた行は誰も拾わない（`rakuten-cs.js` / `sbi-cs.js` には常設監視が無い）。
>
> 影響するのは楽天証券・SBI証券の**通常ページ2本のみ**。スクリーナー2種は `document.body` の
> 常設監視があり、TradingView はボタンが 1 つ出れば足りるため成立しない。
> **実装を変えない**（「静止を N 回連続」や楽天・SBI への常設監視の常設化は、
> いずれも FR-13 の範囲を超える。ADR-0008 の 5）。
> 「たまに一部の行だけメニューが出ない」報告が来たら、まずここを疑う。

### 再試行を始めない場合

| Content Script | 条件 |
| --- | --- |
| `rakuten-cs.js` | `location.href` に一致する `menuSelector` が 0 件（SPEC-CS-14） |
| 5本すべて | 起動時の門（`isExtensionAlive()` が偽）／`getEnableLinkKeysAsync()` が失敗（SPEC-CS-19） |

> `sbi-cs.js` は URL で対象を絞らない（SPEC-CS-09）。SBI証券の対象外ページでは
> 30 秒間セレクタ 2 本を評価し続ける。**DOM は一切変更しない**（NFR-01）。
> 絞り込みの追加は SPEC-CS-09 の変更にあたるため、本仕様では行わない（ADR-0008 の 2）。

### 二重注入の防止（FR-13 判定基準3）

| 層 | 内容 | 版 |
| --- | --- | --- |
| 楽天・SBI 4本 | ~~置換済みの子ノードはテキストノードではないため、同じ要素を再走査しても置換が起きない~~ | **1.17.0 で失効**（下記） |
| 楽天・SBI 4本 | G1: `attachMenu()` は、対象要素が `span.x-kabu-root` の**内側**にあるとき何もしない | 1.13.0 |
| 楽天・SBI 4本 | G2: `attachMenu()` は、対象要素が `span.x-kabu-root` を**内側に持つ**とき何もしない | **1.17.0** |
| TradingView ボタン | `$('.ktt-tv-kabuLinkMenu').length > 0` なら設置済みとして成功を返す | 1.13.0 |
| TradingView 右クリック | `tr[data-kabu-tantan]` のガード（SPEC-CS-11 条件1） | 既存・変更なし |

> G1 が要る理由: 注入したメニュー項目の `<a>` が検出用セレクタに再びヒットする
> （楽天スーパースクリーナーの検出用セレクタのヒットが 1150 件になるのはこれ）。
> パスを繰り返す設計では、構造的な性質だけに頼らない。
>
> **G2 が要る理由（1.17.0）:** 1行1メニューにするため最初のテキストノードで打ち切るようになり
> （SPEC-CS-02 / FR-28 判定基準10）、**未置換のテキストノードが要素内に残る**。
> 1行目の「構造的な性質」はここで失効し、**繰り返すパスが2つ目を置換してしまう**。
> **二重注入の防止は G1・G2 の2つだけが担う。**

### 定数

| 定数 | 値 | 根拠 |
| --- | --- | --- |
| `retrySetupIntervalMs` | 500 | 現れてから注入までの遅れの上限。固定待機と同じ粒度 |
| `retrySetupTimeoutMs` | 30000 | 30 秒たっても現れないものは対象ページではないとみなす。検証ツールの計測点（TradingView は遷移後 5000ms。SPEC-SC-25）より十分に長い |
| `observerDebounceMs` | 200 | `document.body` 監視の発火を束ねる幅（SPEC-CS-08 / SPEC-CS-10。ADR-0008 の 3） |

> **`observerDebounceMs` と `attachPass()` は 2 ファイルに重複定義してある**
> （`observerDebounceMs`: `rakuten-scr-cs.js` / `sbi-scr-cs.js`、
> `attachPass()`: `rakuten-cs.js` / `sbi-cs.js`。引数だけが違う）。
> **定数を `urls.js` へ寄せると、SPEC-SC-25 の `settleMs` 計算式との対応が 1 箇所になる。**
> 1.13.0 では寄せていない（実装変更。値を変える必要が出た時点で行う）。

- 要件: FR-13, FR-03, FR-04, NFR-01, NFR-09, NFR-14, CON-02, CON-03
- 検証: `auto`（`service_worker: retrySetup`（成功で停止 / 打ち切りで停止 / 例外で停止）と
  `楽天証券 Content Script › 遅れて現れた銘柄コードにもメニューを注入する` ほか。SPEC-CS-22 の「検証」表）／
  `半自動`（`npm run check:selectors` のフル実行を**連続 2 回**。FR-13 判定基準5 の (a)(b)(c)。SPEC-SC-25）／
  `manual`（TradingView の銘柄切替への追随（FR-13 判定基準6）と切断状態での再試行停止・
  canvas 監視の停止（同 4）。`docs/MANUAL-CHECKLIST.md` **A-12 / G-6 / G-7**。いずれも 1.13.0 で新設済み。
  canvas 監視の門の**正常時の非退行**は既存の **A-8**（NFR-14 判定基準3））

### 検証（developer が用意するもの）

1〜9 すべて 1.13.0 で用意済み。

| # | 種別 | テスト名 | 何を固定するか |
| --- | --- | --- | --- |
| 1 | `auto` | `service_worker: retrySetup › 成功したら再試行を止める` | `setup()` が真を返した後は呼ばれない |
| 2 | `auto` | `service_worker: retrySetup › 打ち切り時刻を過ぎたら止める` | `timeoutMs` 経過後に呼ばれない（`intervalMs: 20, timeoutMs: 100` で駆動）。`clearInterval` に到達する |
| 3 | `auto` | `service_worker: retrySetup › setup が例外を投げたら止める` | 例外が外へ出ず、2 回目が無い |
| 4 | `auto` | `楽天証券 Content Script › 遅れて現れた銘柄コードにもメニューを注入する` | フィクスチャが 1500ms 後に行を足す → `span.x-kabu-root` が 3 件（判定基準1） |
| 5 | `auto` | `楽天証券 Content Script › 同じ銘柄コードに二重注入しない` | 4 の後に 2 tick 待っても件数が増えない（判定基準3） |
| 6 | `auto` | `SBI証券 Content Script › 遅れて現れた銘柄コードにもメニューを注入する` | 4 と同じ（`sbi-cs.js` 側） |
| 6b | `auto` | `スクリーナー Content Script › 楽天スーパースクリーナー: 後から現れた結果一覧に注入する` | 器が後から現れても `document.body` 監視が拾う（SPEC-CS-08）。二重注入しない |
| 6c | `auto` | `スクリーナー Content Script › SBI銘柄スクリーニング: 後から現れた結果一覧に注入する` | 実測「ヒット 50 / 注入 0」の経路の回帰（SPEC-CS-10） |
| 7 | `manual` | `docs/MANUAL-CHECKLIST.md` A-12 | TradingView でリトライ注入されたボタンが銘柄切替に追随する（判定基準6） |
| 8 | `manual` | `docs/MANUAL-CHECKLIST.md` G-6 | 楽天証券のページ読み込み直後に拡張機能を再読み込みし、**その後に現れた行にも注入されない**（判定基準4） |
| 9 | `manual` | `docs/MANUAL-CHECKLIST.md` G-7 | 切断後に **canvas 監視が外れ、「株Link」ボタンの表示が更新されなくなる**（判定基準4。下記「canvas 監視の切断時の停止」） |

#### canvas 監視の切断時の停止（検証表 9。1.13.0）

`src/tradingview-cs.js` の `setupKabuLinkMenu()` の中で、canvas 監視を他の3種と同じ形に揃えた
（SPEC-CS-19「監視の停止」）。`canvasObserverCallback` は独立した関数で監視オブジェクトを
参照できないため、**同ファイルの `bodyObserver` と同じく無名コールバックで包む**
（`canvasObserverCallback` 自体は変えていない）。

```javascript
const canvasObserver = new MutationObserver(() => {
  // 切断状態では監視を外す(復帰手段が無く、監視を続けても無駄に走るだけ。SPEC-CS-19)
  if (!isExtensionAlive()) {
    canvasObserver.disconnect()
    return
  }
  canvasObserverCallback()
})
canvasObserver.observe(canvas, { attributes: true })
```

| 観点 | 内容 |
| --- | --- |
| 正常時の振る舞い | 変わらない（`isExtensionAlive()` が真なら従来どおり `canvasObserverCallback()` を呼ぶ） |
| 自動テスト | **無い。** 切断状態は Playwright から作れない（SPEC-CS-19 の検証欄と同じ理由） |
| 手動確認 | `docs/MANUAL-CHECKLIST.md` **G-7**。TradingView のチャートでボタンが出ている状態 → 拡張機能を再読み込み → タブは再読み込みせずに銘柄コードが取れない画面へ移動 → **ボタンが残ったまま消えない**（監視が外れた証拠。**A-8 とは逆になるのが正しい**）。G-5 / G-6 と違い時間の窓は無い |
| 正常時の非退行 | **A-8**（銘柄が無い画面でボタンが隠れる）。門が真の経路が壊れていないことの直接の証拠（NFR-14 判定基準3） |

> 切断状態は Playwright から再現できない（SPEC-CS-19 の検証欄と同じ理由）。テスト 1〜3 の
> `isExtensionAlive()` 経路も Service Worker 上では常に真になるため、**判定基準4 は手動でしか確かめられない**。

---

## SPEC-CS-23 TradingView: ウォッチリストの行からの右クリック（FR-19）

> 1.15.0 で実装した（FR-19）。設計判断は [ADR-0010](../adr/0010-tradingview-watchlist-origin.md)。
>
> 再レビュー M-5 への対応（行の目印を値の形で決める）も同版で入っている。
> 最終レビュー M-5b への対応（形の判定の字種を解釈側と揃える）も同版で入っている。
> **行が持つ属性の名前は推測のまま**（後述「行の目印は推測値」）。**実サイトで確認するまで確定しない。**
> 属性名が外れていても「ウォッチリストで何も出ない」に落ちる。
>
> **「誤った銘柄のリンクが出ない」は自動的には成り立たない。** 実装当初（1.15.0 の開発中）には
> `NYSE:BRK.B` の行から `BRK`（別企業）を返す経路が実在した（後述「米国コードの後続境界」）。
> 成り立たせているのは `parseExchangeSymbol()` の**後続境界**であって、設計の構造ではない。

チャート画面のウォッチリストの銘柄行を右クリックすると、**その行の銘柄**でメニューを拡張する。
拡張するメニューの形（3行＋入れ子）・項目の中身・並び順は SPEC-CS-11 / 17 / 18 と**同じ**。
1.13.0 から変わったのは**起点の判定と銘柄の取得元だけ**。

実装は `src/tradingview-cs.js`。

| 実装 | 役割 |
| --- | --- |
| `contextMenuOrigin`（`let`） | 直近の右クリックの起点。`{ kind, at, code, type }` の**1件のみ** |
| `discardedOrigin()` | 捨てた状態（`{ kind: null, at: 0, code: null, type: null }`）を作る |
| `resolveContextMenuOrigin(target)` | 発生元から起点を解決する（行 → チャート → 捨てる） |
| `findRowTickerCode(target)` | 発生元から祖先方向へ行の目印を探し、銘柄を取り出す |
| `watchlistSymbolAttrs` / `watchlistRowSelector` | 行の目印（候補属性の配列と、そこから組み立てたセレクタ） |
| `parseExchangeSymbol(text)` | `EXCHANGE:CODE` の解釈（チャートと行で共有。後述） |
| `contextMenuGraceMs` | 猶予 1500ms（チャート・行で共通） |

### 1.13.0 から変えた箇所・変えていない箇所

| 箇所 | 1.15.0 |
| --- | --- |
| `contextmenu` の記録 | **変えた。** `chartContextMenuAt`（時刻のみ）→ `contextMenuOrigin`（起点の種別と、行由来なら銘柄まで） |
| 猶予の定数 | **改名した。** `chartContextMenuGraceMs` → `contextMenuGraceMs`（値は 1500ms のまま） |
| `attachMenu()` の条件4（猶予） | **変えた。** 「チャート上で」→「有効な起点で」 |
| `attachMenu()` の条件6（銘柄） | **変えた。** `origin.kind === 'row' ? origin : getTickerCode()` の1行 |
| `getTickerCode()` | **中身を分けた。** 解釈部を `parseExchangeSymbol()` に切り出し、canvas の読み出しだけが残った。**引数・戻り値・振る舞いは変えていない** |
| `attachMenu()` の条件1・2・3・5 | 変えていない |
| `addTickerMenuAsync()` 以降（3行の追加・除去・二重追加の防止） | 変えていない |
| 入れ子（SPEC-CS-17）・項目生成（SPEC-CS-18） | 変えていない |
| 「株Link」ボタン（SPEC-CS-12） | 変えていない（canvas 由来のまま。FR-19「やらないこと」） |
| `menuSelectors`（SPEC-CS-15）・`targets.mjs` | 変えていない（後述「検証対象に載せない理由」） |

### 起点の判定（チャート／ウォッチリストの行）

`document` の `contextmenu`（`capture: true`）で受け、リスナーは**1本**。
キャプチャ段階で受けるのはサイト側が `stopPropagation()` しても届くようにするため。

```javascript
/** 直近の右クリックの起点。kind: 'row' | 'chart' | null、at は未発生・破棄なら 0 */
let contextMenuOrigin = { kind: null, at: 0, code: null, type: null }
```

`resolveContextMenuOrigin(target)` が次の順に解決する。**上から順に評価し、最初に当たったものを採る。**

| 順 | 条件 | 記録 |
| --- | --- | --- |
| 1 | 発生元またはその祖先が**行の目印**（後述。`EXCHANGE:CODE` の形の値を持つ候補属性）を持つ。かつ銘柄を解釈できた | `{ kind: 'row', at: Date.now(), code, type }` |
| 2 | 1 に当たったが**銘柄を解釈できなかった**（`exchanges` に無い取引所・コード書式違反） | **捨てる**（`at: 0`）。チャートへ落とさない |
| 3 | 発生元が `div.chart-gui-wrapper` の内側 | `{ kind: 'chart', at: Date.now(), code: null, type: null }` |
| 4 | それ以外（ツールバー・銘柄検索・余白） | **捨てる**（`at: 0`） |

- **行の判定をチャートより先に行う**（行が優先）。優先順位は**記録の時点で決まり**、
  `attachMenu()` は記録された1件しか見ない。起点が同時に2つ存在しない
- **2 でチャートへ落とさないのが必須。** 落とすと「指数の行を右クリックしたら
  チャートの銘柄のリンクが出る」ことになり、FR-19 判定基準 2 ＝ FR-04 違反になる
- 4 で**捨てる**のは 1.13.0 と同じ理由（直前の右クリックの記録が猶予内に残っていても拡張させない）
- 記録は常に上書きする。1件しか持たない。捨てる状態は `discardedOrigin()` が作る
- 1 と 2 の切り分けは `findRowTickerCode(target)` の戻り値で行う

  | 戻り値 | 意味 | 記録 |
  | --- | --- | --- |
  | `null` | **`EXCHANGE:CODE` の形の値を持つ要素が祖先に無い**（＝行ではない）。属性はあるが値が `main` / `8253` のような形の場合もここ | 3 へ進む（**チャートへ落ちる**） |
  | `{ code: null, type: null }` | 形は満たすが銘柄を解釈できない（`SP:SPX` など） | **捨てる**（2） |
  | `{ code, type }` | 行で銘柄を解釈できた | `kind: 'row'`（1） |

  > **`null` と `{ code: null }` の分かれ目が、チャート起点を守る要**（後述「チャート起点を構造的に守る」）。
  > 「属性があれば行」にすると、チャート内の無関係な `data-symbol` で 2 に落ち、
  > **チャートの右クリックが黙って死ぬ**。

### 猶予時間

**チャート・行で共通の1つの定数**（1.13.0 の 1500ms を据え置き、起点を限定しない名前に改めた）。

```javascript
/** contextmenu が発生してから、メニューの拡張を許す猶予(ミリ秒) */
const contextMenuGraceMs = 1500
```

`attachMenu()` の条件4 は `Date.now() - origin.at > contextMenuGraceMs` で判定する。
**捨てた記録（`at: 0`）は常に猶予外**になるので、破棄の表現は 1.13.0 のまま変わっていない。

### 銘柄の取得元（条件6）

| 起点 | 取得元 |
| --- | --- |
| `kind === 'row'` | **記録済みの `code` / `type`**（右クリックの時点で確定済み） |
| `kind === 'chart'` | `getTickerCode()`（canvas の `aria-label`。SPEC-TC-07） |

分岐は `attachMenu()` の `origin.kind === 'row' ? origin : getTickerCode()` の**1行だけ**。

**メニュー生成の時点で行の DOM をたどり直さない。** ウォッチリストは仮想スクロールで
行が差し替わりうるため、右クリック時に確定した値だけを使う（FR-19 判定基準 8）。

### 行の目印は推測値

行が銘柄を持つ属性の**名前**は、2026-08-23 の実 DOM 調査の生データが本リポジトリに収録されておらず、
**確定していない**。要件が確定させているのは「`EXCHANGE:CODE` 形式（例 `TSE:8253`）と
コード単独（例 `8253`）の両方を属性として持つ」ことだけ。

**候補の配列を1箇所だけに置く**（`src/tradingview-cs.js` の `watchlistSymbolAttrs`。
実測値への差し替えはこの1箇所だけで済む）。

```javascript
/** ウォッチリストの行が銘柄を持つ属性の候補(推測値 / 実サイト未確認。SPEC-CS-23) */
const watchlistSymbolAttrs = ['data-symbol-full', 'data-symbol-short']

/** 行の目印セレクタ。属性名を直書きせず候補配列から組み立てる */
const watchlistRowSelector = watchlistSymbolAttrs.map((attr) => `[${attr}]`).join(',')
```

| 順 | 属性 | 期待する値 | 根拠 |
| --- | --- | --- | --- |
| 1 | `data-symbol-full` | `TSE:8253` | 推測。TradingView のウォッチリストで一般に知られる名前で、要件の「`EXCHANGE:CODE` 形式」と一致する |
| 2 | `data-symbol-short` | `8253` | 推測。要件の「コード単独」と一致する。**形の条件を満たさないので行の目印にはならない**（下記） |

**`'data-symbol'` は候補から外す**（1.15.0 の再レビュー M-5。当初は「1 が別名だった場合の受け皿」として
入れていた）。理由は後述「チャート起点を構造的に守る」。

- **行かどうかの判定にも同じ配列を使う**（`watchlistRowSelector`。現在の値は
  `[data-symbol-full],[data-symbol-short]`）。属性名を直書きしない。
  **このセレクタはウォッチリストに限定していない**（ページ全体で評価される）。
  同じ属性を持つ要素が他のウィジェットにもあれば、そこでも起点になる（「実サイトで確認すべき事項」の 6）
- **セレクタは粗い絞り込みでしかない。行と見なすのは「値が `EXCHANGE:CODE` の形」のときだけ**（下記）
- **読み取りは発生元から祖先方向へ、目印に一致する要素を近い順に見る**（`findRowTickerCode()`）。
  1要素につき候補属性を配列順に試し、最初に解釈できた値を採る。解釈できなければ
  `parentElement` から `closest()` で次の目印付き祖先へ上がる。
  **子孫方向へは探さない**（別の行の銘柄を拾う）

#### 「行」の定義は属性の有無ではなく値の形

**属性を持っているだけでは行と見なさない。** 候補属性の値が `EXCHANGE:CODE` の**形**
（**`/^[A-Z][A-Z0-9_]*:/`**。取引所トークンらしき語＋コロン）を満たすものだけを行の値として扱う。

| 祖先が持つ値 | 行か | 結果 |
| --- | --- | --- |
| `TSE:8253` / `TSE_DLY:8253` | 行 | 銘柄を解釈 → `kind: 'row'` |
| `SP:SPX`（`exchanges` に無い取引所） | 行 | 解釈できない → **捨てる**（判定基準 7。何も出さない） |
| `MAIN:1`（大文字の内部識別子） | 行 | 同上（**下記「残る差分」**） |
| `8253`（コード単独） | 行ではない | 形を満たさない → チャート判定へ進む |
| `main` / `pane-1` / 空文字 | 行ではない | 同上 |
| **`main:1` / `chart:2` / `pane:0` / `Widget:1`**（小文字を含む識別子） | **行ではない** | 同上（**大文字だけを形と見なす**） |
| `nyse:aapl`（小文字の取引所表記） | 行ではない | 同上。SPEC-TC-09 が「不成立」と定めている形で、解釈側も受理しない |

- **字種は解釈側と揃える。** 形の判定に使う字種（`[A-Z]`）は
  `parseExchangeSymbol()` の取引所トークン（`/^([A-Z]+)(_DLY)?:/`）と**同じ大文字のみ**にする。
  **広げると、解釈が絶対に成功しない値まで「行」になって捨てられ、チャート起点が死ぬ**（下記）
- **形の判定に `exchanges`（SPEC-EL-09）を使わない。** 使うと `SP:SPX` が「行ではない」になり、
  チャート起点へ落ちて**指数の行にチャートの銘柄が出る**（判定基準 7 違反）。
  「取引所として妥当か」は解釈側（`parseExchangeSymbol()`）の仕事で、ここは**形だけ**を見る
- 形の判定は純粋な文字列処理なので、`node:vm` の既存の仕組みで自動テストできる
- この条件は**要件の前提の範囲内**。FR-19 の実 DOM 調査が「各行は `EXCHANGE:CODE` 形式の属性を持つ」と
  確定させているので、**本物の行が形の条件で落ちることはない**

##### 残る差分（消せない。字種を揃えても残る）

**「形は満たすが解釈は絶対に成功しない」値の集合は、原理的に消えない。**
判定基準 7 が `SP:SPX` を「行として認識したうえで捨てる」ことを要求しているためで、
**`exchanges` に無い大文字トークンはすべてこの集合に入る**（`SP:` `MAIN:` `PANE:` …）。

| | 集合 | 起点 | 影響 |
| --- | --- | --- | --- |
| 意図どおり | `SP:SPX` などウォッチリストの対象外の行 | 捨てる | **正しい**（判定基準 7） |
| 巻き添え | チャート内の要素が候補属性に `MAIN:1` のような**大文字＋コロン**の値を持つ場合 | 捨てる | **チャート起点が死ぬ**（FR-04 の退行） |

- **字種を揃える（`[A-Za-z]` → `[A-Z]`）ことで、巻き添えの集合は
  「大文字始まりのコロン値」だけに縮む。** `main:1` / `chart:2` のような小文字の内部識別子は外れる
- 残りをさらに消すには `exchanges` を引くしかないが、それは判定基準 7 を壊す（上記）。**ここが下限**
- 巻き添えが実際に起きるかは**実サイトでしか分からない**（「実サイトで確認すべき事項」の 7）。
  観測されたら候補属性を実測名だけに絞る

### 市場種別は `EXCHANGE:` からしか決めない

コード単独（`8253`）は取引所が分からないため、**解釈に失敗させる**。
「4桁なら国内株」と当てにいくと、米国株の行で誤ったリンクを出す（FR-19 判定基準 3・6 に反する）。
結果として `data-symbol-short` は行の**目印**としては働くが、銘柄の**取得元**にはならない。

### `EXCHANGE:CODE` の解釈は再実装しない（NFR-13）

解釈手順（**SPEC-TC-07 の 1〜3**。取引所トークンの切り出し、`_DLY` の除去、
`exchanges`（SPEC-EL-09）での市場種別の判定、市場ごとのコード書式）は
`parseExchangeSymbol(text)` の**1箇所だけ**にあり、canvas の `aria-label` と行の属性値の
**両方がこの関数を通る**。

| | 〜1.13.0 | 1.15.0〜 |
| --- | --- | --- |
| 解釈の実装 | `getTickerCode()` の中 | **`parseExchangeSymbol(text)`**（`src/tradingview-cs.js`）。`EXCHANGE:CODE …` を受け `{ code, type }` を返す |
| `getTickerCode()` | canvas 読み出し＋解釈 | canvas 読み出し → `parseExchangeSymbol()` を呼ぶ1行（**引数・戻り値・振る舞いは変えていない**） |
| 行の解釈 | — | 属性値 → 同じ `parseExchangeSymbol()` |

- **解釈規則の情報源は SPEC-TC-07 のまま。** 本節は規則を再掲しない
  （規則が2箇所に書かれると片方だけ古くなる）。**SPEC-TC-07 の実装先は
  `getTickerCode()` から `parseExchangeSymbol()` に移っている**
- 解釈は**先頭からの前方一致だが、米国コードだけは後続境界を見る**
  （切り出してよい後続だけを許す許可列挙。値は後述、規則の正本は SPEC-TC-02）。
  `TSE:7203 の 1 日 チャート` と `TSE:8253`、`BATS:AAPL の 1 日 チャート` と `NASDAQ:AAPL` は
  同じ結果になる（`aria-label` はコードの直後が空白で、境界を満たすため）。
  **「後続文字の有無に依存しない」ではない**（後述「米国コードの後続境界」）
- 引数が `null` / `undefined` / 空文字なら `{ code: null, type: null }` を返す
  （`aria-label` が無い canvas と、属性を持たない要素の両方がここに来る）
- `src/urls.js` へ移して Service Worker と共有はしない。FR-14 側も
  「入力の性質が違う」として共有を却下している（ADR-0009 の 3 ／ ADR-0010 の 3 の (c)）

### 米国コードの後続境界（FR-08）

> **規則の正本は SPEC-TC-02**（`ticker-code.md`）。本節は TradingView 側での適用と、
> 3経路で値を揃える約束だけを書く。**規則そのものを再掲しない**（2箇所に書くと片方が古くなる）。

米国コードの抽出は**実装当初**（1.15.0 の開発中。コミット前）に `/^[A-Z]{1,5}/` と
**後続境界を持っていなかった**。canvas の `aria-label` はコードの後ろに「 の 1 日 チャート」
（先頭が空白）が続くため実害が出ていなかったが、**行の属性値は値全体がシンボル**なので、
境界の欠落がそのまま誤読になっていた。境界はその後 3 段階で広がり、**最後に向きが反転した**。

| 入力 | ① 境界なし | ② `.` のみ | ③ `.` `-` `/` `+` の禁止列挙 | ④ 1.15.0（許可列挙） |
| --- | --- | --- | --- | --- |
| `NYSE:BRK.B`（バークシャー B株） | **`BRK`**（別企業） | `null` | `null` | `null` |
| `NYSE:BRK-B`（Yahoo Finance 系の表記） | **`BRK`** | **`BRK`** | `null` | `null` |
| `NYSE:BRK/B` / `NYSE:BRK+B` | **`BRK`** | **`BRK`** | `null` | `null` |
| `NYSE:BRK&B` / `NYSE:BRK_B`（列挙外の ASCII 記号） | **`BRK`** | **`BRK`** | **`BRK`** | `null` |
| `NYSE:BRK1`（数字が続く） | **`BRK`** | **`BRK`** | **`BRK`** | `null` |
| `NYSE:BRK・B`（全角の連結記号） | **`BRK`** | **`BRK`** | **`BRK`** | `null` |
| `NASDAQ:ALPHABET` | **`ALPHA`** | `null` | `null` | `null` |
| `BATS:AAPL の 1 日 チャート` | `AAPL` | 変わらず | 変わらず | 変わらず |
| `NASDAQ:GOOGL` / `NYSE:F` | `GOOGL` / `F` | 変わらず | 変わらず | 変わらず |

> **①〜③ は利用者に届いていない**（いずれも 1.15.0 のコミット前の一時状態）。
> 残してあるのは、**禁止列挙では塞ぎ切れない**という事実が実例つきで分かるため。
> ③ の時点で ASCII 記号 27 種と数字が素通りしていた。

**現在の境界（`src/tradingview-cs.js` の `parseExchangeSymbol()`）:**

```javascript
/^[A-Z]{1,5}(?=$|[\s,;:!?"'()[\]{}]|(?![Ａ-Ｚａ-ｚーｰ])(?=[^\x20-\x7E])[\p{L}、。，；：！？＂＇（）［］｛｝「」『』【】〈〉《》〔〕‘’“”])/u
```

**向きが「切り出してよい後続だけを許す」許可列挙になっている。**

| 後続 | 例 | 扱い |
| --- | --- | --- |
| 文字列の終わり | `NASDAQ:GOOGL` | 通す |
| 空白・ASCII の終止記号 | `BATS:AAPL の 1 日 チャート` | 通す |
| 非 ASCII の `\p{L}`・全角の終止記号 | `AAPLの株価` | 通す |
| 英数字 | `ALPHABET` / `BRK1` | **落とす** |
| 上の列挙に無い ASCII 記号 | `BRK.B` / `BRK-B` / `BRK&B` / `BRK_B` | **落とす** |
| 全角英字・全角の連結記号 | `Ｓ＆Ｐ` / `BRK・B` | **落とす** |
| 長音符2字（`ー` U+30FC / `ｰ` U+FF70） | `BRKーB` / `BRKｰB` | **落とす**（`\p{L}` に含まれるため、明示的に除外している） |

**取れないものは「何も出さない」に倒す**（FR-19 判定基準 3）。ウォッチリストの行では
「その行が `BRK.B` を表示しているのに `BRK` のページが開く」ことになるため、
**行の経路ではこの境界が唯一の歯止め**になる。

#### `u` フラグが必須（外すと黙って壊れる）

**`u` フラグを落とすと `\p{L}` はリテラル `p{L}` として解釈される。**
例外も lint エラーも出ず、**「非 ASCII の文字が続く形」だけが静かに落ちる**
（`AAPLの株価` が取れなくなる）。他の分岐は動き続けるので、**症状が部分的で気づきにくい。**

TradingView 側は DOM を使う経路に自動テストが無く（CON-08）、
`parseExchangeSymbol` の自動テストも 3 件しかない。**この罠は下記の3経路テストで塞いである。**

#### Service Worker との一致（1.15.0 でテストによる歯止めが付いた）

境界の値は `src/service_worker.js` の `usCodePattern` ほか2箇所と**完全に同じ文字列**。
**実装（関数）は共有しない**（ADR-0009 の 3。入力の性質が違う）が、
**境界の値だけは揃える**ことを FR-08 が要求している。

| | 内容 |
| --- | --- |
| 対象の3経路 | `service_worker.js` の `usCodePattern` ／ 同ファイルの優先順位4の直書き ／ `tradingview-cs.js` の `parseExchangeSymbol()` |
| 固定するもの | 3経路の**件数が3であること**、**全件に `u` フラグがあること**、**境界の文字列が完全一致すること** |
| テスト | `米国ティッカーの後続境界: リテラル3本で同じ値 › リテラル3本とも同じ境界で、u フラグが付いている`（`tests/service-worker.spec.mjs`。ソースから `[A-Z]{1,5}` を含む正規表現リテラルを取り出して比較する） |

> **開発中は 2 度食い違った。**
>
> | 段階 | TradingView 側 | Service Worker 側 |
> | --- | --- | --- |
> | 1回目 | `.` を境界に足した | `(?![A-Za-z])` のまま。`BRK.B` → `BRK` |
> | （追随） | — | `.` を足して揃った |
> | 2回目 | `.` のみ。`BRK-B` → `BRK` | `.` のみ。`BRK-B` → `BRK`（**両方とも同じ穴**） |
> | 現在 | 許可列挙（上記） | 同じ文字列 |
>
> **「揃っているのは結果であって、仕組みではない」がそのとおりになった。**
> 1回目は**片方を直しても他方が直らなかった**。
> 2回目は逆に**両方が同じ穴を持ったまま揃って見えていた**。
>
> **1.15.0 でコード側の歯止めが付いた**（上記の3経路テスト）。
> ただし**テストが守るのは「一致」であって「規則の正しさ」ではない。**
> 2回目の穴は3経路が揃っていても防げない種類のもので、
> **3経路が同時に間違っていれば、テストは緑のまま通る。**
> 規則そのものの妥当性は SPEC-TC-02 側の入力別テストが受け持つ。
>
> **境界を変えるときは3経路すべてを同時に変える**（1箇所だけ直すと上記テストが落ちる）。

### 対象外の行（判定基準 7）

**除外リストは持たない。** `exchanges`（SPEC-EL-09）に載っていない取引所トークンは対象外、
という既存の規則だけで落とす。指数・先物・FX・暗号資産の行はこれで落ちる。

| 行の例 | トークン | `exchanges` | 結果 |
| --- | --- | --- | --- |
| `TSE:8253` | `TSE` | `jp` | 項目を出す |
| `TSE_DLY:8253` | `TSE`（`_DLY` を剥がす） | `jp` | 項目を出す |
| `NASDAQ:AAPL` / `BATS:AAPL` | `NASDAQ` / `BATS` | `us` | 項目を出す（米国株対応サイトのみ。SPEC-CS-18） |
| `SP:SPX` / `TVC:NI225`（指数） | `SP` / `TVC` | 無し | **何もしない** |
| `CME_MINI:ES1!`（先物） | `CME_MINI` | 無し | **何もしない** |
| `FX:USDJPY` / `OANDA:USDJPY` | `FX` / `OANDA` | 無し | **何もしない** |
| `BINANCE:BTCUSDT`（暗号資産） | `BINANCE` | 無し | **何もしない** |
| `NYSE:BRK.B` / `NYSE:BRK-B` / `NYSE:BRK・B`（クラス株・連結記号の表記） | `NYSE` | `us` | **何もしない**（後続境界を満たさない。上記） |

取引所が対象でも、続く値がコード書式に合わなければ落ちる（SPEC-TC-07 の 3）。
**「何もしない」は区切り線も出さないことを含む**（条件6 を満たさないので DOM を一切変更しない）。

### スクロール・ウォッチリスト切り替えへの追随（判定基準 8）

**行にも、ウォッチリストの容器にも、イベントや `MutationObserver` を張らない。**
`document` の `contextmenu` 1本で受け、発生元から祖先をたどって行かどうかを判定する。

| 観点 | 結果 |
| --- | --- |
| 仮想スクロールで行が差し替わる | 影響しない。張り直しが不要（毎回たどり直す） |
| 別のウォッチリストへ切り替える | 同上 |
| 監視の増加（NFR-01, CON-03） | 無し。リスナーは 1.13.0 と同じ1本のまま |
| 1回の右クリックのコスト | 祖先方向の `closest()` 1〜2回 |

比較検討と却下した案は ADR-0010 の 5。

### チャート起点を構造的に守る（再レビュー M-5 / 2026-08-29）

**FR-04（必須。1.13.0 から動いている）を、FR-19（優先度: 希望）の推測で殺さないための節。**

危険はこうだった。`resolveContextMenuOrigin()` は行をチャートより先に見て、
**目印が見つかったが解釈できなければ捨て、チャートへ落とさない**（判定基準 2 のための設計で、これは正しい）。
ところが「目印」が**属性の有無**だけで決まっていたため、
**チャート領域内の要素が候補属性を持ち、その値が `EXCHANGE:CODE` でなければ、
チャートの右クリック拡張が全面的に止まる**。しかも属性名は実サイト未確認の推測値だった。

#### 採った手当て（3つ。どれも実サイト情報を要さない。すべて 1.15.0 で実装済み）

| # | 変更 | これで消える危険 | 代償 | 版 |
| --- | --- | --- | --- | --- |
| 1 | 候補属性から **`'data-symbol'` を外す** | 最も汎用的な名前が消え、チャート内の無関係な要素に当たる確率が大きく下がる | **新機能が動かない**だけ（実測の属性名が本当に `data-symbol` だった場合。A-13 が NG → 1箇所を直す） | 1.15.0 |
| 2 | **行と見なす条件を「値が `EXCHANGE:CODE` の形」に狭める** | チャート内の `data-symbol-full` / `-short` が `main` / `8253` のような値でも**行と見なされず、チャート起点が生きる** | 無し（本物の行は `EXCHANGE:CODE` を持つと要件が確定させている） | 1.15.0 |
| 3 | **形の字種を解釈側と揃える**（`[A-Za-z]` → `[A-Z]`） | `main:1` / `chart:2` / `pane:0` のような**小文字の内部識別子**が「行」から外れる。**解釈が絶対に成功しない値を捨てる経路**が縮む | 小文字始まりのコロン値を持つ行は行と見なされない。**下記「残る穴」に一行加わる**が、期待どおりの配置では結果が変わらない | 1.15.0 |

**2 が本体。** 1 だけでは `data-symbol-short`（値はコード単独）がチャート内にあると同じ事故が起きる。
2 は「行の定義を、属性の有無から**値の形**に移す」ことで、その経路ごと塞ぐ。

**3 は 2 の詰め。** 2 の当初は形の字種が `[A-Za-z]` で**解釈側（`[A-Z]+`）より広く**、
その差分（`main:1` など）が丸ごと「形は満たすが解釈できない」＝**捨てる**に落ちていた。
**M-5 で塞いだはずの失敗モードが、値の形の範囲だけ狭めて残っていた**（最終レビュー M-5b）。
**差分そのものは消えない**（判定基準 7 が `SP:SPX` を行として扱うことを要求するため。
上記「残る差分」）。3 は**差分を「大文字＋コロン」まで縮める**手当て。

#### 採らなかった案（reviewer の提案）

**`resolveContextMenuOrigin()` の先頭でチャートを判定し、チャート内なら即 `kind: 'chart'` を返す。**

```javascript
// 採用しなかった
if ($(target).closest('div.chart-gui-wrapper').length > 0) {
  return { kind: 'chart', at: Date.now(), code: null, type: null }
}
```

**却下。危険の向きが提案時の見立てと違う。**
提案では最悪ケースが「ウォッチリストが `div.chart-gui-wrapper` の内側にある → **新機能が動かない**」
とされていたが、**実際に起きるのは「行を右クリックしたのにチャートの銘柄が出る」**。
先頭で返すと行の判定に到達しないため、**入れ子配置ではすべての行で誤った銘柄のリンクが出る**。
これは FR-19 判定基準 2 ＝ **FR-04 違反**で、本 ADR が最も重いと定めた失敗そのもの（ADR-0010 の 0）。

| 案 | ウォッチリストが `chart-gui-wrapper` の内側だったとき | チャート内に候補属性があったとき |
| --- | --- | --- |
| 現行（行が先） | 正しく行の銘柄が出る | **チャート起点が死ぬ**（← 手当て 1・2 で解消） |
| reviewer 案（チャートが先） | **全行でチャートの銘柄が出る（重い失敗）** | チャート起点は無傷 |
| **採用（行が先＋形の条件）** | 正しく行の銘柄が出る | チャート起点は無傷 |

**「新機能が動かない側に倒す」という reviewer の判断基準自体は正しい。**
手当て 1・2 はその基準を満たしたうえで、**重い失敗の経路を新設しない**。

#### 残る穴（承知のうえで残す）

**ウォッチリストが `div.chart-gui-wrapper` の内側にあり、かつ行の目印が
`EXCHANGE:CODE` の形の値をどこにも持たない**場合、行はチャート起点として扱われ、
**チャートの銘柄が出る**（重い失敗）。**手当て 3 により、
「行の値が小文字始まりのコロン値（`nyse:aapl` 等）だけ」の場合もこの穴に入る。**

> **期待どおりの配置（ウォッチリストが `chart-gui-wrapper` の外）なら、手当て 3 で結果は変わらない。**
> 小文字始まりの行は、3 の前は「行 → 解釈できない → 捨てる」、3 の後は
> 「行ではない → チャート判定も外れる → 捨てる」で、**どちらも何も出ない**。
> 差が出るのは入れ子配置のときだけで、そこは元々この穴の範囲。

- この条件が成り立つ世界では**そもそも FR-19 が動かない**（形の値が無いので銘柄を取れない）。
  つまり「新機能が動かないうえに誤った銘柄が出る」という並びになるため、**A-13 が NG なら
  A-17 の結果に関わらず、まず属性名を実測して直す**
- 検出は手動確認 **A-13**（行の銘柄が出るか）と **A-15**（指数の行で何も出ないか）。
  A-15 で「チャートの銘柄が出る」なら、この穴を踏んでいる。**その場合は手当て 2 を外し、
  行の目印を見つけた時点で必ず捨てる**（1.15.0 の実装当初の形）に戻す

#### 実装（1.15.0）

| 実装 | 内容 |
| --- | --- |
| `watchlistSymbolAttrs` | `['data-symbol-full', 'data-symbol-short']`。`watchlistRowSelector` は配列から組み立てるので `[data-symbol-full],[data-symbol-short]` に追従する |
| `isSymbolShaped(text)` | 値が `EXCHANGE:CODE` の**形**（`/^[A-Z][A-Z0-9_]*:/`）かだけを見る**純粋関数**。**`exchanges` を引かない**こと、**字種は `parseExchangeSymbol()` の取引所トークンと揃える**こと、広げると FR-04 が止まることを JSDoc に明示してある |
| `findRowTickerCode(target)` | 形を満たす値だけを行の値と見なす。`shaped` フラグで、形の値をどこにも見なければ **`null`**（行ではない → チャート判定へ）、形はあって解釈できなければ **`{ code: null, type: null }`**（捨てる） |
| 起点の優先順位 | **変えていない**（行 → チャート → 捨てる） |

- **形の判定に `exchanges` を使わない。** `SP:SPX` は「行だが解釈できない」（捨てる）であって
  「行ではない」ではない。混ぜると指数の行にチャートの銘柄が出る（判定基準 7 違反）
- 手動確認の文言（A-13 / A-15 / A-17）も本変更に合わせてある

**上限と下限を両方テストで固定してある**（最終レビュー M-5b）。

| 固定するもの | テスト | 内容 |
| --- | --- | --- |
| 上限（広げすぎの防止） | `EXCHANGE:CODE の形だけを行の値と見なす` | 偽: `main:1` / `chart:2` / `pane:0` / `Widget:1` / `nyse:aapl`。**次に触る人が「小文字も通そう」と戻すのを事故で起こさせない** |
| 差分が残ることの明示 | 同上 | 真: **`MAIN:1`**。「残る差分」が**消えたと誤解させない** |
| 下限（狭めすぎの防止） | `解釈できる値は必ず形を満たす（形の判定は解釈より狭くならない）` | `parseExchangeSymbol()` が `code` を返す値は必ず `isSymbolShaped()` が真。**同じループで `code` が非 null であることも断言**し、テストが空振りしていないことを担保する |

> **総当たりでの裏づけ（2026-08-29 / developer の開発時確認。テストには入っていない）:**
> `exchanges` の**全7キー × `_DLY` の有無 × 市場ごとの妥当なコード × 後続文字列の有無＝108値**を生成し、
> **108件すべてで `parseExchangeSymbol()` が `code` を返し、すべて `isSymbolShaped()` が真**（違反 0 件）。
> 差分が「大文字＋コロン」に縮んでいることも確認した（`SP:SPX` / `MAIN:1` / `CME:ES1!` / `XETR:BMW` は
> **形は真・解釈は `null`** ＝ 行として捨てる）。
> **コミットされているテストが固定するのは上表の 5 サンプル**で、108値の総当たりは実行時の確認に留まる。

#### 自動テストが届く範囲と届かない範囲

**規則（形の判定）は固定された。配線（分岐が起点に結び付いていること）は未検証。**

| 対象 | 手段 |
| --- | --- |
| `isSymbolShaped()` の真偽 | `auto`（`tradingview-cs.js: isSymbolShaped › EXCHANGE:CODE の形だけを行の値と見なす`。`tests/content-script.spec.mjs`） |
| 形の判定と解釈の**包含関係**（解釈できる値は必ず形を満たす） | `auto`（`tradingview-cs.js: isSymbolShaped › 解釈できる値は必ず形を満たす（形の判定は解釈より狭くならない）`） |
| `findRowTickerCode()` の**戻り値3値の作り分け**と、それを起点へ結び付ける分岐 | **無し。** `$().closest()` による DOM 走査で、フィクスチャを作っても実サイトとの乖離を検出できない（CON-08）。**目視は A-13 / A-15 / A-17 のみ** |

> **「#3 の危険を縮めた」の根拠はこの分岐**なので、**分岐そのものが実 DOM で未検証**であることを
> 「実サイトで確認すべき事項」の **7** に残してある。設計としては閉じているが、
> **配線の確認が済むまでは「縮めたはず」であって「縮めたことを確かめた」ではない。**
> **そのうえで、縮めても差分は残る**（上記「残る差分」）。

### 検証対象に載せない理由（`menuSelectors`）

行の目印は `menuSelectors`（SPEC-CS-15）に**足さない**。`div.chart-gui-wrapper` と同じ扱い
（ADR-0002 の 3）。理由は2つ。

1. **属性名が推測のままなので、`check:selectors` の ❌ が「破損」か「最初から間違い」かを区別できない**
2. 足すと SPEC-SC-02 の対象が 20 → 21 になり、`targets.mjs` に**ウォッチリストの行を右クリックする操作**と
   ページ識別セレクタの追加が要る。加えて検証は未ログインで走る（FR-16）ため、
   未ログインのチャート画面に銘柄行が出るかが未確認で、0 件が常態化しかねない

**載せ替えを再検討する条件:** (1) 実サイトで属性名が確定し、(2) 未ログインでも銘柄行が出ることが
確認できたとき。どちらも実サイトを見ないと決まらない。

### 実サイトで確認すべき事項（1.15.0 時点で未確定）

> **2026-08-30 に利用者が実機で確認した。残るのは 6 だけ。**
>
> | # | 結果 |
> | --- | --- |
> | 1（属性名が推測） | **解消。** 行から銘柄が読めた＝`data-symbol-full` / `data-symbol-short` のどちらかが実在する。**どちらかまでは分かっていない**（実装は両方を候補として持ったままでよい） |
> | 2（属性が行そのものに付いているか） | **解消。** 祖先方向の走査で読めている |
> | 3（チャート内の候補属性） | **解消。** チャート起点の右クリックが退行していない（「チャートもでる」） |
> | 4（米国株・指数の表記） | **解消。** `SPCX`（ETF）で項目が出て、`SPX`（指数）では出ない |
> | 5（メニューの器） | **解消。** 行起点で項目が出ている以上、器はチャートと同じ1つ |
> | 7（DOM 走査の配線） | **解消。** 3・4 が意図どおりということは、`null` と `{ code: null }` の作り分けが効いている |
> | **6（ウォッチリスト以外に同じ目印を持つ要素が無いこと）** | **未解消。誰も見ていない**（A-17 の後半）。**属性名が実在すると分かった分、他ウィジェットにも同じ属性がある可能性はむしろ上がった** |
>
> **6 を他の項目と一緒に畳まない。** これが FR-19 で唯一残る「**出てしまう**」側の危険で、
> 出てしまう害（別ウィジェットで無関係な銘柄のリンクが出る）は「出ない」害より重い。

**下表のうち未確認は 6 だけ。** 1・2・3・4・5・7 は 2026-08-30 の実機確認で埋まった（上記）。
残りは手動確認 **A-17 の後半**で確定させる。

> **本表は「実装が推測に頼っている箇所」の一覧で、FR-19 の判定基準の消化状況とは別の表。**
> **FR-19 側にはもう1件残っている**（判定基準8＝スクロール・ウォッチリスト切り替え後。**A-16**）。
> あちらは推測ではなく**未実施の確認**なので本表に行が無い。
> **本表だけを見て「残るは A-17 の後半だけ」と読まないこと**
> （`docs/requirements/README.md` と FR-19 は「未確認 3（A-16）と 6」と数えている。
> **番号が指すものが表ごとに違う**）。

**「誤った銘柄のリンクが出る経路は無い」とは書かない。**
外れたときの影響は「何も出ない」「行以外の場所で項目が出る」に限られるが、
これは**推測が外れた場合の影響**の話であって、
解釈そのものの正しさとは別。解釈側には実際に誤読の経路があった
（上記「米国コードの後続境界」。後続境界で塞いだ）。

| # | 確認すること | 外れていたときの影響 | 直し方 |
| --- | --- | --- | --- |
| 1 | 行が持つ属性の**名前**（`data-symbol-full` / `data-symbol-short` のどちらか、または別名） | ウォッチリストで**何も出ない**（誤った銘柄は出ない） | `src/tradingview-cs.js` の `watchlistSymbolAttrs` を実測値に直す（**この1箇所だけ**） |
| 2 | 属性が**行そのもの**に付いているか（子要素に分かれていないか） | 同上 | 祖先方向の走査でほぼ吸収できる。吸収できなければ読み取り方を見直す |
| 3 | ~~チャート（`div.chart-gui-wrapper` の内側）に候補属性を持つ要素が**無い**こと~~ **前提を大きく縮めた**（上記「チャート起点を構造的に守る」）。チャート内に候補属性があっても、値が `EXCHANGE:CODE` の形でなければ行と見なさずチャート起点が生きる。**ただし「大文字＋コロン」の値だけは今も行と見なされる**（「残る差分」）ため、**完全には消えていない。7 に統合した** | — | — |
| 4 | 米国株・指数を含むウォッチリストでの表記（調査時は全件が国内株） | 判定基準 6・7 が未確認のまま | 表記を実測して `exchanges` を見直す |
| 5 | 行の右クリックで開くメニューが**チャートと同じ器**（`overlap-manager-root` 直下に1つ）であること | 条件2（`overlap-root` がちょうど1件）に落ちて**何も出ない** | 条件2 の見直し（本節の改訂） |
| 6 | **候補属性を持つ要素がウォッチリストの行にしか無いこと。** `watchlistRowSelector` はページ全体に対して評価され、ウィジェットの種類で絞っていない | 銘柄検索の候補一覧・スクリーナー・詳細ウィジェットが同じ属性を持つと、**そこでも項目が出る**（FR-19 判定基準 5 に反する） | ウォッチリストの容器を起点にする形へ変える。容器の特定にハッシュ付きクラスが要る（CON-08）ため、**実際に出る場所が分かってから**決める |
| 7 | **`findRowTickerCode()` の分岐が実 DOM で意図どおり働くこと**（形の値が無い要素 → `null` → チャート起点／形はあって解釈不能 → 捨てる）。**DOM 走査部分に自動テストが無い**（CON-08。固定されているのは純粋関数 `isSymbolShaped()` / `parseExchangeSymbol()` だけ）。**チャート内の要素が `MAIN:1` のような大文字＋コロンの値を持たないこと**も含む（上記「残る差分」） | 配線が意図と違えば、**チャート起点が死ぬ**（3 の縮小が効いていない）か、**指数の行にチャートの銘柄が出る**（判定基準 7 違反） | A-17 の1つめ（チャート）と A-15（指数の行）の**両方**を見て切り分ける。片方だけでは分からない。チャート起点が死ぬ場合は、右クリックした位置の要素が持つ**属性名と値**を実測して候補属性を絞る |

**残る 6 は国内株だけのウォッチリストで確認できる**（A-17 の後半。他ウィジェットを開いて右クリックする）。
1・2・5・7 は A-13 / A-15 で、4 は A-14 で 2026-08-30 に確認済み。

> **3 と 6 は同じ弱点の裏表だった**（行の目印が「属性を持つ要素」で、ウォッチリストに限定されていない）。
> 3 はチャート領域側（**項目が出なくなる**）、6 はそれ以外の場所（**項目が出てしまう**）。
>
> | | 手当て | 残り |
> | --- | --- | --- |
> | 3（出なくなる側） | **危険の範囲を縮めた**（消してはいない）。行の定義を「値が `EXCHANGE:CODE` の形（大文字＋コロン）」に狭めた | 残るのは**チャート内に大文字＋コロンの値がある場合**だけ。分岐が実 DOM で働くことともども未確認（7） |
> | 6（出てしまう側） | **残る。** 銘柄検索の候補一覧・詳細ウィジェット等が同じ属性と `EXCHANGE:CODE` の値を持てば、そこでも起点になる | **A-17 の2つめの操作**で見る。出た場所が分かってからウィジェットで絞る |
>
> **6 だけが「出てしまう」側**なので、`未確認 → 何も起きない` とは言えない。
> **2026-08-30 の実機確認で 3 と 7 が埋まった今、残っているのは 6 だけ**であり、
> **FR-19 で唯一残る危険が「出てしまう」側になった**。
> 要件側（FR-19 の未確認表）が「どれが外れても『出ない』側に倒れる」としていたのは
> **本節の 6 について誤り**。analyst に訂正を依頼済み（本節の記述が正）。

**後続境界（`BRK.B` / `BRK-B` などの表記）の行は上表に足さない。** 判断の根拠は次の2つ。

| 観点 | 理由 |
| --- | --- |
| 入力が DOM に依存しない | 判定は文字列処理だけで閉じており、**自動テストで固定できる**（FR-08 の「✅ に戻す条件」も自動テストだけで判定するとしている）。上表は「実サイトを見ないと決まらないこと」だけを載せる |
| 表記が何であれ結果が同じ | TradingView が `BRK.B` と書くか `BRK-B` と書くかは未確認だが、**許可列挙なのでどちらでも「何も出さない」に落ちる**（未知の表記が出ても既定で落ちる側）。挙動の分岐が無いので確認する意味が無い |

目視での確認は **A-15**（`BRK.B` と `BRK-B` の行で何も出ないこと）に置いてある。
これは上表の未確認事項の消化ではなく、**自動テストが触れない「行 → メニュー」経路の回帰確認**。

### FR-19 の判定基準との対応

| FR-19 判定基準 | 満たす仕組み |
| --- | --- |
| 1 行を右クリックすると項目が出る | 起点の判定 1 → 条件4・6 を通る |
| 2 出る銘柄が**その行**のもの | 起点の記録が1件で、行がチャートより優先。銘柄は右クリック時に確定 |
| 3 読み取れないときは追加しない | 起点の判定 2（捨てる）。**`EXCHANGE:CODE` の形の値を持つ行はチャートへ落ちない** |
| 4 メニューの形は FR-18 に従う | `addTickerMenuAsync()` 以降を変えていない |
| 5 チャート・ウォッチリスト以外では出さない | 起点の判定 4（捨てる）。1.13.0 と同じ |
| 6 国内株・米国株で正しいリンク | `type` を SPEC-CS-18 に渡すだけ。米国株の絞り込みは既存 |
| 7 指数・先物・FX・暗号資産では出さない | `exchanges` に無い取引所を対象外にする。**形は満たすので「行」ではあり、チャートへ落ちずに捨てられる** |
| 8 スクロール・切り替え後も動く | `document` で受けて祖先をたどる（行にイベントを張らない） |

**FR-04 との整合（申し送り）:** 1.15.0 で、FR-04 の「チャート以外を右クリックしても
項目を追加しない」の禁止対象から**ウォッチリストの銘柄行**が外れた（FR-04 の 2026-08-23 追記のとおり）。
ツールバー・銘柄検索・行を特定できない余白は引き続き禁止のまま。
**要件本文（FR-04 の禁止対象の書き換え、FR-19 の状態）の更新は analyst の担当。**

- 要件: FR-19, FR-04, FR-08, FR-18, NFR-01, NFR-13, CON-03, CON-08
- 検証: `auto`（`tradingview-cs.js: parseExchangeSymbol` **3件** と
  `tradingview-cs.js: isSymbolShaped` **2件**（`EXCHANGE:CODE の形だけを行の値と見なす` /
  `解釈できる値は必ず形を満たす（形の判定は解釈より狭くならない）`）。
  `tests/content-script.spec.mjs`。
  `node:vm` で `src/urls.js` ＋ `src/tradingview-cs.js` を評価して関数だけを取り出す
  （ビルドが無く `export` が使えないため。CON-02）。**DOM を使う部分は対象外**（CON-08）で、
  ここで固定できるのは `EXCHANGE:CODE` の解釈と**形の判定**だけで、
  **`findRowTickerCode()` の DOM 走査と分岐は含まない**（上記「自動テストが届く範囲と届かない範囲」）。
  後続境界の回帰も `parseExchangeSymbol` の3件が持つ）／
  `auto`（**境界の値の一致**は `米国ティッカーの後続境界: リテラル3本で同じ値 › リテラル3本とも同じ境界で、u フラグが付いている`。
  `tests/service-worker.spec.mjs`。3経路の件数・`u` フラグ・境界文字列の一致を固定する）／
  `半自動` **無し**（`menuSelectors` を増やさないため `check:selectors` の対象は 20 のまま。
  チャート起点の非退行は既存の `overlap-root` / `context-menu` が見る）／
  `manual`（`docs/MANUAL-CHECKLIST.md` **A-13〜A-17**。1.15.0 で新設。
  A-13 国内株の行 ／ A-14 米国株・指数を混在させたウォッチリスト ／ A-15 対象外の行 ／
  A-16 スクロール・ウォッチリスト切り替え後 ／ A-17 **チャート起点とツールバー・銘柄検索の非退行**。
  既存の **A-6 の3つめの操作**は期待結果を反転させた（ウォッチリストでは**出るのが正しい**）。
  **2026-08-30 に A-13 / A-14 / A-15 / A-17 の前半を実施し、上表は 6 だけが残った**）／
  `manual`（**未消化**: **A-16**（スクロール・切り替え後。判定基準 8）と **A-17 の後半**（上表 6））

---

## SPEC-CS-24 TradingView: 右クリックメニューの縦位置補正（FR-24）

> 1.16.0 で実装した（FR-24）。設計判断は [ADR-0012](../adr/0012-tradingview-menu-vertical-fit.md)。
> 補正の実装は `fitContextMenuIntoWindow()`（`src/tradingview-cs.js`）。

拡張が3行を足すとメニューは下へ伸びるが、**TradingView は伸びたことを知らないので位置を直さない**。
画面の下寄りで右クリックすると追加行がウィンドウの外に出て、**ホバーできず入れ子も開けない**。
拡張が伸ばした分は拡張が収める。

### 何を触るか

| 対象 | 値 |
| --- | --- |
| 要素 | `ctxMenu.closest('div.context-menu')` の1件（SPEC-CS-17 の `positionSubmenu()` と同じ引き方） |
| プロパティ | **インラインの `margin-top` だけ** |
| 触らないもの | `top` / `transform` / `height` / 項目の内容・並び・件数（判定基準7） |

**`top` も `transform` も読まない。** サイト側がどちらで位置決めしていても、
負の `margin-top` は箱をそのまま上へずらす（ADR-0012 の 2）。

### 手順

1. 3行を**同期的に**追加する（SPEC-CS-11。ここは変えない）
2. **次のフレーム**（`requestAnimationFrame`）で補正を1回だけ行う
   （サイト側が位置を決め終える前に測らないため。ADR-0012 の 5）
3. 補正の中で、次を上から順に判定し、1つでも満たさなければ**何もしない**

   | # | 条件 | 満たさないとき |
   | --- | --- | --- |
   | 1 | 追加した区切り行がまだ document にある | 何もしない（0件・例外で除去済み） |
   | 2 | `div.context-menu` が引ける | 何もしない |
   | 3 | `overflow = Math.ceil(rect.bottom - window.innerHeight)` が **0 より大きい** | 何もしない（**判定基準5**。下端に掛からない位置では今までと同じ位置に出る） |
   | 4 | `shift = Math.min(overflow, Math.floor(rect.top))` が **0 より大きい** | 何もしない（既に上端に接している） |

4. `menu.style.marginTop = '-' + shift + 'px'` を設定する。**ずらしたことを記録する**
5. 3行を除去する経路（0件・例外。SPEC-CS-11）では、**ずらしていたときだけ
   `margin-top` を元の値に戻す**（拡張の痕跡を残さない。FR-18 判定基準6 と同じ方針）

   > **状態: 5 の「ずらしていたときだけ」は未実装（予定）。**
   > 現在は補正が掛かったかに関わらず書き戻すため、`requestAnimationFrame` が発火する前に
   > 0件経路へ入ると**触っていない要素に `style` 属性が残る**（値は空文字）。
   > **実害はほぼ無い**（TradingView はクリック座標をインラインスタイルで持つので `style` 属性は元からある）が、
   > **「痕跡ゼロ」は条件つきではなく構造で保証したい**。下記「developer への申し送り」を参照

- `shift` の切り捨て・切り上げは**下端を切らない側**に倒す（`overflow` は切り上げ、`rect.top` は切り捨て）
- **余白は足さない。** 利用者の要望は「見切れる分だけ上に移動」で、それ以上寄せる根拠が無い

### 上端は切らない（判定基準3）

`shift` を `rect.top` で頭打ちにすることで、**メニューの上端がウィンドウの外に出ない**。
サイト側の項目は上に並んでいるため、上を切ると**サイト側の機能が使えなくなる**（NFR-01）。

### 画面より高いメニュー（判定基準4）

**拡張はスクロール層を足さない**（確定。2026-08-30）。
メニューの外枠にはサイト側のスクロール層（模倣用クラス `scrollWrap`。SPEC-CS-16）があり、
**利用者の実機確認で「TradingView 自身のメニューはスクロールできる」ことが分かった**。
判定基準4 は**サイト側のスクロールで満たされる**。

| 状態 | 扱い |
| --- | --- |
| メニューが画面に収まる | 補正で下端まで収める（上記「手順」） |
| メニューが画面より高い | 上端で頭打ちにし、**下は見切れたまま**。到達はサイト側のスクロールで行う |

> 採択時は「サイト側がスクロールするかは未確認」として**先回りで他人の DOM を触らない**方針を採り、
> 手動確認で決めることにしていた（ADR-0012 の 4）。**確認の結果、足さないで確定。**

### 起点による差は無い

補正は `addTickerMenuAsync()`（チャート起点・ウォッチリスト行起点の共通経路。SPEC-CS-23）で行う。
**行起点でも同じ補正が掛かる**（判定基準6）。

### 対象外

| 対象 | 理由 |
| --- | --- |
| 入れ子（サブメニュー）の縦位置 | SPEC-CS-17 で対処済み（画面内に収め、`overflow-y` でスクロール） |
| 横方向のはみ出し | FR-24 の「やらないこと」。報告が無い |
| 「株Link」ボタンのメニュー（SPEC-CS-12） | FR-24 の対象外。**ただし同じ症状が出る可能性が高い**（クリック座標に自前で置いており、縦のはみ出しを見ていない）。A-18 に観察ステップを置き、出るなら要件として起こす |

### 実装（1.16.0 / SPEC-CS-24）

| 実装 | 内容 |
| --- | --- |
| `fitContextMenuIntoWindow(addedRow)` | 補正の本体（上記「手順」の 3・4）。**`positionSubmenu()` は変更していない**（あちらは自前の入れ子、こちらはサイト側の親メニューで、触ってよい範囲が違う） |
| `addTickerMenuAsync()` | 3行を追加した直後に `requestAnimationFrame` で補正を1回予約する |
| `removeRows()` | 追加前の `margin-top` を控えておき、3行を除去するときに戻す |

- **`menuSelectors` は増やしていない。** `div.context-menu` は既に検出用セレクタ
  `context-menu` に入っている（SPEC-CS-15）。`closest()` の引数はそこから引く

#### developer への申し送り（未実装分。レビュー 🟢6）

| # | ファイル | 変更 |
| --- | --- | --- |
| 1 | `src/tradingview-cs.js` | `fitContextMenuIntoWindow()` が実際に `margin-top` を書いたかを**呼び出し側が分かる形**にする（戻り値でも、`addTickerMenuAsync()` 側のフラグでもよい） |
| 2 | `src/tradingview-cs.js` | `removeRows()` は**ずらしたときだけ** `margin-top` を書き戻す |

- **挙動は変わらない。** 変わるのは「触っていない要素に `style` 属性を作らない」ことだけ
- **`fitContextMenuIntoWindow()` は 4 つの `return` すべてが「何もしなかった」を意味する**ので、
  戻り値を足すなら**書いたときだけ真**にすれば足りる

#### 自動テストが無いこと（CON-08）

**測る値がウィンドウの高さなので、フィクスチャでは実サイトとの差が出る。**
本節に対応する自動テストは無い。

> **開発時の確認（使い捨てスクリプト。テストには入っていない）:**
> はみ出さない → 無変更／下に 100px はみ出す → `margin-top: -100px` で下端ぴったり／
> 画面より高い → 上端で頭打ちになり下は見切れたまま（**仕様どおり**）／
> 3行が除去済み → 何もしない、の4通りを確認した。
> **恒久的に守られているのは仕様の記述だけで、コードの回帰はこの確認では止まらない。**

- 要件: FR-24, FR-04, FR-18, FR-19, NFR-01, CON-03, CON-08
- 検証: `manual`（`docs/MANUAL-CHECKLIST.md` **A-18**。1〜3・5・7 は下端付近での右クリック、
  6 はウォッチリストの行で同じことを行う。**判定基準4 はサイト側のスクロールで満たす**ことが
  2026-08-30 の実機確認で確定した）／`auto` **無し**（CON-08。上記「自動テストが無いこと」）

---

## SPEC-CS-25 メニュー項目のクリック範囲（FR-25）

> 1.16.0 で実装した（FR-25）。設計判断は [ADR-0013](../adr/0013-tradingview-menu-item-hit-area.md)。
>
> **対象は TradingView だけではない**（2026-08-30 に楽天証券・SBI証券を追加。FR-25 判定基準 2-d）。

拡張が出すメニューの項目は、**行のどこをクリックしても
文字の上をクリックしたときと同じ結果**になること。**サイトを問わない。**

### 対象と手段

**手段はサイトごとに違う。DOM の形が違うため**（ADR-0013 の 4）。
**揃えるのは利用者から見た挙動であって、実装の手段ではない。**

| # | 対象 | 実装 | 手段 |
| --- | --- | --- | --- |
| 2-a | TradingView・右クリックメニューの入れ子（チャート起点） | `makeMenuItem()` | **JS**（行のハンドラで `<a>` のクリックを代行） |
| 2-b | 同（ウォッチリストの行起点。FR-19） | 同上（共通） | 同上 |
| 2-c | TradingView・「株Link」ボタンのメニュー | `makeButtonMenuItem()` | **変更しない**（既に行全体が反応する。非退行の確認） |
| 2-d | 楽天証券・SBI証券のリンクメニュー | `linkMenu.js` の `createMenuItem()` | **CSS のみ**（`<a>` を `display: block`。ハンドラを増やさない） |

**2-a / 2-b で CSS が使えない理由:** 項目の左にアイコン用の `<td>` があり、
**`<a>` をセルをまたいで広げられない**（判定基準1 は「左のアイコン列」を含む）。

**2-d で JS を使わない理由:** 注入先サイトの DOM にハンドラを増やさずに済む（NFR-01）。
`<li>` は既に `display: block; width: 100%` で、`<a>` を block にすれば文字の右も上下も覆える。

### 現状（初版からの構造）

| サイト | 押した場所 | 現在 |
| --- | --- | --- |
| TradingView | 文字の上（`<a>`） | 新しいタブで開く → メニューが閉じる |
| TradingView | **アイコン列・文字の右の余白・上下の余白** | **メニューが閉じるだけで何も開かない** |
| 楽天・SBI | 文字の上（`<a>`） | 新しいタブで開く（**メニューは開いたまま**） |
| 楽天・SBI | **文字の右の余白** | **何も起きない**（メニューは開いたまま。押し直せるので害は小さい） |

行のハンドラが「Esc を投げて閉じる」しかしていないため。
**行はホバーでハイライトする**（サイト側の `{item}` クラス）ので、見た目と挙動が食い違っている。

### 変更後の規則（2-a / 2-b。TradingView）

行の `click` ハンドラで次を行う。

| # | 条件 | 動作 |
| --- | --- | --- |
| 1 | `event.target.closest('a')` が**その行の `<a>`** | 何も代行しない（ブラウザがリンクを開く） |
| 2 | 1 以外で、行の中に `<a>` がある | **その `<a>` の `click()` を呼ぶ**（代行） |
| 3 | 行の中に `<a>` が無い | 何もしない |
| — | 上のいずれの後でも | **メニューを閉じる**（現行と同じ `keyup` / `keyCode: 27` の送出） |

- **開く経路は `<a>` の1本のまま。** URL・`target="_blank"`・`rel="noopener noreferrer"` を
  2箇所で持たない（SPEC-CS-05）
- **`chrome.runtime.sendMessage({ type: 'open-url' })` は使わない。**
  押した場所で経路が割れると、切断状態（SPEC-CS-19）での挙動まで割れる
- **閉じるのは開いた後。** 先に閉じると `<a>` が DOM から外れ、代行クリックが空振りする
- 閉じ方は現行のまま（`keyup` / `keyCode: 27` の送出）。**開閉の挙動は変えない**（判定基準4）

#### 代行クリックが戻ってくる分を捨てる（`delegating`）

**代行で発火した `<a>` のクリックは、同じ行まで再びバブルして戻る。**
そのままだとハンドラが2回走り、**`keyup`（Esc）を2回投げる**ことになる。

`makeMenuItem()` は**行ごとのローカル変数** `delegating` を1つ持ち、代行中に戻ってきた
クリックでは**何もせずに抜ける**。

| 押した場所 | ハンドラの回数 | `<a>` のクリック | Esc |
| --- | --- | --- | --- |
| 文字の上 | 1回 | ブラウザが処理 | 1回 |
| 文字の外 | 2回（2回目は `delegating` で素通り） | 1回（代行） | **1回** |

- **利用者から見た挙動は上表と同じ**（開く → 閉じる）。フラグは Esc の重複を防ぐためだけにある
- **他社サイトへ余計なキーイベントを渡さない**（NFR-01 / CON-03）。
  Esc は TradingView 側の閉じる処理を呼ぶ手段で、**2回投げると別の動作を誘発しうる**
- 変数は**行ごと**（`makeMenuItem()` のクロージャ）。項目をまたいで共有しない
- 代行は `try` / `finally` で囲み、`<a>` のクリックが例外で終わってもフラグを残さない

### 変更後の規則（2-d。楽天証券・SBI証券）

`src/style.css` に規則を1つ足す。**JavaScript は変更しない。**

```css
li.x-kabu-menu-item > a {
  display: block;
}
```

| 観点 | 結果 |
| --- | --- |
| 押せる範囲 | `<li>` の**内容ボックス**いっぱい（文字の右・上下を含む） |
| 項目間の隙間（判定基準6） | **押せないまま。** `<li>` の `margin: 3px 6px`（SPEC-CS-03）は要素の外側で、`<a>` の箱に入らない |
| メニューの開閉（判定基準4） | **変わらない。** ホバーで開き、外れると閉じる（SPEC-CS-04）。クリックでは閉じない |
| サイト側の操作（判定基準7） | **ハンドラを増やさないので影響しない**（NFR-01） |
| 見た目 | 行の高さ・余白・字下げは変えない（FR-25 の「やらないこと」）。`<a>` の箱が広がるだけで、下線は文字の幅のまま |

- **`padding` を足して行を大きくしない。** 判定基準6（隙間で隣を開かせない）と
  「見た目を変えない」の両方に効く
- `<li>` の DOM 構造・クラス名は変えない（SPEC-CS-03 と自動テストのセレクタを動かさない）

### 退行させないもの（判定基準5）

**どちらの手段でも `<a>` をそのまま残す**ので、**文字の上**では次が構造上維持される。
**文字の外**でどこまで同じになるかは**手段によって違う**（次節）。

| 項目 | 根拠 | 文字の外（TradingView / JS 代行） | 文字の外（楽天・SBI / CSS） |
| --- | --- | --- | --- |
| 新しいタブで開く（左クリック） | `target="_blank"`。代行クリックも同じ `<a>` を通る | ✅ | ✅ |
| ツールチップ（`title`） | `<a title="…">` のまま | ❌（`<a>` の外にはツールチップが無い） | ✅ |
| 中クリック・Ctrl+クリック | ブラウザが `<a>` に対して行う | ❌（後述） | ✅ |
| 右クリックからの「リンクのアドレスをコピー」 | `href` のまま | ❌（後述） | ✅ |
| ホバー時のハイライト | サイト側の `{item}` クラス。触らない | ✅ | ✅ |

### 既知の制限（TradingView 側は左クリックだけが同等。判定基準5）

**行のハンドラが見るのは `click` だけ**なので、**文字の外**では次が効かない。

| 操作 | 文字の上 | 文字の外 |
| --- | --- | --- |
| 左クリック | 新しいタブで開く | **同じ**（代行） |
| **中クリック**（`auxclick`） | 背景タブで開く | **何も起きない** |
| **右クリック**（`contextmenu`） | ブラウザのメニューに「リンクのアドレスをコピー」が出る | **出ない** |
| ツールチップ（`title`） | 出る | 出ない |

- **判定基準1 は満たしている。** FR-25 は 2026-08-30 に「クリック＝**左クリック**」と明示した。
  本節が書いているのは**判定基準5 側の副次的な同等性**が文字の外では成り立たない、という事実で、
  **未達ではない**
- **退行ではない**（1.16.0 より前は文字の外では左クリックすら効かなかった）。
  **1.16.0 で埋まったのは左クリックだけ**である
- **右クリックは原理的に代行できない。** 「リンクのアドレスをコピー」は**ブラウザのネイティブメニュー**で、
  JavaScript から開けない。`href` を持つ要素の上で右クリックされたときにブラウザが出すもので、
  **`<a>` の箱の外に出す手段が無い**
- **中クリックは代行しない**（下記）
- **楽天・SBI 側（CSS 方式）は面全体が `<a>` なので、5つとも完全に成立する。**
  **サイトによって達成度が違う**のは、`<a>` の箱を広げられるかどうかの差（ADR-0013 の 1・4）

#### なぜ TradingView 側は `<a>` の箱を広げないか

**「アイコン列が別セルだから」だけではない。** 同じセルの中（文字の右の余白）に限れば
楽天・SBI と同じ CSS 方式が使えそうに見えるが、**現時点では採らない**
（2026-08-30 に検討。ADR-0013 の追補3）。

項目の DOM は次のとおりで、**`<a>` と `<td>` のあいだにサイト側の要素が2つ挟まる**。

```html
<td>                              ← ここまで広げたい
  <div class="{content}">         ← TradingView のクラス（ハッシュ付き）
    <span class="{label}">        ← 同上
      <a …>株探/基本情報で開く</a>   ← いまは文字の幅しかない
    </span>
  </div>
</td>
```

| 理由 | 内容 |
| --- | --- |
| **効くかどうかがサイト側の CSS 次第** | `<a>` を `display: block` にしても、広がるのは**親（`span.{label}`）の幅まで**。`{content}` が flex 行で `{label}` が内容幅なら、**余白に届かず何も変わらない**。親行では同じ `{content}` の中でラベルと矢印が左右に分かれており、**`{label}` は内容幅である可能性が高い**（SPEC-CS-11） |
| **届かせるには模倣用クラスを機能の前提にすることになる** | `{content}` / `{label}` に幅指定を当てる必要がある。これらは**検証対象外**で「崩れても見た目が変わるだけ」という前提の値（SPEC-CS-16 / ADR-0002 の 6）。**機能（押せる範囲）の前提に格上げすると、TradingView のリリースのたびに機能が壊れうる** |
| **見た目を変えない保証が測れない** | 行の高さ・矢印の位置が動かないことを確かめる手段が**手動確認しかない**（CON-08）。FR-25 の「やらないこと」と FR-18 判定基準10 に直接触る |
| **要件上の利得がゼロ** | 判定基準1 は左クリックに確定済み。得られるのは**中クリックとアドレスのコピー**で、判定基準5 はどちらも「**文字の上で**退行しないこと」しか求めていない |
| **土台がまだ実サイト未確認** | 1.16.0 の修正（JS 代行・縦位置補正）自体が実機で未確認。**未確認の土台の上に、サイト側 CSS に依存する変更を積むのは順序が逆** |

**やる条件（実サイトで1つ測れば決まる）:**
A-11 の実施時に、入れ子の項目で **`<a>` の右端と、それを含む `<td>` の右端**を DevTools で比べる。

| 観測 | 判断 |
| --- | --- |
| `<a>` の箱が既に `<td>` の幅いっぱい | **`display: block` だけで余白が埋まる**（`width: 100%` は既に付いている）。そのとき CSS 方式を足す価値がある。**残る制限はアイコン列だけ**になる |
| `<a>` の箱が文字の幅しかない（**想定**） | サイト側のクラスに幅指定を当てない限り届かない。**現状のまま**とする |

> **アイコン列は、どちらに転んでも JS 代行のまま。** セルをまたいで `<a>` は広げられない。
> `delegating`（上記）の仕組みも残る。

#### 中クリックを代行しない理由

| 案 | 判定 |
| --- | --- |
| **(a) 採用** 代行しない | `auxclick` を拾って `<a>` に合成イベントを投げても、**ブラウザが「背景タブで開く」を実行するとは限らない**（合成イベントは信頼済みイベントではない）。`chrome.runtime.sendMessage` で開くと**開く経路が2本**になり、SPEC-CS-25 の第一原則を崩す |
| (b) `auxclick` を拾って別経路で開く | 却下。上記の2本目の経路が生まれる。**押した場所で開き方が変わる**という、いま直したばかりの不整合を別の形で作り直す |

### 適用範囲

> **判定基準1 の「クリック」は左クリックを指す**（FR-25。2026-08-30 に明示）。
> 中クリック・右クリックからの操作は判定基準5 の側で扱い、
> TradingView では**文字の外では成立しない**（上記「既知の制限」）。

| 対象 | 扱い |
| --- | --- |
| 入れ子の情報サイト項目（`makeMenuItem()`） | **対象**（判定基準 1 / 2-a / 2-b） |
| 入れ子の楽天証券・内藤証券の項目 | **対象。** 同じ `makeMenuItem()` を通る（判定基準3） |
| チャート起点・ウォッチリスト行起点 | **どちらも対象。** 項目の生成は共通 |
| 楽天証券・SBI証券のリンクメニュー（`linkMenu.js`） | **対象**（判定基準 2-d。2026-08-30 に追加）。手段は CSS |
| 親行「`<code>` を開く ▶」 | **対象外。** リンクではなく、ホバーで入れ子を開くだけ（SPEC-CS-11。FR-25 の「やらないこと」） |
| 「株Link」ボタンのメニュー（`makeButtonMenuItem()`） | **変更しない。** `<tr>` に直接ハンドラを付けて `openUrlAsync()` を呼ぶ作りで、**既に行全体が反応する**。判定基準 2-c は非退行の確認 |
| 楽天証券・SBI証券の**メニュー外**（元の銘柄コードのテキスト等） | **対象外。** 押せる範囲を広げるのは `<li>` の中だけ（判定基準7） |

### `<a style="width: 100%">` の扱い

`makeMenuItem()` の `<a>` には `width: 100%` が付いている（ADR-0002 の 5 で維持と決めた値）。
**インライン要素なので効いていない。** 行のハンドラで代行する本仕様では**不要**だが、
**削除も追加もしない**（見た目に影響しないことが確かめられていないため、変更点を増やさない）。

> **A-5 の3つめの操作には、この確認が最初からあった**
> （「文字が無い右側の余白をクリック → 開くこと」。`width: 100%` が効いているかの確認）。
> **実施結果が記録されていない**ため見逃されていた。手順の欠落ではなく**未実施**。
> 判定基準1 は「アイコン列・右の余白・上下の余白」と場所を具体化しており、
> A-11 / A-13 にも同じ操作を足す（FR-25 の検証欄）。

### 実装（1.16.0 / SPEC-CS-25）

| # | ファイル | 内容 |
| --- | --- | --- |
| 1 | `src/tradingview-cs.js` | `makeMenuItem()` の `.click()` ハンドラを「変更後の規則（2-a / 2-b）」の 1〜3 ＋ 閉じる、に置き換えた。**引数（`code` / `item`）と DOM 構造は変えていない**。行ローカルの `delegating` を1つ持つ（上記） |
| 2 | `src/style.css` | `li.x-kabu-menu-item > a { display: block; }` を追加（**2-d**）。**既存の規則の削除・変更は無い** |
| 3 | `tests/content-script.spec.mjs` | describe **`メニュー項目のクリック範囲`** の3件（下記）。TradingView 側（2-a / 2-b / 2-c）は自動化しない（CON-08） |
| — | — | `src/linkMenu.js` / `makeButtonMenuItem()` / `menuSelectors` は**無変更** |

- **代行クリックはユーザー操作の中で起きる**ので、ポップアップブロックには当たらない
- `style.css` は Stylelint（`stylelint-config-recess-order`）の対象

#### 自動テストで固定していること（2-d）

| テスト名（describe `メニュー項目のクリック範囲`） | 固定する事実 | 判定基準 |
| --- | --- | --- |
| `項目の文字の外を押しても、文字の上と同じ URL が開く` | 押せる範囲が `<li>` の内容ボックスまで広がっていること | 1 / 2-d |
| `項目と項目のあいだを押しても何も開かない` | `margin` の隙間はクリック範囲に入らないこと | 6 |
| `項目をクリックしてもメニューは閉じない` | 楽天・SBI 側の開閉が変わっていないこと（**TradingView とは正解が違う**） | 4 |

**座標は実測で決める。** `<a>` の箱と、その中の**文字の矩形**（`Range.getBoundingClientRect()`）を測り、
**文字の外がいちばん広い項目**を選んで「文字の右端と箱の右端の中間」を押す。

- **タイトルの長さ・オプションの並び順に依存しない。** 座標や項目番号を直書きすると、
  遷移先サイトを増減しただけでテストが壊れるか、**当たり判定の外を押していても気づけなくなる**
- 新しいタブが実サイトへ出ないよう、**クリック対象の URL だけ** `context.route` で差し替える
  （オプションページの「外部リクエストゼロ」と同じ方針）
- **効いていることを確認済み:** CSS を `display: inline` に戻すと 1 と 3 が落ち、`block` で通る。
  **テストが空振りしていない**ことの担保（SPEC-CS-23 の包含関係テストと同じ考え方）

#### TradingView 側に自動テストが無いこと（CON-08）

2-a / 2-b / 2-c は**入れ子の DOM が TradingView 上でしか組み立たない**ため自動化しない。

> **開発時の確認（使い捨てスクリプト。テストには入っていない）:**
> アイコン列のクリックで **`<a>` のクリック1回 ＋ Esc 1回**（`delegating` が効いていること）を確認した。
> **恒久的に守られているのは仕様の記述と手動確認だけ。**

- 要件: FR-25, FR-02, FR-03, FR-04, FR-06, FR-18, FR-19, NFR-01, NFR-08, CON-03, CON-08
- 検証: `auto`（**楽天・SBI のみ**。`メニュー項目のクリック範囲` の3件）／
  `manual`（**TradingView のみ**。CON-08。`docs/MANUAL-CHECKLIST.md` **A-5**（既存の3つめ）、
  **A-11**・**A-13** に足した「文字の無い場所を押す」、**A-2**（ボタンメニューの非退行。判定基準 2-c））

## SPEC-CS-26 米国株の行への注入（FR-28）

> 1.17.0 で実装（FR-28）。設計判断は [ADR-0014](../adr/0014-us-ticker-in-injection.md)。

証券会社サイトの一覧に並ぶ**米国株の行**でも、ティッカーにホバーするとメニューが出る。
1.16.1 までは国内株4桁専用だった（初版からで、**破損ではなく未実装**だった）。

### 実装の所在（3箇所）

| # | ファイル | 中身 | 判定基準 |
| --- | --- | --- | --- |
| 1 | `src/urls.js` | `usCodePattern`（`service_worker.js` から移設）・`jpLooseCodePattern`・`matchInjectionTicker()`（SPEC-TC-10） | 1, 6, 8, 9 |
| 2 | `src/linkMenu.js` | `createMenu` の `type`。米国株では `url3` を持つキーだけを `url3` で組む。0件なら `null` | 2, 3, 4 |
| 3 | `src/rakuten-cs.js` / `src/sbi-cs.js` | `menuSelectors` の `us: true`。楽天・保有商品一覧（すべて）はセレクタにカンマで米国株式の行を足してある。**1.18.0 で米国株のお気に入り2ページを足した**（12 → 14。SPEC-CS-07） | 1, 7 |

`src/rakuten-scr-cs.js` / `src/sbi-scr-cs.js` は **`attachMenu` の引数を受けるだけ**
（`us: true` を付けていない。FR-28 適用範囲 f）。

### `menuSelectors` の `us`

```javascript
{ title: '保有商品一覧・すべて', url: '…', selector: '…', us: true }
```

| 値 | 意味 |
| --- | --- |
| `true` | そのセレクタで拾った要素に**国内株の抽出が空振りしたら**米国株の抽出も試す |
| 省略 | 国内株のみ。**1.16.1 とバイト単位で同じ結果** |

**opt-in（許可列挙）にする。** 全エントリに効かせると、FR-28 が対象外と決めたページ
（ランキング・個別銘柄・スクリーナー）でも米国ティッカーの形に当たった時点でメニューが出る。
外したときの失敗が「**別銘柄が静かに開く**」側になるため採らない（ADR-0014 の 1）。

**`us: true` が付いているのは4エントリ**（1.18.0 現在）。

| サイト | 対象 | 米国株の行が並ぶか | 状態 |
| --- | --- | --- | --- |
| 楽天 | 保有商品一覧・すべて | **並ぶ**（国内株と同じページに混ざる。2026-08-30 の実機で**メニューが出ることを確認済み**） | **付いている**（1.17.0） |
| SBI | ポートフォリオ | **未確認**（外国株式の保有が無いと確かめられない。FR-28 適用範囲 c） | **付いている**（1.17.0） |
| 楽天 | お気に入り・米国株（`info_us_prc_reg_lst.do`） | **並ぶ**（そのページが米国株の一覧。**URL は実測**） | **付いている**（1.18.0） |
| 楽天 | お気に入り編集・米国株（`info_us_prc_reg_lst_edit.do`） | 同上 | **付いている**（1.18.0） |
| 楽天 | お気に入り（国内株） | **並ばない**（米国株は**別ページ**だった。2026-08-30 の実機確認） | **付けていない**（1.17.0 の開発中に一度付けたが、同版で外した） |
| 楽天 | お気に入り編集（国内株） | 同上 | 同上 |

> **国内株のお気に入り2ページに付けない理由。** 米国株が別ページである以上、
> そのページに米国株の行は並ばない。**付けても利得はゼロで、1〜5文字の大文字トークンに当たる余地だけが増える**
> （`td.align-C div.mbody nobr` は構造だけで拾っており、判定基準7 は目視でしか担保できない）。
> **必要な場所にだけ付ける**という opt-in の趣旨そのもの（ADR-0014 の 1・9-2）。
> 外して困るのは「実は混在していた」場合だが、そのときの結果は**何も出ない＝1.16.1 と同じ**で、
> 利用者が気づける側に倒れる。
>
> **`us: true` を戻すと `お気に入りは us を付けていないので米国ティッカーの形の行に注入しない` が落ちる**
> （変異検証済み）。この2行が戻らないことは自動テストが見張る。

### 米国株のお気に入りページのセレクタ

> 1.18.1 で実 DOM に合わせた（FR-28）。1.18.0 に入っていたのは国内株版の写しで、
> **3箇所とも外れていた**（ADR-0014 の 9-5）。

**実 DOM**（お気に入り・米国株。利用者の DevTools より。2026-09-01）:

```html
<table id="pcmm-foreign-stock" class="tbl-data-01">
  <tbody>
    <tr>…ヘッダ行…</tr>
    <tr>
      <td width="3%" class="valign-M">…注文ボタン…</td>
      <td width="6%" align="left"><div class="mbody"> NVDA </div></td>   ← ティッカー
      <td width="22.5%" align="left">…銘柄名（リンク）…</td>
      <td width="6%" align="left">…市場「米国」…</td>
      <td class="align-R" align="right">…数値列…</td>
```

**国内株版との違いは3箇所**（写した推測はすべて外れた）。

| | 国内株（写した元） | 米国株（実測） |
| --- | --- | --- |
| 起点 | `form#form` | **`table#pcmm-foreign-stock`**（フォームではなくテーブルに id） |
| セル | `td.align-C` | **`td`（クラス無し・`align="left"`）** |
| 中身 | `div.mbody > nobr` | **`div.mbody` の直下にテキスト**（`nobr` が無い） |

**セレクタ:**

```text
table#pcmm-foreign-stock tr > td:nth-of-type(2) div.mbody
```

**ティッカーの列を位置で絞る。** `div.mbody` は他の列も持ちうる（画面では省略表示で確認できない）。

| 案 | 内容 | 判定 |
| --- | --- | --- |
| A | **`td:nth-of-type(2)` ＋ `div.mbody` の両方**を条件にする | **採用** |
| B | `td div.mbody` を全部渡し、抽出側の判定に任せる | 不採用 |
| C | `td[width="6%"]` のように属性で絞る | 不採用 |

**B を採らない理由（具体例）。** 銘柄名の列に**英字の名前**が入ると `usCodePattern` が成立する。
`APPLE INC` → **`us APPLE`**（空白が後続境界。実在しないティッカーではなく
**別銘柄のページを開く**形。判定基準6・7 違反）。
市場列（`米国`）と日本語の銘柄名は落ちるが、**ETF や英字表記の銘柄名は落ちない**。
抽出は形しか見ないので、**届かせない**のがセレクタの仕事（SPEC-TC-10）。

**C を採らない理由。** `width="6%"` は**市場列にも付いている**（上の実 DOM）。絞りになっていない。

**A の失敗はすべて 0 件に倒れる。**

| 外れ方 | 結果 |
| --- | --- |
| `table#pcmm-foreign-stock` が無い（id が変わった） | 0 件 |
| 列が増減して 2 番目がティッカーでなくなった | その列に `div.mbody` が無ければ 0 件。**両方の条件を満たす別の列があれば誤爆する**（残る危険） |

> **前例に沿った。** ランキング6ページが `tr td:nth-of-type(2)` で同じ絞り方をしている（SPEC-CS-07）。
> **id と列位置と `div.mbody` を重ねる**ことで、1つ外れても残り2つが 0 件側へ倒す。

**お気に入り編集・米国株は実 DOM 未確認のまま。** 一覧ページと同じセレクタを**推測**で置いてある。

| 分かっていること | 出典 |
| --- | --- |
| `form table.tbl-data-01` が **1件**ある（フォームはある） | `npm run check:selectors` の手がかり |
| `td.align-C` は **0件**（セルのクラスは国内株版と違う） | 同上 |
| 編集用のチェックボックス等で列構成が一覧と違う可能性 | 未確認 |

**id で当たらなければ 0 件に倒れる**ため、推測を置いても誤爆はしない
（一覧と同じ `table#pcmm-foreign-stock` を要求する）。
**確かめ方は2つを並行させる**（ADR-0014 の 9-6）。

1. **利用者に DOM を見てもらう。** 2回目の実機確認は**もともと依頼が発生している**ので、
   **追加の往復はゼロ**（SPEC-CS-26 の「未確認のまま残るもの」）
2. `npm run check:selectors` の手がかりで、**どの段階で 0 件になったか**を得る

> **ツールだけでは足りない。** 手がかりが返すのは「どこで 0 件になったか」であって、
> **正しいセレクタではない**。一覧ページも、ツールは `form#form` が 0 件だと示したが、
> **`table#pcmm-foreign-stock` を教えてはくれなかった**（ADR-0014 の 9-5）。

**フィクスチャは実 DOM を写してある**（テーブルの id・列の並び・`div.mbody` 直下のテキスト）。
**1点だけ実物と違う**——実画面の銘柄名は**リンク**だが、フィクスチャでは**直下のテキスト**にしてある。
理由と含意は下記「案B の回帰テストと実物の1点の違い」。

- 要件: FR-28（判定基準1・7）
- 検証: `auto`（`米国株のお気に入り2ページでは米国ティッカーの行にメニューが出る`。
  **案B の回帰**＝`APPLE INC`（銘柄名の列）にメニューが出ないことを同じテストで固定している）／
  `manual`（`docs/MANUAL-CHECKLIST.md` C-1）／`半自動`（`npm run check:selectors`）

#### 案B の回帰テストと実物の1点の違い（developer の申告。2026-09-01）

**フィクスチャの銘柄名は `<div class="mbody">APPLE INC</div>`（直下テキスト）だが、
実画面の銘柄名は `<a>` で包まれたリンク**である。

| | フィクスチャ | 実 DOM |
| --- | --- | --- |
| 銘柄名の列 | `div.mbody` の**直下にテキスト** | `div.mbody` の中に**リンク**（実測。ただし内部構造は未確認） |

**この違いには意味がある。** `attachMenu` は**要素の直下のテキストノードだけ**を置換する（SPEC-CS-02）。
リンクで包まれていると直下にテキストノードが無く、**案B（`td div.mbody` を全部渡す）でも注入されない。**

| | フィクスチャ | 実機（銘柄名がリンクなら） |
| --- | --- | --- |
| 案B を採っていたら | `APPLE INC` に**誤ったメニューが出る** | **出なかった可能性がある** |

- **フィクスチャを実物どおりリンクにすると、案B の回帰テストは何も検出しなくなる**
  （案B に変異させても結果が変わらない）。**回帰を効かせるために直下テキストにしてある**
- **したがって「案B を却下した理由」は、実機では成立しなかったかもしれない。**
  却下の判断自体は変えない（**ETF など英字表記でリンクでないセルがあれば崩れる**。ADR-0014 の 9-6）が、
  **却下の根拠として挙げた `APPLE INC` の例は、フィクスチャ上でのみ再現する**
- **実機で銘柄名の列がリンクかどうかは未確認**（下記「未確認のまま残るもの」）

> **テストが守っているのは「列の位置で絞っていること」であって、
> 「実機で誤爆しないこと」ではない。** 前者は退行の検知に効くが、後者は目視でしか分からない。
> **効く範囲を正確に書く**（本仕様で繰り返している方針）。

### 保有商品一覧（すべて）のセレクタ

> **「米国株式」は 2026-08-30 の実機確認で当たった**（利用者報告「保有商品一覧はでる」）。
> 見立てだった値が実測で裏づけられた。**このラベルが変われば 0 件に戻る**ので、
> 「メニューが出なくなった」報告があればまずここを疑う（CON-03）。

```text
div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td,
div#table_possess_data table.tbl-bold-border tr > td:contains("米国株式") + td   ← 実機で確認済み
```

- **許すラベルは「米国株式」だけ。**「外国株式」「株式」は中国株式・アセアン株式を含みうる。
  そこへ届くと `00700` のような数字コードに**国内株の非アンカー抽出が当たり `0070` を開く**
  （判定基準 6 違反）。**米国株式に絞れば、ラベルが違っていても 0 件＝今日と同じ**
- 商品種別で絞ることが、投資信託・債券・預り金・為替の行を除く手段でもある（判定基準 7）。
  抽出は形しか見ないので、`USD 米ドル` の行に届けば `us USD` が成立してしまう（SPEC-TC-10）
- **ラベル「米国株式」は 2026-08-30 の実機確認で当たった**（このページは FR-28 で唯一、
  **国内株と米国株が同じページに混ざる**ことが実測で確かめられた対象）

### 判定基準と満たし方

| # | 判定基準 | 満たし方 |
| --- | --- | --- |
| 1 | 米国株の行でメニューが出る | `us: true` ＋ SPEC-TC-10 の順位 2 |
| 2 | 米国株用のページが開く | `url3`（SPEC-CS-06）。右クリックの URL と文字列一致 |
| 3 | 米国株のページを持たない遷移先は並ばない | `url3` を持つキーだけ。順序はオプションの並び順 |
| 4 | 0件ならメニューを出さない | `createMenu` が `null` |
| 5 | 国内株がいままでどおり | **国内株を先に判定する**（SPEC-TC-10）。米国株の抽出は今日何も起きない要素だけで走る。**ただし抽出以外で2点変わる**——遷移先0件のとき空の箱が開かなくなる（判定基準4）／同じコードが2回あるセルで2つ目のメニューが消える（判定基準10）。どちらも「集合・順序・リンク先」は不変で判定基準5 に反しない（ADR-0014 の 2・5・7） |
| 6 | 国内株↔米国株の誤判定禁止 | 市場は取り出した**形**で決まる。ただし**完全ではない**——`jp` を先に見るため、**同一セル内に4桁相当が混ざると `jp` と判定される**（`AAPL 1234.5` → `jp 1234`、`00700` → `jp 0070`）。ADR-0014 の 2 の残存リスク。**セレクタ側で対処し、C-1 の目視で確認する** |
| 7 | 株式以外の行に出さない | **保有商品一覧（すべて）だけ**が商品種別で絞れる（上記）。**残る3エントリ（お気に入り・お気に入り編集・SBIポートフォリオ）は絞れないため、判定基準7 は目視でしか担保されない**（下記「判定基準7 が構造で担保できない3エントリ」） |
| 8 | 単独トークンのときだけ切り出す | `usCodePattern` の後続境界（SPEC-TC-02。`BRK.B` で `BRK` を開かない） |
| 9 | 取引所が読み取れなくてもよい | 取引所を見ない。常に `url3` |
| 10 | 1行に1メニュー | 最初のテキストノードで打ち切る（SPEC-CS-02 の手順 4）**＋ 注入済みの要素を対象にしない門**（同 G2）。**打ち切りだけでは足りない**——未置換のノードが残り、繰り返すパスが2つ目を置換する（ADR-0014 の 7 の追補） |

### 判定基準7 が構造で担保できないエントリ

**`us: true` を付けた瞬間、そのセレクタが拾う要素は「1〜5文字の大文字トークン」で当たるようになる。**
1.16.1 までは4桁数字専用なので当たらなかった。**`us: true` のエントリだけ、当たる文字列の集合が広がる。**

| エントリ | 商品種別で絞れるか | 判定基準7 の担保 | 状態 |
| --- | --- | --- | --- |
| 楽天・保有商品一覧・すべて | **絞れる**（`td:contains("米国株式") + td`） | 構造 | 付いている（1.17.0） |
| SBI・ポートフォリオ | **絞れない**（構造だけで拾う） | **目視のみ** | 付いている（1.17.0） |
| 楽天・お気に入り・米国株 | **列の位置で絞る**（`td:nth-of-type(2) div.mbody`。実 DOM で確定） | **構造 ＋ 目視**（列構成が変わると崩れる） | 付いている（1.18.0）。**セレクタは 1.18.1 で実測どおりに修正済み** |
| 楽天・お気に入り編集・米国株 | **未確認**（一覧と同じと推測） | **目視のみ** | 同上（**セレクタは推測のまま**） |

投資信託・預り金・為替の行がこれらの表に混ざるかは**未確認**。混ざっていれば
`USD 米ドル` のようなセルに `us USD` が成立してメニューが出る（SPEC-TC-10 の具体例表）。

> **ここは「外れても 0 件で今日と同じ」に倒れない。** 保有商品一覧のラベルや
> スクリーナーの適用範囲は外れても何も起きない側だが、**目視のみの3エントリは外れると
> 余計なメニューが出る側**である。扱いを分けること。
>
> **出ることが分かった時点で、そのエントリのセレクタを絞る**（抽出規則は動かさない）。
> 絞る手がかり（列の位置・商品種別の表記）は実 DOM を見ないと決められないため先回りしない（CON-03）。
>
> **国内株のお気に入り2ページは対象ではない**（`us` を付けていない）。
>
> **お気に入り・米国株は 2026-09-01 の実 DOM で「列の位置」という絞りが手に入った**
> （`td:nth-of-type(2)`。上記「米国株のお気に入りページのセレクタ」）。
> **商品種別の列は無いので構造だけでは足りない**が、**銘柄名の列（`APPLE INC` のような英字）に
> 届かなくなる**のは大きい。**残るのは列構成が変わったときと、編集ページ（未確認）。**

**確認は `docs/MANUAL-CHECKLIST.md` の C-1 / C-3 に置いた**（下記「`manual`」）。

### 注入件数と再試行の関係

`attachPass()` の静止判定は `span.x-kabu-root` の件数で行う（SPEC-CS-22）。
静止条件は「**累計1件以上**、かつ直近のパスの新規注入が0件」。
**メニューが出ない行は 1.16.1 と同じく数に入らない**ので、判定の作りそのものは変わらない。

**`createMenu` が `null` を返すようになった影響で、注入が永久に0件になる経路が2つできた。**

| 経路 | 起きること | 扱い |
| --- | --- | --- |
| 遷移先を**全部**無効にした（`keys.length === 0`） | どのページでも `createMenu` が常に `null`。累計0件のまま**30秒×60パス**回り続ける | **門で塞ぐ**（下記） |
| 米国株の行しか無いページで、`url3` を持つ遷移先だけを無効にした | そのページでは累計0件のまま 30 秒で打ち切る | **塞がない**（対象外ページと同じ経路。有限で終わる） |

#### 遷移先が0件のときは再試行を始めない（1.17.0）

`rakuten-cs.js` の `attachAsync` と `sbi-cs.js` の `attach` は、
`getEnableLinkKeysAsync()` の結果が**空なら `retrySetup()` を始める前に打ち切る**。

```javascript
if (keys.length === 0) {
  return
}
```

- **1.16.1 では起きなかった。** 空の `<ul>` を注入していたので累計が1件以上になり、静止していた
- 置くのは**楽天・SBI の非スクリーナー2本だけ**。この2本は `retrySetup()` で
  「静止するまで繰り返す」作りなので、静止しない状態を作ると回り続ける（NFR-01）
- **スクリーナー2本（`rakuten-scr-cs.js` / `sbi-scr-cs.js`）には置かない。**
  こちらが `retrySetup()` に渡すのは**常設監視の設置**で、`document.body` は必ず取れるため
  実質初回で成功して止まる（SPEC-CS-08 / SPEC-CS-10）。
  0キーのとき「監視が張られたまま空回りする」のは **1.16.1 から変わっておらず退行ではない**。
  常設監視を張るかどうかは別の判断（人が検索を実行するまでの時間に上限が無い。FR-15）に従うので、
  本件を理由に触らない

> **この門は利用者から見えない。** 有無にかかわらず**注入は0件**で、DOM の差が出ない。
> 自動テスト（`遷移先を全部無効にすると国内株の行にもメニューを出さない`）が固定できるのは
> **「メニューが出ない」という利用者から見える半分だけ**で、
> **「30秒回り続けない」という半分は固定できていない**（SPEC-CS-22 の再試行は
> DOM を変えないため、パスの回数を外から数える手段が無い）。
> **消えたら気づけない種類の門**なので、`attachAsync` / `attach` を触るときは本節を読むこと。

### 検証

- 要件: FR-28（＋ FR-02, FR-03, FR-07, FR-08, NFR-01）
- 検証: `auto` ／ `manual`（実ページの目視と、ラベルの実測）

**`auto`（`tests/content-script.spec.mjs`。判定基準 1〜6・8〜10 を固定する。
CON-08 は TradingView だけの制約で、楽天・SBI はフィクスチャで検証できる）**

| テスト（`米国株の行への注入`） | 固定しているもの | 判定基準 |
| --- | --- | --- |
| `保有商品一覧（すべて）の米国株の行にメニューが出て、国内株の行は変わらない` | 米国株の行（`AAPL` / `T`）に注入され、`BRK.B` と `ALPHABET` には注入されない。国内株の行の項目は有効な全キー × `url1` のまま | 1, 5, 6, 8, 9 |
| `米国株の項目は url3 を持つサイトだけで、右クリックと同じ URL になる` | 項目が `getUrl('us', 'AAPL', undefined, …)` の結果と**集合・順序・URL とも一致**し、国内株より少ない | 2, 3, 9 |
| `url3 を持たないサイトだけが有効なら米国株の行にメニューを出さない` | `span.x-kabu-root` ごと作られない（空の箱を開かない） | 4 |
| `保有商品一覧（すべて）は国内株式・米国株式の行だけに注入する` | 投資信託・預り金の行に出ない。`USD 米ドル` に出ないのは**セレクタの働き**であることも併せて固定 | 1, 7（**このページのみ**） |
| `SBI ポートフォリオの外国株式の行にも注入する` | 国内株は `url1`、外国株式の行は `url3` の URL になる（実画面は未確認のまま） | 1, 2 |
| `us を付けていないランキングでは米国ティッカーの形のセルに注入しない` | opt-in が効いている（`ETF` のセルに出ない） | — |
| **`お気に入りは us を付けていないので米国ティッカーの形の行に注入しない`** | **`us: true` を戻すと落ちる**（変異検証済み）。米国株が別ページと分かった2ページに opt-in が戻らないことの歯止め（ADR-0014 の 9-2） | — |
| **`米国株のお気に入り2ページでは米国ティッカーの行にメニューが出る`**（1.18.0。**1.18.1 で実 DOM のフィクスチャに差し替え**） | ティッカーの列だけに注入され（`NVDA` / `AAPL` / `T`）、`BRK.B` / `ALPHABET` は落ちる。URL は `url3`。**前後の空白を落として判定し、置換するテキストノードは元のまま**（` NVDA `）。**銘柄名の列（`APPLE INC`）と市場の列（`米国`）には出ない**＝案B の回帰（ADR-0014 の 9-6。**フィクスチャ上でのみ再現する**ことに注意） | 1, 2, 7, 8, 9 |
| **`遷移先を全部無効にすると国内株の行にもメニューを出さない`** | 空の箱を開かない（1.16.1 は開いていた）。**早期 return そのものは観測できない**（上記「注入件数と再試行の関係」） | 4 |
| `同じコードが2回現れるセルでもメニューは1つ` | 打ち切り ＋ G2 の門。**再試行のパスを回しても2つ目が生えない** | 10 |

> **米国株のフィクスチャは `us: true` が残るページへ移した**（新設 `RAKUTEN_POSSESS_ALL_US_HTML`）。
> お気に入りの米国株混在フィクスチャは**捨てずに opt-in の回帰テストへ転用**した
> （`お気に入りは us を付けていないので…`）。**同じ入力で結果が反転する対**になっている。
>
> **1.18.0 でその対に3本目が入った。** 同じ HTML を**米国株ページの URL**で出す
> （`米国株のお気に入り2ページでは…`）。**入力の差は URL だけ**なので、
> 「`us: true` を付けたエントリに当たったかどうか」以外の説明が立たない。
>
> **フィクスチャは実 DOM ではない。** 国内株版と同じ構造だという**推測をそのまま写した**もので、
> このテストが通ることは**実ページで動くことを意味しない**（確認は C-1。CON-03）。

| テスト（`urls.js: matchInjectionTicker`） | 固定しているもの | 判定基準 |
| --- | --- | --- |
| `国内株を先に見て、空振りしたときだけ米国株を試す` | SPEC-TC-10 の順序と具体例表 | 5, 6, 8 |
| `形しか見ないので、届かせてはいけないセルは抽出では防げない` | `00700` → `jp 0070`、`USD 米ドル` → `us USD`。**抽出では判定基準 6・7 を守れない**ことの明示 | 6, 7 |
| `allowUs が偽なら米国株は一切成立しない` | opt-in の下限（`us` を付けないエントリは 1.16.1 と同じ結果） | 5 |
| `前後の空白を落として判定する` | `trim()` の扱い | 1 |

> テストを増やしたら `npm run docs:tests` を実行する。
>
> **判定基準7 を自動で固定できるのは保有商品一覧（すべて）だけ。**
> 残る3エントリは商品種別で絞っておらず、**フィクスチャに株式以外の行を置けば注入される**
> （＝仕様どおりの結果になり、テストにならない）。**目視で担保する**（上記の節）。

**`manual`（`docs/MANUAL-CHECKLIST.md` の C-1 / C-3。FR-28 を ✅ にする条件）**

**1回目を 2026-08-30 に実施した**（利用者。1.17.0）。結果は2つ。

| 対象 | 結果 | 扱い |
| --- | --- | --- |
| 保有商品一覧（すべて） | **メニューが出た** | 判定基準1 は満たす。ラベルの見立ても当たった |
| お気に入り | **出なかった** | **破損ではない。米国株が別ページだった**（`info_us_prc_reg_lst.do`）。**1.18.0 で対応済み**（SPEC-CS-07） |

**2回目（1.18.1 の実装後）が残っている。依頼するのは1つだけ。**

| 段 | 依頼 | 手間 |
| --- | --- | --- |
| **必須** | **`npm run check:selectors` を1回**（米国株2行が ✅ になるか） | 実行1回。**目視は要らない** |
| 任意 | 下表の目視 | 画面を開くだけ |
| **ついで** | DevTools を開くなら、下表の 5・6 も | 追加の往復はゼロ |

**依頼を増やさない。** 見る項目は6つあるが、**利用者に必ず頼むのは検証ツールの実行1回**で、
残りは「開いたなら見る」に落とす。**未確認は正しく残すが、それを全部依頼に変換しない。**

| # | 見るもの | 段 | 外れたときの直し方 |
| --- | --- | --- | --- |
| 1 | **米国株のお気に入り2ページ**でメニューが出る（一覧は実 DOM で確定、編集は⚠️推測のまま） | **ツールで判定できる** | セレクタを実 DOM に合わせる |
| 2 | **その2ページで、ティッカー以外の列にメニューが出ていない**（銘柄名・市場・数値の列） | 任意（目視） | そのエントリのセレクタを絞る。**抽出規則は動かさない** |
| 3 | 保有商品一覧（すべて）の米国株の行が、選ぶと**米国株のページ**を開く（項目が国内株より少ない） | 任意（目視） | `type` の判定か `url3` の選択を疑う |
| 4 | 同じ画面の**国内株の行**が従来どおり（項目の数・並び、1行1メニュー） | 任意（目視） | 判定基準5 の退行として扱う |
| 5 | **お気に入り編集・米国株の DOM**（ティッカーが入っている要素まで） | **ついで**（DevTools を開くなら） | そのまま報告してもらい、セレクタを直す |
| 6 | お気に入り・米国株で、**銘柄名の列がリンクかどうか** | **ついで**（同じ画面で分かる） | 記録だけ。**実装は変えない**（案B を却下した根拠の裏取り） |

> **1 と 2 は本来は対で見るもの。** 1 だけを見て「出た」で終えると、
> **出てはいけない列にも出ている**状態を見逃す（この2ページに商品種別の列は無い）。
> **ツールが数えるのは「注入できた件数」なので、2 は判定できない。**
> **1 が ✅ でも 2 は開いたままである**ことを忘れないこと。
>
> **5 が ✅ で埋まらないなら、それでよい。** 編集ページのセレクタが外れていれば
> ツールが ❌ を返すので、**そのときに初めて DOM を依頼する**（当たっていれば依頼は不要）。
> 一覧ページで推測が3箇所とも外れた以上**測ってから直すほうが安い**が、
> **ツールが先に答えを返すなら、測る依頼自体を出さずに済む**（ADR-0014 の 9-5・9-6）。

**C-1 の手順は書き換えが要る**（**ファイルの編集は本仕様の担当外**）。

| 現在の手順 | 直し方 |
| --- | --- |
| 「お気に入り・お気に入り編集・保有商品一覧（すべて）を開き、**米国株の行**に…」 | **お気に入りは米国株ページ**（`info_us_prc_reg_lst.do` / `…_edit.do`）を開く、に変える。国内株のお気に入りでは**出ないのが正しい** |
| 「3ページとも見てください」（判定基準7） | 対象を**米国株のお気に入り2ページ ＋ 保有商品一覧（すべて）**にする。米国株のお気に入りでは「**ティッカーの列にだけ出ているか**」を見る（銘柄名・市場・数値の列に出ていないこと） |
| 商品種別の表記の記録 | **確認済みなので削ってよい**（「米国株式」で当たり） |

> SBI ポートフォリオに外国株式の行が並ぶかは**未確認のまま残す**（FR-28 適用範囲 c）。
> **並ばなくても未達としない。**

### テストの対の作り（1.18.1 で変わった）

1.18.0 までは「**同じ HTML を URL だけ変えて出す**」ことで、国内株ページ（`us` 無し）と
米国株ページ（`us: true`）の結果が反転することを示していた。
**構造が違うと分かった以上、同じ HTML は使えない**（実 DOM は別テンプレート。ADR-0014 の 9-5）。

| テスト | 使うフィクスチャ |
| --- | --- |
| `お気に入りは us を付けていないので米国ティッカーの形の行に注入しない` | **国内株の構造**（変えていない。米国ティッカーの行を含む） |
| `米国株のお気に入り2ページでは米国ティッカーの行にメニューが出る` | **実 DOM の構造**（1.18.1 で差し替え） |

**「同じ入力で結果が反転する」という担保は無くなったが、opt-in の歯止めは残っている**
（国内株フィクスチャに米国ティッカーの行があるので、`us: true` を戻せば `AAPL` に注入されて落ちる）。

**変異検証は3件とも「落ちること」を実測した**（2026-09-01）。

| 変異 | 結果 |
| --- | --- |
| 国内株のお気に入りに `us: true` を戻す | `お気に入りは us を付けていないので…` が失敗 |
| セレクタを**案B**（`td div.mbody`）にする | 注入が **3 → 4件**（`APPLE INC` に出る）。該当テストが失敗 |
| セレクタを 1.18.0 の値（国内株版の写し）に戻す | **0 件**。該当テストが失敗 |

> **却下の理由がそのまま回帰テストになった**（案B）。ただし**フィクスチャ上でのみ再現する**
> ことに注意（上記「案B の回帰テストと実物の1点の違い」）。

**`scripts/selector-check/targets.mjs` は変更不要だった**（セレクタを持たない。SPEC-SC-02）。

### 未確認のまま残るもの（2026-09-01 時点）

| # | 内容 | 優先度 |
| --- | --- | --- |
| 1 | **お気に入り編集・米国株の実 DOM**（一覧と同じという推測のまま）。一覧ページは**実測で確定**した | **高**。ただし**先にツールが答える**（`npm run check:selectors` が ❌ を返したときだけ DOM を依頼する） |
| 2 | お気に入り・米国株で、**ティッカー以外の列にメニューが出ていないか**（列構成が想定どおりか） | 高。**ツールでは判定できない**（注入件数しか数えない）ので目視のみ |
| 3 | **実機の銘柄名の列がリンクかどうか**（`div.mbody` の直下にテキストがあるか） | **低（「ついで」）**。**案B を却下した根拠の裏取り**で、**結論は変わらない**（上記「案B の回帰テストと実物の1点の違い」）。DevTools を開く用事が別にあるときだけ見る |
| 4 | 保有商品一覧の米国株の行が**米国株のページを開くか**（項目数が国内株より少ないか） | 高（利用者に確認中） |
| 5 | **米国株専用の保有一覧**（`ass_us_stk_possess_lst.do` のようなページ）があるか | 低（保有商品一覧・すべてで出るため実害が無い） |
| 6 | SBI ポートフォリオに外国株式の行が並ぶか（FR-28 適用範囲 c） | 低（**未達としない**） |

> **3 を記録に残す理由。** お気に入りが `jp` / `us` で対称だったので、**保有商品一覧にも
> 米国株専用ページがある可能性**がある（`ass_jp_stk_possess_lst.do` の対がある形）。
> 見つかっても新しい設計は要らず、SPEC-CS-07 に1行足すだけ。

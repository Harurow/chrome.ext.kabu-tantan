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

> 固定待機だけでは、回線やマシンが遅いと注入に失敗する。**1.13.0 で再試行を入れた**（SPEC-CS-22）。
> 固定待機はそのまま残し、待機が明けた後に**成功するか 30 秒経つまで試し直す**（FR-13）。
> 上表の「待機」と「エントリポイント」は 1.12.2 から変えていない。

- 要件: FR-02, FR-03, NFR-09, FR-13, NFR-14
- 検証: `auto`（楽天・SBI の注入テスト）／`manual`（門は `docs/MANUAL-CHECKLIST.md` G）

## SPEC-CS-02 メニュー注入の手順

`attachMenu(element, keys)`

1. 要素のテキストから国内銘柄コードを抽出（SPEC-TC-06）。無ければ何もしない
2. 要素の子ノードを走査し、**銘柄コードを含むテキストノード**を探す
3. そのテキストノードを `createMenu()` が返す `<span class="x-kabu-root">` で置換する

テキストノードのみを対象とするため、既存の要素構造・イベントを壊さない。
置換後の子ノードはテキストノードではないので、**同じ要素を再走査しても 2 度目の置換は起きない**。

> **二重注入のガード（1.13.0 で追加。SPEC-CS-22 / FR-13 判定基準3）:** 手順 1 の前に、
> 対象要素が `span.x-kabu-root` の内側にあるなら何もしない、を置く（楽天・SBI の4本すべて）。
> 注入したメニュー項目の `<a>` が検出用セレクタに再びヒットするため
> （楽天スーパースクリーナーのヒットが 1150 件になるのはこれ）、
> パスを繰り返す設計では構造的な性質だけに頼らない。

- 要件: FR-02, FR-03, CON-03, FR-13
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
- **`document.body` を `MutationObserver({ childList: true, subtree: true })` で監視**し、
  結果一覧の出現・ページ送りのたびに再注入する（`setupObserver()`）
- **コールバックは 200ms でデバウンス**する（`observerDebounceMs`）。
  デバウンスが明けて DOM を変える直前にも切断状態の門を置く（SPEC-CS-19）
- 監視の設置は `retrySetup()` 経由（SPEC-CS-22）。`document.body` は必ず取れるので実質初回で成功する
- 常設監視は打ち切らない。外すのは切断を検知したときだけ（SPEC-CS-19）
- 設置直後に初期パスを 1 回走らせる（`mutationObserverCallback(keys)`）
- `createMenu(..., nonStyle = true)` で呼び、`ul.x-kabu-body` に `margin-top: -3px` を追加する

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

| 対象 | セレクタ |
| --- | --- |
| 個別銘柄 | `div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal` |
| ポートフォリオ | `div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)` |

> ポートフォリオのセレクタは 1.12.1 まで `body.vsc-initialized` と空白で始まっていた。
> これは SBI証券が出力するクラスではなく、**Video Speed Controller（別の Chrome 拡張）が
> `<body>` に付けるクラス**で、当該拡張を入れていない環境では常に 0 件になっていた（CON-11）。
> **1.12.2 で先頭の `body.vsc-initialized` と直後の空白だけを削った。以降は 1 文字も変えていない。**
> 削った文字列は 2026-08-23 の実サイト実測で 24 件ヒットしている
> （3回目版 `git show e0d3c5e:docs/SELECTOR-CHECK.md`。SPEC-SC-13「引用にはリビジョンを添える」）。
> 同種の混入が他に無いことの点検と再発防止は SPEC-CS-21。

- 要件: FR-03, FR-21, CON-11
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
3. `document` の `contextmenu` を**キャプチャ段階**で監視し、発生元がチャート内なら発生時刻を保持する（後述「起点の判定」）
4. メニューが作られるたびに `attachMenu()` を呼ぶ
5. `attachMenu()` は次を上から順に判定し、1つでも満たさなければ **DOM を一切変更しない**

   | # | 条件 | 満たさないとき |
   | --- | --- | --- |
   | 1 | `isExtensionAlive()` が真（SPEC-CS-19） | 何もしない（切断状態。NFR-14） |
   | 2 | `selectorOf('overlap-root')` がちょうど1件 | 何もしない |
   | 3 | `tr[data-kabu-tantan]` が0件 | 何もしない（二重追加の防止。後述） |
   | 4 | 直近 1500ms 以内に**チャート上で** `contextmenu` が発生している | 何もしない |
   | 5 | `selectorOf('context-menu')` が1件以上 | 何もしない。2件以上なら**先頭の1件だけ**を対象にする |
   | 6 | `getTickerCode()`（SPEC-TC-07）が `code` を返す | 何もしない（区切り線も追加しない） |

   > 条件1 は起動時の門（SPEC-CS-01）とは別に、メニューが作られるたびに評価する。
   > ページを開いた後に拡張機能が更新される経路がこれで塞がる（SPEC-CS-19）。

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
  `manual`（**自動テスト対象外**。`docs/MANUAL-CHECKLIST.md` A-5, A-6, A-7, A-9, A-10, A-11）

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
- 検証: `auto`（SPEC-SC-16 の `セレクタ定義` 7件）／
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

## SPEC-CS-20 楽天証券・国内株式・株価検索の破損調査（FR-20）

> **状態: 原因未特定。** ここに書くのは**調査手順と切り分けの観点**であり、修正内容ではない。
> 原因が確定したら SPEC-CS-07（必要なら SPEC-MF-06 / SPEC-SC-05）を直し、本節を結論に置き換える。

### 分かっていること（2026-08-23 / 2026-08-24）

| 事実 | 出所 |
| --- | --- |
| 12ページ中このページだけ、利用者の目視でメニューが出ない | 利用者の実機確認 |
| **同じ検出用セレクタ**を使う「国内株式・個別銘柄」は ✅（識別 1 / ヒット 1 / 注入 1） | 3回目版（`git show e0d3c5e:docs/SELECTOR-CHECK.md`）／4回目版（本コミットの `docs/SELECTOR-CHECK.md`。2026-08-24 23:16 / 1.12.2）とも同値 |
| 検証ツールの判定は 3回目版で ⚠️、**4回目版で ❌**。件数はどちらも識別 0 / ヒット 0 で変わらず、記号だけが到達判定（FR-22 / SPEC-SC-24）で変わった | 4回目版 |
| 到達先の題名は `国内株式トップ \| 株価検索 \| 国内株式トップ \| 国内株式 \| 楽天証券[PC]`。エラー画面・ログイン画面ではない | 同上（手がかり節） |
| プレフィックス追跡は**段階1の `div#line1` で 0 件** | 同上 |
| 主要コンテナは `div.pcm-header`, `div.pcm-content`, `div.mbody`, `iframe`, `input#ratAccountId` | 同上 |
| 楽天証券の Content Script だけが `location.href.indexOf(url) !== -1` でページを絞る（SPEC-CS-07） | `src/rakuten-cs.js` |
| 楽天証券の注入設定に `all_frames` が無い。iframe 内には注入されない | `src/manifest.json`（SPEC-MF-06） |

**「セレクタが壊れた」説は弱い。** セレクタが個別銘柄と同一で、そちらが ✅ である以上、
セレクタ破損が原因なら「結果画面の DOM が個別銘柄と別物」でなければならない。
先に疑うべきは**そもそも Content Script が動いていない**経路（URL 部分一致・フレーム）。

### 仮説と切り分け

| # | 仮説 | 見分け方 | 当たった場合の直し先 |
| --- | --- | --- | --- |
| 1 | 結果画面の URL が `/app/info_jp_prc_search.do` と一致せず、URL 絞り込みで弾かれている | 開発者がアドレスバーを読む（下記） | `rakuten-cs.js` の `menuSelectors[].url`（エントリを**足す**） |
| 2 | 結果が iframe に描画され、`all_frames` が無いため注入されない | DevTools の Elements で `iframe` の有無を見る。SPEC-SC-20 の「主要コンテナ」に `iframe` / `frameset` が出るかを見る | `manifest.json`（SPEC-MF-06）。**注入先が広がるので影響範囲を要検討** |
| 3 | 検証ツールがログイン画面・エラー画面に飛ばされている（ツール側の問題。拡張は無罪） | SPEC-SC-22 の題名がログイン系・エラー系 | `scripts/selector-check/targets.mjs` の到達方法（SPEC-SC-06） |
| 3b | 検証ツールが**エラーではない別のページ**（検索フォーム・国内株式トップ）に着いている | 題名は対象ページ風だが、ページ名が2度出るなど不自然。**ツールは判別できない**（SPEC-SC-18） | 同上。判別できないので人が実ページを見る |
| 4 | 結果画面の骨格が個別銘柄と別物 | SPEC-SC-21 のプレフィックス追跡が `div#line1` の段階で 0 件 | `rakuten-cs.js` の `menuSelectors`（エントリを**足す**） |
| 5 | 見出しの構造だけが違う | 同追跡が `div#line1` は 1 件、`h1.hdg-l1-01-title` で 0 件 | 同上 |
| 6 | 「株価検索の結果画面」が存在せず、個別銘柄ページへ遷移する仕様になった | アドレスバーが `info_jp_prc_stock.do` になる | **FR-20 を取り下げる**（analyst の判断。architect は決めない） |

### 手がかりで絞れたこと（4回目版）

| # | 仮説 | 4回目版の手がかり | 残るか |
| --- | --- | --- | --- |
| 1 | URL 絞り込みで弾かれている | ツールは `menuSelectors[].url` から URL を組み立てて `goto` するため、**この経路は検査できない** | **残る**（人がアドレスバーを読む） |
| 2 | iframe に描画されている | 主要コンテナに `iframe` が出た。ただしエラー画面に着いた4ページにも同じ `iframe` が出ており、**楽天証券の全ページ共通の要素**の可能性が高い | **残る**（弱い証拠） |
| 3 | ログイン画面・エラー画面に飛ばされている | 題名がどちらにも当たらない（到達判定は `到達したとみなす`） | **否定** |
| 3b | エラーではない別のページに着いている | 題名に `国内株式トップ` が**2度**現れる。SPEC-SC-18 のとおりツールでは判別できない | **残る（最有力）** |
| 4 | 骨格が個別銘柄と別物 | 追跡が段階1（`div#line1`）で 0 件。3b でも同じ観測になるため単独では分けられない | **残る** |
| 5 | 見出しの構造だけが違う | `div#line1` が 0 件なので当たらない | **否定** |
| 6 | 結果画面が存在しない | ツールでは分からない | **残る**（人がアドレスバーを読む） |

**残った 1・2・3b・4・6 は、いずれもツールでは分けられない。** 次は人が実サイトを見る（下の「着手順」4）。

### 着手順

1. SPEC-SC-20〜23（FR-12 判定基準5）を実装する ← **1.12.0 で完了**
2. `npm run check:selectors` を再実行し、このページの手がかりを得る ← **4回目版（2026-08-24 23:16 / 1.12.2）で完了**
3. 手がかりで仮説 2〜5 を絞る ← **完了**（上表。3・5 を否定した）
4. 絞りきれない分は、開発者が実サイトで下表を確認する ← **未実施。ここが次の一手**
5. 原因を1つに確定してから修正する。**手がかり無しで実 DOM を当てにいかない**（FR-20 の「順序」）

### 手がかりに出ないもの（人が確認する）

**URL は結果ファイルに出ない**（NFR-12 / SPEC-SC-14）。次は開発者が目で読む。

| 確認すること | 方法 | 記録 |
| --- | --- | --- |
| 結果画面のパス（`.do` まで） | 楽天証券にログインし、株価検索で銘柄を検索してアドレスバーを読む | **パス部分だけ**を仕様に書き写す。`;BV_SessionID=…` 以降とクエリは**書き写さない** |
| 結果が iframe か | DevTools の Elements で確認する | フレームの有無だけ |

> **FR-22 の実装後、このページの記号は 4回目版で ⚠️ から ❌ に変わった**（題名がエラー画面の目印に
> 当たらないため「到達した」と判断された。SPEC-SC-24。上の「分かっていること」表と同じ観測）。
> **❌ になったこと自体は仮説1〜6 のどれの裏づけにもならない。**
> 到達判定は「エラー画面ではない」ことしか示さず、仮説 3b（別の正常ページに着いている）を排除できない。
> 切り分けは引き続き下表の目視で行う。

### 修正時の制約（退行防止。FR-20 判定基準4）

- `menuSelectors` の**既存12エントリを書き換えない**。必要ならエントリを足す
- **既存の `title` を変えない。** `targets.mjs` との突き合わせが壊れる（SPEC-SC-16 が検出する）
- エントリを足したら `scripts/selector-check/targets.mjs` にも対象を足す（SPEC-SC-04）。
  足さないと `npm test` が落ちる
- 修正後に `npm run check:selectors -- --only=rakuten` を実行し、
  **12ページすべてが ✅**（利用者データを用意した上で）になることを確認する

- 要件: FR-20, FR-02, FR-12
- 検証: `半自動`（`npm run check:selectors -- --only=rakuten` で当該ページが ✅、他11ページが ✅ のまま）／
  `manual`（株価検索の結果画面で銘柄コードにホバーしてメニューが出て、選ぶと新しいタブで開くこと）

---

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

| 層 | 内容 | 新旧 |
| --- | --- | --- |
| 楽天・SBI 4本 | 置換済みの子ノードはテキストノードではないため、同じ要素を再走査しても置換が起きない（SPEC-CS-02） | 既存 |
| 楽天・SBI 4本 | `attachMenu()` は、対象要素が `span.x-kabu-root` の内側にあるとき何もしない | **追加** |
| TradingView ボタン | `$('.ktt-tv-kabuLinkMenu').length > 0` なら設置済みとして成功を返す | **追加** |
| TradingView 右クリック | `tr[data-kabu-tantan]` のガード（SPEC-CS-11 条件1） | 既存・変更なし |

> 2つ目のガードが要る理由: 注入したメニュー項目の `<a>` が検出用セレクタに再びヒットする
> （楽天スーパースクリーナーの検出用セレクタのヒットが 1150 件になるのはこれ）。
> パスを繰り返す設計では、構造的な性質だけに頼らない。

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

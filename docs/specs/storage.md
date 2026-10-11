# SPEC-ST: 設定の保存形式

実装: `src/urls.js`（`getEnableLinkKeysAsync`）、`src/options.js`

## SPEC-ST-01 保存領域とスキーマ

`chrome.storage.sync` に単一キー `enableLinkKeys` で保存する。

```json
{
  "enableLinkKeys": {
    "kabutan.jp/stock": 0,
    "minkabu.jp/stock": 1,
    "finance.yahoo.co.jp/": 2
  }
}
```

- **キー** = `externalUrls[].key`（SPEC-EL-01）
- **値** = 表示順序（0 始まりの連番）
- **無効にしたサイトはオブジェクトに含めない**（`false` を入れるのではなく削除する）

`sync` なので同一 Google アカウントの Chrome 間で同期される。

- 要件: FR-09, NFR-02
- 検証: `auto`（`オプションページ › トグルを OFF にして保存すると設定が永続化される`）

## SPEC-ST-02 未設定時の既定値

`enableLinkKeys` が存在しない場合（初回インストール直後）は、
**`externalUrls` の全件を定義順で有効**として扱う。

```javascript
return externalUrls.map((i) => i.key)
```

- 要件: FR-09
- 検証: `auto`（`オプションページ › 初期状態では全てのトグルが ON`）

## SPEC-ST-03 未知キーの無視

storage に `externalUrls` に存在しない `key` が残っていても無視する
（サイト廃止でエントリが削除された場合に発生する）。

`getEnableLinkKeysAsync()`（SPEC-ST-04）は**未知キーを落とさない**。storage にあるキーを順序付きでそのまま返す。
未知キーを落とすのは、キーから `externalUrlsMap` を引く各経路の側である。

| 経路 | 実装 | ガード | 導入 | 未知キーだけが残っている場合 |
| --- | --- | --- | --- | --- |
| Service Worker（コンテキストメニュー） | `src/service_worker.js` `rebuildContextMenusAsync()` | `if (!externalUrlsMap[key]) { continue }` | **1.7.19**（1fd7e57。1.6.18 までは `externalUrlsMap[key].title` をガード無しで読み、未知キーで例外になっていた） | `removeAll()` の後に1件も `create()` しない。エラーは出さない（SPEC-SW-02 の手順 3） |
| オプションページ | `src/options.js` の初期化 | `if (item) { … }` | **1.7.19**（1fd7e57。並び替え対応で有効キー基準のループに変えたときに入った。1.6.18 までは `externalUrls` 基準でループしていたため、未知キーは構造上無視されていた） | 有効（チェック済み）の行が0件になり、`externalUrls` の全件がチェックなしで並ぶ |
| 楽天・SBI 系の注入メニュー | `src/linkMenu.js` `createMenu()` | `const entry = externalUrlsMap[key]; if (!entry) { return }` | **1.17.0**（3817d1d） | 項目が0件になり `null` を返す。呼び出し側は置換しない（SPEC-CS-06） |
| TradingView のメニュー | `src/tradingview-cs.js` `makeLinkItemsAsync()` | `.filter((item) => item != null && …)` | 1.11.0 | 情報サイトの項目が0件になる。証券会社の項目も無ければ3行を除去する（SPEC-CS-11 / SPEC-CS-18） |

- **オプションページで保存し直すと、未知キーは storage から消える。** 保存処理は DOM 上の
  `input.link-list-item` だけから `enableLinkKeys` を組み立てる（SPEC-ST-05）ため、行を持たない未知キーは書き戻されない
- **楽天・SBI の非スクリーナー2本（`rakuten-cs.js` / `sbi-cs.js`）では、未知キーだけが残っていると再試行が打ち切りまで続く。**
  `keys.length === 0` の門は未知キーを数えるので通り抜け、`createMenu()` が毎回 `null` を返すため静止条件（累計1件以上）が成立しない。
  **30秒の打ち切り（SPEC-CS-22）まで 500ms ごとにセレクタを評価し続ける。DOM は変えない。**
  遷移先を全部無効にした場合（`keys` が空）にだけ門が効く（1.17.0。SPEC-CS-26）。
  コードから読み取った挙動で、実測はしていない
- Service Worker の `chrome.contextMenus.onClicked` にも `if (!externalInfo)` のガードがあるが、
  対象は storage ではなくクリックされた `menuItemId`。メニューは既知のキーにしか作らないため、本項の経路には数えない

> **2026-10-11 に訂正した（1.17.0 から 1.20.3 まで、本項は実装と食い違っていた）。**
> それまでは「`linkMenu.js`: **ガードしていない**（`externalUrlsMap[key]` が `undefined` だと例外）」
> 「既知の弱点: `createMenu` は未知キーで落ちる。サイト廃止直後の storage に古いキーが残っていると
> Content Script 全体が停止しうる」と書いていた。
> **これは 1.16.1 までの事実で、1.17.0 で失効していた。** 1.16.1 までの `createMenu()` は
> `const { title, url1 } = externalUrlsMap[key]` と分割代入しており、未知キーで `TypeError` になった。
> 1.17.0（FR-28。米国株の行への注入）で `url1` / `url3` を選び分けるために本体を書き直した際、
> 未知キーを読み飛ばすガードが同時に入った。**この変更は FR-28 の作業として入り、
> 本項・NFR-05・SPEC-CS-06・SPEC-CS-18 の記述を追随させなかった。**
> 同じ訂正を SPEC-CS-06 / SPEC-CS-18 / SPEC-EL-02 にも入れた。
> 以後、ガードの有無を書く項目は、表の「導入」列のように**いつから**を併記する。
> （同日、レビューで SW とオプションページの「導入」を「初版から」→「1.7.19（1fd7e57）」に直した。`git show 1fd7e57` で確認）

- 要件: NFR-05
- 検証: `auto`（下の「自動テスト」5件。2026-10-11 に追加。`src/` は変えていない）

**自動テスト:**

4経路それぞれで、未知キーを**既知キー2件の間に**挟み、残りの遷移先が設定順に並ぶことを見る。
共通の設定値は `tests/fixtures/storage.mjs` の `STALE_KEYS`（未知キー単体は `STALE_KEY`）。

```javascript
{ 'kabutan.jp/stock': 0, 'ktt-test.invalid/removed': 1, 'minkabu.jp/stock': 2 }
```

- 未知キー `ktt-test.invalid/removed` は実在しえない値にしてある（`.invalid` は予約済みの TLD）
- 既知キー2件の並びは `externalUrls` の定義順（`minkabu.jp/stock` → `kabutan.jp/stock`）の**逆**にしてある。
  定義順のまま並んだ場合と区別するため
- **ガードを一時的に外すと落ちることを、追加時に developer が確かめた**（2026-10-11。表の右端の列。4 はガードではなく保存処理の性質を見る）

| # | ファイル / describe | テスト名 | 手順 | 期待 | ガードを外したとき（2026-10-11 実測） |
| --- | --- | --- | --- | --- | --- |
| 1 | `tests/content-script.spec.mjs` / `設定の反映` | `storage に残った未知のキーは読み飛ばし、残りの遷移先でメニューを作る` | オプションページで `chrome.storage.sync.set({ enableLinkKeys: STALE_KEYS })` を実行して閉じる。`serveFixture(page, RAKUTEN_FAVORITES_URL, RAKUTEN_FAVORITES_HTML)` | `span.x-kabu-root` が3件（フィクスチャの全行）。先頭の `span.x-kabu-root` の `li.x-kabu-menu-item a` が2件で、`href` が順に `https://kabutan.jp/stock/?code=7203`・`https://minkabu.jp/stock/7203`。ページ全体の `li.x-kabu-menu-item a` が6件 | `linkMenu.js` の `if (!entry) { return }` を削除 → `createMenu()` が `TypeError` を投げ、`retrySetup` が握って打ち切るため `span.x-kabu-root` が0件で失敗 |
| 2 | `tests/service-worker.spec.mjs` / `service_worker: コンテキストメニューの再構築` | `storage に残った未知のキーは読み飛ばし、エラーを出さない` | 1つ目の `serviceWorker.evaluate` で、**`set` の前に一度きりの `chrome.storage.onChanged` リスナーを付け**、`STALE_KEYS` を `set` し、そのリスナーの受信を待ってから `await remakeContextMenus()` で **`onChanged` 由来の再構築を待ち切る**。その後 `keys = await installMenuRecorderAsync(serviceWorker)` で記録を差し替える。2つ目の `serviceWorker.evaluate` で `await remakeContextMenus()` の後 `kttMenuRecorder.resultAsync()` を返す | 前提として `keys` が `['kabutan.jp/stock', 'minkabu.jp/stock']`。`lastErrors` が0件。`errors`（`console.error`）が0件。`calls` に `STALE_KEY` を含まない。`calls` を describe 内ヘルパー `splitByRemoveAll(calls)` で `removeAll` ごとの区間に切り、区間が1つ以上あり、**すべての区間**が `['kabutan.jp/stock', 'minkabu.jp/stock']`（`onChanged` 由来の回は差し替え前に済ませるので通常は1区間。区間の数は問わない） | `service_worker.js` の `if (!externalUrlsMap[key]) { continue }` を削除 → `console.error` が1件（`remakeContextMenus: Error: contextMenus.create failed: ktt-test.invalid/removed: Cannot read properties of undefined (reading 'title')`）で失敗 |
| 3 | `tests/options.spec.mjs` / `オプションページ` | `storage に残った未知のキーは行を作らず、有効な行を保存順に並べる` | `pageerror` を集める。options.html を開いて `STALE_KEYS` を `set` し、`openOptions` で開き直す。期待する行の列を `['kabutan.jp/stock', 'minkabu.jp/stock', ...残りの externalUrls のキーを定義順に]` として SW で作る | 行の `id` の列が期待と完全一致（未知キーの行が無く、行数が `externalUrls.length`）。チェック済みの `value` の列が `['kabutan.jp/stock', 'minkabu.jp/stock']`。`pageerror` が0件 | `options.js` の `if (item)` を外す → `createItem(undefined)` が `TypeError` を投げ、行が `['kabutan.jp/stock']` の1件で失敗 |
| 4 | `tests/options.spec.mjs` / `オプションページ` | `storage に残った未知のキーは、保存し直すと消える` | 3 と同じく `STALE_KEYS` を入れて開き直す。`li[id="kabutan.jp/stock"]` の `span.lever` を OFF → ON と2回押す（押すたびにチェック状態を確かめる）。`#save` が `scale-in` になってから押し、`scale-out` に戻るのを待つ。`chrome.storage.sync.get('enableLinkKeys')` を読む | `{ 'kabutan.jp/stock': 0, 'minkabu.jp/stock': 1 }` と完全一致（未知キーが消え、順序の値が詰め直される） | （保存処理の性質を見るテスト）`options.js` の `if (item)` を外すと、初期化が例外で止まって `change` ハンドラが付かず、`#save` が `scale-in` にならず時間切れで失敗 |
| 5 | `tests/tradingview.spec.mjs` / `TradingView: storage に残った未知のキー` | `未知のキーは入れ子の項目に出さず、残りの遷移先を設定順に並べる` | `beforeEach` で `setEnableLinkKeysAsync(context, extensionId, STALE_KEYS)`（既存の describe は `beforeEach` で遷移先を `ONLY_SITE_KEY` の1件にするので別 describe にする。縦位置補正の0件経路だけは、テスト内ヘルパー `makeMenuEmptyAsync` で `{}` に入れ直している）。`stubBrokerTabsAsync(serviceWorker, { loggedIn: false })` → `openChartPageAsync` → ``rightClickAsync(page, `[${CHART_MARK}]`)`` → `openContextMenuAsync` → `openSubmenuAsync` | 入れ子の `<a>` の `textContent`（前後の空白を除く）の列が `['株探/基本情報で開く', 'MINKABU/株価情報トップで開く']`。`href` の列が SW で作った `makeUrl(externalUrlsMap[k].url1, CHART_CODE)` の列と一致 | `tradingview-cs.js` の `item != null &&` を削除 → `makeLinkItemsAsync()` が `TypeError` で reject し、`addTickerMenuAsync()` の `catch` が **3行ごと取り除く**。`openContextMenuAsync` の `tr[data-kabu-tantan]` が0件で失敗（実測）。3行は同期で足されてから非同期で外れるので、最初の判定がその間に当たると `openContextMenuAsync` を通り、`openSubmenuAsync` で失敗することもありうる（推測） |

> **2 の手順で `onChanged` 由来の回を先に待ち切る理由。** 記録の差し替え（`installMenuRecorderAsync`）の途中、
> つまり内部の `await remakeContextMenus()` の後から `await getEnableLinkKeysAsync()` を待つ間に `onChanged` 由来の回が始まると、
> `removeAll` だけが差し替え前に走って記録されず、`create` だけが記録される。すると先頭の区間が途中からの列になりうる
> （reviewer の指摘による推測。実測では再現していない）。
> 受信を待ってから積むのは、`onChanged` が届く前に `remakeContextMenus()` を積んでしまう余地を消すため。
> Service Worker 本体の `onChanged` リスナーはトップレベルで先に登録されているので、テスト側のリスナーが呼ばれた時点で
> `onChanged` 由来の回はキューに積まれている。前提として、テストごとに `context` が作り直されて storage は空から始まるので、
> `set` は必ず変更になり `onChanged` は必ず届く。
> 2026-10-11 の初版の手順は「`set` → `installMenuRecorderAsync`」で、`onChanged` 由来の回が記録に入るかを問わない形にしていた。
> 期待（すべての区間が2キー・区間は1つ以上）は変えていない。変更後は `--repeat-each=10` ですべて通り、
> 記録は `['removeAll', 'kabutan.jp/stock', 'minkabu.jp/stock']` の1区間だった（developer の実測）。
>
> **5 の「ガードを外したとき」は 2026-10-11 に訂正した。** テスト追加前の本表は「3行は残るが入れ子に項目が出ず、
> `openSubmenuAsync` が時間切れで落ちる」と書いていた。実装の `addTickerMenuAsync()` は
> `Promise.all([makeBrokerItemsAsync(…), makeLinkItemsAsync(…)])` を `try` で囲み、`catch` で `removeRows()` を呼ぶ
> （1.11.0 の 4196748 から）。これを読まずに SPEC-CS-18 の旧記述（「3行が除去されずにメニューへ残る」）を写していた。
> ガードが無いときの実際の害は「死んだ3行が残る」ことではない。**未知キーが1つあるだけで、有効な情報サイトと
> 証券会社の項目を含む拡張の3行がまるごと出なくなる**ことである。SPEC-CS-18 も同時に直した。

- **未知キーだけが残っている場合**（上の経路表「未知キーだけが残っている場合」列）は自動テストにしていない。
  楽天・SBI の注入メニューは、ガードを外しても `retrySetup` が例外を握って0件で終わるため、
  「メニューが出ない」ことでは**ガードの有無を区別できない**（既存の `遷移先を全部無効にすると国内株の行にもメニューを出さない` と同じ見え方になる）
- 5 は SPEC-CS-18 の未知キーのガードの検証を兼ねる（SPEC-CS-18 のほかの `auto` は FR-26 の段階4 の範囲で未着手）

**手動確認は置かない。** 4経路とも、実際の拡張を Chromium に読み込んだ自動テストで見ている。
判定は対象サイトの DOM に依存しない（TradingView もフィクスチャ上で拡張自身のコードを動かしている）。
Service Worker 側の「エラー欄に出ない」は、エラー欄に出る元の `chrome.runtime.lastError` と `console.error` を
テストが直接記録し、0件であることを確かめている。
テスト追加（2026-10-11）までは手動確認の手順を置いていた（オプションページのコンソールで `STALE_KEYS` を `set` し、
4経路で既知の2件だけが並ぶことを見る）。

## SPEC-ST-04 順序の復元

読み出し時は値（順序）で昇順ソートしてキー配列を返す。

```javascript
Object.keys(storage.enableLinkKeys)
  .sort((a, b) => storage.enableLinkKeys[a] - storage.enableLinkKeys[b])
```

- 要件: FR-09
- 検証: `auto`（`オプションページ › ハンドルをドラッグして並び替えた順序が保存される`）

## SPEC-ST-05 保存の契機

オプションページの保存ボタン押下時のみ。トグル操作や並び替えでは保存しない
（保存ボタンが表示状態になるだけ）。

- 要件: FR-09
- 検証: `auto`（同上）

## SPEC-ST-06 変更検知

Service Worker が `chrome.storage.onChanged` を購読し、
**変更内容を問わず**コンテキストメニューを再構築する。

> `namespace` や変更キーで絞っていない。保存キーが1つしか無いため実害は無い。

- 要件: FR-05
- 検証: `manual`（オプション変更後に右クリックメニューが変わること）

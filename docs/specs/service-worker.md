# SPEC-SW: バックグラウンド処理

実装: `src/service_worker.js`

## SPEC-SW-01 依存の読み込み

```javascript
importScripts('./urls.js')
```

ES モジュールではなく `importScripts` を使う（CON-02）。
これにより `externalUrls` / `externalUrlsMap` / `getEnableLinkKeysAsync` / `makeUrl` が
Service Worker のグローバルスコープに入る。

> このグローバル露出をテストから利用している（`docs/TESTING.md`）。

- 要件: CON-02
- 検証: `auto`（`urls.js: makeUrl` のテストが Service Worker 上で動くこと自体が証跡）

## SPEC-SW-02 コンテキストメニューの構築

> **1.20.3 で修正した。** f3af82f（2023-07）から 1.20.2 まで、`remakeContextMenus()` は
> `getEnableLinkKeysAsync()` → `removeAll()` → `create()` を順に行う**排他の無い async 関数**だった。
> 契機（SPEC-SW-03）が近接して2回来ると `A:get → B:get → A:removeAll → B:removeAll → A:create×N → B:create×N`
> と交錯し、**B の `create` が全件 `duplicate id` で失敗していた。** `create` にコールバックが無いため、
> chrome://extensions のエラー欄に `Unchecked runtime.lastError: Cannot create item with duplicate id <key>` が
> 有効なキーの件数だけ出ていた（2026-10-11 利用者報告。FR-05 判定基準 3 に反していた。Service Worker 上で `remakeContextMenus(); remakeContextMenus()`
> を `await` なしで呼ぶと再現し、`await` で直列に呼ぶと 0 件）。
> メニューは先行側の `create` で揃うので見た目はほぼ変わらないが、**2回の間に設定が変わると、
> 古い設定と新しい設定の和集合のメニューになりうる**（B の `get` が A の `removeAll` より前に走るため。FR-05 判定基準 1・2）。
> **直列化が要るのは、`removeAll` と `create` の組がメニュー全体を置き換える操作で、
> 2組が重なると置き換えの途中に別の置き換えが割り込むから。** MV3 の Service Worker は同時に1インスタンスしか
> 動かないので、メモリ上の直列化で足りる。
> 実行中の再構築に後続の呼び出しを相乗りさせる（合流する）作りにはしない。契機は起動・更新・設定変更に限られ頻度が低く、
> 単純さを優先する。
> 1.20.2 との差分は3点: 再構築の直列化（下の「直列化」）、`create` の完了待ちと失敗の扱い（「1回の再構築」の手順 3〜4）、
> `remakeContextMenus()` の戻り値（「戻り値」。1.20.2 は1回分の async 関数の Promise で、失敗すると reject した）。

### 構成

`src/service_worker.js` のトップレベルに置く。

| 名前 | 種別 | 役割 |
| --- | --- | --- |
| `contextMenusQueue` | `let`（初期値 `Promise.resolve()`） | 再構築の直列化に使う Promise チェーンの末尾 |
| `remakeContextMenus()` | `const` の関数（`async` にしない） | 1回分の再構築をチェーンの末尾に積み、その回の完了を待てる Promise を返す。契機（SPEC-SW-03）から呼ぶのはこの関数だけ |
| `rebuildContextMenusAsync()` | `const` の `async` 関数 | 1回分の再構築（下の手順 1〜4）。`remakeContextMenus()` 以外から呼ばない |
| `createContextMenuAsync(properties)` | `const` の関数 | `chrome.contextMenus.create(properties, callback)` を Promise にする。コールバック内で `chrome.runtime.lastError` があれば `new Error(lastError.message)` で reject、無ければ resolve |

- `chrome.contextMenus.removeAll()` / `chrome.contextMenus.create()` を呼ぶのは `rebuildContextMenusAsync()` と
  `createContextMenuAsync()` の中だけとする

### 直列化

```javascript
const remakeContextMenus = () => {
  contextMenusQueue = contextMenusQueue
    .then(() => rebuildContextMenusAsync())
    .catch((error) => {
      console.error('remakeContextMenus:', error)
    })
  return contextMenusQueue
}
```

| 項目 | 振る舞い |
| --- | --- |
| 実行順 | 呼び出し順に1回ずつ実行する。前の回が終わる（成功・失敗とも）までは次の回を始めない |
| 設定の読み出し | 各回が**自分の番になった時点で** `getEnableLinkKeysAsync()` を呼ぶ。呼び出し時点では読まない。したがって**最後の回は、その回が始まった時点の最新の設定を反映する** |
| 合流 | しない。N 回呼べば N 回再構築する |
| 前の回の失敗 | チェーンを止めない。失敗は `console.error` に1回出し、次の回はそのまま走る |
| Service Worker の停止 | チェーンはメモリ上にしか無い。停止後の次の起動では空のチェーンから始まる（停止をまたいだ直列化はしない。同時に動くインスタンスが無いため不要） |

### 1回の再構築（`rebuildContextMenusAsync()`）

1. `getEnableLinkKeysAsync()` で有効キーを順序付きで取得する
2. `await chrome.contextMenus.removeAll()` で全削除する
3. 有効キーを順に処理する。`externalUrlsMap` に無いキーはスキップする（SPEC-ST-03）。
   それ以外は `await createContextMenuAsync({ id: key, title: externalUrlsMap[key].title, contexts: ['selection'] })` で
   **1件ずつ完了を待つ**。**失敗しても残りのキーの作成を続ける**（失敗したキーと `Error.message` を記録する）
4. 手順 3 で1件以上失敗していれば、`Error` を投げる。`message` は失敗した**全キー**と各キーの `lastError.message` を含む
   （例: `contextMenus.create failed: minkabu.jp/stock: Cannot create item with duplicate id minkabu.jp/stock; kabutan.jp/stock: …`）

- 手順 1・2 が失敗（reject）した回は、その場で中断する（`create` を1件も呼ばない）。失敗の扱いは「直列化」の表のとおり
- `create` を1件ずつ待つのは、項目の並び（＝オプションページの並び順。FR-05 判定基準 1）を呼び出しの到着順に頼らないため
- `create` の失敗を握りつぶさない。**直列化後に `create` が失敗したら、それは本件とは別の不具合**なので
  `console.error`（chrome://extensions のエラー欄に出る）で見えるようにする
- `contexts: ['selection']` なので**文字列選択時のみ**表示される

### 戻り値

`remakeContextMenus()` は、**その呼び出しで積んだ回が終わったとき**に `undefined` で fulfill する Promise を返す。

- その回が失敗しても **reject しない**（失敗は `.catch` で `console.error` 済み）。
  契機のハンドラは戻り値を待たない（SPEC-SW-03）ので、reject させると `Uncaught (in promise)` が重ねて出るため
- 同じ回の前に積まれた回もすべて終わっているので、`await remakeContextMenus()` は**それまでに積まれた全再構築の完了待ち**としても使える
  （テストはこれで起動時の `onInstalled` 由来の再構築を待ち切ってから始める）

### 検証（SPEC-SW-02）

| 種別 | 内容 |
| --- | --- |
| `auto` | `tests/service-worker.spec.mjs` の describe **`service_worker: コンテキストメニューの再構築`**（1.20.3 で追加）。下の4件が SPEC-SW-02 の分。**同じ describe の5件目 `storage に残った未知のキーは読み飛ばし、エラーを出さない` は SPEC-ST-03 の自動テスト 2**（2026-10-11 追加） |
| `review` | 契機のハンドラ（SPEC-SW-03）が `remakeContextMenus()` を呼ぶだけであること。`removeAll` / `create` の呼び出しが `rebuildContextMenusAsync()` / `createContextMenuAsync()` の外に無いこと |
| `manual`（**任意**） | 下の「手動確認」（`docs/MANUAL-CHECKLIST.md` **D-2**）。**Chrome の画面の表示そのもの**（エラー欄・右クリックメニューの描画）だけを見る。依頼の対象にしない（2026-10-11 に必須から変更） |

**自動テスト（describe `service_worker: コンテキストメニューの再構築`）:**

共通の前処理（`installMenuRecorderAsync`）: `serviceWorker.evaluate` の中で、まず `await remakeContextMenus()` で
起動時（`onInstalled`）の再構築を待ち切る。期待するキーの列 `keys` は
`(await getEnableLinkKeysAsync()).filter((key) => externalUrlsMap[key])`。
`chrome.contextMenus.removeAll` / `chrome.contextMenus.create` / `console.error` を代入で差し替え、呼び出しを記録する。

- `removeAll`: `'removeAll'` を記録してから、差し替え可能な委譲先（初期値は元の `removeAll`）を呼ぶ。各テストは委譲先を差し替えて失敗や待機を作る
- `create`: `id` を記録する。渡されたコールバックの有無にかかわらず自前のコールバックで元の `create` を呼び、
  その中で `chrome.runtime.lastError?.message` を記録してから、渡されたコールバックがあれば**同期で**呼ぶ（`lastError` はその間だけ読める）
- `console.error`: 引数を文字列化して記録し、元の関数にも渡す
- 記録を返す前に、**`create` のコールバックが全件呼ばれるのを待つ**（完了を待たない実装でも `lastError` を取りこぼさないため）
- `context` はテストごとに作り直されるので差し替えを戻す処理は要らない（既存の `証券会社の応答` と同じ）

| テスト名 | 手順 | 期待 |
| --- | --- | --- |
| `並行して呼んでも create の lastError が出ない` | `await Promise.all([remakeContextMenus(), remakeContextMenus()])` | 記録した `lastError` が0件。`console.error` が0回。呼び出しの記録が `['removeAll', ...keys, 'removeAll', ...keys]` と完全一致（交錯していない） |
| `前の再構築が失敗しても次の再構築は走る` | `removeAll` を「1回目だけ `Promise.reject(new Error('KTT-TEST'))`、2回目以降は元の関数」に差し替え、`await Promise.all([remakeContextMenus(), remakeContextMenus()])` | `Promise.all` が fulfill する（どちらの戻り値も reject しない）。`console.error` が1回で、引数に `KTT-TEST` を含む。呼び出しの記録が `['removeAll', 'removeAll', ...keys]` と完全一致（1回目は `removeAll` の失敗で中断し `create` を1件も呼ばない。2回目は全件を順に作る）。`lastError` が0件 |
| `create の失敗を console.error に出し、残りの項目も作る` | 前提として `keys.length > 1` を確かめる（先頭キーと末尾キーを区別するため）。`removeAll` を何もしない `async () => {}` に差し替える（既存の項目が残るので、`create` は実際に `duplicate id` で失敗する）。`await remakeContextMenus()` | 戻り値が fulfill する。`create` が `keys` の全件について順に呼ばれる（1件目の失敗で止まらない）。前提として、記録した `lastError` が `keys.length` 件ある（全件が実際に失敗している）。`console.error` がちょうど1回で、その文字列化に `duplicate id`・`keys` の先頭キー・末尾キーを含む |
| `各回は自分の番になった時点の設定で作る` | 前提として `keys.length > 1` を確かめる（変更の前後で項目の列を区別するため）。`removeAll` の1回目だけ、**到達した時点で合図を出し**、テスト側で解放するまで待たせる。A = `remakeContextMenus()`、B = `remakeContextMenus()` を `await` なしで呼ぶ。**合図を待ってから**（＝A が設定を読み終え、1回目の `removeAll` で止まってから）`await chrome.storage.sync.set({ enableLinkKeys: { [keys[0]]: 0 } })`。その後 1回目の `removeAll` を解放し、`await remakeContextMenus()` で待ち切る | 記録を `removeAll` で区切った各区間の `create` の id 列が、1区間目は `keys`、2区間目以降はすべて `[keys[0]]`。区間は3つ以上（A・B・`onChanged` 由来の回・待ち切りの回。`onChanged` の到着時機は問わない） |

- 4件目で合図を待つのは、A の回が**マイクロタスクで始まる**ため（`remakeContextMenus()` は `.then` で回を始める）。
  A・B を呼んだ直後に同期で `set` すると、A の `get` が `set` より後になり、仕様どおりの実装でも1区間目が `[keys[0]]` になる
- 1件目・4件目は 1.20.2 の実装では失敗する作りである（1件目は記録が `removeAll, removeAll, …` の順になり `lastError` が出る。
  4件目は B が呼び出し時点で設定を読むので2区間目が `keys` になる）

**手動確認（`docs/MANUAL-CHECKLIST.md` D-2。任意。手順は同じ）:**

1. `chrome://extensions` の株リンクのカードからエラーの一覧を開き、表示中のエラーをすべて消す（ボタンの表示名は Chrome の版・表示言語で異なる）
2. `chrome://extensions` の一覧に戻り、株リンクのカードにある Service Worker のリンク（例: 「ビューを検査」の横の `service worker`。表示名は版・表示言語で異なる）から DevTools を開き、コンソールで `remakeContextMenus(); remakeContextMenus()` を実行する
3. コンソールにもエラー欄にも `Unchecked runtime.lastError` と `remakeContextMenus:` が出ないこと
4. 任意のページで `7203` を選択して右クリックし、株リンクの項目が**有効な遷移先ごとに1回ずつ**、オプションページの並び順で並ぶこと

**自動テストとの分担（2026-10-11 に整理。FR-26 判定基準 3 と同じく、自動と手動で同じことを二重に持たない）:**

| 旧手動確認 | 自動テストが代わっている範囲 | 手動に残るもの |
| --- | --- | --- |
| 手順 3（作り直しを2回続けてもエラーが出ない） | `並行して呼んでも create の lastError が出ない` が `create` の `lastError` 0件と `console.error` 0回を確かめる。現行実装では、メニュー構築がエラー欄に出す経路はこの2つしか無い（下記） | エラー欄の**表示**。Playwright から読めない（下記の実測） |
| 手順 4（1回ずつ・設定の順） | 同じテストの呼び出し記録 `['removeAll', ...keys, 'removeAll', ...keys]` の完全一致と `lastError` 0件で、最後に登録された項目が `keys` の順に1回ずつであることが決まる（同じ id の2回目の `create` は `duplicate id` で失敗することを3件目のテストが実際に起こして確かめている）。設定変更の重なりは4件目 | 右クリックメニューの**描画**。作った順に描くのは Chrome の振る舞い。登録済みの項目を読み出す API は `chrome.contextMenus` に無い（事実）。Playwright からブラウザ自身の右クリックメニューを開いて操作できないことは、2026-10-11 に FR-29 の作業で確かめた（SPEC-SW-10 の「自動化できない理由」） |
| 旧手順 5（拡張を再読み込みしたあともエラー欄が空） | **確認から外した**（不具合を見分けられない。下記の実測） | なし |

- **メニュー構築がエラー欄に出す経路（実装の読み取り。事実）:** `create` は必ず `createContextMenuAsync()` 経由で、
  そのコールバックが `chrome.runtime.lastError` を読む。したがって現行実装は `create` から `Unchecked runtime.lastError` を出さない。
  `removeAll` は Promise 形式で、失敗は reject になる。どちらの失敗も `remakeContextMenus()` の `.catch` が
  `console.error('remakeContextMenus:', …)` に1回出す。`review` 行の「`removeAll` / `create` の呼び出しが2関数の外に無い」がこの前提を守る
- **任意にした理由:** 手動に残るのはエラー欄と右クリックメニューの**Chrome による表示**だけで、拡張のコードの退行はそこに現れる前に自動テストで落ちる。
  表示の確認は「1.20.3 の是正を利用者の Chrome で一度見届ける」意味しか持たず、`src/service_worker.js` を変えるたびに繰り返す価値が無い。
  削除せず任意で残すのは、元の利用者報告がエラー欄の表示だったため（見届けたいときの手順として残す）。
  FR-05 は手動確認を ✅ の条件にしていない（FR-05 の「手動確認」欄）ので、任意にしても FR-05 の状態は動かない

**実測（2026-10-11。メインセッションの使い捨てスクリプト。リポジトリには入れていない）— エラー欄は Playwright から読めない:**

| 項目 | 内容 |
| --- | --- |
| 方法 | 既存テストと同じ `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=…', '--load-extension=…'] })` で 1.20.2（7405875 の `src/`）を読み込む。`chrome://extensions` を開き `chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })` で開発者モードを有効にする。Service Worker で `remakeContextMenus(); remakeContextMenus()` を実行し、`chrome.developerPrivate.getExtensionInfo(id)` の `runtimeErrors` を読む |
| 事実 1 | 不具合そのものは再現する。`create` を差し替えてコールバックで数えると、1.20.2 で `lastError` が **22 件**出た |
| 事実 2 | `runtimeErrors` は**常に空**。ヘッドレス／画面あり、Preferences に `extensions.ui.developer_mode: true` を書いて起動、`--error-console` フラグの組み合わせ4通りと画面ありの計5回とも空 |
| 事実 3 | 比較用に Service Worker で出した `console.error('KTT-PROBE …')` と `setTimeout(() => { throw … })` も `runtimeErrors` に載らなかった。この環境ではエラー欄そのものに何も記録されない |
| 結論 | エラー欄の表示は Playwright から確かめられない。原因（`lastError` と `console.error`）は自動テストが直接記録して0件を確かめている |

**実測（2026-10-11。architect の使い捨てスクリプト。リポジトリには入れていない）— 再読み込み:**

| 項目 | 内容 |
| --- | --- |
| 再読み込みの再現 | **できた。** 上と同じ起動方法で、`chrome://extensions` で開発者モードを有効にしたうえで `chrome.developerPrivate.reload(id, { failQuietly: true })`、または Service Worker から `chrome.runtime.reload()` を呼ぶと、新しい Service Worker が立ち上がり `context` の `serviceworker` イベントが来た（各1回） |
| 再現しなかった条件 | 開発者モードを有効にせず `chrome://extensions` も開かずに `chrome.runtime.reload()` を呼んだ1回は、新しい Service Worker が立ち上がらず、拡張のページが `net::ERR_BLOCKED_BY_CLIENT` になった。**どちらの差が効いているかは切り分けていない** |
| 再読み込みで起きる作り直し | 1.20.2 と現行（1.20.3）の `src/` を作業用ディレクトリに複製し、`service_worker.js` の先頭に `create` / `removeAll` / `onInstalled` を記録する処理を足して、`developerPrivate.reload` を2回ずつ実行した。**両版とも毎回** `onInstalled` の `reason` は `update`、`removeAll` 1回・`create` 22回・`lastError` **0件**。初回インストール時（`reason: 'install'`）も両版とも同じ |
| 結論 | 再読み込みは作り直しを1回起こすだけで、重なりを作らない。**1.20.2 でもエラーが出ないので、旧手順 5 は不具合を見分けられない。** 自動化もしない（見分ける力の無い確認を移しても守るものが無い） |

- **SPEC-CS-19 の「拡張機能の再読み込みは Playwright から再現できず」は本件には当てはまらない。** 上のとおり再読み込みそのものは再現できた。
  SPEC-CS-19 が自動化できないとしている本体は「切断状態（古いタブの Content Script）」で、そちらが再現できるかは確かめていない（SPEC-CS-19 に注記した）
- 推測（未検証）: 利用者の Chrome でも、再読み込みだけでは他の契機（`onStartup` / `storage.onChanged`）は起きず、重ならない。Playwright の Chromium と同じ結果になると見ている

> Chrome 本体の更新（`onInstalled` の `chrome_update` と `onStartup` の重なり）は手元で再現できないため、自動テストに委ねる。

- 要件: FR-05（判定基準 1〜3）

## SPEC-SW-03 再構築の契機

| イベント | 動作 |
| --- | --- |
| `chrome.runtime.onInstalled` | `remakeContextMenus()` を呼ぶ（SPEC-SW-04 の判定より前） |
| `chrome.runtime.onStartup` | `remakeContextMenus()` を呼ぶ |
| `chrome.storage.onChanged` | `remakeContextMenus()` を呼ぶ（変更されたキー・領域は見ない） |

- どのハンドラも `remakeContextMenus()` の戻り値を**待たない**（`await` も `return` もしない）
- **契機は重なりうる。** 重なっても SPEC-SW-02 の直列化により1回ずつ順に実行され、最後の回が最新の設定を反映する。
  重なる組み合わせとして次を想定する（いずれも推測。実測していない）。1.20.2 までは重なると交錯していた（SPEC-SW-02 の経緯）
  - Chrome 本体の更新後の起動: `onInstalled`（`reason: 'chrome_update'`）と `onStartup` がほぼ同時に来る
  - 起動直後の設定の同期: 他端末からの `storage.sync` の同期による `onChanged` と `onStartup`
  - オプションページでの連続保存: `onChanged` が続けて来る

- 要件: FR-05（判定基準 2・3）
- 検証: `auto`（SPEC-SW-02 の describe `service_worker: コンテキストメニューの再構築`。重なりを `remakeContextMenus()` の並行呼び出しで再現する。
  `onInstalled` / `onStartup` を合成発火する手段は無い）／`review`（ハンドラが `remakeContextMenus()` を呼ぶだけであること）／
  `manual`（SPEC-SW-02 の手動確認に加え、オプションページで遷移先を1つ外して保存し、右クリックメニューからその項目だけが消えること）

## SPEC-SW-04 オプションページを自動で開く条件（FR-10）

> **1.20.1 で修正した。** 1.10.0〜1.20.0 の実装は FR-10 に反していた。`reason` を見ずに
> `details.reason === 'install' || compareVersion(details.previousVersion, '1.0.9') < 0` としており、
> **Chrome 本体の更新（`reason: 'chrome_update'`）のたびにオプションページが開いていた。**
> `previousVersion` は `reason === 'update'` のときにしか存在せず（Chrome の仕様）、
> `compareVersion(undefined, '1.0.9')` は SPEC-SW-09 により負を返すため。
> 1.9.21 までの文字列比較（`undefined < '1.0.9'` は `false`）では起きておらず、
> 数値比較へ置き換えた e47a177（1.10.0）の退行である。

### 判定関数 `shouldOpenOptionsPage(details)`

`src/service_worker.js` のトップレベルに `const` で置く純関数。`chrome.*` を呼ばない。
`onInstalled` のハンドラは次の形にする（判定をハンドラ内に書かない）。

```javascript
chrome.runtime.onInstalled.addListener((details) => {
  remakeContextMenus()

  if (shouldOpenOptionsPage(details)) {
    chrome.runtime.openOptionsPage()
  }
})
```

| `details.reason` | `details.previousVersion` | 戻り値 | 根拠 |
| --- | --- | --- | --- |
| `'install'` | （無い） | `true` | 初回インストール |
| `'update'` | `'1.0.8'` など `1.0.9` 未満の文字列 | `true` | 設定形式が変わった版より前からの更新 |
| `'update'` | `'1.0.9'` / `'1.0.10'` / `'1.20.0'` など `1.0.9` 以上の文字列 | `false` | 境界は `1.0.9` を含まない（`< 0`） |
| `'update'` | 文字列でない（`undefined` 等） | `false` | Chrome の仕様では起きない。起きたら開かない側に倒す |
| `'chrome_update'` | （無い） | `false` | Chrome 本体の更新。FR-10 の対象外 |
| `'shared_module_update'` | （無い） | `false` | 共有モジュールの更新。FR-10 の対象外 |
| 上記以外の値 | — | `false` | 未知の理由では開かない |

- バージョン比較は **`reason === 'update'` かつ `typeof previousVersion === 'string'` のときだけ**行う
- 比較は `compareVersion(details.previousVersion, '1.0.9') < 0`（数値比較。SPEC-SW-09）
- 閾値 `'1.0.9'` は関数内のリテラルのままでよい（他所から参照しない）
- `compareVersion()` は変更しない（SPEC-SW-09 の `undefined` の扱いはそのまま）。
  **「前の版が無い」を `compareVersion` に渡さない**のは呼び出し側（本関数）の責務とする

### 検証

| 種別 | 内容 |
| --- | --- |
| `auto` | `tests/service-worker.spec.mjs` の describe **`service_worker: shouldOpenOptionsPage`**（新設）。`serviceWorker.evaluate` で上表の全行を引数に渡し、戻り値を確かめる。テスト名は次の4件とする: `初回インストールでは開く` / `1.0.9 未満からの更新では開く` / `1.0.9 以上からの更新では開かない`（`1.0.9` / `1.0.10` / `1.20.0`） / `Chrome 本体と共有モジュールの更新では開かない`（`chrome_update` / `shared_module_update` / `update` かつ `previousVersion` 無し / 未知の `reason`） |
| `review` | `onInstalled` のハンドラが `shouldOpenOptionsPage(details)` だけで分岐していること（`onInstalled` を合成発火する手段が無いため、配線はレビューで見る） |
| `manual` | `chrome://extensions` で拡張を再読み込みしてもオプションページが開かないこと（`reason: 'update'`、`previousVersion` は現行版）。`chrome_update` は手元で再現できないため自動テストに委ねる |

- 要件: FR-10, NFR-04

## SPEC-SW-05 コンテキストメニュークリック時の動作

> **1.21.0 から（FR-29）。** 1.20.3 までは `onClicked` に無名関数を渡し、銘柄コードと解釈できなければ
> `console.log('銘柄コードが見つかりませんでした')` して抜け、URL が決まらなければ（米国株で `url3` の無い遷移先）**何もせずに抜けていた**
> （FR-29 の「押しても何も起きない」の 1・2）。1.21.0 でハンドラを名前付き関数にし、その2つの分岐で小窓を開くようにした。
> 判定の順序と、開ける場合の振る舞い（`tabs.create` の引数）は変えていない。設計判断は ADR-0017。

### 構成（SPEC-SW-05）

`src/service_worker.js` のトップレベルに置く。

| 名前 | 種別 | 役割 |
| --- | --- | --- |
| `onContextMenuClickedAsync(info, tab)` | `const` の `async` 関数 | クリック時の処理（下の手順）。`chrome.contextMenus.onClicked.addListener(onContextMenuClickedAsync)` で登録する。**無名関数で包まない**（テストが同じ関数を直接呼び、登録も `hasListener` で確かめるため） |
| `openNoticeWindowAsync(params, tab)` | `const` の `async` 関数 | 小窓を開く（SPEC-SW-10） |

### 手順（SPEC-SW-05）

1. `getTickerCode(info.selectionText)` で銘柄コードを判定する（SPEC-TC-04）
2. `status: false` なら、`await openNoticeWindowAsync({ reason: 'not-ticker', key }, tab)` して終わる。
   **選択文字列（`info.selectionText`）は `params` に入れない**（FR-29 判定基準 4・7）。コンソールには何も出さない
3. `externalUrlsMap[key]` が無ければ `console.error(`unknown key: ${key}`)` して終わる（**小窓は開かない**。FR-29 の洗い出し 3）
4. `getUrl(type, code, exchange, url1, url2, url3)` で遷移先を決める（SPEC-TC-05）
5. URL が得られれば `chrome.tabs.create({ url })` して終わる（引数は `{ url }` だけ。**小窓は開かない**）
6. URL が得られなければ `await openNoticeWindowAsync({ reason: 'us-unsupported', key, code }, tab)` する

- 判定の順序は 銘柄コード → 識別子 → URL（1.20.3 と同じ）
- **未知の識別子でも、選択文字列が銘柄コードとして読めなければ手順 2 が先に当たり、`not-ticker` の小窓が開く。**
  手順 3（知らせない）に来るのは、未知の識別子で、かつ銘柄コードとして読めた場合だけ。
  項目は定義にある遷移先からしか作らない（SPEC-SW-02）ので未知の識別子は利用者の操作では起きず、`not-ticker` の小窓は `key` を表示に使わない（SPEC-NT-02）。
  したがって**順序は入れ替えない**（入れ替えると 1.20.3 からの差分が増えるだけで、利用者に見える違いが無い）
- 手順 6 に来るのは `type === 'us'` で、`url3` が無く、かつ「`url2` が無いか `exchange` が無い」場合だけ。
  `type === 'jp'` は `url1` が必須（SPEC-EL-05）なので必ず URL が決まる
- `onContextMenuClickedAsync` が返す Promise は reject しない（`openNoticeWindowAsync` が例外を内側で処理する。SPEC-SW-10）
- `params` に入るのは Service Worker が作った値だけ（`reason` は固定の文字列、`key` は `menuItemId`、`code` は `getTickerCode` の結果）

### 検証（SPEC-SW-05）

| 種別 | 内容 |
| --- | --- |
| `auto` | `tests/service-worker.spec.mjs` の describe **`service_worker: 開けない項目を押したときの小窓`**（1.21.0 で追加。下の8件） |
| `review` | `onClicked` のハンドラが `onContextMenuClickedAsync` そのものであること。手順の順序が上のとおりであること。**差分が `src/tradingview-cs.js` / `src/tradingview-cs.css` / `src/linkMenu.js` / `src/*-cs.js` / `src/urls.js` / `src/style.css` に入っていないこと**（FR-29 判定基準 8。TradingView のメニューと注入メニューの組み立てに触れない） |
| `auto`（既存） | FR-29 判定基準 8 の退行検知として、既存の `tests/tradingview.spec.mjs` と `tests/content-script.spec.mjs` が全件通ること。**ただし FR-07 判定基準 1〜4（米国株でボタンメニューに出る項目の集合）を直接見るテストは無い**（FR-07 の「確認方法」。自動化は FR-26 の段階 4）。本件はそれらのファイルを変えないので、上の `review` と合わせて退行しないことの根拠にする |
| `manual` | SPEC-SW-10 の手動確認 M-1（Chrome の右クリックメニューを実際に押す。自動化できないことは 2026-10-11 に確かめた。同節） |

**共通の前処理（`installOpenRecorderAsync(serviceWorker, { realWindows })`）:**
`serviceWorker.evaluate` の中で、`chrome.tabs.create` を「引数を記録して `{}` を返す」関数に差し替える。
`realWindows` が偽なら `chrome.windows.create` も「引数を記録して `{ id: -1 }` を返す」関数に差し替える（実際には開かない）。
`console.error` は引数を文字列化して記録し、元の関数にも渡す。記録は `globalThis.kttOpenRecorder` に置く。
`context` はテストごとに作り直されるので差し替えを戻す処理は要らない（既存の `証券会社の応答` と同じ）。
各テストで扱う遷移先の一覧は、`externalUrls` から実行時に作る（直書きしない）。

- `usUnsupportedKeys`: `url3` も `url2` も持たない key（前提として1件以上あること）
- `url3Keys`: `url3` を持つ key（前提として1件以上あること）
- `url2Keys`: `url2` を持つ key

| # | テスト名 | 手順 | 期待 |
| --- | --- | --- | --- |
| 1 | `米国株のページが無い遷移先を押すと、タブを開かず小窓を1つ開く` | `usUnsupportedKeys` の各 key について、選択文字列 `AAPL` / `NASDAQ:AAPL` / `AAPL NASDAQ` のそれぞれで、記録を空にしてから `await onContextMenuClickedAsync({ menuItemId: key, selectionText }, undefined)` | 毎回、`tabs.create` が0回、`windows.create` が1回。その引数は `type: 'popup'`・`focused: true`・`width: 440`・`height: 280`。`url` を `new URL()` で分解し、`origin + pathname` が `chrome.runtime.getURL('notice.html')` と一致し、`[...searchParams]` が `[['reason', 'us-unsupported'], ['key', key], ['code', 'AAPL']]` と完全一致。`console.error` が0回 |
| 2 | `開ける場合はこれまでどおりタブを開き、小窓を開かない` | 全 key で `7203`、`url3Keys` で `AAPL`、`url2Keys` で `NASDAQ:AAPL` を押す（1回ごとに記録を空にする） | 毎回、`tabs.create` がちょうど1回で、引数が `{ url: 期待値 }` と完全一致（期待値は `makeUrl(url1, '7203')` / `makeUrl(url3, 'AAPL')` / `makeUrl(url2, 'AAPL', 'NASDAQ')`）。`windows.create` は全体で0回 |
| 3 | `銘柄コードと解釈できない文字列では、選択した文字列を渡さずに小窓を開く` | key `kabutan.jp/stock` で、選択文字列 `こんにちは` / `株価はNYSEで上昇` / `SP:SPX` / `BRK.B` を押す | 毎回、`tabs.create` 0回、`windows.create` 1回。`[...searchParams]` が `[['reason', 'not-ticker'], ['key', 'kabutan.jp/stock']]` と完全一致。`url` が選択文字列そのものも `encodeURIComponent(選択文字列)` も含まない。`console.error` 0回 |
| 4 | `未知の遷移先キーは小窓もタブも開かず、console.error に出す` | `menuItemId` に `STALE_KEY`（`tests/fixtures/storage.mjs`）、選択文字列 `7203` | `tabs.create` 0回、`windows.create` 0回。`console.error` が1回で、`unknown key` と `STALE_KEY` を含む |
| 5 | `小窓は押した元のウィンドウの中央に開く` | `base = (await chrome.windows.getAll({ windowTypes: ['normal'] }))[0]`。(i) `tab = { id: -1, windowId: base.id }`、(ii) `tab = undefined`、(iii) `tab = { id: -1, windowId: -1 }` で、`usUnsupportedKeys[0]` と `AAPL` を押す | (i) `left === base.left + Math.max(0, Math.round((base.width - 440) / 2))`、`top === base.top + Math.max(0, Math.round((base.height - 280) / 2))`。(ii)(iii) 引数に `left` / `top` のキーが無い。(i)〜(iii) とも `windows.create` が1回、`console.error` 0回 |
| 6 | `何度押しても小窓は1つだけで、最後に押した内容を出す` | `realWindows: true`。`usUnsupportedKeys[0]` で `AAPL` → `MSFT` → `TSLA` を順に `await` して押す（`tab` は (i) と同じ） | `chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })` のうち、タブの `pendingUrl` か `url` が `chrome.runtime.getURL('notice.html')` で始まるウィンドウがちょうど1つ。その URL の `code` が `TSLA`。`tabs.create` 0回 |
| 7 | `小窓を開けなくても例外を外へ出さない` | `chrome.windows.create` を `async () => { throw new Error('KTT-TEST') }` に差し替えて、`usUnsupportedKeys[0]` と `AAPL` を押す | `onContextMenuClickedAsync` の Promise が fulfill する。`console.error` が1回で `KTT-TEST` を含む |
| 8 | `クリックのハンドラは onClicked に登録されている` | `chrome.contextMenus.onClicked.hasListener(onContextMenuClickedAsync)` | `true` |

**「ガードを外すと落ちる」ことの実証（1.21.0 の実装時に developer が1回ずつ行い、下の全行で該当テストが落ちることを確かめた。変更はコミットしていない）:**

| 一時的に入れる変更 | 落ちるべきテスト |
| --- | --- |
| 手順 6 を消す（URL が無ければ黙って抜ける。1.20.3 の振る舞い） | 1 |
| 手順 5 のあとも小窓を開く | 2 |
| 手順 3 で小窓を開く／`console.error` を消す | 4 |
| SPEC-SW-10 の手順 2（既存の小窓を閉じる）を消す | 6（ウィンドウが3つになる） |
| SPEC-SW-10 の手順 3（位置）を消す | 5 の (i) |
| SPEC-SW-10 の `try` / `catch` を消す | 7 |
| `addListener` に無名関数を渡す形に戻す | 8 |
| 手順 2 で `params` に `info.selectionText` を足す | 3 |
| 手順 2 を現行（`console.log` して抜ける）に戻す | 3 |

- 要件: FR-05, FR-29（判定基準 1〜5・8・9）
- 検証: 上の表

## SPEC-SW-06 楽天証券 URL の生成

`getRakutenSecUrlAsync(type, code)`

1. `chrome.tabs.query({ url: 'https://member.rakuten-sec.co.jp/*' })` で開いているタブを探す
2. タブ URL から `/[;?&]BV_SessionID=([^?&]+)/` でセッション ID を抽出（最初に見つかったもの）
3. セッション ID があれば銘柄ページ URL を組み立てる

> **1.20.2 から。** 1.20.1 までの `jp` の URL は `…&chartPeriod=1&dscrCd=6526&gmn=J…` と
> **`dscrCd` を2つ持ち、2つ目が直書きの `6526`** だった。初期実装（5265886）からの残骸で、銘柄コードとは無関係。

| type | パス | クエリ（**完全形。省略しない**） |
| --- | --- | --- |
| `jp` | `/app/info_jp_prc_stock.do;BV_SessionID=<id>` | `?eventType=init&dscrCd=<code>&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01` |
| `us` | `/app/info_us_prc_stock.do;BV_SessionID=<id>` | `?eventType=init&tickerCd=<code>&chartType=&l-id=mem_us_fu_a_a` |

- オリジンは両方とも `https://member.rakuten-sec.co.jp`
- **`jp` のクエリは `dscrCd` を1つだけ持ち、その値は `<code>`（銘柄コード）であること。**
  パラメータの並びも上表のとおりとする
- `jp` のクエリは実サイト検証ツールの `RAKUTEN_STOCK_QUERY`（`scripts/selector-check/targets.mjs`。
  SPEC-SC-06）と、銘柄コード部分（`7203`）を除いて同一。片方を変えるときはもう片方を確認する
  （両者はコードを共有しない。ツールは `src/` を読み込まないため）

**ログイン済みタブが無ければ `null`** を返し、メニューに項目を出さない。

> セッション ID を新規に取得することはしない。ユーザーが既に開いているタブから
> 借用するだけ。これが `tabs` 権限を必要とする理由（SPEC-MF-03）。

**組み立てた URL は Service Worker の外に出さない**（SPEC-MSG-06）。使い道は
`chrome.tabs.create({ url })` の引数だけで、メッセージの応答・ログ・storage に載せない。

> **1.20.1 から。** 1.20.0 までは `rakuten-sec:info` /
> `rakuten-sec:open` の応答で URL（`BV_SessionID` を含む）を Content Script に返し、
> TradingView の右クリックメニューでは `<a href>` として**ページの DOM に書き出していた**（SPEC-CS-28）。

- 要件: FR-06, NFR-03, CON-04
- 検証: `auto`（`tests/service-worker.spec.mjs` の describe **`service_worker: 証券会社の応答`**。SPEC-MSG-06）
  - **`楽天証券の国内株 URL は dscrCd を1つだけ持ち、値は銘柄コードである`**（1.20.2 で追加済み）:
    `rakuten-sec:open`（`code: '7203'`, `type: 'jp'`）で `chrome.tabs.create` に渡った URL について、
    `new URL(url).searchParams.getAll('dscrCd')` が `['7203']` と等しく、
    `new URL(url).search` が `?eventType=init&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01` と完全一致すること
  - `manual`（楽天証券にログインした状態で TradingView を開き、メニューに出ること。
    国内株の項目を開き、指定した銘柄の個別銘柄ページが表示されること）

## SPEC-SW-07 内藤証券 URL の生成

`getNaitoSecUrlAsync(type, code)`

1. `chrome.tabs.query({ url: 'https://*.qhit.net/naito/iswebptt2/*' })`
2. タブ URL が `/([;?&]qcode=)([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])/` に一致すれば、
   `qcode` を対象銘柄コードに差し替えた URL を返す
3. `type === 'jp'` のみ対応。米国株は常に `null`

返す URL は**ログイン済みタブの URL の丸写し**（`qcode` 以外のクエリ・セッション相当の値を含む）。
楽天証券と同じく **Service Worker の外に出さない**（SPEC-MSG-06。1.20.1 から）。

- 要件: FR-06, NFR-03, CON-04
- 検証: `auto`（describe **`service_worker: 証券会社の応答`**。SPEC-MSG-06）／
  `manual`（内藤証券で国内株個別銘柄を開いた状態で TradingView を開く）

## SPEC-SW-08 アクションボタン

`chrome.action.onClicked` で `chrome.runtime.openOptionsPage()` を呼ぶ。

- 要件: FR-05
- 検証: `manual`

## SPEC-SW-09 compareVersion

`MAJOR.MINOR.PATCH` を `.` 区切りで数値化し、先頭から比較する。

- 欠けた要素は `0` として扱う
- 数値化できない要素は `0` として扱う
- `undefined` / `null` は `'0'` として扱う

> **`undefined` → `'0'` は変えない（1.20.1 で判断）。** 「前の版が無い」ことを比較の結果で表すと、
> 呼び出し側の意図（開く／開かない）を比較関数が決めることになる。1.10.0 の退行はこの形から出た。
> 有無の判定は呼び出し側で先に行う（SPEC-SW-04 の `shouldOpenOptionsPage`）。
> 既存テスト `compareVersion › マイナー/パッチを数値として比較する` の `undef` の期待値（負）は
> **本関数の契約として残す**。テスト内のコメントに「オプションページを開く判定ではない。SPEC-SW-04」と書いてある（1.20.1）。

- 要件: NFR-04
- 検証: `auto`（`compareVersion › マイナー/パッチを数値として比較する`）

## SPEC-SW-10 開けないときの小窓を開く

> **1.21.0 から。** 要件は FR-29。設計判断は ADR-0017。

`openNoticeWindowAsync(params, tab)`。`src/service_worker.js` のトップレベルに `const` の `async` 関数で置く。
呼ぶのは `onContextMenuClickedAsync`（SPEC-SW-05）だけ。小窓のページそのものは SPEC-NT。

### 定数

| 名前 | 値 | 用途 |
| --- | --- | --- |
| `noticePagePath` | `'notice.html'` | 小窓のページ（SPEC-NT-01） |
| `noticeWindowWidth` | `440` | 小窓の幅（枠を含む。px） |
| `noticeWindowHeight` | `280` | 小窓の高さ（枠・タイトルバーを含む。px） |

### 引数

| 引数 | 内容 |
| --- | --- |
| `params` | `{ reason: 'us-unsupported', key, code }` または `{ reason: 'not-ticker', key }`（後者は FR-29 判定基準 4） |
| `tab` | `onClicked` の第2引数をそのまま渡す。`undefined` のこともある |

### 手順（SPEC-SW-10）

関数の本体全体を `try` / `catch` で包み、例外は `console.error('openNoticeWindowAsync:', error)` に1回出して握る（**reject しない**）。

1. **URL を作る。** `chrome.runtime.getURL(noticePagePath) + '?' + new URLSearchParams(params)`。
   クエリの並びは `params` のキーの順（`reason` → `key` → `code`）
2. **既存の小窓を閉じる。** `await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })` のうち、
   いずれかのタブの `pendingUrl ?? url ?? ''` が `chrome.runtime.getURL(noticePagePath)` で始まるウィンドウを、
   1つずつ `await chrome.windows.remove(id)` で閉じる。`remove` の失敗（利用者が同時に閉じた等）は個別に握って続ける
3. **位置を決める。** `tab?.windowId` が 0 以上の数なら `await chrome.windows.get(tab.windowId)` を試み、
   得られたウィンドウ `base` の `left` / `top` / `width` / `height` がすべて数なら次の位置にする。
   それ以外（`tab` が無い・`windowId` が負・`get` が失敗）は位置を指定しない（Chrome に任せる）

   ```javascript
   left = base.left + Math.max(0, Math.round((base.width - noticeWindowWidth) / 2))
   top = base.top + Math.max(0, Math.round((base.height - noticeWindowHeight) / 2))
   ```

4. **開く。** `await chrome.windows.create({ url, type: 'popup', width: noticeWindowWidth, height: noticeWindowHeight, focused: true })`。
   手順 3 で位置が決まったときだけ `left` / `top` を足す

- **小窓は同時に1つまで**（FR-29 判定基準 5）。手順 2 で閉じてから開くので、何度押しても増えない。
  既存の小窓を使い回さず作り直すのは、押した元のウィンドウの中央に開き直し、前面に出すため（ADR-0017 の 2）
- 手順 2 で `pendingUrl` を見るのは、開いた直後でまだ読み込みが終わっていない小窓も拾うため（下の実測 2）
- 選択文字列は受け取らず、URL にも入れない（NFR-03。FR-29 判定基準 7）
- 押した元のウィンドウがシークレットウィンドウの場合の振る舞いは確かめていない。
  推測: 拡張の既定の動作（`spanning`）では拡張のページはシークレットウィンドウに読み込めないため、小窓は通常のウィンドウとして開く

### 権限と manifest

| 項目 | 結論 | 根拠 |
| --- | --- | --- |
| `chrome.windows` の権限 | **不要** | 公式リファレンスに `windows` 用の権限の記載が無い。`tabs` 権限が要るのはタブの `url` / `pendingUrl` / `title` / `favIconUrl` を読むときだけ（[chrome.windows](https://developer.chrome.com/docs/extensions/reference/api/windows)） |
| タブの `url` / `pendingUrl` を読む（手順 2） | 既存の `tabs` 権限で読める。**権限は増えない** | SPEC-MF-03 に用途を1行足す |
| `chrome.runtime.getURL` | 権限不要 | [chrome.runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime)（権限が要るのはネイティブメッセージングだけ） |
| `web_accessible_resources` | **不要** | 拡張自身が開く拡張のページで、Web ページから読み込ませるものではない（同上の `getURL` の説明。要るのは Web ページが拡張の資源を読むとき） |
| `src/manifest.json` | **変更しない**（版を除く） | 小窓のページは宣言の要る項目（`options_page` 等）に当たらない。`npm run validate` は manifest から参照されるファイルしか見ないので、検査内容は変わらない。`notice.*` の実在はページを開く自動テスト（SPEC-NT）が見る |

### 実測（2026-10-11。architect の使い捨てスクリプト。リポジトリには入れていない）

既存テストと同じ `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=…', '--load-extension=…'] })`
（`@playwright/test` 1.64.0 / Chromium 156.0.8078.4、ヘッドレス）で、`src/` の複製に仮の `notice.html` / `notice.js` を足して試した。

| # | 試したこと | 結果 |
| --- | --- | --- |
| 1 | Service Worker から `chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL('notice.html?key=abc'), width: 360, height: 200 })` | 開いた。`type: 'popup'`・`360×200`・`focused: true`・タブ1つ。Playwright の `context` の `page` イベントで小窓のページを取れ、クエリも読めた |
| 2 | 開いた直後に `chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })` | 小窓のタブは `url: ''`・`pendingUrl: 'chrome-extension://…/notice.html?a=1'`。**`pendingUrl` を見れば読み込み前でも拾える** |
| 3 | 開いた直後に `chrome.runtime.getContexts({ contextTypes: ['TAB'] })` | **小窓が含まれなかった**（500ms 待つと含まれた）。読み込み前の小窓を拾えない |
| 4 | `left: 300, top: 200` を指定 | `left: 300`・`top: 200` で開いた。指定しないと `0, 0` |
| 5 | `width: 50, height: 50` を指定 | `86×73` に広げられた（下限がある。値は環境依存と推測） |
| 6 | 小窓のページのボタンで `window.close()` | 閉じた（`page` の `close` イベント。その後 `popup` のウィンドウは0）。`chrome.tabs.update` で別の URL に移った後でも閉じた |
| 7 | 小窓のページの `innerWidth` / `innerHeight` | **1280×720**（ウィンドウは 440×260）。Playwright が既定のビューポートに置き換える。**実際のウィンドウでの収まりは自動テストで測れない**（SPEC-NT-05） |
| 8 | 小窓のページの `document.hasFocus()` | `true` |

### 検証（SPEC-SW-10）

| 種別 | 内容 |
| --- | --- |
| `auto` | SPEC-SW-05 の describe `service_worker: 開けない項目を押したときの小窓` の 1・5・6・7（URL・大きさ・位置・1つまで・例外を外へ出さない）。小窓のページの表示と閉じ方は SPEC-NT |
| `review` | `windows.create` を呼ぶのが `openNoticeWindowAsync` の中だけであること。`params` に選択文字列が入る経路が無いこと |
| `manual` | 下の M-1 |

**手動確認 M-1（1.21.0 のリリース前に1回。以後は `src/notice.*` か本節の大きさ・位置を変えたときだけ）:**

1. 拡張を読み込んだ Chrome で、任意のページの `AAPL` という文字列を選択して右クリックし、「四季報」を押す
2. 押した元のウィンドウの中央付近に小窓が前面で開き、新しいタブは開かないこと
3. 小窓の文言が切れずに読め、「閉じる」ボタンがスクロールせずに見えること
4. 「閉じる」で小窓が閉じること

**自動化できない理由:** (1) 手順 1 の「Chrome の右クリックメニューを実際に押す」操作は、Playwright から行えない（**2026-10-11 に developer が確かめた**）。
example.com をフィクスチャで返して `AAPL` を選択し、`page.click({ button: 'right' })` → `ArrowDown` ×8 → `Enter` をヘッドレスと `--headed` の両方で試した。
ページには `contextmenu` イベントが届いたが、Service Worker に足したリスナーで `chrome.contextMenus.onClicked` は**一度も発火せず**、タブも小窓も開かなかった。
CDP に右クリックメニューを扱うドメインは無く、`chrome.contextMenus` にクリックを模擬する API も無い（事実）。
OS の操作（osascript / xdotool）はアクセシビリティ権限が要り CI に持ち込めないため試していない。
押した後の処理と登録（`hasListener`）は自動テストが見る。(2) 手順 3 の収まりは、実測 7 のとおり Playwright が小窓の表示領域を置き換えるため、
実際のウィンドウの大きさで測れない。自動テストは控えめな大きさで近似する（SPEC-NT-05）。

> M-1 は `docs/MANUAL-CHECKLIST.md` の **D-3** に置いた。D-1 の `AAPL` の行と「何も開かない」3行も小窓に合わせて直した。
> M-1 は FR-29 の ✅ の条件にしない（FR-29 の「手動確認」欄。FR-05 / FR-10 と同じ扱い）。

- 要件: FR-29（判定基準 1・5・6・7・9）, NFR-03

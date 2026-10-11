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

`remakeContextMenus()` が以下を行う。

1. `getEnableLinkKeysAsync()` で有効キーを順序付きで取得
2. `chrome.contextMenus.removeAll()` で全削除
3. 各キーについて `chrome.contextMenus.create({ id: key, title, contexts: ['selection'] })`

- `contexts: ['selection']` なので**文字列選択時のみ**表示される
- `externalUrlsMap` に無いキーはスキップする（SPEC-ST-03）

- 要件: FR-05
- 検証: `manual`（文字列を選択して右クリック）

## SPEC-SW-03 再構築の契機

| イベント | 動作 |
| --- | --- |
| `chrome.runtime.onInstalled` | 再構築 |
| `chrome.runtime.onStartup` | 再構築 |
| `chrome.storage.onChanged` | 再構築 |

- 要件: FR-05
- 検証: `manual`

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

1. `info.selectionText` から `getTickerCode()` で銘柄コードを判定（SPEC-TC-04）
2. `status: false` なら何もしない
3. `info.menuItemId`（= `key`）から `externalUrlsMap` を引く。未知なら `console.error`
4. `getUrl()` で遷移先を決める（SPEC-TC-05）
5. URL が得られれば `chrome.tabs.create({ url })`

- 要件: FR-05
- 検証: `auto`（`getTickerCode` / `makeUrl`）／`manual`（実際のクリック）

## SPEC-SW-06 楽天証券 URL の生成

`getRakutenSecUrlAsync(type, code)`

1. `chrome.tabs.query({ url: 'https://member.rakuten-sec.co.jp/*' })` で開いているタブを探す
2. タブ URL から `/[;?&]BV_SessionID=([^?&]+)/` でセッション ID を抽出（最初に見つかったもの）
3. セッション ID があれば銘柄ページ URL を組み立てる

| type | URL |
| --- | --- |
| `jp` | `https://member.rakuten-sec.co.jp/app/info_jp_prc_stock.do;BV_SessionID=<id>?eventType=init&dscrCd=<code>&…` |
| `us` | `https://member.rakuten-sec.co.jp/app/info_us_prc_stock.do;BV_SessionID=<id>?eventType=init&tickerCd=<code>&…` |

**ログイン済みタブが無ければ `null`** を返し、メニューに項目を出さない。

> セッション ID を新規に取得することはしない。ユーザーが既に開いているタブから
> 借用するだけ。これが `tabs` 権限を必要とする理由（SPEC-MF-03）。

**組み立てた URL は Service Worker の外に出さない**（SPEC-MSG-06）。使い道は
`chrome.tabs.create({ url })` の引数だけで、メッセージの応答・ログ・storage に載せない。

> **1.20.1 から。** 1.20.0 までは `rakuten-sec:info` /
> `rakuten-sec:open` の応答で URL（`BV_SessionID` を含む）を Content Script に返し、
> TradingView の右クリックメニューでは `<a href>` として**ページの DOM に書き出していた**（SPEC-CS-28）。

- 要件: FR-06, NFR-03, CON-04
- 検証: `auto`（`tests/service-worker.spec.mjs` の describe **`service_worker: 証券会社の応答`**。SPEC-MSG-06）／
  `manual`（楽天証券にログインした状態で TradingView を開き、メニューに出ること）

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

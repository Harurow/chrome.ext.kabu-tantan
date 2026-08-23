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
|---------|------|
| `chrome.runtime.onInstalled` | 再構築 |
| `chrome.runtime.onStartup` | 再構築 |
| `chrome.storage.onChanged` | 再構築 |

- 要件: FR-05
- 検証: `manual`

## SPEC-SW-04 初回インストール時のオプションページ表示

以下のいずれかで `chrome.runtime.openOptionsPage()` を呼ぶ。

- `details.reason === 'install'`
- 更新前バージョンが `1.0.9` 未満

バージョン比較は `compareVersion(a, b)` で**数値比較**する。

```javascript
compareVersion(details.previousVersion, '1.0.9') < 0
```

> 以前は文字列比較 (`previousVersion < '1.0.9'`) で、`1.10.x` 以降に破綻する状態だった。

- 要件: FR-10, NFR-04
- 検証: `auto`（`compareVersion › マイナー/パッチを数値として比較する`）

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
|------|-----|
| `jp` | `https://member.rakuten-sec.co.jp/app/info_jp_prc_stock.do;BV_SessionID=<id>?eventType=init&dscrCd=<code>&…` |
| `us` | `https://member.rakuten-sec.co.jp/app/info_us_prc_stock.do;BV_SessionID=<id>?eventType=init&tickerCd=<code>&…` |

**ログイン済みタブが無ければ `null`** を返し、メニューに項目を出さない。

> セッション ID を新規に取得することはしない。ユーザーが既に開いているタブから
> 借用するだけ。これが `tabs` 権限を必要とする理由（SPEC-MF-03）。

- 要件: FR-06, NFR-03
- 検証: `manual`（楽天証券にログインした状態で TradingView を開き、メニューに出ること）

## SPEC-SW-07 内藤証券 URL の生成

`getNaitoSecUrlAsync(type, code)`

1. `chrome.tabs.query({ url: 'https://*.qhit.net/naito/iswebptt2/*' })`
2. タブ URL が `/([;?&]qcode=)([0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY])/` に一致すれば、
   `qcode` を対象銘柄コードに差し替えた URL を返す
3. `type === 'jp'` のみ対応。米国株は常に `null`

- 要件: FR-06
- 検証: `manual`（内藤証券で国内株個別銘柄を開いた状態で TradingView を開く）

## SPEC-SW-08 アクションボタン

`chrome.action.onClicked` で `chrome.runtime.openOptionsPage()` を呼ぶ。

- 要件: FR-05
- 検証: `manual`

## SPEC-SW-09 compareVersion

`MAJOR.MINOR.PATCH` を `.` 区切りで数値化し、先頭から比較する。

- 欠けた要素は `0` として扱う
- 数値化できない要素は `0` として扱う
- `undefined` / `null` は `'0'` として扱う

- 要件: NFR-04
- 検証: `auto`（`compareVersion › マイナー/パッチを数値として比較する`）

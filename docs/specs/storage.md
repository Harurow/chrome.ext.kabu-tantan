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

- Service Worker: `if (externalUrlsMap[key])` でガードしてコンテキストメニューを作らない
- オプションページ: `if (item)` でガードして行を作らない
- `linkMenu.js`: **ガードしていない**（`externalUrlsMap[key]` が `undefined` だと例外）
- `tradingview-cs.js`: `makeLinkItemsAsync()` が `item != null` でガードして項目を作らない（1.11.0〜。SPEC-CS-18）

> 既知の弱点: `createMenu` は未知キーで落ちる。
> 実際には Content Script が `getEnableLinkKeysAsync()` の結果をそのまま渡すため、
> サイト廃止直後の storage に古いキーが残っていると Content Script 全体が停止しうる。

- 要件: NFR-05
- 検証: `manual`（未対応。回帰テスト化の候補）

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

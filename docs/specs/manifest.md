# SPEC-MF: 拡張機能の宣言

実装: `src/manifest.json`

## SPEC-MF-01 基本情報

| 項目 | 値 |
| --- | --- |
| `manifest_version` | 3 |
| `name` | `__MSG_app_title__`（= 株リンク） |
| `description` | `__MSG_app_description__` |
| `default_locale` | `ja` |
| `version` | `package.json` と同じ値（SPEC-MF-02）。**この表に値を書き写さない** |
| `options_page` | `options.html` |

- 要件: FR-01, FR-11, CON-01
- 検証: `validate`（必須フィールド、バージョン形式、`__MSG_` キーの実在）

## SPEC-MF-02 バージョンの一致

`src/manifest.json` と `package.json` の `version` は常に一致させる。

> SPEC-MF-01 の表に実際のバージョン値を書き写さない。過去に書き写した値が 1.11.0 のまま
> 古くなっていた。値の情報源は `src/manifest.json` と `package.json` だけにする。

`package-lock.json` の `version` も同じ値に揃える（SPEC-MF-09）。

- 要件: NFR-06
- 検証: `validate`（不一致で exit 1）

## SPEC-MF-03 権限

```json
"permissions": ["tabs", "contextMenus", "storage"]
```

`host_permissions` は宣言しない。

| 権限 | 用途 |
| --- | --- |
| `tabs` | 楽天証券・内藤証券のログイン済みタブの URL からセッション情報を読む（SPEC-SW-06/07） |
| `contextMenus` | 選択文字列に対する右クリックメニューの追加（SPEC-SW-02） |
| `storage` | 利用サイトと並び順の保存（SPEC-ST-01） |

> `tabs` は**全タブの URL を読める強い権限**。ストア審査ではこの用途の説明が必要。

- 要件: FR-06, NFR-03, CON-04
- 検証: `validate`（想定外の権限追加を警告）

## SPEC-MF-04 アイコン

`icons` に 16 / 24 / 32 / 48 / 128 / 256 px、`action.default_icon` に 16 / 24 / 32 px を宣言する。

- 要件: NFR-07
- 検証: `validate`（参照先ファイルの実在）

## SPEC-MF-05 Service Worker

```json
"background": { "service_worker": "service_worker.js" }
```

`type: "module"` は指定しない（`importScripts` を使うため。CON-02）。

- 要件: FR-06
- 検証: `validate`（ファイルの実在）

## SPEC-MF-06 content_scripts

全 5 エントリ。`matches` はすべて `https://` のみ。

| # | matches | all_frames | css | js（この順に読み込む） |
| --- | --- | --- | --- | --- |
| 0 | `https://*.rakuten-sec.co.jp/*` | false | `style.css` | jquery → `urls.js` → `linkMenu.js` → `rakuten-cs.js` |
| 1 | `https://hs.trkd-asia.com/rakutensecscr/*` | **true** | `style.css` | jquery → `urls.js` → `linkMenu.js` → `rakuten-scr-cs.js` |
| 2 | `https://*.sbisec.co.jp/ETGate/*`<br>`https://*.sbi.ifis.co.jp/*` | false | `style.css` | jquery → `urls.js` → `linkMenu.js` → `sbi-cs.js` |
| 3 | `https://graph.sbisec.co.jp/sbiscreener/*` | **true** | `style.css` | jquery → `urls.js` → `linkMenu.js` → `sbi-scr-cs.js` |
| 4 | `https://jp.tradingview.com/*` | false | `tradingview-cs.css` | jquery → `urls.js` → `tradingview-cs.js` |

- `#1` と `#3` はスクリーナーが iframe 内で動くため `all_frames: true`
- `#4` は `linkMenu.js` を読み込まない（TradingView は独自のメニュー生成を行う）

- 要件: FR-02, FR-03, FR-04, CON-02
- 検証: `validate`（ファイル実在・https 限定・**読み込み順**）／`auto`（楽天・SBI の注入テスト）

## SPEC-MF-07 CSS の注入先

| CSS | 注入先 |
| --- | --- |
| `style.css` | 楽天証券・楽天スクリーナー・SBI証券・SBIスクリーナー |
| `tradingview-cs.css` | TradingView のみ |

> **この対応表は死にコード判定の起点になる。** TradingView 用の規則が `style.css` に
> 入っていれば、そもそも読み込まれないので確実に不要。詳細は `AGENTS.md`。

- 要件: CON-03
- 検証: `validate`（ファイル実在）／`manual`（規則の要否判断）

## SPEC-MF-08 アクションボタン

ツールバーアイコンをクリックするとオプションページを開く（`action.default_popup` は持たない）。

- 要件: FR-05
- 検証: `manual`（拡張アイコンをクリックしてオプションページが開くこと）

## SPEC-MF-09 package-lock.json のバージョン同期

> **1.20.2 から。**

実装: `scripts/validate-manifest.mjs`（`npm run validate`）

`package-lock.json`（リポジトリ直下。git 管理下）の次の2箇所が `package.json` の `version` と一致すること。

| 検査対象 | 不一致時 |
| --- | --- |
| `version`（トップレベル） | fail |
| `packages[""].version` | fail |
| `package-lock.json` が存在しない・JSON として読めない・`packages[""]` が無い | fail |

- 不一致を warn にしない（exit 1 にする）
- fail のメッセージは、2行目以降に直し方として **`npm install --package-lock-only`** を含める。
  形式は既存の `version 不一致` に揃える。例:

  ```text
  ❌ version 不一致: package-lock.json の version=1.10.0 / package.json=1.20.2
     → package.json を正として `npm install --package-lock-only` で package-lock.json を同期する
  ```

- 比較の正は `package.json`。lock を手で書き換える案内はしない
- 既存の検査（SPEC-MF-01 / 02 / 04〜07）の順序・メッセージは変えない。成功時の `✅` 行も変えない

> **経緯。** 1.10.0〜1.20.1 の間、`package-lock.json` の `version` と `packages[""].version` は
> `1.10.0` のまま止まっていた。バージョンを `package.json` の手書きで上げており、
> `npm install` を伴わない版上げでは lock が追随しないため。validate は
> `src/manifest.json` と `package.json` しか比べておらず、検出できなかった。
> lock は 1.20.2 の作業ツリーで `npm install --package-lock-only` により同期した。

- 要件: NFR-06
- 検証: `validate`（本節の検査そのもの）／`manual`:
  1. `npm run validate` が exit 0 で終わること（同期済みの状態）
  2. `package-lock.json` のトップレベル `version` を `0.0.0` に書き換えて `npm run validate` を実行し、
     exit 1 になり、メッセージに `package-lock.json` と `npm install --package-lock-only` が出ること
  3. 同様に `packages[""].version` だけを書き換えた場合も exit 1 になること
  4. 書き換えた値を元に戻し、exit 0 に戻ること

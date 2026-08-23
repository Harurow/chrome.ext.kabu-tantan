# 仕様書

**現在の実装がどうなっているか**を記述する。あるべき姿ではない。

最終更新: 2026-08-23 / 対象バージョン: 1.11.0

## 一覧

| ID | ファイル | 対象 | 主な実装 |
| --- | --- | --- | --- |
| `SPEC-MF` | [manifest.md](manifest.md) | 拡張機能の宣言・権限・注入先 | `src/manifest.json` |
| `SPEC-EL` | [external-links.md](external-links.md) | 遷移先サイト定義と URL 生成 | `src/urls.js` |
| `SPEC-TC` | [ticker-code.md](ticker-code.md) | 銘柄コードの判定規則 | `src/service_worker.js`, `src/*-cs.js` |
| `SPEC-ST` | [storage.md](storage.md) | 設定の保存形式 | `src/urls.js`, `src/options.js` |
| `SPEC-SW` | [service-worker.md](service-worker.md) | バックグラウンド処理 | `src/service_worker.js` |
| `SPEC-MSG` | [messaging.md](messaging.md) | メッセージ通信 | `src/service_worker.js`, `src/tradingview-cs.js` |
| `SPEC-CS` | [content-scripts.md](content-scripts.md) | 各サイトへのメニュー注入 | `src/*-cs.js`, `src/linkMenu.js` |
| `SPEC-OP` | [options-page.md](options-page.md) | オプションページ | `src/options.*` |
| `SPEC-SC` | [selector-check.md](selector-check.md) | 実サイトのセレクタ検証ツール | `scripts/selector-check/`, `tests/selector-defs.spec.mjs` |

## 記述の約束

- 各項目に ID (`SPEC-<領域>-<連番>`) を振る
- 各項目に **対応する要件** と **検証方法** を書く
- 検証方法は、自動テストがあればテスト名、無ければ手動確認手順を書く
- 実装ファイルと行番号を示せる場合は示す（行番号はズレるのでファイル名を優先）

## 検証方法の表記

| 表記 | 意味 |
| --- | --- |
| `auto` | `npm test` で自動検証される。テスト名を併記 |
| `lint` | `npm run lint:all` で検出される |
| `validate` | `npm run validate` で検証される |
| `manual` | 手動確認が必要。手順を併記 |
| `半自動` | `npm run check:selectors` が判定する（人がログイン／ページを用意してから起動する。SPEC-SC） |

## 設計判断

「なぜその作りにしたか」は [../adr/](../adr/) に置く。仕様書には決まった内容だけを書く。

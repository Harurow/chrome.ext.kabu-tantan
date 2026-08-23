# 仕様書

**現在の実装がどうなっているか**を記述する。あるべき姿ではない。

最終更新: 2026-08-23 / 対象バージョン: 1.12.2

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
- **既存 ID は再利用しない。** 廃止する場合は「廃止」と明記して欠番にする

## 実装前の仕様の扱い

仕様書は原則「**今そうなっていること**」を書く。
まだ実装していない決定は、次の形で**予定と分かるように**書き、実装後に architect が注記を外す。

```markdown
> **状態: 未実装（予定）。** 要件は FR-xx。実装後に architect がこの注記を外す。
```

| 状態 | 意味 |
| --- | --- |
| 注記なし | 実装済み。実物がそうなっている |
| **未実装（予定）** | developer への指示。実装が終わったら architect が確定表現に直す |
| **一部未実装（予定）** | 節の大半は実装済みで、注記に列挙した差分だけが未実装。差分の範囲を必ず節の冒頭に列挙する |
| **原因未特定** | 調査手順と切り分けの観点だけを書いてある。結論は出ていない |

### 実装が確定していない仕様（2026-08-23 時点）

| SPEC | 要件 | 状態 | 内容 |
| --- | --- | --- | --- |
| SPEC-CS-20 | FR-20 | **原因未特定** | 楽天証券・株価検索の破損調査 |

欠番: SPEC-SC-12（`body.vsc-initialized` の追加検査。1.12.2 で廃止・削除済み。**再利用しない**）

1.12.0 で実装が完了したもの: SPEC-CS-12「メニューの組み立て」「ボタンの注入（起動時）」（FR-07 / NFR-14）／
SPEC-CS-19 の門・網・監視の停止（NFR-14）／SPEC-SC-20〜23 と
トークン単位の伏せ字（FR-12 判定基準5 / NFR-12）。

1.12.1 で実装が完了したもの: SPEC-SC-14 の URL 置換先を `[url]` にする変更（FR-17）／
SPEC-SC-16 の `結果ファイルの書式`（テスト18。生成物を markdownlint に掛ける）。

1.12.2 で実装が完了したもの: SPEC-CS-09 / SPEC-CS-21（FR-21・CON-11）と
SPEC-SC-24 ＋ SPEC-SC-05 / 10 / 13 / 16 / 18 / 20 / 21 / 23 の改訂（FR-22）、SPEC-SC-12 の廃止。
到達判定の5値目 `REACH_NOT_EVALUATED`・`decideReach()` への切り出し（SPEC-SC-24）と、
利用者データ付記を「❌ に確定した経路を問わず1回」に揃える変更（SPEC-SC-10）も 1.12.2 に含む。
再分類の適用条件を「呼ばれた時点が ⚠️」に絞る修正（SPEC-SC-24 / ADR-0006 の 6-3）と
その回帰テスト2件（SPEC-SC-16 の 25・26）も同版。
設計判断は [ADR-0006](../adr/0006-reach-judgement-by-title.md) /
[ADR-0007](../adr/0007-con11-audit-scope.md)。

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

# 検証

## 要約

株リンクの確かめ方と結果の入口。自動テスト（Playwright）・半自動の実サイト検証（`npm run check:selectors`）・手動確認の3層に分けている。
テスト全件（文書だけの変更は文書の検査）とレビューが通るまでコミットできない（コミットゲート）。

## 確かめる手順

- 3層の切り分け・実行方法・方針: [testing.md](notes/testing.md)
- 修正からコミット・push までの順番と、コミットゲート: [workflow.md](notes/workflow.md)

## 確認項目

| 層 | 一覧 | 備考 |
| --- | --- | --- |
| 自動 | [TEST-CATALOG.md](TEST-CATALOG.md) | `npm run docs:tests` の生成物。手で書き換えない |
| 半自動 | `scripts/selector-check/targets.mjs` の対象 | 何をどう判定するかは [notes/specs/selector-check.md](notes/specs/selector-check.md)（`SPEC-SC`） |
| 手動 | [manual-checklist.md](notes/manual-checklist.md) | 自動化できないと確かめたものだけ |

## 結果

機能の検証結果は層ごとに次の場所に残る。文書の配置変更は、その下に作業範囲と検証方法を記録する。

- 自動: コミットのたびに `npm run check`（文書だけの変更は `npm run check:docs`）を通す。通った記録は手元の `.claude/check-passed.json` にだけ置き、git には入れない
- 半自動: [SELECTOR-CHECK.md](SELECTOR-CHECK.md)（`npm run check:selectors` が毎回上書きする生成物）。実行ごとの一覧と収録コミットは [notes/requirements/functional.md](notes/requirements/functional.md) の `FR-12`「結果ファイルの出典」表。引用するときは収録コミットを添える（`SPEC-SC-13`）
- 手動: [manual-checklist.md](notes/manual-checklist.md) の各項目の記録

### 検証 docs の配置整理（2026-10-17）

対象は `babb207` を起点とする資料の移動と参照修正。hotl の状態ファイルは無く、このプロジェクトは hotl の要件承認を使っていない。
要件・仕様・ADR の ID と、当時の判断・承認・結果は保ち、要件の指紋の取り直しや hotl の回の開始は行わない。

入口以外の直下12項目を、次のように判定した。現在の資料38ファイルを `git mv` で移し、`docs/README.md` は固有の案内を [AGENTS.md](../AGENTS.md) に移して削除した。

| 元の項目 | 扱い | 現在の場所 | 判断の理由 |
| --- | --- | --- | --- |
| `ARCHITECTURE.md` | 移動（1） | [architecture.md](notes/architecture.md) | 更新する実装構造と更新手順 |
| `TESTING.md` | 移動（1） | [testing.md](notes/testing.md) | 更新する検証の方針と手順 |
| `MANUAL-CHECKLIST.md` | 移動（1） | [manual-checklist.md](notes/manual-checklist.md) | 今後も確認結果を追記する |
| `WORKFLOW.md` | 移動（1） | [workflow.md](notes/workflow.md) | 現在の開発とレビューの手順 |
| `requirements/` | 移動（5） | [notes/requirements/](notes/requirements/) | FR 等の既存体系。分割部品用の名前と区別 |
| `specs/` | 移動（11） | [notes/specs/](notes/specs/) | 実装に追随する現在の仕様 |
| `adr/` | 移動（18） | [notes/adr/](notes/adr/) | 追補する判断記録。ID と当時の記録は維持 |
| `README.md` | 統合して削除 | [AGENTS.md](../AGENTS.md) | 入口・ID・追跡関係の案内を引き継ぐ |
| `TEST-CATALOG.md` | 動かさない（1） | [TEST-CATALOG.md](TEST-CATALOG.md) | 自動生成物。リンクは生成スクリプトで修正 |
| `SELECTOR-CHECK.md` | 動かさない（1） | [SELECTOR-CHECK.md](SELECTOR-CHECK.md) | 実サイトの結果の生成物。収録版の引用先を維持 |
| `images/` | 動かさない（6） | [既存スクリーンショット](images/) | README が使う固定した過去の画像 |
| `zenn/` | 動かさない（1） | [2026年8月の作業ログ](zenn/2026-08-modernization.md) | 数値・引用を含む固定した過去の資料 |

移動した3つの索引のファイル名は `README.md` から `index.md` に変えた。移動前後で全38ファイルの見出しと ID の出現数が一致し、全文も指定したリンク・参照の置換後の内容と一致した。
新たなローカルリンク切れは0件。生成結果・既存画像・過去ログの8ファイルはバイト単位で一致した（テストカタログは生成側でリンクを直して再生成）。
`lint:all`、テストカタログの最新性検査（282件）、手動確認文書を読む既存テストが成功した。全件の検査と独立レビューはコミット前のゲートで確認する。
実サイトへのアクセス・拡張機能の配布はこの作業に含まない。本番フォルダは無い。

## 残った指摘

実サイトでしか確かめられず残っている確認は、[notes/requirements/index.md](notes/requirements/index.md)「実サイトでの確認だけが残っているもの」。作業としては [tasks.md](tasks.md) に載せている。

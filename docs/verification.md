# 検証

## 要約

株リンクの確かめ方と結果の入口。自動テスト（Playwright）・半自動の実サイト検証（`npm run check:selectors`）・手動確認の3層に分けている。
テスト全件（文書だけの変更は文書の検査）とレビューが通るまでコミットできない（コミットゲート）。

## 確かめる手順

- 3層の切り分け・実行方法・方針: [TESTING.md](TESTING.md)
- 修正からコミット・push までの順番と、コミットゲート: [WORKFLOW.md](WORKFLOW.md)

## 確認項目

| 層 | 一覧 | 備考 |
| --- | --- | --- |
| 自動 | [TEST-CATALOG.md](TEST-CATALOG.md) | `npm run docs:tests` の生成物。手で書き換えない |
| 半自動 | `scripts/selector-check/targets.mjs` の対象 | 何をどう判定するかは [specs/selector-check.md](specs/selector-check.md)（`SPEC-SC`） |
| 手動 | [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) | 自動化できないと確かめたものだけ |

## 結果

このプロジェクトでは、回ごとの見出しを持たない。結果は層ごとに次の場所に残る。

- 自動: コミットのたびに `npm run check`（文書だけの変更は `npm run check:docs`）を通す。通った記録は手元の `.claude/check-passed.json` にだけ置き、git には入れない
- 半自動: [SELECTOR-CHECK.md](SELECTOR-CHECK.md)（`npm run check:selectors` が毎回上書きする生成物）。実行ごとの一覧と収録コミットは [requirements/functional.md](requirements/functional.md) の `FR-12`「結果ファイルの出典」表。引用するときは収録コミットを添える（`SPEC-SC-13`）
- 手動: [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) の各項目の記録

## 残った指摘

実サイトでしか確かめられず残っている確認は、[requirements/README.md](requirements/README.md)「実サイトでの確認だけが残っているもの」。作業としては [tasks.md](tasks.md) に載せている。

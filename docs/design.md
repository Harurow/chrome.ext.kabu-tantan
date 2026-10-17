# 設計

## 要約

株リンクをどう作っているかの入口。全体の作りは [architecture.md](notes/architecture.md)、各部分の今の振る舞いは [specs](notes/specs/)（`SPEC-`）、選択肢を比べて決めた記録は [adr](notes/adr/)（`ADR-`）にある。
仕様書には「あるべき姿」ではなく、今そうなっていることを書く。

## 全体の図

[architecture.md](notes/architecture.md) の「全体像」（オプションページ・設定の保存先・Service Worker・Content Script・注入先サイト・遷移先サイトのつながり）。

## 方針

- 他社のサイトの DOM に注入するという前提と、コーディング規約: [AGENTS.md](../AGENTS.md)
- なぜその作りなのか・変えるときの手順: [architecture.md](notes/architecture.md)
- 選択肢を比べて1つに決めた記録（`ADR-0001`〜）: [notes/adr/index.md](notes/adr/index.md)

## 仕様

領域ごとの一覧は [notes/specs/index.md](notes/specs/index.md)。仕様と実装は1対1で、食い違ったらどちらかがバグ。

## タスク

このプロジェクトでは、設計の中にタスクの番号を振らない。残りの作業は [tasks.md](tasks.md)。

## 要件との対応

- 仕様の各項目に、満たす要件（`FR-`・`NFR-`・`CON-`）と確かめ方を書いている（[notes/specs/index.md](notes/specs/index.md)「記述の約束」）
- 特定の仕様に結びつかない要件と、その対応先: [notes/requirements/index.md](notes/requirements/index.md)「仕様に紐づかない要件」
- 要件 → 仕様 → テストのつながり方: [AGENTS.md](../AGENTS.md)「追跡関係」

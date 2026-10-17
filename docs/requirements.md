# 要件定義

## 要約

株リンクが満たすべきことの入口。中身は [requirements](notes/requirements/) にあり、ID（`FR-`・`NFR-`・`CON-`）もそこで振る。
実現手段は書かない。どう作っているかは [design.md](design.md) から案内する。

## 目的

[notes/requirements/background.md](notes/requirements/background.md) の「背景」「目的」「利用者」。

## 要件

| 種類 | ファイル | ID |
| --- | --- | --- |
| 機能要件 | [notes/requirements/functional.md](notes/requirements/functional.md) | `FR-01`〜 |
| 非機能要件 | [notes/requirements/non-functional.md](notes/requirements/non-functional.md) | `NFR-01`〜 |

状態の記号（✅・⚠️・❌）・優先度・書き方の約束・更新の経緯は [notes/requirements/index.md](notes/requirements/index.md)。ID の採番規則は [AGENTS.md](../AGENTS.md)「ID 採番規則」。

## スコープ外

[notes/requirements/background.md](notes/requirements/background.md) の「スコープ」の「対象外」。

## 前提

- 利用環境と注入先サイトについての前提: [notes/requirements/background.md](notes/requirements/background.md) の「前提」
- 制約条件（`CON-`）: [notes/requirements/constraints.md](notes/requirements/constraints.md)

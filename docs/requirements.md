# 要件定義

## 要約

株リンクが満たすべきことの入口。中身は [requirements/](requirements/) にあり、ID（`FR-`・`NFR-`・`CON-`）もそこで振る。
実現手段は書かない。どう作っているかは [design.md](design.md) から案内する。

## 目的

[requirements/background.md](requirements/background.md) の「背景」「目的」「利用者」。

## 要件

| 種類 | ファイル | ID |
| --- | --- | --- |
| 機能要件 | [requirements/functional.md](requirements/functional.md) | `FR-01`〜 |
| 非機能要件 | [requirements/non-functional.md](requirements/non-functional.md) | `NFR-01`〜 |

状態の記号（✅・⚠️・❌）・優先度・書き方の約束・更新の経緯は [requirements/README.md](requirements/README.md)。ID の採番規則は [README.md](README.md)「ID 採番規則」。

## スコープ外

[requirements/background.md](requirements/background.md) の「スコープ」の「対象外」。

## 前提

- 利用環境と注入先サイトについての前提: [requirements/background.md](requirements/background.md) の「前提」
- 制約条件（`CON-`）: [requirements/constraints.md](requirements/constraints.md)

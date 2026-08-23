# ドキュメント

## 構成

```text
docs/
├── requirements/       要件定義 — 「何を満たすべきか」
│   ├── background.md       背景・目的・スコープ
│   ├── functional.md       機能要件 (FR-xx)
│   ├── non-functional.md   非機能要件 (NFR-xx)
│   └── constraints.md      制約条件 (CON-xx)
├── specs/              仕様書 — 「現在どう作られているか」
│   ├── manifest.md         SPEC-MF  拡張機能の宣言
│   ├── external-links.md   SPEC-EL  遷移先サイト定義
│   ├── ticker-code.md      SPEC-TC  銘柄コード判定
│   ├── storage.md          SPEC-ST  設定の保存形式
│   ├── service-worker.md   SPEC-SW  バックグラウンド処理
│   ├── messaging.md        SPEC-MSG メッセージ通信
│   ├── content-scripts.md  SPEC-CS  各サイトへの注入
│   └── options-page.md     SPEC-OP  オプションページ
├── ARCHITECTURE.md     実装構造・同梱ライブラリの更新手順
├── WORKFLOW.md         開発フロー・エージェント・コミットゲート
├── TESTING.md          テスト方針・3層の切り分け
├── TEST-CATALOG.md     テスト一覧（自動生成）
├── MANUAL-CHECKLIST.md 手動確認チェックリスト（利用者が実施）
├── images/             README 用スクリーンショット
└── zenn/               記事化用の作業ログ
```

## 使い分け

| | 書くもの | 書かないもの |
| --- | --- | --- |
| **requirements/** | 満たすべきこと。実現手段は問わない | 実装方法、具体的なセレクタ |
| **specs/** | **今そうなっている**こと。実装と1対1 | やりたいこと、将来の構想 |
| **ARCHITECTURE.md** | なぜその作りなのか、変更時の手順 | 個々の機能仕様 |

> **仕様書は「あるべき姿」ではなく「実際にそうなっているもの」を書く。**
> 実装と食い違ったら、どちらかが必ずバグ。放置しない。

## 追跡関係

```text
要件 (FR-xx / NFR-xx / CON-xx)
  └─ 仕様 (SPEC-xx-nn)
       └─ テスト (tests/*.spec.mjs) または 手動確認手順
```

- 仕様には必ず「どの要件を満たすか」を書く
- 仕様には必ず「どう確認するか」を書く
- 要件に紐づかない仕様が出てきたら、要件側の漏れを疑う

## ID 採番規則

| 接頭辞 | 対象 | 例 |
| --- | --- | --- |
| `FR-` | 機能要件 | `FR-01` |
| `NFR-` | 非機能要件 | `NFR-01` |
| `CON-` | 制約条件 | `CON-01` |
| `SPEC-<領域>-` | 仕様 | `SPEC-CS-03` |

**既存 ID は再利用しない。** 廃止する場合は項目を残して「廃止」と明記し、欠番にする。

## 担当エージェント

`.claude/agents/` に役割を分けて定義してある。詳細は [WORKFLOW.md](WORKFLOW.md)。

| エージェント | 役割 | 書き換えてよい場所 |
| --- | --- | --- |
| `lead` | 全体調整。工程を回す | なし |
| `analyst` | 利用者と対話して要件を決める | `docs/requirements/` |
| `architect` | 要件から設計・仕様を起こす | `docs/specs/`, `docs/ARCHITECTURE.md` |
| `developer` | 実装 | `src/`, `tests/`, `scripts/`, ルートの設定ファイル |
| `reviewer` | レビュー | **なし（読み取り専用）** |

> **コミットは、テスト全件が通り、かつ reviewer のレビューが通るまでできない。**
> `.claude/hooks/commit-gate.sh` が機械的にブロックする。

## 関連

- [WORKFLOW.md](WORKFLOW.md) — 開発フロー・エージェント・コミットゲート
- [CLAUDE.md](../CLAUDE.md) — 開発ガイド（規約・注意事項）
- [README.md](../README.md) — 利用者向け

# CLAUDE.md — 株リンク (kabu-tantan) 開発ガイド

## プロジェクト概要

日本の証券会社サイト（楽天証券・SBI証券）および TradingView 上に、外部の株式情報サイトへのリンクメニューを追加する Chrome 拡張機能。

- **拡張機能名:** 株リンク
- **Manifest:** v3
- **バージョン:** `src/manifest.json` の `version`（`package.json` と一致させる。`npm run validate` が検証する）
- **ライセンス:** MIT

## クイックスタート

```bash
npm install
npx playwright install chromium   # 初回のみ

npm run lint          # ESLint (JS)
npm run lint:css      # Stylelint (CSS)
npm run lint:all      # 両方
npm run fix           # 自動修正
npm run validate      # manifest.json の構造・参照先・バージョン整合を検証
npm test              # Playwright による UI テスト
npm run check         # lint:all + validate + test
npm run package       # dist/kabu-tantan-<version>.zip を作成
npm run docs:tests    # docs/TEST-CATALOG.md を再生成
npm run approve       # レビュー承認を記録する（コミットに必須）
```

> `npm run check` は lint + validate + テスト + **テストカタログの陳腐化検査**を行う。

> **コミットは、テスト全件が通り、かつ reviewer のレビューが通るまでできない。**
> `.claude/hooks/commit-gate.sh` が機械的にブロックする。詳細は [docs/WORKFLOW.md](docs/WORKFLOW.md)。

### Chrome への読み込み

1. `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」から `src/` を指定

> ビルドステップは無い。`src/` がそのまま拡張機能として動作する。

## アーキテクチャ

```
src/                        ← このディレクトリがそのまま拡張機能
├── manifest.json           # マニフェスト (v3)
├── service_worker.js       # バックグラウンド Service Worker
├── urls.js                 # 外部リンク定義・URL ユーティリティ (共有)
├── linkMenu.js             # ドロップダウンメニュー生成 (共有)
├── style.css               # 楽天・SBI 用スタイル
├── rakuten-cs.js           # 楽天証券
├── rakuten-scr-cs.js       # 楽天スーパースクリーナー
├── sbi-cs.js               # SBI証券
├── sbi-scr-cs.js           # SBI銘柄スクリーニング
├── tradingview-cs.js       # TradingView
├── tradingview-cs.css      # TradingView 用スタイル
├── options.html/js/css     # オプションページ
├── _locales/ja/            # 日本語ローカライズ
├── images/                 # アイコン画像
└── third-party/            # 同梱ライブラリ (編集しない。docs/ARCHITECTURE.md 参照)

scripts/                    # 開発用 Node スクリプト (validate / package / test-catalog)
tests/                      # Playwright テスト
docs/
├── requirements/           # 要件定義 (FR / NFR / CON)
├── specs/                  # 仕様書 (SPEC-xx) ← 実装と1対1
├── ARCHITECTURE.md         # 実装構造・ライブラリ更新手順
├── TESTING.md              # テスト方針・手動確認手順
├── TEST-CATALOG.md         # テスト一覧 (自動生成)
├── WORKFLOW.md             # 開発フロー・エージェント・コミットゲート
├── images/                 # README 用スクリーンショット
└── zenn/                   # 記事化用の作業ログ

.claude/
├── agents/                 # 要件 / 設計 / 実装 / レビュー / 調整のエージェント定義
├── hooks/commit-gate.sh    # コミットゲート (PreToolUse)
└── settings.json           # フック設定
```

| レイヤー | ファイル | 役割 |
|---------|---------|------|
| Service Worker | `service_worker.js` | コンテキストメニュー管理、メッセージハブ、タブ操作 |
| 共有モジュール | `urls.js`, `linkMenu.js` | URL 定義・生成、メニュー DOM 生成 |
| Content Script | `*-cs.js` | 各サイトへのメニュー注入 |
| オプション | `options.*` | ユーザー設定 UI |

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### ドキュメントの役割分担

| ディレクトリ | 書くもの | 担当エージェント |
|-------------|---------|----------------|
| `docs/requirements/` | **満たすべきこと**（FR / NFR / CON） | analyst |
| `docs/specs/` | **今そうなっていること**（SPEC-xx）。実装と1対1 | architect |
| `src/`, `tests/` | 実装 | developer |
| — | レビュー（書き換えなし） | reviewer |

索引は [docs/README.md](docs/README.md)。**仕様書は「あるべき姿」ではなく「実際にそうなっているもの」を書く。**

### エージェント

`.claude/agents/` に役割を分けて定義してある。**役割をまたぐ変更をしない。**

| エージェント | 役割 | 書き換えてよい場所 |
|-------------|------|------------------|
| `lead` | 全体調整。工程を回す | なし |
| `analyst` | 利用者と対話して要件を決める | `docs/requirements/` |
| `architect` | 要件から設計・仕様を起こす | `docs/specs/`, `docs/ARCHITECTURE.md` |
| `developer` | 仕様に従って実装する | `src/`, `tests/`, `scripts/`, ルート設定 |
| `reviewer` | 実装と文書を突き合わせて検証する | **なし（読み取り専用）** |

フロー・モデル選定・コミットゲートは [docs/WORKFLOW.md](docs/WORKFLOW.md)。

### データフロー

1. オプションページで遷移先を設定 → `chrome.storage.sync` に保存
2. Service Worker が `storage.onChanged` で検知 → コンテキストメニュー再構築
3. Content Script がページ読み込み時に `chrome.storage.sync` から設定取得 → メニュー生成

### メッセージ通信

`chrome.runtime.sendMessage` / `onMessage` で通信する。

| type | 用途 |
|------|------|
| `rakuten-sec:info` | 楽天証券のセッションIDから個別銘柄 URL を取得 |
| `rakuten-sec:open` | 上記 URL を新しいタブで開く |
| `naito-sec:info` | 内藤証券の個別銘柄 URL を取得 |
| `naito-sec:open` | 上記 URL を新しいタブで開く |
| `open-url` | 指定 URL を新しいタブで開く |

## ⚠️ 他社サイトに注入するという前提

**このコードは自分たちが作っていないサイトの DOM を書き換える。** これが設計上もっとも重要な制約。

### CSS を消すときの鉄則

セレクタには**対象サイト側で定義済みのクラス**が混ざる（例: TradingView の `theme-dark`、
`chart-widget__top--themed-light`、`apply-common-tooltip`、`button-hw_3o_pb`）。
リポジトリを grep して「使われていない」ように見えても、サイト側にあるものは消してはいけない。

削除前に必ずこの順で確認する:

1. **`src/manifest.json` の `content_scripts` を見る。** どの CSS がどの `matches` に注入されるかが分かる。
   注入先サイトと無関係な規則は確実に死にコード。
2. **接頭辞で判定する。** `ktt-tv-` / `x-kabu-` は拡張が自分で付ける独自クラス。
   `src/*.js` に付与箇所が無ければ死んでいる。接頭辞が無いものはサイト側の可能性が高いので残す。
3. **`git log -S'<クラス名>' -- src/`** で、付与していた JS がいつ消えたかを追う。
4. サイト側クラスと独自クラスを**同一要素で**組み合わせた規則は、独自クラス側が死んでいれば規則ごと死んでいる。

同じ理由で Stylelint の `selector-class-pattern` は無効にしてある（サイト側のハッシュ付きクラス名に合わせるため）。

### セレクタは壊れる前提で書く

`menuSelectors` はサイト側の DOM 構造に強く依存する。サイト改修で無言のうちに効かなくなるため、
動かなくなった報告があればまず対象サイトの実 DOM を確認する。

## コーディング規約

### 言語・スタイル

- **JavaScript (ES2021+)**、TypeScript は使わない
- **インデント:** スペース 2（`.editorconfig` 参照）／**改行:** LF ／**文字コード:** UTF-8
- **セミコロンなし・シングルクォート**（neostandard 準拠）

### Lint

- **JS:** ESLint 9 + [neostandard](https://github.com/neostandard/neostandard)（flat config: `eslint.config.mjs`）
- **CSS:** Stylelint 17 + stylelint-config-standard + **stylelint-config-recess-order**（`stylelint.config.mjs`）
- `src/third-party/` は両方の対象外
- **プロパティの並び順も Stylelint が見る。** 旧 `.csscomb.json` は廃止し
  `stylelint-config-recess-order` に統合した。`npm run fix` で自動整列される

> ESLint 10 系にはまだ上げていない。neostandard の ESLint 10 対応が prerelease
> (`0.14.0-next`) のみのため、安定版が出たら追随する。

### 命名規則

| 対象 | 規則 | 例 |
|------|------|-----|
| 関数（非同期） | `camelCase` + `Async` | `getEnableLinkKeysAsync()` |
| 定数 | `UPPER_SNAKE_CASE` または `camelCase` | `menuSelectors` |
| jQuery 要素 | `$` プレフィックス | `$menu` |
| CSS クラス（楽天・SBI） | `x-kabu-` プレフィックス | `x-kabu-body` |
| CSS クラス（TradingView） | `ktt-tv-` プレフィックス | `ktt-tv-kabuLinkMenu` |

### Content Script の共通パターン

```javascript
$(() => {
  setTimeout(attachAsync, 500)   // サイト側の描画完了を待つ
})

async function attachAsync () {
  const keys = await getEnableLinkKeysAsync()
  if (keys.length === 0) return

  menuSelectors.forEach((menuSelector) => {
    $(menuSelector.selector).each((_, element) => attachMenu(element, keys))
  })
}
```

- 動的コンテンツには `MutationObserver` を使う（`rakuten-scr-cs.js` / `sbi-scr-cs.js` 参照）
- 外部リンクには必ず `target="_blank" rel="noopener noreferrer"` を付ける

### 外部リンクの追加方法

1. `src/urls.js` の `externalUrls` にエントリを追加

   ```javascript
   {
     key: 'site-name',                  // 一意なキー（storage の識別子になるので後から変えない）
     title: 'サイト名',
     url0: 'https://...',               // トップページ（オプション画面のリンク先）
     url1: 'https://.../${code}',       // 国内株
     url2: 'https://.../${exchange}/${code}',  // 米国株・取引所コードあり（任意）
     url3: 'https://.../${code}'        // 米国株・取引所コードなし（任意）
   }
   ```

2. `npm test` を実行する（`externalUrls` の整合性テストが走る）
3. `src/manifest.json` と `package.json` の `version` を更新する

> `key` は `chrome.storage.sync` に保存される識別子。変更すると既存ユーザーの設定が失われる。

### バージョニング

セマンティックバージョニング。`src/manifest.json` と `package.json` の**両方**を更新する
（`npm run validate` が不一致を検出する）。

## テスト

Playwright で拡張機能を実際に Chromium へロードして検証する。詳細は [docs/TESTING.md](docs/TESTING.md)。

| ファイル | 対象 |
|---------|------|
| `tests/service-worker.spec.mjs` | `getTickerCode` / `compareVersion` / `makeUrl` / `externalUrls` の整合性 |
| `tests/options.spec.mjs` | オプションページの表示・保存・並び替え・外部リクエスト有無 |
| `tests/content-script.spec.mjs` | 楽天・SBI へのメニュー注入（フィクスチャ HTML を実オリジンで差し替え） |

テストの一覧は [docs/TEST-CATALOG.md](docs/TEST-CATALOG.md)（`npm run docs:tests` で自動生成）。
**テストを増減したらこれを再生成すること。**

**TradingView は自動テスト対象外。** DOM がハッシュ付きクラス名で頻繁に変わるため、
フィクスチャ化しても実サイトとの乖離を検出できない。
変更時は [docs/TESTING.md](docs/TESTING.md) の手動確認手順に従う。

## 注意事項

- **ビルドシステムなし:** ES モジュール (`import`/`export`) は使えない。
  スクリプト間の共有は `manifest.json` の `js` 配列の読み込み順で制御する
  （`npm run validate` が読み込み順を検証する）
- **jQuery 依存:** Content Script では `$` がグローバルで利用可能
- **外部リソースを実行時に取得しない:** Chrome ウェブストアの審査とプライバシーの観点から、
  フォント・アイコン・画像はすべて `src/` に同梱する
  （`tests/options.spec.mjs` に外部リクエストゼロを保証する回帰テストがある）
- **`src/third-party/` は編集しない:** 更新手順は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 参照

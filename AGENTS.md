# AGENTS.md — 株リンク (kabu-tantan) 開発ガイド

> AI エージェント（Claude Code など）が最初に読むファイル。**AI が覚えておくべきことはここに書く**
> （末尾の「[AI エージェント向けの記録](#ai-エージェント向けの記録)」）。`CLAUDE.md` は置かない。

## プロジェクト概要

日本の証券会社サイト（楽天証券・SBI証券）および TradingView 上に、外部の株式情報サイトへのリンクメニューを追加する Chrome 拡張機能。

- **拡張機能名:** 株リンク
- **Manifest:** v3
- **バージョン:** `src/manifest.json` の `version`（`package.json` / `package-lock.json` と一致させる。`npm run validate` が検証する）
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
>
> **コミットは、テスト全件が通り、かつ reviewer のレビューが通るまでできない。**
> `.claude/hooks/commit-gate.sh` が機械的にブロックする。詳細は [docs/WORKFLOW.md](docs/WORKFLOW.md)。

### Chrome への読み込み

1. `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」から `src/` を指定

> ビルドステップは無い。`src/` がそのまま拡張機能として動作する。

## アーキテクチャ

```text
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
├── notice.html/js/css      # 右クリックの項目で開けないときに理由を知らせる小窓
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
| --- | --- | --- |
| Service Worker | `service_worker.js` | コンテキストメニュー管理、メッセージハブ、タブ操作 |
| 共有モジュール | `urls.js`, `linkMenu.js` | URL 定義・生成、メニュー DOM 生成 |
| Content Script | `*-cs.js` | 各サイトへのメニュー注入 |
| オプション | `options.*` | ユーザー設定 UI |

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### ドキュメントの役割分担

| ディレクトリ | 書くもの | 担当エージェント |
| --- | --- | --- |
| `docs/requirements/` | **満たすべきこと**（FR / NFR / CON） | analyst |
| `docs/specs/` | **今そうなっていること**（SPEC-xx）。実装と1対1 | architect |
| `src/`, `tests/` | 実装 | developer |
| — | レビュー（書き換えなし） | reviewer |

索引は [docs/README.md](docs/README.md)。**仕様書は「あるべき姿」ではなく「実際にそうなっているもの」を書く。**

### エージェント

`.claude/agents/` に役割を分けて定義してある。**役割をまたぐ変更をしない。**

| エージェント | 役割 | 書き換えてよい場所 |
| --- | --- | --- |
| `lead` | 全体調整。工程を回す | なし |
| `analyst` | 利用者と対話して要件を決める | `docs/requirements/` |
| `architect` | 要件から設計・仕様を起こす | `docs/requirements/`, `docs/specs/`, `docs/ARCHITECTURE.md`, `docs/adr/` |
| `developer` | 仕様に従って実装する | `src/`, `tests/`, `scripts/`, ルート設定 |
| `reviewer` | 実装と文書を突き合わせて検証する | **なし（読み取り専用）** |

`AGENTS.md` はどの担当の書き換え範囲にも入れない。書くのはメインセッションだけ（下の「[AI エージェント向けの記録](#ai-エージェント向けの記録)」）。

フロー・モデル選定・コミットゲートは [docs/WORKFLOW.md](docs/WORKFLOW.md)。

### データフロー

1. オプションページで遷移先を設定 → `chrome.storage.sync` に保存
2. Service Worker が `storage.onChanged` で検知 → コンテキストメニュー再構築
3. Content Script がページ読み込み時に `chrome.storage.sync` から設定取得 → メニュー生成

### メッセージ通信

`chrome.runtime.sendMessage` / `onMessage` で通信する。

| type | 用途 |
| --- | --- |
| `rakuten-sec:info` | 楽天証券の個別銘柄 URL を組み立てられるか（ログイン済みタブがあるか）を返す |
| `rakuten-sec:open` | Service Worker が URL を組み立てて新しいタブで開く |
| `naito-sec:info` | 内藤証券の個別銘柄 URL を組み立てられるかを返す |
| `naito-sec:open` | Service Worker が URL を組み立てて新しいタブで開く |
| `open-url` | 指定 URL を新しいタブで開く |

> 証券会社の URL（楽天証券の `BV_SessionID` を含む）は **Service Worker の外へ出さない**。
> 応答は `{ available: boolean }` だけで、Content Script にも注入先ページの DOM にも URL を渡さない（SPEC-MSG-06 / ADR-0016）。

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
| --- | --- | --- |
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
3. `src/manifest.json` と `package.json` の `version` を更新し、`npm install --package-lock-only` で lock を同期する

> `key` は `chrome.storage.sync` に保存される識別子。変更すると既存ユーザーの設定が失われる。

### バージョニング

セマンティックバージョニング。`src/manifest.json` と `package.json` の**両方**を更新し、
`npm install --package-lock-only` で `package-lock.json` を同期する
（`npm run validate` が3者の不一致を検出する。SPEC-MF-09）。

> `package.json` を手で書き換えるだけだと lock が追随しない。1.10.0〜1.20.1 の間、lock の version は 1.10.0 のまま止まっていた。

## テスト

Playwright で拡張機能を実際に Chromium へロードして検証する。詳細は [docs/TESTING.md](docs/TESTING.md)。

| ファイル | 対象 |
| --- | --- |
| `tests/service-worker.spec.mjs` | `getTickerCode` / `compareVersion` / `makeUrl` / `externalUrls` の整合性 |
| `tests/options.spec.mjs` | オプションページの表示・保存・並び替え・外部リクエスト有無 |
| `tests/content-script.spec.mjs` | 楽天・SBI へのメニュー注入（フィクスチャ HTML を実オリジンで差し替え） |
| `tests/tradingview.spec.mjs` | TradingView で拡張が作った DOM（入れ子メニューのクリック範囲・縦位置補正・証券会社の項目が URL を DOM に出さないこと・未知キーの読み飛ばし）と、セレクタからフィクスチャを組み立てる規則。サイト側の実 DOM は見ない（CON-08） |
| `tests/notice.spec.mjs` | 右クリックの項目で開けないときの小窓（文言・設定順の並び・選択文字列を出さないこと・HTML として解釈しないこと・閉じ方・外部リクエストゼロ・大きさへの収まり） |
| `tests/selector-defs.spec.mjs` | `menuSelectors` の定義・`check:selectors` の中断処理・手がかりの消毒と書式 |

テストの一覧は [docs/TEST-CATALOG.md](docs/TEST-CATALOG.md)（`npm run docs:tests` で自動生成）。
**テストを増減したらこれを再生成すること。**

**TradingView の自動テストは、拡張が自分で作った DOM の振る舞いだけを見る**
（`tests/tradingview.spec.mjs`）。**緑でも実サイトが壊れていない根拠にはならない**（CON-08）。
サイト側の DOM・見た目・挙動は `npm run check:selectors` と
[docs/MANUAL-CHECKLIST.md](docs/MANUAL-CHECKLIST.md) の A セクションが見る。
変更時は同チェックリストに従って利用者に確認を依頼する。

検証の切り分け（自動 / 半自動 / 手動）は [docs/TESTING.md](docs/TESTING.md) を参照。

## 注意事項

- **ビルドシステムなし:** ES モジュール (`import`/`export`) は使えない。
  スクリプト間の共有は `manifest.json` の `js` 配列の読み込み順で制御する
  （`npm run validate` が読み込み順を検証する）
- **jQuery 依存:** Content Script では `$` がグローバルで利用可能
- **外部リソースを実行時に取得しない:** Chrome ウェブストアの審査とプライバシーの観点から、
  フォント・アイコン・画像はすべて `src/` に同梱する
  （`tests/options.spec.mjs` に外部リクエストゼロを保証する回帰テストがある）
- **`src/third-party/` は編集しない:** 更新手順は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 参照

## AI エージェント向けの記録

**AI が覚えておくべきことは、このファイルに書く。** 個人用のメモリ（Claude Code の auto memory など）には置かない。
`CLAUDE.md` は置かない（2026-10-11 利用者判断）。Claude Code は v2.1.277 以降、`CLAUDE.md` が無ければ本ファイルを読む。

**書くのはメインセッション**（利用者と直接やり取りしている AI）。サブエージェント（`.claude/agents/`）は書かず、
記録すべきことに気づいたら報告に書いてメインセッションに渡す。本ファイルの変更もコミットゲート（reviewer → `npm run approve`）を通す。

| 書く | 書かない |
| --- | --- |
| 繰り返し効く規則・手順、実行環境の癖、利用者との進め方の取り決め | 進行中の状態（どの版を申請したか等。git log と docs に残る）、個人情報、コードや git 履歴から読み取れること |

### 利用者への依頼は、必要になった時点でだけ出す

ログイン、拡張の再読み込み、ターミナルでのコマンド実行、実機での目視確認など、
利用者に手を動かしてもらう依頼は**実際に必要になったときにだけ**伝える。「後でこれをお願いします」と先に予告しない。

- 待ち状態の報告は「何を待っているか」だけにとどめ、依頼は含めない
- 複数の依頼をまとめて渡すのは、**すべてが今実行できるとき**だけにする
- 依頼を出したら、それが完了するまで次の依頼を積まない

> 2026-08-23、レビュー待ちの間に「reviewer が通ったら次はこれをお願いします」と先に出したところ、
> 「事前に提示されると今必要なのかな？と思ってしまいます」と指摘された。予告は利用者に「今動くべきか」の判断を強いる。

### 手動確認の補助ページは、その都度作って終わったら消す

手動確認で利用者に文字列を選んでもらうとき（D-1 など）は、選ぶ文字列・押す項目・期待結果を並べたページを AI が作って渡す。
置き場所は作業用の一時ディレクトリにし、リポジトリには入れず、確認が終わったら消す（2026-10-12 利用者判断）。消す前に、結果を `docs/MANUAL-CHECKLIST.md` に記録する。

- 文字列は `user-select: all` の枠に入れると、1回のクリックで全体を選べる（ドラッグが要らない）
- `file://` で開いたページでも、株リンクの右クリックメニューは出て、押すとタブや小窓も開く（2026-10-12 の D-1 で確かめた。
  `chrome://extensions` の「ファイルの URL へのアクセスを許可する」がオンだったかオフだったかは記録していない）

> 利用者の言葉（2026-10-12）: 「毎回テストするときに作ってくれればいいよ。」「チェックして終わったら破棄でいいんじゃないかな。」

### 自動でテストできるものは、自動でテストする

**テストは自動化を基本にする。** 利用者に手動確認を頼むのは、自動化できないと確かめたものだけにする（2026-10-11 利用者指示）。

- 手動確認の項目を足す前、利用者に確認を頼む前に、まず Playwright で再現できないかを試す
- 試して自動化できなかったときは、方法と結果を下の表に書く（同じ試行を繰り返さないため）
- 自動テストに移した項目は `docs/MANUAL-CHECKLIST.md` から外す（自動と手動で同じことを二重に持たない。FR-26 判定基準 3）

**自動化できないと確かめたもの:**

| 対象 | 確かめたこと | 代わりに何で見るか |
| --- | --- | --- |
| `chrome://extensions` のエラー欄 | 2026-10-11。Playwright の Chromium で `chrome.developerPrivate.getExtensionInfo()` の `runtimeErrors` を読んだが、開発者モードを有効にしても、ヘッドレス・画面ありとも常に空。Service Worker の `console.error` や例外も載らなかった（試した条件は SPEC-SW-02 の実測表） | エラーの元（`chrome.contextMenus.create` の `lastError` など）をテストで直接記録する |
| Chrome の右クリックメニューの項目を押す | 2026-10-11。選択して `page.click({ button: 'right' })` → 矢印キー → Enter を、ヘッドレス・画面ありとも試したが `chrome.contextMenus.onClicked` が発火しない。CDP にも `chrome.contextMenus` にも、メニューを操作・模擬する手段が無い | 押したあとの処理を `onContextMenuClickedAsync` の直接呼び出しで見る。押す操作と小窓の実際の見え方は手動確認 D-3 |
| 実サイトの DOM・見た目、ログインが要るもの | フィクスチャでは実サイトの変化を検出できない（CON-08）。ログイン済みタブが前提（CON-04） | `npm run check:selectors` と手動確認 |

**まだ試していないもの:** 切断状態（拡張機能の更新・再読み込みの後に残った古いタブ。手動確認 G）。
再読み込みそのものは Playwright で再現できる（2026-10-11 実測。開発者モードを有効にして `chrome.developerPrivate.reload(id)`）ので、
古いタブで切断状態になるかを確かめれば自動化できる見込みがある。SPEC-CS-19 などの「再読み込みを再現できない」という記述は、この実測より前のもの。

> 利用者の言葉（2026-10-11）: 「自動でテストできるとか、基本的に自動でテストしてください。」

### 修正したら、レビュー → テスト → コミット → push までをセットで行う

**コードを修正したら、レビュー → テスト → コミット → push までを1セットとして行う。**
push の前に利用者へ確認しない（2026-10-11 利用者指示）。

1. 修正する
2. reviewer のレビューを通す。OK が出なければ直して、もう一度レビューを通す
3. レビューが OK なら `npm run approve` でテストする。`npm run check` を全件流し、通れば承認を記録する
   （コミットゲート。`docs/WORKFLOW.md`）。通らなければ承認されないので、直して手順2からやり直す
4. 変更を**すべて**コミットする（一部だけ `git add` すると、テストしていない組み合わせが履歴に入りうる）。
   承認後にファイルを1文字でも変えるとゲートがコミットを止めるので、
   **コミットされた中身は手順3でテストが通ったものと同じ**になる。
   **`npm run approve` とコミットは別々の Bash 呼び出しで行う。** ゲートのフック（PreToolUse）は呼び出しを実行する前に判定するので、
   `npm run approve && git commit …` のように1回の呼び出しにまとめると、承認前の状態で判定されて呼び出しごと止まる（2026-10-11 に実際に踏んだ）
5. push する。手順3のテストで足りるので流し直さない（承認とコミットの間に何か変えたら、手順2からやり直す）

> 利用者の言葉（2026-10-11）: 「Code修正したらテストして、まあその前にレビューか。
> レビューしてOKだったらテストして、コミットしてプッシュ。ここまでがセット。」

### リリースの分担

| 担当 | 作業 |
| --- | --- |
| AI | コミット → push（上の流れ。確認は不要）→ `npm run package`。**パッケージ作成は利用者に確認してから** |
| 利用者 | zip のアップロードと Chrome ウェブストアへの申請 |

`npm run package` は作業ツリーの `src/` をそのまま固める。作業中で `src/` が汚れているときは、
対象コミットを `git worktree add --detach <dir> <commit>` で取り出してそこで `node scripts/package.mjs` を実行し、
展開した zip と `git archive <commit> src` の中身が一致することを `diff -r` で確かめてから `dist/` に置く。

### 図は Mermaid で書く

罫線のアスキーアートは日本語が混ざると崩れるので使わない（ディレクトリツリーは例外）。

### 実行環境ではシグナルが届かないことがある

AI エージェントの Bash 実行環境（Claude Code で確認）は、`kill -INT` を子プロセスに届けない
（素の `bash -c 'trap … INT'` すら反応しない。SIGTERM は届く）。`( … ) &` の背景ジョブや
`sleep | node` のパイプ経由で起動すると、シグナルの継承（SIG_IGN）や stdin の TTY の有無も変わる。
コミットゲートやセレクタ検証ツールの後始末の検証で、これが原因の誤判定を3回繰り返した。

- シグナル関連の検証は **`child_process.spawn` + `child.kill(sig)`** で行う（シェルを介さない）
- **実 TTY（raw モードの readline）は再現できない。** `SELECTOR_CHECK_FORCE_TERMINAL=1` のような
  テスト用の強制フラグで擬似的に再現し、最終確認は利用者に実端末で依頼する
- 「自分の環境で再現しない」を根拠に他の担当の報告を否定しない。先に最小再現
  （`node -e 'process.on("SIGINT",…)'` 程度）で環境そのものを疑う。逆に自己申告も鵜呑みにしない

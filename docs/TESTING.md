# テスト

## 実行方法

```bash
npm install
npx playwright install chromium   # 初回のみ

npm test                # ヘッドレス実行
npm run test:headed     # ブラウザを表示して実行
npm run test:ui         # Playwright UI モード（デバッグ向き）
npm run docs:tests      # docs/TEST-CATALOG.md を再生成

npx playwright test options.spec.mjs                    # ファイル単位
npx playwright test -g "並び替え"                        # テスト名で絞る
npx playwright show-report                              # 失敗時のレポート
```

### 配布物そのものをテストする

既定では `src/` を直接読み込むが、`EXTENSION_PATH` で対象を差し替えられる。
`npm run package` で作った zip を展開して流せば、**実際に配布するものが動くか**を検証できる。

```bash
npm run package
unzip -q dist/kabu-tantan-<version>.zip -d /tmp/kt-pkg
EXTENSION_PATH=/tmp/kt-pkg npm test
```

リリース前にはこれを実行すること（zip の詰め忘れ・パス間違いを検出できる）。

## 何をどう検証するか（3層の切り分け）

**すべてを自動化しようとしない。** 壊れやすさ・静かに壊れるか・自動化コストで層を分ける。

| 層 | 対象 | 手段 | 実行 |
| --- | --- | --- | --- |
| **自動** | ロジック / オプションページ / 楽天・SBI の注入 | Playwright（29件） | `npm test`（約27秒） |
| **半自動** | 実サイトのセレクタ健全性 | 利用者がログイン → 自動で検証 | 未実装（FR-12） |
| **手動** | TradingView / 証券会社セッション連携 | チェックリスト | [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) |

判断基準:

| 条件 | 層 |
| --- | --- |
| ログイン不要 かつ DOM が安定 かつ 静かに壊れる | **自動**。最優先で自動化する |
| ログインが要る が 検証自体は機械的 | **半自動**。ログインだけ人力にする |
| DOM が毎リリース変わる（フィクスチャが実物と乖離する） | **手動**。自動化しても「通るだけ」になり有害 |
| 見た目の妥当性（配色・読みやすさ） | **手動**。機械では判定できない |

自動テストは **ファイル単位で** `src/` の JS 1426行中 870行（61%）を対象にしている（行カバレッジではない）。
残り 39% は `tradingview-cs.js`（399行）と スクリーナー2種（157行）で、いずれも
上表の「手動」条件に該当する。

> **「自動化できない＝テストしない」ではない。**
> 手動で確認するものは [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) に手順と期待結果を書き、
> 実施結果を記録できる形にしてある。

## 方針

拡張機能はビルドもモジュール化も無いため、**関数単体を Node で import することができない。**
そのため Playwright で拡張機能を実際に Chromium へロードし、実行中のコンテキストに対して検証する。

```js
chromium.launchPersistentContext('', {
  channel: 'chromium',        // 拡張機能はこのチャネルの new headless で動作する
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
})
```

### 1. Service Worker のロジック検証

Playwright の `Worker#evaluate` で **Service Worker のグローバルスコープに直接アクセス**できる。
`importScripts('./urls.js')` 済みなので `urls.js` の関数もそのまま呼べる。

```js
await serviceWorker.evaluate((t) => getTickerCode(t), '7203')
```

これが実質的な単体テストになる。

### 2. オプションページ

`chrome-extension://<id>/options.html` に直接遷移する。`extensionId` は Service Worker の
URL のホスト部分から取得する。`chrome.storage.sync` にはページの `evaluate` から触れるので、
保存内容をそのまま検証できる。

### 3. Content Script

`content_scripts` の `matches` は**実オリジンでしか発火しない**ため、ローカルの HTML ファイルを
開いても注入されない。そこで `context.route()` で対象 URL のレスポンスを
フィクスチャ HTML に差し替える。

```js
await context.route('https://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do;...',
  (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
```

フィクスチャは `tests/content-script.spec.mjs` 内に定義してあり、
`src/*-cs.js` の `menuSelectors` に対応した最小限の DOM 構造を再現している。
**サイト側の構造が変わってセレクタを直すときは、フィクスチャも合わせて更新すること。**

> テストの**一覧**は [TEST-CATALOG.md](TEST-CATALOG.md)（`npm run docs:tests` で自動生成）。
> このファイルには方針と手法だけを書く。

## カバーしている範囲

**テストの一覧は [TEST-CATALOG.md](TEST-CATALOG.md)**（`npm run docs:tests` で自動生成）。

大まかには以下を検証している。

| 層 | 対象 |
| --- | --- |
| ロジック | `getTickerCode`（誤マッチ防止を含む） / `compareVersion` / `makeUrl` / `externalUrls` の整合性 |
| オプションページ | 一覧表示・初期値・グリッドレイアウト・トグル保存・ドラッグ並び替え・リンク属性・外部リクエストゼロ・アイコンフォント |
| Content Script | 楽天証券とSBI証券へのメニュー注入、URL生成、ホバー開閉、対象外ページで注入しないこと、設定の反映 |

## カバーしていない範囲

- **TradingView (`tradingview-cs.js`)**
  DOM がハッシュ付きクラス名（`menu-Tx5xMZww` 等）で構成され、リリースごとに変わる。
  フィクスチャ化しても実サイトとの乖離を検出できず、テストが「通るだけ」になるため対象外。
  変更時は実際に TradingView を開いて手動確認する。
- **楽天証券・内藤証券のセッション連携**
  ログイン状態のタブが前提のため自動化していない。
- **楽天スーパースクリーナー / SBI銘柄スクリーニング**
  `MutationObserver` + iframe 前提で、フィクスチャでの再現コストが見合わない。

## 手動確認

自動テストの対象外は [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) に従って確認する。
**手順・期待結果・チェック欄がセクション別にまとまっている**ので、
変更箇所に対応するセクションだけ実施すればよい。

変更箇所ごとにどのセクションを実施するかは、チェックリスト冒頭の対応表を参照する（表はそこだけに置く）。

利用者に依頼する場合は、`docs/MANUAL-CHECKLIST.md` の該当セクションを渡し、
末尾の報告フォーマットで結果を返してもらう。

### 配布物の確認

リリース前に実施する。

```bash
npm run package
unzip -q dist/kabu-tantan-<version>.zip -d /tmp/kt-pkg
EXTENSION_PATH=/tmp/kt-pkg npm test
```

さらに `chrome://extensions/` で `/tmp/kt-pkg` を「パッケージ化されていない拡張機能」として
読み込み、[MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) の全セクションを実施する。

## 制約

- `fullyParallel: false` / `workers: 1` で直列実行する。
  拡張機能の読み込みには永続コンテキストが必要で、`chrome.storage.sync` の状態が
  テスト間で干渉するため。
- `evaluateAll` は自動待機しない。Content Script の注入は非同期なので、
  先に `expect(locator).toHaveCount(n)` などで待ってから使う。
- **テストを増減したら `npm run docs:tests` で `docs/TEST-CATALOG.md` を再生成する。**
  `npm run check` が `--check` モードで陳腐化を検出する。

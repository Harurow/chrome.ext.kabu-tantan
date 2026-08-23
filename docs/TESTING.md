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
|----|------|
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

## 手動確認手順

自動テストの対象外（CON-08 など）は、変更時にここに従って手で確認する。

### TradingView

`src/tradingview-cs.js` / `src/tradingview-cs.css` を変更したら必ず実施する。

1. `chrome://extensions/` で拡張機能を再読み込みする
2. https://jp.tradingview.com/chart/ を開き、国内株（例 `TSE:7203`）を表示する
3. **ツールバーに「株Link」ボタンが出ること**（SPEC-CS-12）
4. 「株Link」をクリック → メニューが出ること。背景クリックで閉じること
5. メニューの項目をクリック → 新しいタブで該当銘柄のページが開くこと
6. **チャートを右クリック** → メニュー下部に区切り線と各サイトの項目が追加されていること（SPEC-CS-11）
7. 米国株（例 `BATS:AAPL`）に切り替え、米国株対応サイトのみ出ることを確認する
8. 銘柄を指定しない画面（チャート以外）に移動し、ボタンが隠れることを確認する

楽天証券にログイン中のタブがある場合は、5 と 6 に「楽天証券で開く」が増えることも確認する。

### 楽天スーパースクリーナー

1. 楽天証券にログインし、スーパースクリーナーを開く
2. 結果一覧の銘柄コードにホバー → メニューが出ること
3. **ページ送りをして、次ページでもメニューが出ること**（MutationObserver の確認、SPEC-CS-08）

### SBI銘柄スクリーニング

1. SBI証券にログインし、銘柄スクリーニングを開く
2. 結果一覧の銘柄コードにホバー → メニューが出ること
3. 条件を変えて再検索し、メニューが再注入されること（SPEC-CS-10）

### 楽天証券・SBI証券の残りのページ

自動テストは楽天の「お気に入り」と SBI の「ポートフォリオ」のみ。
`docs/specs/content-scripts.md` の SPEC-CS-07 / SPEC-CS-09 の表にある残りのページは、
セレクタを変更したときに手で開いて確認する。

### 証券会社セッション連携

1. 楽天証券にログインしたタブを開いたまま TradingView を開く
2. 「株Link」メニューに「楽天証券を開く」が出ること
3. クリックして該当銘柄のページが開くこと
4. 楽天証券のタブを閉じ、メニューから項目が消えること（SPEC-SW-06）

内藤証券も同様（国内株の個別銘柄ページを開いた状態で確認、SPEC-SW-07）。

### 配布物

リリース前に実施する。

```bash
npm run package
unzip -q dist/kabu-tantan-<version>.zip -d /tmp/kt-pkg
EXTENSION_PATH=/tmp/kt-pkg npm test
```

さらに `chrome://extensions/` で `/tmp/kt-pkg` を「パッケージ化されていない拡張機能」として
読み込み、オプションページが開けることを確認する。

## 制約

- `fullyParallel: false` / `workers: 1` で直列実行する。
  拡張機能の読み込みには永続コンテキストが必要で、`chrome.storage.sync` の状態が
  テスト間で干渉するため。
- `evaluateAll` は自動待機しない。Content Script の注入は非同期なので、
  先に `expect(locator).toHaveCount(n)` などで待ってから使う。
- **テストを増減したら `npm run docs:tests` で `docs/TEST-CATALOG.md` を再生成する。**
  `npm run check` が `--check` モードで陳腐化を検出する。

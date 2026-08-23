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
| **自動** | ロジック / オプションページ / 楽天・SBI の注入 / セレクタ定義の整合性 / 中断時の後始末 | Playwright（38件） | `npm test`（約27秒） |
| **半自動** | 実サイトのセレクタ健全性 | 利用者がログイン → 自動で検証 | `npm run check:selectors` |
| **手動** | TradingView の見た目・操作 / 証券会社セッション連携 | チェックリスト | [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) |

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

## 半自動: 実サイトのセレクタ検証

対象サイトの改修で**検出用セレクタ**（銘柄コード要素・挿入先を探すセレクタ）が
効かなくなったことを、利用者の報告を待たずに確認するためのツール。
仕様は [specs/selector-check.md](specs/selector-check.md)、設計判断は [adr/0001](adr/0001-selector-check-design.md)。

```bash
npm run check:selectors                          # 全サイト
npm run check:selectors -- --only=tradingview    # TradingView だけ（ログイン不要）
npm run check:selectors -- --out=/tmp/x.md       # 出力先を変える
npm run check:selectors -- --help                # 使い方
```

### 流れ

1. 一時プロファイルでヘッド有りの Chromium が起動し、端末に準備手順が出る
2. **人がログインする**（楽天証券 / SBI証券）。ツールはログインを代行しない（CON-04, CON-10）
3. `reach: 'tab'` の対象（楽天スーパースクリーナー / SBI証券の2ページ / SBI銘柄スクリーニング）は
   **人が対象ページを開いておく**。スクリーナーは検索を実行し結果一覧が出た状態にする
4. 端末で **Enter** を1回押す（時間制限なし）
5. 楽天証券の12ページと TradingView はツールが自動で遷移して判定する
6. 結果が `docs/SELECTOR-CHECK.md` に上書き生成され、ブラウザと一時プロファイルが破棄される

> 楽天証券のセッションは、開いているタブの URL から借用する（`service_worker.js` と同じ方式）。
> **借用した文字列も URL も結果ファイルには出力しない**（NFR-12）。
> お気に入り・保有銘柄が 0 件だと「破損」と区別できないため、
> 1銘柄以上を登録した口座で実行する（0件のときは備考に注意が出る）。

### 結果の読み方（4値）

| 記号 | 意味 | やること |
| --- | --- | --- |
| ✅ 正常 | ページに到達し、検出用セレクタが1件以上ヒットした | なし |
| ❌ 破損 | ページには到達したが検出用セレクタが 0 件 | **サイト改修を疑い、実 DOM を見てセレクタを直す** |
| ⚠️ 未到達 | ページ識別セレクタも検出用セレクタもヒットしない | 遷移に失敗したか、ページ構造ごと変わった。`targets.mjs` の識別セレクタも疑う |
| — 未実施 | `--only` で除外・ログインしていない・対象のタブが開かれていない | 必要なら準備して再実行する |

「識別」列はページ識別セレクタ、「ヒット」列は検出用セレクタ、
「注入」列は拡張機能が実際に挿入した要素の数（参考値。判定には使わない）。

### 中断したとき

`Ctrl+C`（または `kill`）でいつでも止められる。一時プロファイルと Chromium は必ず破棄される（NFR-12）。

- 端末では readline が raw モードになるため、Ctrl+C は**プロセスのシグナルではなく readline のイベント**として届く。
  両方の経路から同じ終了処理を呼んでいる
- **SIGHUP（端末を閉じる / SSH 切断）もリスナーが要る。** 無いと Node は `process.on('exit')` を実行せずに終了し、
  ログイン済み Cookie を抱えたプロファイルが残る
- 中断時は `--user-data-dir` を目印に Chromium を落としてからプロファイルを消す。
  先に消すと、終了処理中の Chromium がディレクトリを書き戻して残骸になる
- `--dry-run` はブラウザを起動せずに準備手順の表示と Enter 待ちだけを行う。
  この後始末の経路を自動テスト（`tests/selector-defs.spec.mjs`）から検証するために使う
- stdin が閉じている場合（`< /dev/null` など）は Enter を待たずに、準備なしで検証を始める

### 終了コード

| コード | 条件 |
| --- | --- |
| `0` | 破損 0 件かつ未到達 0 件（未実施はあってよい） |
| `1` | 破損が 1 件以上 |
| `2` | 破損 0 件だが未到達が 1 件以上 |
| `3` | ツールの実行エラー（定義の不一致・ブラウザ起動失敗・プロファイル削除失敗など） |

### `npm run check` に含めない理由

対象はいずれも他社サイトで、自動・反復アクセスは利用規約上の問題になりうる（CON-10）。
**開発者が手で起動したときだけ**アクセスする。CI からも起動しない。

### セレクタの単一情報源

検証ツールは**セレクタ文字列を一切持たない**。`src/*-cs.js` の `menuSelectors` を
`node:vm` で読み出して使う（NFR-13）。`tests/selector-defs.spec.mjs` が
`menuSelectors` の構造と `scripts/selector-check/targets.mjs` との1対1対応を `npm test` で守っている。

つまり **セレクタを直したときに検証側を直す作業は発生しない**。
逆に `menuSelectors` の名前・構造を壊すと `npm test` が落ちる。

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
| セレクタ定義 | `menuSelectors` の読み出し・構造・`targets.mjs` との1対1対応（半自動検証の前提。NFR-13） |
| 検証ツール | 中断（SIGINT / SIGTERM / SIGHUP / 端末の Ctrl+C）で一時プロファイルが残らないこと（NFR-12） |

## カバーしていない範囲

- **TradingView (`tradingview-cs.js`)**
  DOM がハッシュ付きクラス名（`menu-Tx5xMZww` 等）で構成され、リリースごとに変わる。
  フィクスチャ化しても実サイトとの乖離を検出できず、テストが「通るだけ」になるため対象外。
  **検出用セレクタが生きているかは `npm run check:selectors` が判定する。**
  見た目・操作感は実際に TradingView を開いて手動確認する。
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

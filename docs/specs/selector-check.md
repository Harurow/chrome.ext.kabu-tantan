# SPEC-SC: 実サイトのセレクタ検証ツール

実装: `scripts/selector-check/`, `package.json` の `check:selectors`, `tests/selector-defs.spec.mjs`
生成物: `docs/SELECTOR-CHECK.md`

> 設計判断の比較検討は [ADR-0001](../adr/0001-selector-check-design.md)。
>
> **実測の範囲（2026-08-23 / 拡張機能 1.10.0）:** TradingView の4対象だけを実行した。
> 楽天証券・SBI証券・スクリーナー2種はログイン／人の操作を要するため**未検証**。
> 最新の結果は [SELECTOR-CHECK.md](../SELECTOR-CHECK.md)。

## 用語

| 語 | 意味 |
| --- | --- |
| **検出用セレクタ** | 拡張機能が銘柄コード要素・挿入先を探すために使うセレクタ。壊れると機能が消える。**検証対象** |
| **ページ識別セレクタ** | 対象ページに到達できたことを判定するためのセレクタ。拡張機能は使わない。**検証ツールだけが持つ** |
| **模倣用クラス** | 見た目を合わせるために拡張機能が付与するクラス。検証対象外（FR-12） |
| **対象** | 「1ページ × 1検出用セレクタ」の組。判定の最小単位 |

---

## SPEC-SC-01 位置づけと起動方法

```bash
npm run check:selectors                    # 全サイト
npm run check:selectors -- --only=tradingview   # TradingView だけ
npm run check:selectors -- --out=/tmp/x.md      # 出力先を変える
npm run check:selectors -- --dry-run            # ブラウザを起動せず準備表示・Enter 待ち・後始末だけ
npm run check:selectors -- --help               # 使い方を表示して終了（コード 0）
```

| | |
| --- | --- |
| 実体 | `node scripts/selector-check/index.mjs` |
| 実行契機 | **開発者が手で起動したときだけ。** `npm run check` には含めない（CON-10） |
| ブラウザ | Playwright（`@playwright/test` の `chromium`）。**ヘッド有り**で起動する |
| 依存追加 | **無し。** 既存の devDependencies だけで動く |
| テストランナー | 使わない。素の Node スクリプト（`playwright test` のタイムアウトを避けるため。FR-15） |

`--only` に指定できるサイトキー: `rakuten` / `rakuten-scr` / `sbi` / `sbi-scr` / `tradingview`（カンマ区切り）。
指定しなかったサイトは「未実施」として出力する（FR-16）。

| オプション | 書式 | 不正時 |
| --- | --- | --- |
| `--only=<サイト,...>` | **`=` で繋ぐ**（`--only tradingview` は不可） | stderr にメッセージと使い方を出して終了コード 3（SPEC-SC-15） |
| `--out=<パス>` | 同上。相対パスはリポジトリルート基準で解決する | 同上 |
| `--dry-run` | ブラウザを起動しない。準備手順の表示・Enter 待ち・後始末だけを通す（SPEC-SC-08 の自動テスト経路） | — |
| `--help` / `-h` | 使い方を stdout に出して終了コード 0 | — |

未知のオプションも終了コード 3。

- 要件: FR-12, FR-15, CON-10
- 検証: `manual`（`npm run check:selectors -- --only=tradingview` が完走し `docs/SELECTOR-CHECK.md` が更新されること）

---

## SPEC-SC-02 検出用セレクタの単一情報源

**検証ツールはセレクタ文字列を一切持たない。** `src/*-cs.js` の `menuSelectors` を読み出して使う（NFR-13）。

| 情報 | 置き場所 | 理由 |
| --- | --- | --- |
| 検出用セレクタ | `src/*-cs.js` の `menuSelectors`（**唯一の情報源**） | 拡張機能が実際に使う値でなければ検証の意味が無い |
| ページ識別セレクタ | `scripts/selector-check/targets.mjs` | 拡張機能は使わない。`src/` に検証専用の情報を入れない（FR-12「やらないこと」） |
| 到達方法・URL・待機時間 | `scripts/selector-check/targets.mjs` | 同上 |

`targets.mjs` と `menuSelectors` は **`key ?? title` で突き合わせる**。
突き合わせに失敗（欠け・余り）したら実行を中止する（SPEC-SC-16 が `npm test` でも検出する）。

- 要件: NFR-13, FR-12, CON-02
- 検証: `auto`（SPEC-SC-16）

---

## SPEC-SC-03 セレクタ定義ローダ

`scripts/selector-check/load-selectors.mjs`

ビルドが無く `export` が使えない（CON-02）ため、`node:vm` で Content Script を評価して
`menuSelectors` を取り出す。

```js
vm.runInNewContext(`${source}\n;menuSelectors`, sandbox, { filename, timeout: 1000 })
```

サンドボックスに与えるもの（それ以外は与えない。`require` / `process` / `fs` を露出しない）:

| 名前 | 中身 |
| --- | --- |
| `$` / `jQuery` | 何を呼ばれても自分を返す Proxy（トップレベルの `$(() => …)` を無害化する） |
| `MutationObserver` | `observe` / `disconnect` が空実装のクラス |
| `setTimeout` | 何もせず `0` を返す |
| `document` / `chrome` / `console` | 空オブジェクト（`console` のみ実物） |

### `src/*-cs.js` 側の契約

ローダが成立するために、5本の Content Script は以下を満たすこと。**破ると検証が動かなくなる。**

1. 検出用セレクタを `const menuSelectors = [ … ]` という名前の配列で持つ（1ファイル1箇所）
2. トップレベルで実行するのは `$(() => …)` の登録のみ。DOM・ネットワークに触れない
3. 各要素は `{ title: string, selector: string }` を必ず持つ。
   楽天証券は `url`（URL 部分一致）、TradingView は `key` を追加で持つ

> 5本すべてから `menuSelectors` を取り出せる（楽天12 / 楽天スクリーナー1 / SBI 2 /
> SBI スクリーナー1 / TradingView 4 件）。`tradingview-cs.js` は SPEC-CS-15 で括り出し済み。

- 要件: NFR-13, CON-02
- 検証: `auto`（SPEC-SC-16）

---

## SPEC-SC-04 検証ターゲット表

`scripts/selector-check/targets.mjs` が持つ構造。**`selector` フィールドを持たせてはならない**（SPEC-SC-02）。

```js
{
  site: 'rakuten',                  // サイトキー
  label: '楽天証券',
  source: 'src/rakuten-cs.js',      // menuSelectors の読み出し元
  targets: [
    {
      key: 'お気に入り',             // menuSelectors の key ?? title と一致させる
      reach: 'goto',                // SPEC-SC-06
      url: (ctx) => `https://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do${ctx.rakutenSession}`,
      pageSelectors: ['form#form table.tbl-data-01'],   // OR 判定
      settleMs: 2000,
      requiresUserData: true,       // 0 件が利用者データ起因でもありうる（SPEC-SC-10）
      note: ''
    }
  ]
}
```

| フィールド | 必須 | 意味 |
| --- | --- | --- |
| `key` | ✓ | `menuSelectors` との突き合わせキー |
| `reach` | ✓ | `goto`（ツールが遷移）/ `tab`（人が開いたタブを探す）/ `after`（前段の操作の結果を見る） |
| `url` | `goto` のみ | 文字列または `(ctx) => string` |
| `frameUrl` | `tab` のみ | 対象フレームの URL 部分一致 |
| `pageSelectors` | ✓ | ページ識別セレクタ。**1つでもヒットすれば到達とみなす** |
| `settleMs` | — | 遷移後の待機ms。既定 2000（Content Script の固定待機 500/1500ms + 描画待ち） |
| `requiresUserData` | — | 真なら 0 件時の備考に「利用者データ不足の可能性」を自動付記する |
| `action` | — | 検証前に行う操作（TradingView の右クリック。SPEC-SC-11） |

- 要件: FR-12, FR-15
- 検証: `auto`（SPEC-SC-16 が `menuSelectors` との1対1を検査）

---

## SPEC-SC-05 ページ識別セレクタの初期値

**方針: 検出用セレクタの祖先（データ行を含まないページの骨格）を使う。**
利用者のデータが 0 件でも存在する要素を選ぶ。これにより FR-12 の3状態が分離できる。

### 楽天証券（`src/rakuten-cs.js`）

| 対象 | ページ識別セレクタ | 利用者データ依存 |
| --- | --- | --- |
| お気に入り | `form#form table.tbl-data-01` | ✓ |
| お気に入り編集 | `form table.tbl-data-01` | ✓ |
| 保有商品一覧・すべて | `div#table_possess_data` | ✓ |
| 保有商品一覧・国内株式 | `table#poss-tbl-sp` | ✓ |
| ランキング・売買代金 / 出来高 / 値上り・値下り / 信用残 | `div#str-main-inner div.mbody table.tbl-data-01` | — |
| ランキング・積立 | `div#str-main-inner table table.tbl-data-01` | — |
| ランキング・楽天内 | `div#daily-ranking, div#weekly-ranking, div#daily-ranking-margin, div#margin-oneday-ranking, div#sor-ranking` | — |
| 国内株式・個別銘柄 | `div#line1 h1.hdg-l1-01-title` | — |
| 国内株式・株価検索 | `div#line1 h1.hdg-l1-01-title` | — |

### その他

| サイト | 対象 | ページ識別セレクタ |
| --- | --- | --- |
| 楽天スーパースクリーナー | スーパースクリーナー | `div#resultpanel div.resulttablebox` |
| SBI証券 | 個別銘柄 | `div#main div.mgt15 div.trHead01 table.tbl01` |
| SBI証券 | ポートフォリオ | `div.middleArea2 div.middleAreaM2`（**`body.vsc-initialized` を含めない**。SPEC-SC-12） |
| SBI銘柄スクリーニング | スクリーナー | `div#root div.App div.Screener div.resultpane` |
| TradingView | チャート canvas / ツールバー挿入先 / オーバーレイレイヤー | `#header-toolbar-symbol-search, canvas` |
| TradingView | 右クリックメニュー | `div#overlap-manager-root` |

### 実測状況

| サイト | 状況 |
| --- | --- |
| TradingView | **実測済み・妥当**。`#header-toolbar-symbol-search, canvas` は 14 件、`div#overlap-manager-root` は 1 件ヒットした（推測値がそのまま当たった） |
| 楽天証券・SBI証券・スクリーナー2種 | **未検証**（ログイン／検索実行が要る）。祖先から起こした推測値のまま |

> 外れが判明したら `targets.mjs` だけを直す。検出用セレクタ側は直さない（そちらが唯一の情報源のため）。

### 誤った識別セレクタの自己検出

「ページ識別セレクタ 0 件 かつ 検出用セレクタ 1 件以上」は論理的に起こりえない組み合わせ。
この場合は判定を **正常** としたうえで、備考に `ページ識別セレクタの見直しが必要` と出力する。

- 要件: FR-12
- 検証: `manual`（実行後に結果表の「識別」列が 1 件以上であることを確認する。
  TradingView の4対象は確認済み。他サイトは未実施）

---

## SPEC-SC-06 対象ページへの到達方法

| `reach` | 動き | 到達できないとき |
| --- | --- | --- |
| `goto` | ツールが `page.goto()` する | 「ページを開けていない」 |
| `tab` | 準備フェーズで人が開いたページ/フレームを URL 部分一致で探す | 「未実施」 |
| `after` | 直前の対象で行った操作の結果をそのまま見る | 前段に従う |

### `tab` のフレーム選択と未実施判定

URL 部分一致だけでは対象ページを一意に決められない（SBI証券の個別銘柄とポートフォリオは
どちらも `sbisec.co.jp/ETGate`）。候補フレームを次の順で選ぶ。

| # | 条件 | 動き |
| --- | --- | --- |
| 1 | ページ識別セレクタが 1 件以上ヒットするフレーム | そのフレームを検証する（最優先） |
| 2 | 識別は 0 件だが検出用セレクタが 1 件以上ヒットするフレーム | そのフレームを検証する（フォールバック） |
| 3 | URL 一致フレームが 1 つも無い | **未実施**（`対象のタブが開かれていない`） |
| 4 | URL 一致フレームはあるが、識別・検出用セレクタとも全フレームで 0 件 | **未実施**（`対象のページが開かれていない（識別セレクタ・検出用セレクタともにヒットしない）`） |

4 を「破損」にしない理由: SBI の2ページを URL で区別できないため、片方しか開いていないときに
もう片方を必ず破損と誤報してしまう。**誤報を避ける代わりに見逃しが生じる**（SPEC-SC-18）。

### サイト別の到達方法

| サイト | 対象 | `reach` | 根拠 |
| --- | --- | --- | --- |
| 楽天証券 | 12ページ | `goto` | セッション付き URL を組み立てられる（FR-15「12ページを手で開かずに済む」） |
| 楽天スーパースクリーナー | 1 | `tab` | 結果一覧の表示に検索の実行が要る。フォーム送信は CON-10 で禁止 |
| SBI証券 | 2 | `tab` | ETGate の URL がセッション・遷移経路に依存し、URL 直打ちで再現できない |
| SBI銘柄スクリーニング | 1 | `tab` | 楽天スクリーナーと同じ理由 |
| TradingView | 4 | `goto` / `after` | 公開チャートは URL で到達できる |

### 楽天証券のセッション借用

準備フェーズ完了後、開いているページのうち URL が `https://member.rakuten-sec.co.jp/` で始まるものを探し、
**`.do` の直後から `?` の手前までのパスパラメータ列**（`;BV_SessionID=…;BV_EngineID=…`）をそのまま取り出して
各対象の URL に付ける。`service_worker.js` の `getRakutenSecUrlAsync()` と同じ借用方式（CON-04）。

- 見つからない場合、楽天証券の12対象はすべて「未実施」（FR-16）
- 取り出したセッション文字列は**結果ファイルに一切出力しない**（SPEC-SC-14）

`goto` する URL は `menuSelectors[].url` のパス部分に上記を連結して作る。
個別銘柄・株価検索はクエリを付ける（`?eventType=init&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01`）。

- 要件: FR-15, CON-04, CON-10
- 検証: `manual`（楽天にログインして実行し、12対象の「識別」列が 1 件以上になること。**未実施**）

---

## SPEC-SC-07 実行フロー

| # | ステップ | 担当 | 失敗時 |
| --- | --- | --- | --- |
| 1 | `menuSelectors` を5ファイルから読み、`targets.mjs` と突き合わせる | ツール | 中止・終了コード 3（結果ファイルは書かない） |
| 2 | 一時プロファイルを作り、拡張機能を読み込んだブラウザを**ヘッド有り**で起動 | ツール | 同上 |
| 3 | 準備手順を端末に出力し、タブを開く（楽天ログイン / SBI ログイン / TradingView） | ツール | — |
| 4 | 人がログインし、`tab` 対象のページ（スクリーナーは検索実行後）を開く | **人** | 開かなければその対象は「未実施」 |
| 5 | 端末で **Enter** を押す（合図。時間制限なし） | **人** | — |
| 6 | 対象を上から順に検証する | ツール | 対象単位で捕捉し、**次の対象へ進む**（FR-15） |
| 7 | `docs/SELECTOR-CHECK.md` を上書き生成する | ツール | 終了コード 3 |
| 8 | ブラウザを閉じ、一時プロファイルを削除する | ツール | SPEC-SC-08 |
| 9 | 判定に応じた終了コードで終了する | ツール | — |

- 合図は **stdin の Enter 1回**（`readline`）。全サイトのログインが済んでから1回だけ押す。
  待機に時間制限を設けない（FR-15）。`page.pause()`（Inspector 依存）や専用ページは使わない
- 対象ごとの Playwright 操作には `page.setDefaultTimeout(15000)` を設定する。
  **ステップ5の待機だけはタイムアウトしない**
- ステップ3で表示する準備手順には、`tab` 対象のページ名と、
  楽天証券の「お気に入りに1銘柄以上を登録しておくこと」を含める（SPEC-SC-10 の誤判定回避）

- 要件: FR-15, FR-16, CON-10
- 検証: `manual`（ログインせずに Enter を押しても TradingView の結果が出て完走すること = FR-16。
  2026-08-23 に確認済み）

---

## SPEC-SC-08 一時プロファイルの生成と破棄

```js
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabu-selector-check-'))
```

- 拡張機能の読み込みには `launchPersistentContext` が必要で `userDataDir` を避けられない。
  よって**毎回使い捨てる**（NFR-12）
- 起動引数は `tests/fixtures/extension.mjs` と同じ（`--disable-extensions-except` / `--load-extension`）。
  `headless: false`、`channel` は `chromium`（環境変数 `SELECTOR_CHECK_CHANNEL` で `chrome` に差し替え可）
- リポジトリ配下にプロファイルを作らない。ダウンロード・トレース・スクリーンショットを保存しない

### 後始末（異常終了を含む）

`cleanup()` は冪等（`fs.rmSync(dir, { recursive: true, force: true })`）。
後始末はどの経路からも `finalCleanup()` = **`killBrowsers()` → `cleanup()`** の順で行う。

| 経路 | 実装 | 効果 |
| --- | --- | --- |
| 正常終了・例外 | `try { … } finally { finalCleanup() }` | 判定に応じた終了コード |
| `SIGINT` / `SIGTERM` | `process.on('SIGINT' / 'SIGTERM')` → `shutdown()` | 終了コード 130 / 143 |
| `SIGHUP`（端末を閉じた・SSH 切断） | `process.on('SIGHUP')` → 同じ `shutdown()` | 終了コード 129 |
| 端末での `Ctrl+C` | `rl.on('SIGINT')`（Enter 待ちの readline）→ 同じ `shutdown()` | 終了コード 130 |
| 捕捉漏れ | `process.on('uncaughtException' / 'unhandledRejection')` → `finalCleanup()` | 終了コード 3 |
| **ブラウザの停止** | `pkill -9 -f <userDataDir>`（パスは ERE エスケープ済み。`win32` では no-op） | SIGKILL 後はプロファイルへの書き戻しが起きない |
| 保険 | `process.on('exit')` → **同期の** `rmSync`（ブラウザ起動後にも再登録する） | 取りこぼしの回収 |

### 削除の順序を保証しているもの

**`killBrowsers()` の `pkill -9 -f <userDataDir>`**（`index.mjs` 68-75 行）。
中断時は Playwright の後始末が非同期で、こちらが先に終了するため、
生き残った Chromium がプロファイルを書き戻して残骸になる。`--user-data-dir` にこの実行専用の
一時パスが入っているのでそれを目印に SIGKILL し、**書き戻しの窓を原理的に消す**。

`process.on('exit')` をブラウザ起動後に再登録するのは**保険**であって、順序の保証ではない。
実測では再登録だけでは `SIGTERM` を取りこぼす。

### シグナル登録の注意

- `process.on('SIGINT')` だけでは足りない。端末（TTY）では Enter 待ちの `readline` が raw モードに
  するため、`Ctrl+C` はカーネルの `SIGINT` ではなく **readline の `'SIGINT'` イベント**として届く。
  両経路とも同一の `shutdown()` を呼ぶ
- `SIGHUP` は**明示登録が必須**。Node はリスナーが無い `SIGHUP` を受けると
  `exit` ハンドラを実行せずに終了するため、`process.on('exit')` の保険も効かない
- `shutdown()` は多重呼び出しを弾き、raw モードを戻すために先に `rl.close()` する
- `cleanup()` は終了しかけの Chromium がロックファイルを書き戻すことがあるため、
  削除を最大3回試し、毎回 `existsSync` で確認する

### 残存の検査

**正常終了・中断のどちらの経路でも**、終了直前に `fs.existsSync(userDataDir) === false` を検査する。
残っていれば `❌ 一時プロファイルが削除できていません: <パス>` を stderr に出し、
**終了コード 3** とする（中断由来の 129 / 130 / 143 より残骸の報告を優先する）。

- 要件: NFR-12
- 検証: `auto`（`検証ツールの中断 › …` 4件。`--dry-run` で Enter 待ちまで進め、
  `SIGINT` / `SIGTERM` / `SIGHUP` / 端末の `Ctrl+C` を送って終了コードとプロファイル削除を確認する）／
  `manual`（実行後に `ls $TMPDIR | grep kabu-selector-check` が空であること）

> 自動テストは `--dry-run`（ブラウザを起動しない）で回すため、**Chromium プロセスの終了自体は
> 自動テストの対象外**。手動で確認する: 中断後に `pgrep -f kabu-selector-check` が空であること。

---

## SPEC-SC-09 セレクタの評価方法

検出用セレクタには jQuery 独自拡張（`:contains()`, `:first`, `[aria-hidden!="true"]`）が含まれるため、
`document.querySelectorAll` では評価できない。**同梱の jQuery で評価する。**

### 注入方法: 関数に包んで登録し、初回評価時に遅延実行する

1. 同梱 `src/third-party/jquery.min.js` の中身を**関数の中に包んだ**文字列を組み立て、
   `context.addInitScript({ content })` で全ページ・全フレームに登録する
   （CDP 経由の注入なのでサイト側の CSP に阻まれない。外部からは取得しない = CON-07）

   ```js
   window.__kabuCheckLoad = function () {
     /* jquery.min.js の中身 */
     window.__kabuCheck$ = window.jQuery.noConflict(true)
   }
   window.__kabuCheckJq = function () {
     if (typeof window.__kabuCheck$ !== 'function') window.__kabuCheckLoad()
     return window.__kabuCheck$
   }
   ```

2. 件数は `frame.evaluate((s) => window.__kabuCheckJq()(s).length, selector)` で取る。
   **jQuery 本体はこの最初の呼び出し時に初めて評価される**
3. `window.__kabuCheckJq` が未定義のフレームは**未到達**として扱い、破損と区別する
4. 評価が例外になった場合は**破損**として扱い、備考に例外メッセージの先頭120文字を記録する

`addInitScript({ path })` で jQuery をそのまま登録しない理由:

| | 理由 |
| --- | --- |
| **必須** | 初期化スクリプトは document-start で走る。jQuery 4 はこの時点で `document.documentElement` が無く、評価すると `TypeError` になる |
| 副次 | ツールがセレクタを評価しない限りサイトの `window` に触れない（NFR-01） |
| 副次 | `noConflict(true)` の実行がサイト本来の `$` が確定した後になるため、復元が正確になる |

`launchPersistentContext` が自動で開く初期ページは初期化スクリプトの登録前に生成されており
jQuery が入らない。登録後に作業用ページを新規に開き、それ以外のページは閉じる。

### 参考値（判定には使わない）

拡張機能を読み込んで実行するため、注入結果そのものも数えて結果表の「注入」列に出す。

| サイト | 数えるもの |
| --- | --- |
| 楽天・SBI | `span.x-kabu-root` |
| TradingView | `div.ktt-tv-kabuLinkMenu` / `tr[data-kabu-tantan]` |

「検出用セレクタは 1 件以上ヒットするのに注入が 0 件」は、セレクタ以外の原因（待機時間・設定・例外）を示す。

- 要件: FR-12, CON-07, NFR-01
- 検証: `manual`（`npm run check:selectors -- --only=tradingview` が完走し、
  4対象すべてに判定（✅ / ❌）が付き、「識別」「ヒット」列に件数が入ること）

> 「注入」列は 2026-08-23 の実測で全対象 0 件。TradingView 側の DOM 改修で
> ツールバー挿入先・右クリックメニューが破損しているため（FR-04 の課題）。
> **注入 0 件はこの仕様の検証条件にしない。**

---

## SPEC-SC-10 判定規則

| ページ識別 | 検出用セレクタ | 判定 | 記号 |
| --- | --- | --- | --- |
| 1件以上 | 1件以上 | 正常 | ✅ |
| 1件以上 | 0件 | **破損** | ❌ |
| 0件 | 0件 | ページを開けていない | ⚠️ |
| 0件 | 1件以上 | 正常（＋識別セレクタ見直しの警告） | ✅ |
| — | — | 未実施（下表） | — |

### 未実施になる条件

| 条件 | 理由文 |
| --- | --- |
| `--only` で除外した | `` `--only` の対象外`` |
| 楽天証券にログイン済みのタブが無い（12対象すべて） | `楽天証券にログインしていない` |
| `reach: 'tab'` で URL 一致フレームが無い | `対象のタブが開かれていない` |
| `reach: 'tab'` で URL 一致フレームはあるが、**識別セレクタ・検出用セレクタともに 0 件** | `対象のページが開かれていない（識別セレクタ・検出用セレクタともにヒットしない）` |
| `reach: 'after'` で前段のフレームが無い | `前段の対象に到達できていない` |

4行目（識別・検出用ともに 0 件）は**破損にも未到達にもしない**。SBI証券の2ページが同一 URL（ETGate）で区別できず、
片方しか開いていないときに他方を破損と誤報するため（SPEC-SC-06）。見逃しの副作用は SPEC-SC-18。

補足規則:

- `requiresUserData: true` の対象が **破損** になった場合、備考に
  `利用者データ（お気に入り・保有銘柄）が 0 件でも同じ結果になる。登録状況を確認すること` を自動付記する。
  判定は安全側に倒して**破損のまま**とする
- セレクタ評価の例外は **破損**
- 遷移そのものの失敗（タイムアウト・ネットワークエラー）は **ページを開けていない**

- 要件: FR-12
- 検証: `manual`（既知の状態から逆算して確認する。SBI の2ページを開かずに実行すると
  どちらも「未実施」になることは 2026-08-23 の実行で確認済み）

---

## SPEC-SC-11 TradingView の検証手順

| # | 手順 | 検証する対象 |
| --- | --- | --- |
| 1 | `https://jp.tradingview.com/chart/?symbol=TSE%3A7203` へ `goto`。`settleMs` は 5000 | — |
| 2 | チャート canvas の件数を数え、`aria-label` の先頭が `TSE:` / `TSE_DLY:` のいずれかかを判定 | チャート canvas |
| 3 | ツールバー挿入先の件数を数える | ツールバー挿入先 |
| 4 | canvas の**中央**で右クリック（`click({ button: 'right' })`）。500ms 待つ | — |
| 5 | オーバーレイレイヤーの件数を数える | オーバーレイレイヤー |
| 6 | 右クリックメニュー本体の件数を数える | 右クリックメニュー |
| 7 | `Escape` を押してメニューを閉じる | — |
| 8 | `?symbol=BATS%3AAAPL` へ `goto` し、`aria-label` の先頭が `BATS:` かを判定 | （米国株の補足検査） |

- **メニュー項目は選択しない**（CON-10）
- 右クリックはチャート領域中央に対して行う（価格軸・時間軸を避ける）
- 銘柄は URL クエリで切り替える。TradingView の UI 操作（シンボル検索フォーム）は使わない
- `aria-label` は**全文を出力しない**。接頭辞の判定結果（`TSE:` で始まる = はい/いいえ）だけを記録する（NFR-12）
- TradingView はログイン不要。楽天・SBI にログインしなくても必ず実施する（FR-16）

- 要件: FR-04, FR-12, FR-16, CON-08, CON-10
- 検証: `manual`（`npm run check:selectors -- --only=tradingview` が完走し、
  4対象すべてに判定が付くこと。ログイン不要なので誰でも実施できる）

> 2026-08-23 の実測: チャート canvas ✅（`aria-label` は `TSE_DLY:` / 米国株では `BATS:` で始まる）、
> オーバーレイレイヤー ✅、**ツールバー挿入先 ❌ / 右クリックメニュー ❌**。
> TradingView 側の DOM 改修による破損で、ツールの不具合ではない。修正は FR-04 側の課題。

---

## SPEC-SC-12 SBI証券ポートフォリオの追加検査

FR-03 の既知課題（`body.vsc-initialized` 依存）に白黒をつけるため、
ポートフォリオの対象では以下を追加で記録する。

| 記録項目 | 取得方法 |
| --- | --- |
| `body.vsc-initialized` の有無 | `document.body.classList.contains('vsc-initialized')` |
| クラスを外したセレクタのヒット件数 | 検出用セレクタの先頭から `body.vsc-initialized`（と続く空白）を取り除いた文字列で再評価 |

判定の読み方:

| 付与 | 元のセレクタ | 外したセレクタ | 結論 |
| --- | --- | --- | --- |
| 有 | 1件以上 | 1件以上 | 現状は動く。ただし他拡張に依存している |
| 無 | 0件 | 1件以上 | **`body.vsc-initialized` が原因。セレクタから外すべき**（FR-03 の課題が確定） |
| 無 | 0件 | 0件 | SBI 側の DOM 変更。別途調査 |

> 「外したセレクタ」は検証ツールが元のセレクタから機械的に生成する。文字列を書き写さない（NFR-13）。

- 要件: FR-03, FR-12
- 検証: `manual`（SBI にログインしてポートフォリオを開いた状態で実行し、結果ファイルの
  「ポートフォリオの追加検査」表を読む。**未実施** — FR-03 の課題は未決着のまま）

---

## SPEC-SC-13 結果ファイル `docs/SELECTOR-CHECK.md`

- 出力先は既定で `docs/SELECTOR-CHECK.md`。**毎回全体を上書きする**（履歴は git で追う。FR-17）
- git 管理下に置く。`npm run check` の対象にはしない（CON-10）が、
  `npm run lint:md` の対象にはなるため **markdownlint を通る書式で生成する**
  （表の区切りは `| --- |`、見出しの前後に空行、末尾に改行）

### 書式

```markdown
# セレクタ検証結果

> このファイルは `npm run check:selectors` が生成する。手で編集しない。
> 実行のたびに全体を上書きする（履歴は git で追う）。

| | |
| --- | --- |
| 実行日時 | 2026-08-23 21:05 (JST) |
| 拡張機能バージョン | 1.10.0 |
| Chromium | 141.0.7390.37 |
| 総合判定 | ❌ 破損 1 件 / 未到達 0 件 / 未実施 2 件 |

## サマリ

| サイト | 対象 | ✅ 正常 | ❌ 破損 | ⚠️ 未到達 | — 未実施 |
| --- | --- | --- | --- | --- | --- |
| 楽天証券 | 12 | 12 | 0 | 0 | 0 |
| 楽天スーパースクリーナー | 1 | 0 | 0 | 0 | 1 |
| SBI証券 | 2 | 1 | 1 | 0 | 0 |
| SBI銘柄スクリーニング | 1 | 0 | 0 | 0 | 1 |
| TradingView | 4 | 4 | 0 | 0 | 0 |

## 楽天証券

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| お気に入り | ✅ | 1 | 24 | 24 | |

### 検証したセレクタ（楽天証券）

| ページ | 検出用セレクタ |
| --- | --- |
| お気に入り | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |

## SBI証券

（同じ形式の表）

### ポートフォリオの追加検査

| 項目 | 結果 |
| --- | --- |
| `body.vsc-initialized` | 付与されていない |
| `body.vsc-initialized` を外したセレクタ | 18 件 |
| 結論 | `body.vsc-initialized` への依存が原因。セレクタから外すべき |

## TradingView

| 対象 | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| チャート canvas | ✅ | 1 | 1 | 1 | `aria-label` は `TSE:` で始まる |

## 未実施の対象

| サイト | 対象 | 理由 |
| --- | --- | --- |
| 楽天スーパースクリーナー | スーパースクリーナー | 対象のタブが開かれていない |
```

- 要件: FR-17
- 検証: `manual`（生成後に `npm run lint:md` が通ること）

---

## SPEC-SC-14 出力に含めない情報

以下は結果ファイル・標準出力のいずれにも出さない（NFR-12, CON-03）。

| 出さないもの | 理由 |
| --- | --- |
| URL（セッションID・口座情報を含む） | ページ名だけを出す |
| Cookie・localStorage・認証情報 | 取得もしない |
| ページ本文・銘柄名・保有数量・HTML・スクリーンショット | 件数だけを出す |
| `aria-label` の全文 | 接頭辞の判定結果のみ |

例外的に出してよいのは、**セレクタ文字列・件数・判定・例外メッセージ**のみ。
結果の書き出しは許可した項目だけを組み立てる実装（ホワイトリスト）にする。

- 要件: NFR-12, FR-17, CON-03
- 検証: `manual`（生成された `docs/SELECTOR-CHECK.md` を `grep -i 'BV_SessionID\|cookie\|http'` して、
  ヒットが説明文中の URL 以外に無いこと）

---

## SPEC-SC-15 終了コード

| コード | 条件 |
| --- | --- |
| `0` | 破損 0 件 かつ 未到達 0 件（未実施はあってもよい。FR-16） |
| `1` | **破損が 1 件以上** |
| `2` | 破損 0 件だが 未到達が 1 件以上 |
| `3` | ツールの実行エラー（**引数の誤り**・定義の突き合わせ失敗・ブラウザ起動失敗・結果書き出し失敗・プロファイル削除失敗） |
| `129` / `130` / `143` | `SIGHUP` / `SIGINT` / `SIGTERM` による中断（後始末は実施済み）。ただし一時プロファイルが残った場合は `3` |

終了時に1行サマリを stdout に出す: `❌ 破損 1 件 / ⚠️ 未到達 0 件 / — 未実施 2 件 → docs/SELECTOR-CHECK.md`

引数の誤りは**ブラウザを起動する前**に判定し、stderr にメッセージと使い方を出して終了コード 3 とする。

| 入力 | stderr のメッセージ |
| --- | --- |
| `--only=xxx`（未知のサイトキー） | `--only の対象外の値です: xxx（有効: rakuten / rakuten-scr / sbi / sbi-scr / tradingview）` |
| `--only tradingview`（`=` 無し） | `--only は = でつなげて指定します（例: --only=…）` |
| 未知のオプション | `知らないオプションです: …` |

- 要件: FR-12（判定3）
- 検証: `manual`（`npm run check:selectors -- --only=tradingview; echo $?`）

---

## SPEC-SC-16 検証ツールの自動テスト

`tests/selector-defs.spec.mjs`（ブラウザを起動しない。Node のみで完結）

### `セレクタ定義` — 5件（NFR-13 の機械的な担保）

| # | テスト |
| --- | --- |
| 1 | 5本の Content Script すべてから `menuSelectors` を取り出せる |
| 2 | 全エントリが文字列の `title` と `selector` を持つ |
| 3 | 楽天証券の全エントリが `url` を持ち、TradingView の全エントリが `key` を持つ |
| 4 | `targets.mjs` の対象と `menuSelectors` が `key ?? title` で1対1に対応する（欠け・余りが無い） |
| 5 | `targets.mjs` のどの対象も `selector` フィールドを持たない（NFR-13 の二重管理禁止） |

セレクタを直しても検証側の修正が不要であること、逆に `menuSelectors` の構造を壊したら
`npm test` が落ちることを保証する。

### `検証ツールの中断` — 4件（SPEC-SC-08 の担保）

CLI を `--dry-run --only=tradingview` で子プロセスとして起動し、Enter 待ちになったところへ割り込む。

| # | 割り込み | 期待 |
| --- | --- | --- |
| 6 | `SIGINT` | 終了コード 130・一時プロファイルが残らない |
| 7 | `SIGTERM` | 終了コード 143・一時プロファイルが残らない |
| 8 | `SIGHUP` | 終了コード 129・一時プロファイルが残らない |
| 9 | 端末の `Ctrl+C`（`SELECTOR_CHECK_FORCE_TERMINAL=1` + stdin へ `\x03`） | 終了コード 130・一時プロファイルが残らない |

一時プロファイルのパスは子プロセスの stdout（`一時プロファイル: …`）から取る。

> ログインが要る部分は自動テストにできない（CON-10）。ブラウザを起動する経路の確認は手動（SPEC-SC-01, 07）。

- 要件: NFR-13, NFR-12, NFR-08
- 検証: `auto`（`セレクタ定義 › …` 5件 + `検証ツールの中断 › …` 4件）

---

## SPEC-SC-17 ファイル構成

```text
scripts/selector-check/
├── index.mjs           # CLI・実行フロー・終了コード（SPEC-SC-01, 07, 15）
├── load-selectors.mjs  # src/*-cs.js からの読み出し（SPEC-SC-03）
├── targets.mjs         # 到達方法・ページ識別セレクタ（SPEC-SC-04, 05, 06）
├── check.mjs           # 1対象の検証と判定（SPEC-SC-09, 10, 11, 12）
└── report.mjs          # docs/SELECTOR-CHECK.md の生成（SPEC-SC-13, 14）
```

`package.json`:

```json
"check:selectors": "node scripts/selector-check/index.mjs"
```

`npm run check` には**足さない**（CON-10）。

- 要件: CON-10, CON-02
- 検証: `lint`（`scripts/**/*.mjs` は既存の ESLint 設定の対象）

---

## SPEC-SC-18 既知の限界

| 限界 | 理由 | 影響 |
| --- | --- | --- |
| スクリーナー2種は人がページを用意する | 結果一覧の表示に検索の実行（フォーム送信）が要る。CON-10 で禁止 | 用意しなければ「未実施」 |
| SBI証券の2ページは人がページを用意する | ETGate の URL がセッション・遷移経路依存で URL 直打ちできない | 同上。FR-15「遷移は自動」を部分的に満たさない |
| 楽天の遷移 URL は未検証 | ログインが要るため一度も実行していない | 「ページを開けていない」が出たら `targets.mjs` を直す |
| Windows では一時プロファイルが残りうる | `killBrowsers()` は `win32` で no-op。生き残った Chromium がファイルを掴んだままだと `rmSync` が失敗する | 終了コード 3 と残存パスを報告して気づけるようにするだけ。削除は手で行う |
| **同一 URL の2ページは破損を見逃す** | SBI の個別銘柄・ポートフォリオはどちらも `ETGate` で、URL でフレームを区別できない。両セレクタとも 0 件のとき「未実施」にしている（SPEC-SC-06 / SPEC-SC-10） | SBI が本当に DOM を変えた場合も「未実施」に埋もれる。**終了コードも 0 系になり気づけない。** SBI の2ページは結果を見て「未実施」なら必ず手で開き直して再実行する |
| お気に入り・保有一覧はデータが無いと破損に見える | ページ骨格だけでは 0 件の理由を区別できない | 備考で注意喚起（SPEC-SC-10） |
| `key ?? title` の突き合わせ | `title` を変えると `targets.mjs` の修正が要る | `npm test`（SPEC-SC-16）が即座に検出する |

- 要件: FR-15, CON-10
- 検証: `manual`

---

## SPEC-SC-19 関連ドキュメントとの対応

実装と同時に以下を更新済み。**内容を変えるときは両方を揃える。**

| ファイル | 記述内容 |
| --- | --- |
| `docs/TESTING.md` | 「3層の切り分け」表の**半自動**行が `npm run check:selectors` を指す。節「半自動: 実サイトのセレクタ検証」に実行手順・準備・4値の読み方・終了コード・`npm run check` に含めない理由（CON-10）がある |
| `docs/MANUAL-CHECKLIST.md` | 「変更箇所 → 実施するセクション」表の `rakuten-cs.js` / `sbi-cs.js` 行が `npm run check:selectors`（結果が ⚠️/未実施 の項目だけ **C** を実施）。<br>**C** はツール結果（`docs/SELECTOR-CHECK.md`）を参照する形。C-2・C-4 は「検索を実行したタブを開いたまま実行する」手順。<br>**A-1 / A-5 / A-8** に「前提の検出用セレクタは `npm run check:selectors` が機械判定する。ここでは表示位置・文言・見た目を目視する」の注記がある |
| `docs/README.md` | `docs/` 構成図に `SELECTOR-CHECK.md`（生成物）・`specs/selector-check.md`・`adr/` がある |
| `docs/ARCHITECTURE.md` | 「検出用セレクタの単一情報源」節に `src/*-cs.js` 側の契約がある |
| `scripts/test-catalog.mjs` | `FILE_INFO` に `selector-defs.spec.mjs`（`specs: 'SPEC-SC'`）がある。テストを増減したら `npm run docs:tests` を再実行する |
| `docs/requirements/*` | **architect / developer は触らない。** FR-12 等の状態更新は analyst の担当 |

- 要件: FR-17, NFR-08
- 検証: `manual`（`npm run lint:md` と `npm run docs:tests:check` が通ること）

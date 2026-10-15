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

`EXTENSION_PATH` を指定して `npm run check` を流しても、作業ツリーの `src/` を試していないので、
全件のチェックが通った記録（`.claude/check-passed.json`。[WORKFLOW.md](WORKFLOW.md)「全件のチェックを同じ作業ツリーで2回流さない」）は残さない。

## 何をどう検証するか（3層の切り分け）

**すべてを自動化しようとしない。** 壊れやすさ・静かに壊れるか・自動化コストで層を分ける。

| 層 | 対象 | 手段 | 実行 |
| --- | --- | --- | --- |
| **自動** | ロジック / オプションページ / 楽天・SBI・スクリーナー2種の注入 / メニュー項目のクリック範囲 / 注入の再試行 / **切断状態（拡張機能の再読み込み後の古いタブ）** / セレクタ定義の整合性 / 中断時の後始末 / **TradingView で拡張が自分で作った DOM の振る舞い** | Playwright（件数は [TEST-CATALOG.md](TEST-CATALOG.md)） | `npm test`（約3分。2026-10-12 に 187件で 3.1〜3.2分。切断状態などの17件を足す前は 170件で 2.2分） |
| **半自動** | 実サイトのセレクタ健全性 | 利用者がログイン → 自動で検証 | `npm run check:selectors` |
| **手動** | **サイト側の** DOM・見た目・挙動（TradingView の挿入先・模倣した見た目・サイト側メニュー）／ 証券会社セッション連携 | チェックリスト | [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) |

> **層は「サイトごと」ではなく「誰の持ち物か」で分ける**（2026-08-30 に `CON-08` を改訂）。
> **拡張が自分で生成した DOM の振る舞いは、サイトの都合では変わらない**ので自動でよい。
> **サイト側の DOM に依存するものだけが半自動・手動に残る。**

判断基準:

| 条件 | 層 |
| --- | --- |
| ログイン不要 かつ DOM が安定 かつ 静かに壊れる | **自動**。最優先で自動化する |
| ログインが要る が 検証自体は機械的 | **半自動**。ログインだけ人力にする |
| **サイト側の** DOM が毎リリース変わる（実在するかを見たい） | **半自動**。フィクスチャでは判定できない（`CON-08`） |
| **拡張が自分で作った** DOM の振る舞い（サイト側は器だけ） | **自動**。サイトの都合では変わらない（`CON-08` の 2026-08-30 改訂） |
| 見た目の妥当性（配色・読みやすさ） | **手動**。機械では判定できない |

自動テストは **ファイル単位で** `src/` の JS 10本・2991行の**すべて**を読み込んで実行している（行カバレッジではない。行単位の計測はしていない）。

| ファイル | 行数 | 読み込むテスト |
| --- | --- | --- |
| `service_worker.js` | 586 | `service-worker.spec.mjs`（Service Worker 上で直接呼ぶ） |
| `urls.js` | 388 | `service-worker.spec.mjs`（`importScripts` 経由）／ `options.spec.mjs`（`options.html` が読み込む）／ Content Script を動かす全テスト（`disconnected.spec.mjs` は `isExtensionAlive()` と `retrySetup()` の切断時の経路を通す） |
| `tradingview-cs.js` | 1101 | `tradingview.spec.mjs` / `disconnected.spec.mjs`（フィクスチャ上で実行）／ `content-script.spec.mjs`（`node:vm` で `isSymbolShaped` / `parseExchangeSymbol` を取り出す）／ `selector-defs.spec.mjs`（`menuSelectors`）／ `service-worker.spec.mjs`（ソースを文字列として読み、正規表現リテラルを照合する。実行はしない） |
| `rakuten-cs.js` | 225 | `content-script.spec.mjs` / `disconnected.spec.mjs`（フィクスチャ上で実行）／ `selector-defs.spec.mjs` |
| `rakuten-scr-cs.js` | 149 | 同上 |
| `sbi-cs.js` | 123 | 同上 |
| `sbi-scr-cs.js` | 147 | 同上 |
| `options.js` | 116 | `options.spec.mjs` |
| `linkMenu.js` | 76 | `content-script.spec.mjs`（楽天・SBI 系の注入を通して） |
| `notice.js` | 80 | `notice.spec.mjs`（Service Worker のクリック処理から実際に小窓を開く／`notice.html` に直接遷移する） |

**ファイル単位で 100% でも、`tradingview-cs.js` は中身の一部しか検査していない。**
1.20.0 で `tests/tradingview.spec.mjs` が入り、**拡張が自分で作った DOM の振る舞い**（入れ子メニューのクリック範囲・
縦位置の補正・証券会社の項目が URL を DOM に出さないこと）をフィクスチャで見るようになった（`FR-26` の段階1・2。SPEC-CS-27）。
**サイト側の DOM・見た目・挙動**（挿入先が実在するか・模倣した見た目・サイト側メニュー）は上表の「半自動」「手動」条件に該当し、
`npm run check:selectors` と [MANUAL-CHECKLIST.md](MANUAL-CHECKLIST.md) の A が見る。
2026-10-12 に、「株Link」ボタンの表示の切り替え（A-8 の拡張側・A-12）とボタンメニューの 0 件・証券会社のタブの有無（A-7b の最終行・B-1）も加わった（`FR-26` の段階4・5 の一部）。
拡張側の振る舞い（`FR-26` の (a)）は、2026-10-15 にすべて自動テストへ移した（段階3〜5）。A の手動確認に残るのは、サイト側に依存する (b) だけ。
**`tradingview.spec.mjs` が緑でも実サイトが壊れていない根拠にはならない**（`CON-08`）。

> 2026-10-11 まではこう書いていた: 「`src/` の JS 2701行中 1652行（61%）を対象にしている。
> 残り 39% は `tradingview-cs.js`（1049行）だけで、上表の『手動』条件に該当する」。1.20.0 で `tests/tradingview.spec.mjs` が入った時点で失効していた。
>
> 数値は `wc -l src/*.js` から出している（2026-10-11 / 1.20.3）。どのテストがどのファイルを読み込むかは
> `tests/` と `tests/fixtures/` を読んで確かめた。`src/` や `tests/` を触ったら数え直すこと。

スクリーナー2種（`rakuten-scr-cs.js` / `sbi-scr-cs.js`）は 1.13.0 で自動の対象に移した。
FR-13（注入の再試行）で常設監視の対象を `document.body` に上げたため、
**「検索より先にタブを開くと以降まったく注入されない」経路をフィクスチャで再現できる**
ようになったのが理由（`tests/content-script.spec.mjs` の `スクリーナー Content Script`）。
DOM はサイト側の構造に依存したままなので、見た目と実 DOM の確認は引き続き
`npm run check:selectors` と手動確認 C-2 / C-4 で行う。

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
2. **人がログインする**（楽天証券 / SBI証券）。ツールはログインを代行しない（CON-04, CON-10）。
   **楽天証券はログイン後のタブを閉じない**（このタブの URL からセッションを借用する。SPEC-SC-06）
3. `reach: 'tab'` の対象（楽天スーパースクリーナー / SBI証券の2ページ / SBI銘柄スクリーニング）は
   **人が対象ページを開いておく**。スクリーナーは検索を実行し結果一覧が出た状態にする
4. 端末で **Enter** を1回押す（時間制限なし）
5. 楽天証券の14ページと TradingView はツールが自動で遷移して判定する
6. 結果が `docs/SELECTOR-CHECK.md` に上書き生成され、ブラウザと一時プロファイルが破棄される

> 楽天証券のセッションは、開いているタブの URL から借用する（`service_worker.js` と同じ方式）。
> **借用した文字列も URL も結果ファイルには出力しない**（NFR-12）。
> お気に入り・保有銘柄が 0 件だと「破損」と区別できないため、
> 1銘柄以上を登録した口座で実行する（0件のときは備考に注意が出る）。
> **お気に入りは国内株・米国株の両方**（1.18.0 で米国株の2ページが対象に加わった）。

### 結果の読み方（4値）

| 記号 | 意味 | やること |
| --- | --- | --- |
| ✅ 正常 | ページに到達し、検出用セレクタが1件以上ヒットした | なし |
| ❌ 破損 | **ページに到達したと判断できるのに**検出用セレクタが 0 件 | **まず手がかりの題名が対象ページのものかを読む。** そのうえでサイト改修を疑い、実 DOM を見てセレクタを直す |
| ⚠️ 未到達 | ページに到達したと判断できない（題名が未到達の目印に当たる／題名から判断できない） | 遷移に失敗したか、ログイン・エラー画面に飛ばされた。`targets.mjs` の到達方法を疑う |
| — 未実施 | `--only` で除外・ログインしていない・対象のタブが開かれていない | 必要なら準備して再実行する |
| 👤 対象外 | **ツールの仕組みでは到達できない**ため人が確認する（1.19.0〜） | `docs/MANUAL-CHECKLIST.md` の該当項目を見る。**破損・未到達・未実施のどれにも数えない**ので、終了コードにも影響しない |

「識別」列はページ識別セレクタ、「ヒット」列は検出用セレクタ、
「注入」列は拡張機能が実際に挿入した要素の数（参考値。判定には使わない）。

#### TradingView では、件数のほかに2つ見る（2026-10-15〜）

| 行 | 見ること | 読み方 |
| --- | --- | --- |
| ウォッチリストの行 | 実サイトの行が今も拡張の読む属性（`watchlistSymbolAttrs`）を持つか。**行は右クリックしない**（CON-10 の許容表に無い） | 「ヒット」が行の数（未ログインの公開チャートで 18 件。2026-10-15）。拡張は行に何も足さないので「注入」は `—`。0 件なら ❌ |
| 右クリックメニュー | 備考の**入れ子の隙間**（親メニューの外枠の端 − 親行の端。入れ子は開かずに測る） | `入れ子の隙間は 0px` なら、親行から入れ子へゆっくり移っても閉じない。`要確認: … Npx` なら、猶予より長くかけて越えると閉じる。判定は変えない |

TradingView 自身のメニューのキー操作と、入れ子が閉じるまでの猶予（150ms）の体感は、どこでも見ない（2026-10-15 の本人の判断。気づいたら報告）。
行の要素が使い回されるときに属性が追随するかは、手動確認 A-19 が見る。

#### 楽天証券の14対象は実測クエリ付きの直打ちで開く（1.18.0〜）

お気に入り2・お気に入り編集2・保有商品一覧2 の6対象は、1.17.0 まで
**組み立てる URL にクエリが無かった**ためエラー画面に飛ばされ、⚠️ のままだった。
1.18.0 で**利用者のアドレスバーどおりのクエリ**を付け直し、
**8回目版（2026-09-01 14:01 / 1.18.1）で楽天14ページ中13が ✅・未到達 0 件**になった
（SPEC-SC-06 / ADR-0011 の 13）。

**残っていた ❌（株価検索）は破損ではなかった。** 検索が POST でアドレスが変わらず、
**ツールが検索前の画面を見ていた**（2026-09-01 に利用者が実機で確認。拡張機能は動いている）。
1.19.0 で**対象外（`👤`）**にし、**人が確認する**形にした（SPEC-SC-10 / ADR-0015）。

> **1.15.0〜1.18.0 にあった「ポータルのリンクをたどる」到達方法（`reach: 'link'`）は
> 1.19.0 で撤去した**（SPEC-SC-26。廃止・欠番）。
> `到達方法: …` / `資格を満たさなかった内訳: …` / `資格を満たさなかったクエリのキー: …` /
> `ハブ N フレームを走査し…` は**どれも出ない**。
> 過去の結果ファイルにこれらが出ていたら、それは 1.15.0〜1.18.0 の版である。

#### 「識別 0 件」でも ❌ になる（1.12.2〜）

ページ識別セレクタは検出用セレクタの**祖先**から起こしてあるため、両者は相関する。
検出用セレクタが根元から壊れると識別セレクタも必ず 0 件になり、
「未到達」と「根元からの破損」が同じ観測になってしまう（SPEC-SC-05）。

そこで**識別・検出がともに 0 件のときだけ**、到達先の題名を材料に到達したかを判定する（SPEC-SC-24 / FR-22）。

| 題名 | 判定 |
| --- | --- |
| 未到達の目印（`エラー …` / `ログイン …` / `メンテナンス` / 英語の `Error` `Sign in` 等）に当たる | ⚠️ のまま |
| 題名が空・不記録（SPEC-SC-22） | ⚠️ のまま（判断材料が無い） |
| どの目印にも当たらない | **⚠️ → ❌ に再分類**。備考に `ページ識別セレクタは 0 件だが、題名から到達と判断した` が付く |

目印は**否定リスト**であって「対象ページに着いた」ことの証明ではない。
別の正常なページに飛ばされていても ❌ になる。
**❌ を見たら、まず手がかり節の「到達先の題名」が対象ページのものかを人が読む。**

分からないときに ❌ 側へ倒すのは意図的で、誤 ❌ は終了コード 1 で目立ち題名を読めばすぐ分かるのに対し、
誤 ⚠️ は終了コード 2 に埋もれて誰も気づかないため（ADR-0006）。
判断の根拠は手がかり節の `到達判定` 行に必ず1行残る。

### ⚠️/❌ には「手がかり」が付く

**⚠️ と ❌ の対象にだけ**、原因切り分けの手がかりが自動で採取される（SPEC-SC-20〜23）。
✅ と未実施には付かない。

| 出る場所 | 内容 |
| --- | --- |
| 結果表の**備考**列 | プレフィックス追跡の1行要約（`` `div#line1` まで 1 件 → `…` で 0 件 ``） |
| サイトの表の後の**節**（`### 〈対象名〉の手がかり`） | 到達先の題名・**到達判定**・見出し・主要コンテナ（`body` 直下）・プレフィックス追跡の段階ごとの件数 |

読む順は **備考の要約 → 節のプレフィックス追跡 → 題名・主要コンテナ**。

| 手がかり | 読み方 |
| --- | --- |
| 先頭の段階から 0 件 | ページの骨格ごと別物。**別のページに着いている**（ログイン画面・エラー画面）疑いが濃い。題名と主要コンテナで確かめる |
| 途中まで件数があり、次の段階で 0 件 | そこが壊れた箇所。**その2段階の差**を実 DOM と見比べる |
| 全段階がヒットするのに ❌ | 最終トークンの絞り込み（`:nth-of-type(2)` など）で 0 件。最後の2段階の差を見る |
| 題名が「セッション情報らしき文字列が含まれるため記録しない」 | 題名は残っていない。主要コンテナで判断する（NFR-12 / SPEC-SC-22） |
| `検証用 jQuery が注入されていないため…` | そのフレームでは段階を数えられない。ツール側の到達の問題 |
| 到達判定が `セレクタを評価できなかったため題名を見ていない` | 件数を数えられていない（jQuery 未注入・評価例外）。**到達したかは判断していない**ので、記号は暫定判定のまま |
| ❌ なのに到達判定が `到達したとみなす` で、備考に再分類の根拠が**無い** | 再分類ではなく**評価の例外**で ❌ になっている（**備考に消毒済みの例外メッセージ**が載る。`Syntax error, unrecognized expression` など。結果表に理由の列は無い）。到達判定の行が示すのは**題名について何を判断したか**だけで、再分類が起きたことは意味しない（SPEC-SC-24） |
| 備考の `利用者データ（お気に入り・保有銘柄）が 0 件でも…` | お気に入り・保有一覧の ❌ に付く。**登録 0 件でも同じ観測になる**ので、まず登録状況を確かめる（再分類された ❌ にも付く） |

**題名がエラー・ログイン画面のものなのに ❌ になっていたら、その題名の目印を
`scripts/selector-check/diagnostics.mjs` の `UNREACHED_TITLE_PATTERNS` に足す**（目印は否定リストなので、
足さない限り同じ題名で誤 ❌ が出続ける。SPEC-SC-24 / ADR-0006）。

**記録されるのは題名（消毒後）・要素のタグ名/`id`/`class` 名・セレクタ文字列・件数だけ**で、
テキスト内容・URL・クエリ・セッション ID は採らない（NFR-12 / CON-10）。
手がかりの採取が失敗しても**判定と終了コードは変わらない**（備考に「手がかりを採れなかった」が付くだけ）。

`id` / `class` のうち**セッション情報らしいトークン**（URL / 既知のセッションパラメータ名 /
クエリ文字列様 / 20文字以上の連続英数字 / UUID 形）は `<withheld>` に置き換わる（SPEC-SC-20 / SPEC-SC-22）。
伏せるのは当たったトークン1個だけで、**タグ名は対象外**、同じ要素の他の `class` はそのまま残る
（`` `div#<withheld>.mbody` `` のように読む）。

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
    `--load-extension=${extensionPath}`,
    '--host-resolver-rules=MAP * ~NOTFOUND',  // 名前解決をすべて失敗させる（下記）
    '--no-proxy-server'                        // OS のプロキシ経由ですり抜けさせない（下記）
  ]
})
```

### 全テストに効く前提（`tests/fixtures/extension.mjs`。2026-10-12〜）

| 前提 | 内容 |
| --- | --- |
| **名前解決を塞ぐ** | `--host-resolver-rules=MAP * ~NOTFOUND`。テストは実サイトへ出ていかない前提（外部リクエストゼロ。NFR-03 / CON-10）。差し替え（`context.route`）は名前解決より前に応えるので影響しない。**Service Worker の `chrome.tabs.create` で開いたタブの最初の遷移は、`context.route` にも `request` イベントにも現れずに出ていく**（2026-10-12 実測）。それでも外へ出られないようにするための備え |
| **プロキシを使わない** | `--no-proxy-server`。OS 側にプロキシが設定されていると、名前解決をプロキシに任せるため `--host-resolver-rules` をすり抜けうる。それを防ぐ |
| **初回インストールのオプションページを待つ** | 拡張は初回インストールでオプションページを開き、そのとき空のタブがあれば上書きする（起動の約100ms後）。待たずにテストがタブを作ると、そのタブを奪われることがあった。`context` fixture は、オプションページが開くまで（最長5秒）待ってから渡す |
| **外部への要求を検査する**（fixture `externalRequests`） | 受け取ったテストは、終わったときに次を検査される。(1) 差し替えていない http(s) の要求（`request` イベント。差し替えの無いものは中断させる）、(2) タブの遷移先（ページができたときの URL とメインフレームの遷移）が http(s) かエラーページ。`routeHtml` / `serveFixture` で応えた URL は数えない。(2) を見るのは、上の `chrome.tabs.create` のタブが `request` に出ないため（名前解決を塞いでいるのでエラーページとして見える）。使っているのは `tests/disconnected.spec.mjs` の13件と、`tests/tradingview.spec.mjs` の A-12・A-7b の0件・B-1 の3件 |

> **拡張がタブを開きうるテストでは、これとは別に Service Worker の `chrome.tabs.create` を差し替える。** 名前解決を塞いでも、
> 遷移そのものは起きる（エラーページになるだけ）。

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

**TradingView だけは書き方が違う**（`tests/tradingview.spec.mjs`）。
DOM を写さず、**`menuSelectors` と `watchlistSymbolAttrs` から実行時に組み立てる**。

| | 楽天・SBI | TradingView |
| --- | --- | --- |
| フィクスチャ | HTML を直書き | **セレクタ定義から生成** |
| セレクタを直したとき | フィクスチャも直す | **自動で追従する**（直さない） |
| 書いてよい値 | サイトの構造（ハッシュ無し） | **ハッシュ付きクラス名を書かない**（`CON-08` の条件1） |

理由は `CON-08`。**写せば毎リリース腐り、腐ったことに気づけない。**
契約（セレクタ定義・属性名）だけを再現すれば、サイト改修でフィクスチャの更新が要らない。
詳細は SPEC-CS-27。

### 4. 開けないときの小窓（FR-29 / SPEC-NT。1.21.0〜）

`tests/notice.spec.mjs`。Chrome の右クリックメニューそのものは Playwright から押せない（2026-10-11 に確かめた。ページに `contextmenu` は届くが `onClicked` が発火しない。SPEC-SW-10）ので、
**押された後の処理**を `serviceWorker.evaluate` で直接呼び（`onContextMenuClickedAsync`）、開いた小窓を `context` の `page` イベントで受け取る。

```js
const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/notice.html') })
await serviceWorker.evaluate((info) => onContextMenuClickedAsync(info, undefined),
  { menuItemId: 'shikiho.toyokeizai.net/stocks', selectionText: 'AAPL' })
const page = await opened
```

- 小窓のページは Playwright が表示領域を 1280×720 に置き換える（SPEC-SW-10 の実測 7）。収まりはビューポートを 424×220 に設定し直して近似する（SPEC-NT-05）
- `notice.html` そのもののリクエストは `request` イベントに出ない（Playwright が新しいウィンドウにつながる前に出るため）。外部リクエストゼロの検査は `notice.css` / `notice.js` が取れていることを前提にする（SPEC-NT-06 の 10）
- Esc で閉じるテストは `keyboard.down` を使う。`press` は keydown で小窓が閉じた後の keyup で落ちることがある（SPEC-NT-06 の 8）
- クリック処理の分岐（タブを開く／小窓を開く／何もしない）は `tests/service-worker.spec.mjs` の describe `service_worker: 開けない項目を押したときの小窓` が見る（SPEC-SW-05）

### 5. 切断状態（NFR-14 / SPEC-CS-19。2026-10-12〜）

`tests/disconnected.spec.mjs`。**拡張機能を再読み込みして、古いタブの Content Script を本当に切断状態にする。**

- **再読み込み:** `reloadExtension` fixture（`tests/fixtures/extension.mjs`）。`chrome://extensions` を開き、
  `chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })` で開発者モードを有効にしてから
  `chrome.developerPrivate.reload(id, { failQuietly: true })` を呼び、新しい Service Worker を待つ。
  古いタブの Content Script は直後から `isExtensionAlive()` が偽になる（`chrome.runtime` が `undefined`）。ヘッドレスでも同じ（2026-10-12 実測）
- **開発者モードは必須。** 無いと `chrome.runtime.reload()` で古いタブは切断されるが、拡張が戻ってこない
  （新しい Service Worker が立たず、新しいタブにも注入されない。`chrome://extensions` を開くだけでも足りない。SPEC-SW-02 の実測表）
- **再読み込みの後は `serviceWorker` fixture が古い。** `chrome.tabs.create` などの差し替えは新しい Service Worker にかけ直す
- **「一瞬も現れない」**は、操作の前にページ側へ MutationObserver を仕込み、拡張の要素（`data-kabu-tantan` / `ktt-tv-` / `x-kabu-`）が
  足された記録が空であることで見る（`tests/fixtures/probes.mjs`）。数を数えるだけでは、足してすぐ消す経路（NFR-14 判定基準2 が禁じるもの）を見逃す
- **例外**は `pageerror` と `console` の error で見る。Content Script（isolated world）の例外・未処理の拒否・`console.error` は、**切断後も**ここに届く（2026-10-12 実測）
- **起動直後 500ms の窓**（SPEC-CS-19「起動時の門」）は、CDP の `Runtime.executionContextCreated`（`auxData.type === 'isolated'`・origin が拡張）で
  Content Script の注入を捕まえ、直後に再読み込みする。注入から再読み込みの完了まで 30ms 前後で、窓に十分収まる。
  **窓を踏んだことは、切断の直前と直後に isolated world で `isExtensionAlive()` とボタンの数を読み、
  `{ alive: true, buttons: 0 }` から `{ alive: false, buttons: 0 }` になったことで確かめる**
- **再試行が止まったこと**（FR-13 判定基準4）は、同じ CDP の手段で isolated world の `setInterval` / `clearInterval` を数え、
  動いているタイマーが 0 になったことで見る（`watchContentScriptAsync` の `countIntervals`。`tests/fixtures/probes.mjs`）。
  G-6 の3件と A-12 は、同じ数え方で**再試行が回っている（1）ことを確かめてから**操作する
- **時間の窓が要る手順を作らない。** 後から現れる行・ツールバーは、切断の**後に**テストが足す
- **各テストに対照を置く。** 切断の前（または別のタブ・再読み込み後のタブ）で同じ操作が効くことを示す。対照が無いと、操作そのものが効いていなくても緑になる
- **限界: テストが終わった後に出る例外は見えない。** 2500ms 後に例外を投げる変異は、どのテストでも落ちなかった（2026-10-12 実測）
- **単独では落とせない門がある**（多重防御）。どの門が単独で判別でき、どれができないかは SPEC-CS-19「単独では判別できない門」

> **SW の `chrome.tabs.create` で開いたタブの最初の遷移は、`context.route` で差し替えられない**（2026-10-12 実測。同じタブでの2回目の遷移と、
> ページ発の `<a target="_blank">` / `window.open` は差し替えられる）。拡張がタブを開くテストは、必ず SW の `chrome.tabs.create` を差し替えて URL を記録する。
> 差し替えずに試したスパイクでは、実在しないセッション ID で楽天証券へ実リクエストが1回出た。
> 2026-10-12 から全テストで名前解決を塞ぎ、fixture `externalRequests` でタブの遷移先も検査している（上の「全テストに効く前提」）。
>
> テストの**一覧**は [TEST-CATALOG.md](TEST-CATALOG.md)（`npm run docs:tests` で自動生成）。
> このファイルには方針と手法だけを書く。

## カバーしている範囲

**テストの一覧は [TEST-CATALOG.md](TEST-CATALOG.md)**（`npm run docs:tests` で自動生成）。

大まかには以下を検証している。

| 層 | 対象 |
| --- | --- |
| ロジック | `getTickerCode`（誤マッチ防止を含む） / `compareVersion` / `makeUrl` / `externalUrls` の整合性 |
| オプションページ | 一覧表示・初期値・グリッドレイアウト・トグル保存・ドラッグ並び替え・リンク属性・外部リクエストゼロ・アイコンフォント |
| 開けないときの小窓（FR-29） | クリック処理の分岐（開ける場合は従来どおり・米国株のページが無い／銘柄コードと読み取れないときは小窓）・小窓は1つまで・位置・文言・閉じ方・外部リクエストゼロ・収まり（近似）・権限が増えていないこと（`manifest: 権限`） |
| Content Script | 楽天証券とSBI証券へのメニュー注入、URL生成、ホバー開閉、対象外ページで注入しないこと、設定の反映 |
| TradingView（**拡張の持ち物だけ**） | 項目のクリックできる範囲・`delegating`（Esc は1回）・メニューの縦位置補正・除去時の後始末・証券会社の項目が URL を DOM に出さないこと・「株Link」ボタンの表示の切り替え（銘柄が取れないと隠れる・再試行で足したボタンも追随する）・ボタンメニューが 0 件なら何も出さないこと・楽天証券のタブの有無で証券会社の項目を出し分けること。**サイト側の実在・見た目は見ていない**（SPEC-CS-27 / FR-26） |
| 切断状態（NFR-14） | 拡張機能を再読み込みした後の古いタブで、TradingView・楽天証券・SBI証券・スクリーナー2種が要素を一切足さない（足してすぐ消す、も含む）・例外を出さない・再試行と監視を止める・タブを再読み込みすると戻ること（`tests/disconnected.spec.mjs`。SPEC-CS-19 / SPEC-CS-22） |
| セレクタ定義 | `menuSelectors` の読み出し・構造・`targets.mjs` との1対1対応（半自動検証の前提。NFR-13） |
| TradingView の行と入れ子の隙間 | 半自動検証で、ウォッチリストの行は数えるだけで注入を数えないこと・入れ子の隙間を測って備考に出し、測れなくても判定を変えないこと。測った隙間が、入れ子を実際に置く位置（右に開く・左に開く）と一致すること（フィクスチャ。`tests/tradingview.spec.mjs`）（SPEC-SC-11。2026-10-15〜） |
| 検証ツール | 中断（SIGINT / SIGTERM / SIGHUP / 端末の Ctrl+C）で一時プロファイルが残らないこと（NFR-12） |
| 手がかり | ⚠️/❌ の切り分け情報の整形（プレフィックス追跡・要素の記述子・題名の不記録判定・出力書式。NFR-12 / SPEC-SC-20〜23） |

## カバーしていない範囲

- **TradingView の「サイト側」に属するもの**
  挿入先・メニュー・行が**実サイトに実在するか**、模倣した**見た目**が揃っているか、
  **サイト側メニューの挙動**（スクロール可否など）。
  DOM がハッシュ付きクラス名（`menu-Tx5xMZww` 等）で構成され、リリースごとに変わるため、
  **フィクスチャでは実サイトとの乖離を検出できない**（`CON-08`）。
  **検出用セレクタが生きているかは `npm run check:selectors` が判定する。**
  ウォッチリストの行が拡張の読む属性を持つかと、親行と入れ子の隙間も、2026-10-15 から `npm run check:selectors` が見る。
  見た目・操作感は実際に TradingView を開いて手動確認する（行の要素の使い回しへの属性の追随は A-19）。

  > **`tradingview-cs.js` そのものは対象外ではない**（2026-08-30 に `CON-08` を改訂）。
  > **拡張が自分で作った DOM の振る舞い**（クリックできる範囲・位置補正・入れ子の開閉・
  > 起点の取り違え）は `tests/tradingview.spec.mjs` が見ている（SPEC-CS-27 / FR-26）。
  >
  > **ただし、それが緑でも「実サイトが壊れていない」根拠にはならない。**
  > 見ているのは**自分たちのコードの退行だけ**で、サイト改修を見る目は1つも増えていない。
  > **手動確認が短くなったことを「TradingView は安全になった」と読み替えないこと**（FR-26 判定基準7）。
- **TradingView が銘柄の切り替え・画面の移動で canvas の属性を書き換えること**（「株Link」ボタンの表示の切り替えの前提）
  フィクスチャではテストが属性を書き換えるので、拡張側の振る舞いしか見ない。実サイトが canvas を作り直す実装になると
  ボタンの表示が更新されなくなるが、自動テストも今の `npm run check:selectors` も緑のまま。手動確認 A-8 の2行で見る
  （**フィクスチャの自動テストでは見えないことは 2026-10-12 に確かめた**。`npm run check:selectors` での半自動化は CON-10 の上では可能だが、まだ試していない（CON-10 は TradingView の銘柄の切り替えを許しており、`scripts/selector-check/check.mjs` はすでに実サイトで銘柄を切り替えている。同じタブで切り替えたときに canvas が同じ要素か・ボタンが隠れるかは見ていない）。SPEC-CS-22「canvas 監視の切断時の停止」）。
- **楽天証券・内藤証券のセッション連携のうち、実際にログインした状態で開いたページが正しいか**
  ログイン状態のタブが前提のため自動化していない（手動確認 B-2〜B-4）。
  タブの有無で項目を出し分けること・URL を DOM に出さないこと・Service Worker が組み立てた URL で開くことは、
  フィクスチャのタブと Service Worker の差し替えで自動テストが見る（SPEC-CS-12 / SPEC-CS-28）。
- **楽天スーパースクリーナー / SBI銘柄スクリーニングの見た目と実 DOM**
  注入・ページ送りへの追随・切断状態は自動テストが見る（1.13.0〜 / 2026-10-12〜）。実 DOM との乖離は
  `npm run check:selectors` と手動確認 C-2 / C-4 で見る。

> 2026-10-12 まではここに「切断状態（Extension context invalidated）の振る舞い。拡張機能の再読み込みは Playwright から再現できず、
> 切断は Chrome の内部状態のため。手動確認セクション G で見る」と書いていた。**誤りだった**（上の「5. 切断状態」）。
> 同じ日まで「スクリーナー2種は `MutationObserver` + iframe 前提で、フィクスチャでの再現コストが見合わない」とも書いていたが、
> こちらは 1.13.0 で注入を自動テストへ移した時点で失効していた。

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

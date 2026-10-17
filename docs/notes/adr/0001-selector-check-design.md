# ADR-0001 セレクタ検証ツールの設計判断

| | |
| --- | --- |
| 状態 | 採択（2026-08-23） |
| 対象 | FR-12, FR-15〜17, NFR-12, NFR-13, CON-02, CON-10 |
| 仕様 | [SPEC-SC](../specs/selector-check.md) |

---

## 1. 検出用セレクタの情報源をどこに置くか（NFR-13）

**決定: `src/*-cs.js` の `menuSelectors` を唯一の情報源とし、検証ツールが `node:vm` で読み出す。**

| 案 | 内容 | 判定 |
| --- | --- | --- |
| **(a) 採用** | 検証ツールが `src/*-cs.js` をテキストとして読み、`node:vm` で評価して `menuSelectors` を取り出す | `src/` は TradingView の定数化のみ。manifest・読み込み順・配布物に影響しない |
| (b) | `src/selectors/*.js` に切り出し、Content Script と検証ツールの両方が読む | 却下。manifest の `js` 配列5箇所・`validate-manifest.mjs` の読み込み順検査・ESLint のグローバル宣言・配布物のファイル数がすべて増える。得られるのは (a) と同じ「1箇所定義」だけ |
| (c) | 実行中の Content Script から取得する | 却下。content script は isolated world にあり、ページの `window` からも Playwright の `evaluate` からも触れない |
| (d) | 検証ツール側にセレクタを書き写す | 却下。NFR-13 に真っ向から反する |

(a) の代償は「`menuSelectors` という変数名」「トップレベルで DOM に触れない」という
**暗黙の契約**が増えること。これは `tests/selector-defs.spec.mjs`（SPEC-SC-16）で
`npm test` の対象にして機械的に守る。CON-02 の「読み込み順の破損を `npm run validate` で検出する」のと同じ扱い。

TradingView の4セレクタは現在コードに直接埋まっているため、(a)(b) いずれでも定数化が要る。
(a) なら **同一ファイル内で `const menuSelectors` に括り出すだけ**で済む。

---

## 2. ページ識別セレクタをどこに持つか

**決定: 検証ツール側（`scripts/selector-check/targets.mjs`）に持つ。**

- FR-12 の「やらないこと」に **`src/` に検証専用のコードを持ち込まない**とある。
  拡張機能が使わないフィールドを `menuSelectors` に足すのはこれに反する
- NFR-13 が禁じているのは**検出用セレクタ**の二重管理。ページ識別セレクタは
  拡張機能が持っていない情報なので、ツール側に置いても二重管理にならない
- 楽天の `menuSelectors[].url`（URL 部分一致）は流用する。SBI には無いが、
  SBI は `reach: 'tab'`（人が開いたタブを探す）なので URL を必要としない

初期値は実 DOM を見ずに「検出用セレクタの祖先」から起こした推測値である。
初回実行で外れが判明したら `targets.mjs` を直す。**検出用セレクタ側は絶対に直さない。**

---

## 3. 対象ページへの到達方法

**決定: 楽天証券12ページと TradingView は自動遷移、スクリーナー2種と SBI 2ページは人が開いたタブを探す。**

| 案 | 判定 |
| --- | --- |
| 全ページを URL 直打ちで遷移 | 不可。スクリーナーは検索の実行（フォーム送信）が要り CON-10 が禁じている。SBI の ETGate URL はセッション・遷移経路依存 |
| 全ページを人が開く | 却下。FR-15 が明示的に否定している（12ページを手で回らない） |
| **採用: 混在（`reach: 'goto' / 'tab'`）** | 手作業は最大4ページ。FR-15 の主眼（楽天12ページ）は自動化できる |

`tab` 対象が開かれていなければ **未実施**（破損ではない）。FR-16 の区別と同じ扱いにする。

---

## 4. 合図の受け取り方

**決定: 端末で Enter を1回（stdin）。**

| 案 | 判定 |
| --- | --- |
| **stdin の Enter** | 採用。追加依存なし。時間制限が無い。`npm run check:selectors` の出力と同じ端末で完結する |
| `page.pause()` | 却下。Playwright Inspector（別ウィンドウ・環境変数）に依存し、Inspector が無い環境で止まる |
| 専用の合図ページ | 却下。拡張機能と無関係な HTML を配布物外に持つことになり、実装量に見合わない |

Playwright のテストランナーを使わず素の Node スクリプトにするのは、
**ログイン待ちにテストタイムアウトを掛けられないため**（FR-15）。

---

## 5. 認証情報を残さない方法（NFR-12）

**決定: `fs.mkdtempSync` で毎回使い捨てのプロファイルを作り、多重の後始末で必ず消す。**

- 拡張機能の読み込みには `launchPersistentContext` が必須で `userDataDir` を避けられない
- `finally` / `SIGINT` / `SIGTERM` / `uncaughtException` / `process.on('exit')` の
  すべてから冪等な `cleanup()` を呼ぶ。最後に `existsSync` で残存ゼロを検査する
- ログイン自動化はしない（CON-04・CON-10）。認証情報を扱わないので保存する対象がそもそも無い
- 結果ファイルはホワイトリスト（セレクタ・件数・判定・例外メッセージ）だけを組み立てる。
  **URL を出さない**（楽天のセッション ID が URL に載るため）

---

## 6. jQuery 独自セレクタの評価

**決定: 同梱の `src/third-party/jquery.min.js` を `addInitScript` で登録するが、`noConflict(true)` を含む
本体の評価は関数に包んで遅らせ、最初にセレクタを評価するときに実行する。**

検出用セレクタには `:contains()` / `:first` / `[aria-hidden!="true"]` が含まれ、
`querySelectorAll` では評価できない。同梱物を使うので外部取得は発生しない（CON-07）。

`addScriptTag` ではなく `addInitScript` を選ぶ理由は、対象サイトの CSP に阻まれないため。
`noConflict(true)` でサイト側の `$` / `jQuery` を元に戻し、サイトの動作を壊さない（NFR-01）。

### 遅延評価にした経緯

当初は `addInitScript({ path: 'src/third-party/jquery.min.js' })` で jQuery をそのまま登録し、
続けて `noConflict(true)` を登録する設計だった。**実装時に動かないことが判明して変更した。**

| | 内容 |
| --- | --- |
| 事象 | 初期化スクリプトは document-start で走る。この時点では `document.documentElement` が無く、jQuery 4 を評価すると `TypeError` になる |
| 変更 | jQuery 本体を `window.__kabuCheckLoad()` の中に包んで登録し、`window.__kabuCheckJq()` が初回呼び出し時にだけ評価する。件数取得は必ずこの関数を経由する |
| 副次効果 | ツールがセレクタを評価しない限りサイトの `window` に触れない（NFR-01 に有利）。`noConflict(true)` の実行がサイト本来の `$` の確定後になるため、復元が正確になる |
| 代償 | `__kabuCheckJq` が未定義のフレーム（初期化スクリプト登録前に生成されたページ）を「未到達」として扱う分岐が要る。作業ページを登録後に開き直すことで通常は発生しない |

仕様は [SPEC-SC-09](../specs/selector-check.md)。

---

## 7. 検証ツール自体の自動テスト

**決定: セレクタ定義の整合性だけを `npm test` で見る。ツールの実行そのものは手動確認。**

ログインが要るので Playwright のフィクスチャ方式では回せない（CON-10）。
一方で NFR-13 の担保は自動化できる — `menuSelectors` が読み出せること、
`targets.mjs` と1対1に対応すること、`targets.mjs` がセレクタ文字列を持たないことの5件（SPEC-SC-16）。

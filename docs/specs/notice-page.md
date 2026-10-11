# SPEC-NT: 開けないときの小窓

実装: `src/notice.html`, `src/notice.js`, `src/notice.css`

> **1.21.0 から。** 要件は FR-29。小窓を開く側は SPEC-SW-10、設計判断は ADR-0017。

右クリックメニュー（FR-05）の項目を押しても遷移先のページを開けないときに、Service Worker が開く小さなウィンドウのページ。
**開くのは Service Worker だけ**で、注入先ページ・Content Script からは開かない。

## SPEC-NT-01 ファイルと読み込み

| ファイル | 内容 |
| --- | --- |
| `src/notice.html` | `<html lang="ja">`、`<meta charset="utf-8">`、`<title>株リンク</title>`、`<link rel="stylesheet" href="notice.css">`。本文は下の構造。末尾で `urls.js` → `notice.js` の順に `<script src>` で読む |
| `src/notice.js` | 表示内容の組み立て（SPEC-NT-02）と閉じ方（SPEC-NT-03） |
| `src/notice.css` | 見た目（SPEC-NT-05） |

本文の構造（id は `notice.js` とテストが使う。変えるときは両方を直す）:

```html
<main class="notice">
  <p id="notice-message" class="notice-message"></p>
  <p id="notice-detail" class="notice-detail"></p>
  <div class="notice-actions">
    <button id="notice-close" type="button" autofocus>閉じる</button>
  </div>
</main>
```

- `urls.js` を `notice.js` より先に読む（`externalUrlsMap` / `getEnableLinkKeysAsync` を使うため。CON-02）。
  **jQuery・`third-party/` は読まない**
- インラインの `<script>` / `style` 属性 / インラインのイベントハンドラを書かない（MV3 の既定の CSP で動かない）
- `src/manifest.json` には何も足さない（SPEC-SW-10 の「権限と manifest」）
- クラス名に `x-kabu-` / `ktt-tv-` の接頭辞は付けない（他社サイトに注入しないページのため。オプションページと同じ扱い）

- 要件: FR-29, CON-02, CON-07
- 検証: `auto`（SPEC-NT-02〜05 のテストがこのページを開いて見る。ファイルが欠ければ全件落ちる）

## SPEC-NT-02 表示内容

`notice.js` は `new URLSearchParams(location.search)` から `reason` / `key` / `code` を読む。
遷移先の名前は `Object.hasOwn(externalUrlsMap, key) ? externalUrlsMap[key].title : null` で引く（未知の key や `__proto__` 等を名前として扱わない）。

| 条件 | `#notice-message` | `#notice-detail` |
| --- | --- | --- |
| `reason` が `us-unsupported`、遷移先の名前が引けて、`code` が空でない | `「<遷移先の名前>」には米国株のページがないため、<code> を開けません。` | 下の「米国株を開ける遷移先」 |
| `reason` が `not-ticker`（FR-29 判定基準 4） | `選択した文字列を銘柄コードとして読み取れませんでした。` | `4桁の銘柄コード（例: 7203）か、米国株のティッカー（例: AAPL）を選択してください。` |
| 上のどれにも当たらない（`reason` が無い・未知、`us-unsupported` で遷移先の名前が引けない・`code` が無い） | `ページを開けませんでした。` | 空文字にし、`hidden` 属性を付ける |

**米国株を開ける遷移先（`us-unsupported` の `#notice-detail`）:**

1. `await getEnableLinkKeysAsync()` で有効な遷移先を設定の順に得る（SPEC-ST-01）
2. `externalUrlsMap` に無い key を除き（SPEC-ST-03）、`url3` を持つものの `title` を残す
3. 1件以上なら `米国株のページがある遷移先: <title を「、」で連結>`、0件なら `米国株のページがある遷移先は、いま有効な遷移先の中にありません。`

- 「米国株のページがある」の基準は `url3` の有無とする。TradingView のメニューの絞り込み（SPEC-CS-18）と同じ基準。
  2026-10-11 時点の `externalUrls` では `url2` を持つものはすべて `url3` も持つ（SPEC-EL-06）ので、`getUrl` の判定（SPEC-TC-05）と食い違わない
- 右クリックメニューには TradingView 自身も並ぶので、TradingView のメニューと違い `tradingview.com/chart` を除かない
- `#notice-message` は同期で入れる。`#notice-detail` は storage を読んでから入れる（非同期）
- **文字列はすべて `textContent` で入れる。** `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` を使わない
  （クエリの値を HTML として解釈しない。小窓は Web ページから開けないが、拡張のページとして守りを置く）
- 文言は日本語だけ（FR-11）。`_locales` は使わない（オプションページと同じ）
- **選択文字列は表示しない**（Service Worker が渡さない。SPEC-SW-05 の手順 2）

- 要件: FR-29（判定基準 1・4・7）, FR-11, NFR-03
- 検証: `auto`（下の SPEC-NT-06 の 1〜6）

## SPEC-NT-03 閉じ方

| 操作 | 動作 |
| --- | --- |
| `#notice-close` のクリック | `window.close()` |
| ページ上で `Escape` キーを押す（`document` の `keydown`） | `window.close()` |

- `#notice-close` は `autofocus` を持つ。開いた直後に `Enter` / `Space` でも閉じられる（`chrome.windows.create` で開いた小窓で `autofocus` が効き、`document.activeElement` がボタンになることは 2026-10-11 に SPEC-SW-10 と同じ方法で実測した）
- 時間で自動的に閉じることはしない
- `window.close()` で `chrome.windows.create` が開いたポップアップが閉じることは実測済み（SPEC-SW-10 の実測 6）

- 要件: FR-29（判定基準 5）
- 検証: `auto`（SPEC-NT-06 の 7〜9）

## SPEC-NT-04 外部へ出さない

- 読み込むのは `notice.html` / `notice.css` / `notice.js` / `urls.js` だけ。Web フォント・画像・アイコンを使わない
  （フォントは端末の既定。SPEC-NT-05）
- 選択文字列を受け取らない（SPEC-SW-10）。storage は読むだけで書かない

- 要件: FR-29（判定基準 7）, NFR-03, CON-07
- 検証: `auto`（SPEC-NT-06 の 10）

## SPEC-NT-05 見た目と大きさ

| 項目 | 値 |
| --- | --- |
| ウィンドウ | 幅 440 × 高さ 280（枠・タイトルバーを含む。SPEC-SW-10） |
| 文字 | `font-family: system-ui, sans-serif`、`font-size: 14px`、`line-height: 1.5`。`#notice-detail` は `13px` で、本文より薄い色 |
| 余白 | `body` の `margin: 0`、`main` の `padding: 20px` |
| ボタン | `.notice-actions` で右寄せ |

- 長い文言は折り返す（横スクロールを出さない。`overflow-wrap: anywhere`）
- **ダークモード（`prefers-color-scheme`）には対応していない**（配色は白地に濃い文字の固定）。オプションページは対応している（`NFR-10` の対象はオプションページだけ）。候補として要件側に記録した（`docs/requirements/README.md` の 2026-10-11 その10）
- CSS のプロパティの並びは Stylelint（`stylelint-config-recess-order`）に従う

**収まりの検証の考え方:** 小窓のページは Playwright が表示領域を 1280×720 に置き換える（SPEC-SW-10 の実測 7）ので、
実際のウィンドウの大きさでは測れない。テストではビューポートを **424×220** に設定し直して測る。
幅は枠の分 16px、高さはタイトルバーと枠の分 60px を、ウィンドウの大きさから差し引いた値（推測による控えめな見積もり。
macOS のタイトルバーは 28px 前後、Windows は 30px 前後と見ている）。実際の見え方は SPEC-SW-10 の手動確認 M-1 が見る。

- 要件: FR-29（判定基準 1）
- 検証: `auto`（SPEC-NT-06 の 11）／`manual`（SPEC-SW-10 の M-1）

## SPEC-NT-06 自動テスト

`tests/notice.spec.mjs`（1.21.0 で新設）の describe **`小窓のページ`** の11件。

**前処理:**

- **実際の経路で開く（`openNoticeAsync`）:** `context.waitForEvent('page', { predicate: (p) => p.url().includes('/notice.html') })` を先に待ち受け、
  `serviceWorker.evaluate((info) => onContextMenuClickedAsync(info, undefined), info)` で SPEC-SW-05 のハンドラを直接呼ぶ。
  得たページの `domcontentloaded` を待つ
- **直接開く:** 想定外の引数を試すときだけ `page.goto(`chrome-extension://${extensionId}/notice.html?…`)` を使う
- 設定を変えるテストは、ハンドラを呼ぶ前に `chrome.storage.sync.set({ enableLinkKeys })` を済ませる（小窓のページは開いたときに読む）
- 期待する遷移先の名前は Service Worker の `externalUrlsMap` から実行時に引く（直書きしない）。
  例に使う key は `shikiho.toyokeizai.net/stocks`（`url3` を持たない）・`kabutan.jp/stock` / `moomoo.com/`（持つ）

| # | テスト名 | 手順 | 期待 |
| --- | --- | --- | --- |
| 1 | `米国株のページが無い遷移先では、遷移先の名前と銘柄を出す` | 既定の設定で `{ menuItemId: 'shikiho.toyokeizai.net/stocks', selectionText: 'AAPL' }` を実際の経路で開く | `#notice-message` が `「四季報」には米国株のページがないため、AAPL を開けません。`（`四季報` は `externalUrlsMap` の title）と完全一致 |
| 2 | `米国株のページがある有効な遷移先を、設定の順に並べる` | `enableLinkKeys` を `{ 'moomoo.com/': 0, 'shikiho.toyokeizai.net/stocks': 1, 'kabutan.jp/stock': 2 }` にしてから 1 と同じく開く | `#notice-detail` が `米国株のページがある遷移先: moomoo証券、株探/基本情報` と完全一致（`url3` を持たないものと無効なものを含まず、設定の順） |
| 3 | `米国株のページがある遷移先が有効な中に無ければ、その旨を出す` | `enableLinkKeys` を `{ 'shikiho.toyokeizai.net/stocks': 0 }` にしてから開く | `#notice-detail` が `米国株のページがある遷移先は、いま有効な遷移先の中にありません。` と完全一致 |
| 4 | `銘柄コードと読み取れない文字列では、選択した文字列を出さない` | `{ menuItemId: 'kabutan.jp/stock', selectionText: 'こんにちは' }` を実際の経路で開く | `#notice-message` / `#notice-detail` が SPEC-NT-02 の2行目と完全一致。`document.body.textContent` が `こんにちは` を含まない |
| 5 | `想定外の引数では、汎用の文言だけを出す` | 直接開く: (i) `notice.html`、(ii) `notice.html?reason=us-unsupported&key=<STALE_KEY>&code=AAPL`、(iii) `notice.html?reason=us-unsupported&key=__proto__&code=AAPL`、(iv) `notice.html?reason=unknown` | いずれも `#notice-message` が `ページを開けませんでした。`、`#notice-detail` が `hidden` 属性を持つ |
| 6 | `引数の文字列を HTML として解釈しない` | 直接開く: `notice.html?reason=us-unsupported&key=shikiho.toyokeizai.net%2Fstocks&code=` に `<b id="ktt-injected">X</b>` を `encodeURIComponent` して付ける | `#ktt-injected` が0件。`#notice-message` のテキストが `<b id="ktt-injected">X</b>` をそのまま含む |
| 7 | `閉じるボタンで小窓が閉じる` | 1 と同じく開き、`#notice-close` をクリック | ページの `close` イベントが3秒以内に来る。その後 Service Worker で `chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })` を見て、小窓（SPEC-SW-10 の手順 2 と同じ判定）が0 |
| 8 | `Esc キーで小窓が閉じる` | 1 と同じく開き、`page.keyboard.down('Escape')` | 7 と同じ |
| 9 | `開いた直後は閉じるボタンにフォーカスがある` | 1 と同じく開く | `document.activeElement.id` が `notice-close` |
| 10 | `外部ホストへ一切リクエストしない` | ハンドラを呼ぶ**前に** `context.on('request')` で全リクエストの URL を集め始め、1 と同じく開いて `#notice-detail` が埋まるまで待つ | 集めた URL がすべて `chrome-extension://<extensionId>/` で始まる。前提として `notice.css` と `notice.js` への要求が含まれる（集め損ねていない） |
| 11 | `既定の設定で、文言が小窓の大きさに収まる` | 既定の設定（全遷移先が有効。米国株を開ける遷移先が最も多く並ぶ）で、`url3` を持たない遷移先のうち title が最も長いものと `AAPL` で開き、`#notice-detail` が埋まってから `page.setViewportSize({ width: 424, height: 220 })` | `document.documentElement.scrollWidth <= innerWidth` かつ `scrollHeight <= innerHeight`。`#notice-close` の矩形がビューポートの内側に収まる |

- テスト 8 は `keyboard.down` を使う（`press` にしない）。`press` は keydown のあとに keyup を送るが、keydown で小窓が閉じると keyup の送り先が無くなり、
  15回中9回落ちた（1.21.0 の実装時に developer が実測。`down` に変えて60回中60回通った）。閉じる処理は keydown に付いているので、`down` だけで確かめられる
- テスト 10 で `notice.html` そのものの要求を数えないのは、Playwright が新しいウィンドウにつながる前に出て `request` イベントに現れないため（2026-10-11 実測）。
  **assert はしない**（Playwright の都合であって、本ページの振る舞いではない）。`notice.html` が外部を読み込めば、その要求は `notice.css` と同じく取れる
- テストの増減に合わせて `npm run docs:tests` で `docs/TEST-CATALOG.md` を再生成する
- `tests/notice.spec.mjs` は `docs/TESTING.md` と `AGENTS.md` のテスト表に載せてある

**「ガードを外すと落ちる」ことの実証（1.21.0 の実装時に developer が1回ずつ行い、下の全行で該当テストが落ちることを確かめた。変更はコミットしていない）:**

| 一時的に入れる変更 | 落ちるべきテスト |
| --- | --- |
| `textContent` を `innerHTML` に変える | 6 |
| `url3` での絞り込みを消す | 2 |
| 設定の順ではなく `externalUrls` の定義順に並べる | 2（`moomoo証券` が `株探/基本情報` の後になる） |
| `Object.hasOwn` を外し、`externalUrlsMap[key]` の有無だけで判定する | 5 の (iii)（`__proto__` で `「undefined」には…` になる） |
| `Escape` の処理を消す | 8 |
| `autofocus` を消す | 9 |
| CSS に外部の Web フォントの `@import` を足す | 10 |
| `main` の `padding` を `80px` にする | 11 |

- 要件: FR-29（判定基準 1・4・5・7・9）

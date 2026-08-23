# SPEC-TC: 銘柄コードの判定規則

実装: `src/service_worker.js`（`getTickerCode`）、`src/*-cs.js`、`src/tradingview-cs.js`

## SPEC-TC-01 国内銘柄コードの形式

```text
[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]
```

4桁。2桁目と4桁目に英字が入りうる（東証が2024年から採番している英字含みコード、例 `135A`）。
使われる英字は上記21文字に限定される（`B` `E` `I` `O` `Q` `V` `Z` は数字との誤読防止で不使用）。

- 要件: FR-08
- 検証: `auto`（`getTickerCode › 4桁の国内銘柄コードを jp として認識する` / `英字を含む国内銘柄コード（例: 135A）も認識する`）

## SPEC-TC-02 米国銘柄コードの形式

```text
^\s*([A-Z]{1,5})(?![A-Za-z])\s*
```

大文字英字 1〜5 文字。**先頭アンカー `^` と後続境界 `(?![A-Za-z])` の両方が必須。**

| 欠けるもの | 起きること |
| --- | --- |
| 先頭アンカー `^` | 日本語文中の大文字並びに誤マッチする（例:「株価はNYSEで上昇」→ `NYSE`） |
| 後続境界 `(?![A-Za-z])` | 単語の途中を切り出す（例: `Apple Inc. AAPL NASDAQ` → `A`）。**別銘柄のページを開くため、開かないより悪い** |

この結果、**選択範囲の先頭にティッカーが単独で置かれている場合のみ**認識する。

| 入力 | 結果 |
| --- | --- |
| `AAPL` / `TSLA` | 認識する |
| `AAPL Apple Inc.` | 認識する（先頭が単独のティッカー） |
| `Apple Inc. AAPL NASDAQ` | 認識しない |
| `TOYOTA`（6文字） | 認識しない |
| `NASDAQ:AAPL` | 認識しない |
| `株価はNYSEで上昇` | 認識しない |

- 要件: FR-08, NFR-04
- 検証: `auto`（`getTickerCode › 文中の大文字並びには誤マッチしない` / `単語の途中を切り出して別銘柄と誤認しない` / `先頭がティッカーなら後ろに文字列が続いても認識する`）

## SPEC-TC-03 取引所コード付きの米国銘柄

```text
^\s*([A-Z]{1,5})\s*(NASDAQ|NYSE)(?![A-Za-z])
```

`NASDAQ` / `NYSE` のみ認識する。SPEC-TC-02 と同じ理由で先頭アンカーと後続境界が必要。

- 要件: FR-08
- 検証: `auto`（`getTickerCode › 取引所コード付きの米国株を認識する`）

### 既知の弱点（未解決）

`EXCHANGE:TICKER` 形式（TradingView のシンボル表記）を正しく扱えない。

| 入力 | 現在の結果 | 本来あるべき結果 |
| --- | --- | --- |
| `NYSE:AAPL` | `NYSE` を銘柄コードとして扱う | `AAPL` |
| `NYSE AAPL` | `NYSE` | `AAPL` |
| `NASDAQ:AAPL` | 認識しない | `AAPL` |
| `AAPLNASDAQ`（空白なし） | `AAPL` + `NASDAQ` | 認識しない |

`NASDAQ:AAPL` が認識されないのは「`NASDAQ` が6文字で `[A-Z]{1,5}` を超える」という
**偶然**であり、5文字の `NYSE` 側は素通りする。

実在しないティッカー `NYSE` のページを開くだけで、別の実在企業のページを開くわけではないため
緊急度は低い。ただし TradingView のシンボル表記そのものなので、利用場面と直撃する。

対応は FR-14 として要件化した。

## SPEC-TC-04 判定の優先順位

`getTickerCode(text)` は以下の順に試し、最初に一致したものを返す。

| 順 | 判定 | 戻り値 |
| --- | --- | --- |
| 1 | 国内4桁 | `{ status: true, type: 'jp', code }` |
| 2 | 米国 + 取引所コード | `{ status: true, type: 'us', code, exchange }` |
| 3 | 米国のみ | `{ status: true, type: 'us', code }` |
| 4 | いずれにも一致しない | `{ status: false }` |

- 要件: FR-08
- 検証: `auto`（`getTickerCode` の8テスト）

## SPEC-TC-05 遷移先 URL の選択

`getUrl(type, code, exchange, url1, url2, url3)` の分岐。

| 条件 | 使う URL |
| --- | --- |
| `type === 'jp'` | `url1` |
| `type === 'us'` かつ `url2` あり かつ `exchange` あり | `url2` |
| `type === 'us'` かつ `url3` あり | `url3` |
| 上記以外 | `undefined`（メニューに出さない） |

`url3` を持たないサイトは、米国株のとき `undefined` が返り**タブが開かない**。

> Chrome のコンテキストメニュー自体は `remakeContextMenus()`（SPEC-SW-02）が有効な全キーから
> 静的に作るため、米国株非対応サイトも**項目としては出る**。出ないのはタブだけ。
> 右クリック時に絞り込んで表示しているのは TradingView 内のメニュー（SPEC-CS-11）であって、
> Chrome のコンテキストメニューではない。

- 要件: FR-08
- 検証: `manual`（米国株を選択して右クリックし、非対応サイトを選んでも**タブが開かない**こと。チェックリスト D）

## SPEC-TC-06 Content Script での抽出

楽天・SBI の Content Script は要素のテキストから国内コードのみを抽出する。

```javascript
text.trim().match(/[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/g)
```

- **アンカー無し**（要素テキストの途中にコードがある想定）
- 複数一致した場合は**先頭の1件のみ**使う
- 一致しない要素はスキップする

- 要件: FR-02, FR-03
- 検証: `auto`（楽天・SBI の注入テスト）

## SPEC-TC-07 TradingView でのコード取得

チャートの `canvas[aria-hidden!="true"]` の `aria-label` から取得する。
`aria-label` は `EXCHANGE:CODE の 1 日 チャート` の形（実測値: `TSE:7203 の 1 日 チャート`）。

> 取引所接頭辞の扱いを 1.10.1 で拡張した。設計判断は [ADR-0002](../adr/0002-tradingview-dom-repair.md) の 2。

### 手順

1. `aria-label` の先頭から `/^([A-Z]+)(_DLY)?:/` で取引所トークンを取り出す
   （`_DLY` は遅延配信の接尾辞。剥がしてから引く）
2. トークンを `exchanges`（SPEC-EL-09）で引き、`'jp'` / `'us'` / 未登録 を判定する
3. 市場ごとに続く銘柄コードを取り出す

   | 市場 | 抽出 | 戻り値 |
   | --- | --- | --- |
   | `jp` | `[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]` | `{ code, type: 'jp' }` |
   | `us` | `[A-Z]{1,5}` | `{ code, type: 'us' }` |
   | 未登録の取引所 / `aria-label` 無し / 形が合わない | — | `{ code: null, type: null }` |

### 旧との差分

| | 旧（〜1.10.0） | 新（1.10.1〜） |
| --- | --- | --- |
| `jp` の接頭辞 | `TSE:` / `TSE_DLY:` を直書き | `exchanges` の `jp` 登録 ＋ `_DLY` 剥がし |
| `us` の接頭辞 | **`BATS:` のみ** | `exchanges` の `us` 登録（`BATS` / `NASDAQ` / `NYSE` / `AMEX` / `CBOE` / `OTC`） |
| 利用者 | 「株Link」ボタン（SPEC-CS-12）のみ | ボタン ＋ **右クリックメニュー（SPEC-CS-11）** |
| canvas の選び方 | 最初にヒットした1件 | 変更なし（複数チャートでは左上のチャートになる。SPEC-CS-11 の既知の制限） |

拡張理由: 右クリックメニューの銘柄取得をここに一本化したため（SPEC-CS-11）。
ログイン済みで `NASDAQ:` / `NYSE:` のまま表示される場合に `BATS:` 限定では取れない。

### 未ログイン時の TradingView の挙動（2026-08-23 実測）

| URL で指定した銘柄 | `aria-label` |
| --- | --- |
| `TSE:7203` | `TSE:7203 …`（遅延配信時は `TSE_DLY:7203 …`） |
| `NASDAQ:AAPL` | **`BATS:AAPL …`** |
| `NYSE:IBM` | **`BATS:IBM …`** |

**未ログインでは米国株の提供元が BATS に置き換わる。** 旧実装が `BATS:` だけで足りていたのはこのため。
ログイン済み（特に有料データ契約あり）で `NASDAQ:` / `NYSE:` のまま出るかは**未確認**。
`exchanges` に両方を登録してあるため、どちらの表記でも銘柄コードを取得できる。

> `code: null` のとき、ボタンは隠れ（SPEC-CS-12）、右クリックメニューは変更されない（SPEC-CS-11）。
> **エラーは出さない。**
>
> Service Worker 側の `getTickerCode(text)`（SPEC-TC-02〜04）は**この変更の対象外**。
> 選択文字列から `NYSE:AAPL` を解釈する話（FR-14）は別タスクに残す。
> ただし取引所の一覧は `exchanges`（SPEC-EL-09）に置くため、FR-14 に着手する際は
> そこを参照すればよく、一覧を二重に持つ必要はない。
>
> サイト側 DOM に強く依存する。TradingView の改修で無言のうちに壊れる。

- 要件: FR-04
- 検証: `auto`（表そのものは SPEC-EL-09 の `urls.js: exchanges` で検査。
  `aria-label` の解析自体は TradingView 上でしか動かないため自動テスト対象外）／
  `半自動`（`npm run check:selectors -- --only=tradingview` の `chart-canvas` と
  `tv-symbol` 追加検査。SPEC-SC-11）／
  `manual`（`docs/MANUAL-CHECKLIST.md` A-1 / A-7。TradingView にログインして `NASDAQ:AAPL` でも
  「株Link」ボタンが出ること）

## SPEC-TC-08 コンテキストメニューでの抽出

`chrome.contextMenus.onClicked` の `info.selectionText` に対して SPEC-TC-04 を適用する。
`status: false` の場合は何も開かず、コンソールに「銘柄コードが見つかりませんでした」を出す。

- 要件: FR-05
- 検証: `auto`（`getTickerCode` のテスト）／`manual`（実際に選択して右クリック）

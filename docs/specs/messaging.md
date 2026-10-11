# SPEC-MSG: メッセージ通信

実装: `src/service_worker.js`（受信）、`src/tradingview-cs.js`（送信）

## SPEC-MSG-01 通信方式

`chrome.runtime.sendMessage` / `chrome.runtime.onMessage` を使う。

リクエスト形式:

```javascript
{ type: '<メッセージ種別>', data: { ... } }
```

レスポンス形式:

```javascript
{ type: '<リクエストと同じ種別>', data: { ... } | null }
```

- 要件: FR-06
- 検証: `manual`（TradingView 上で動作確認）

## SPEC-MSG-02 メッセージ一覧

> 証券会社4種の応答は 1.20.1 で `{ available: boolean }` に変えた（SPEC-MSG-06）。
> 1.20.0 までの応答は `{ rakutenUrl: string | null }` / `{ naitoUrl: string | null }`（URL そのもの）。

| type | data (要求) | data (応答) | 動作 |
| --- | --- | --- | --- |
| `rakuten-sec:info` | `{ code, type }` | `{ available: boolean }` | 楽天証券の URL が組み立てられるか（ログイン済みタブがあるか）を返すだけ |
| `rakuten-sec:open` | `{ code, type }` | `{ available: boolean }` | URL を組み立て、組み立てられたら新しいタブで開く。開いたかを返す |
| `naito-sec:info` | `{ code, type }` | `{ available: boolean }` | 内藤証券について同上 |
| `naito-sec:open` | `{ code, type }` | `{ available: boolean }` | 内藤証券について同上 |
| `open-url` | `{ url }` | `null` | 指定 URL を新しいタブで開く |

- `available` は `getRakutenSecUrlAsync()` / `getNaitoSecUrlAsync()` の戻り値が非 `null` のとき `true`
- `:info` は「メニューに項目を出すべきか」の判定に使い、`:open` は実際の遷移に使う
- **URL は `:open` を受けた Service Worker がその場で組み立て直す。** `:info` の時点の URL を持ち越さない
- `open-url` は**情報サイト**（`externalUrls` 由来の URL）にだけ使う。証券会社の URL を `open-url` で送らない

- 要件: FR-06, NFR-03
- 検証: `auto`（describe **`service_worker: 証券会社の応答`**。SPEC-MSG-06）／`manual`

## SPEC-MSG-03 非同期応答の扱い

`onMessage` ハンドラは以下を返す。

| type | 戻り値 | 理由 |
| --- | --- | --- |
| `rakuten-sec:*` / `naito-sec:*` | `true` | 非同期で `sendResponse` するためチャネルを保持する |
| `open-url` | `false` | 応答を同期的に返し終えている（下記） |
| 未知の type | `false` | 何もしない |

> **`open-url` の応答は送信側に届く**（2026-10-11 訂正。以前は「`false` を返すので届かない」と書いていたが誤り）。
> `onMessageOpenUrlAsync()` は `async` だが `await` を含まず、`chrome.tabs.create()` の呼び出し（待たない）の後に
> `sendResponse?.({ type, data: null })` を**リスナーの実行中に同期で**呼ぶ。`false`（チャネルを保持しない）の返却は
> リスナーから戻った後の非同期応答だけを不可にするもので、同期で呼んだ `sendResponse` は届く。
> 送信側（`openUrlAsync()`）は応答の中身を使わない。

- 要件: —
- 検証: `manual`

## SPEC-MSG-04 送信元

現在 `chrome.runtime.sendMessage` を使うのは **`tradingview-cs.js` のみ**。
楽天・SBI の Content Script は storage を直接読むだけで、Service Worker と通信しない。

- 要件: —
- 検証: `lint` / `manual`

## SPEC-MSG-05 エラー処理

- Service Worker 側は `code` / `type` の検証をしない
- ログイン済みタブが無い場合は例外ではなく `null` を返す
- 送信側は `response.data.available` だけを見る（1.20.0 までは `rakutenUrl` / `naitoUrl` の有無）

> 既知の弱点: Service Worker が休止して応答しない場合、送信側の `await` が
> reject して Content Script のメニュー構築が途中で止まる可能性がある。
> try/catch が無い。

- 要件: NFR-01
- 検証: `manual`（未対応。改善候補）

## SPEC-MSG-06 証券会社の URL を Content Script に渡さない

> 1.20.1 で実装した。要件は NFR-03 / CON-04。設計判断は [ADR-0016](../adr/0016-broker-url-stays-in-service-worker.md)。

**証券会社の URL（楽天証券の `BV_SessionID` を含む URL、内藤証券のログイン済みタブの URL）は、
Service Worker の外に出さない。** Content Script・注入先ページの DOM・メッセージの応答のいずれにも載せない。

| 経路 | 1.20.0 まで | 1.20.1 |
| --- | --- | --- |
| `*:info` / `*:open` の応答 | URL 文字列 | `{ available: boolean }` のみ（SPEC-MSG-02） |
| TradingView 右クリックの証券会社項目 | `<a href="<URL>">` を DOM に挿入 | `href` を持たない行。クリックで `*:open` を送る（SPEC-CS-28） |
| TradingView「株Link」ボタンの証券会社項目 | `*:open` を送る（URL は DOM に無い） | 変更なし |

**理由:** Content Script は注入先ページと同じレンダラープロセスで動く。Chrome は
「Content Script に送ったデータはページへ漏れうると見なす」「機微な処理は Service Worker で行う」
と定めている（[Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)）。
DOM に書き出した URL は TradingView のページスクリプト・計測スクリプトから読める。

**`:open` が URL を組み立て直すことの帰結:**

| 状況 | 結果 |
| --- | --- |
| 右クリック後〜クリックまでに楽天証券のタブを閉じた | `available: false`。タブは開かない |
| 同、別のログイン済みタブに切り替わった | その時点のタブのセッション ID で開く |

### 検証

`tests/service-worker.spec.mjs` の describe **`service_worker: 証券会社の応答`**（1.20.1）。

| テスト名 | 手順 | 期待 |
| --- | --- | --- |
| `楽天証券の info と open の応答に URL を含めない` | `chrome.tabs.query` を差し替え、`member.rakuten-sec.co.jp` の問い合わせに `;BV_SessionID=KTTSECRET` を含むタブを返す。`chrome.tabs.create` を差し替えて URL を記録する。`onMessageRakutenSecInfoAsync` / `onMessageRakutenSecOpenAsync` を `{ type, data: { code: '7203', type: 'jp' } }` で直接呼び、`sendResponse` で応答を受ける | 応答が `{ type, data: { available: true } }` と一致する。`JSON.stringify(応答)` に `KTTSECRET` が無い。`open` では `tabs.create` が1回呼ばれ、その URL が `KTTSECRET` と `7203` を含む |
| `内藤証券の info と open の応答に URL を含めない` | 同上。`qhit.net/naito/iswebptt2` の問い合わせに `qcode=1301` と秘密値 `KTTSECRET` を含むタブを返す | 同上（`tabs.create` の URL は `qcode=7203` と `KTTSECRET` を含む） |
| `ログイン済みタブが無ければ available は false で、タブを開かない` | `chrome.tabs.query` が `[]` を返す | 4種とも `available: false`。`tabs.create` は0回 |

- `context` はテストごとに作り直される（`tests/fixtures/extension.mjs`）ので、差し替えを戻す処理は要らない
- 秘密値は**応答の文字列全体**に対して検査する（フィールド名を変えて URL を残す誤りも落とすため）

- 要件: NFR-03, CON-04, FR-06
- 検証: `auto`（上表）＋ SPEC-CS-28 の DOM 側の回帰テスト

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

| type | data (要求) | data (応答) | 動作 |
|------|------------|------------|------|
| `rakuten-sec:info` | `{ code, type }` | `{ rakutenUrl: string \| null }` | 楽天証券 URL を返すだけ |
| `rakuten-sec:open` | `{ code, type }` | `{ rakutenUrl: string \| null }` | URL を返し、かつ新しいタブで開く |
| `naito-sec:info` | `{ code, type }` | `{ naitoUrl: string \| null }` | 内藤証券 URL を返すだけ |
| `naito-sec:open` | `{ code, type }` | `{ naitoUrl: string \| null }` | URL を返し、かつ新しいタブで開く |
| `open-url` | `{ url }` | `null` | 指定 URL を新しいタブで開く |

`:info` は「メニューに項目を出すべきか」の判定に使い、`:open` は実際の遷移に使う。

- 要件: FR-06
- 検証: `manual`

## SPEC-MSG-03 非同期応答の扱い

`onMessage` ハンドラは以下を返す。

| type | 戻り値 | 理由 |
|------|--------|------|
| `rakuten-sec:*` / `naito-sec:*` | `true` | 非同期で `sendResponse` するためチャネルを保持する |
| `open-url` | `false` | 応答を待たない |
| 未知の type | `false` | 何もしない |

> `open-url` のハンドラ内でも `sendResponse` を呼んでいるが、`false` を返しているため
> 送信側には届かない。送信側 (`tradingview-cs.js`) が応答を使っていないため実害は無い。

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
- 送信側は `response.data.rakutenUrl` の有無だけを見る

> 既知の弱点: Service Worker が休止して応答しない場合、送信側の `await` が
> reject して Content Script のメニュー構築が途中で止まる可能性がある。
> try/catch が無い。

- 要件: NFR-01
- 検証: `manual`（未対応。改善候補）

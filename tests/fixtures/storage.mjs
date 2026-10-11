/**
 * storage に残った未知のキー（廃止済みの key）を再現する設定値（SPEC-ST-03 / NFR-05）。
 *
 * サイト廃止で `externalUrls` からエントリを消しても、利用者の `chrome.storage.sync` には
 * その key が残る。4経路（Service Worker / オプションページ / 楽天・SBI の注入メニュー /
 * TradingView のメニュー）のテストで同じ値を使う。
 *
 * - 未知キーは実在しえない値にする（`.invalid` は予約済みの TLD）
 * - 未知キーを**既知キー2件の間に**挟む。読み飛ばした後の並びまで見るため
 * - 既知キー2件は `externalUrls` の定義順（`minkabu.jp/stock` → `kabutan.jp/stock`）の**逆**にする。
 *   定義順のまま並んだ場合と区別するため
 */
export const STALE_KEY = 'ktt-test.invalid/removed'

export const STALE_KEYS = Object.freeze({
  'kabutan.jp/stock': 0,
  [STALE_KEY]: 1,
  'minkabu.jp/stock': 2
})

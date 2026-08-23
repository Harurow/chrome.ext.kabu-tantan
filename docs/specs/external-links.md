# SPEC-EL: 遷移先サイト定義と URL 生成

実装: `src/urls.js`

## SPEC-EL-01 エントリの構造

`externalUrls` は以下の形の配列。**配列の順序がオプション画面の初期表示順になる。**

| フィールド | 必須 | 用途 |
|-----------|------|------|
| `key` | ✓ | 一意識別子。`chrome.storage.sync` に保存される（SPEC-ST-01） |
| `title` | ✓ | メニュー・オプション画面での表示名 |
| `url0` | ✓ | サイトのトップページ。オプション画面の「開く」リンク先 |
| `url1` | ✓ | 国内株の遷移先 |
| `url2` | | 米国株・取引所コードあり |
| `url3` | | 米国株・取引所コードなし |

- 要件: FR-07
- 検証: `auto`（`externalUrls の整合性 › key が一意で必須フィールドが揃っている`）

## SPEC-EL-02 key の不変性

`key` は `chrome.storage.sync` に保存される永続識別子。
**一度公開した `key` は変更しない。** 変更すると既存ユーザーの設定が失われる。

サイトを廃止する場合はエントリごと削除する。オプション画面と Service Worker は
storage に残った未知の `key` を無視する（SPEC-ST-03）。

- 要件: NFR-05, CON-05
- 検証: `manual`（レビュー時に `key` の変更が無いことを確認）

## SPEC-EL-03 URL テンプレート

`makeUrl(urlTemplate, code, exchange)` がプレースホルダを展開する。

| プレースホルダ | 展開結果 | 使用箇所 |
|---------------|---------|---------|
| `${code}` | 銘柄コードそのもの | `url1` / `url2` / `url3` |
| `${code:0}` | 銘柄コードの先頭1文字 | `url1`（株Biz の階層 URL） |
| `${exchange}` | 取引所コード（`NASDAQ` / `NYSE`） | `url2` のみ |

`exchange` が未指定の場合 `${exchange}` は展開されない。

- 要件: FR-07
- 検証: `auto`（`urls.js: makeUrl` の3テスト）

## SPEC-EL-04 全 URL は https

`url0` / `url1` / `url2` / `url3` はすべて `https://` で始まる。

- 要件: NFR-03
- 検証: `auto`（`externalUrls の整合性 › key が一意で必須フィールドが揃っている`）

## SPEC-EL-05 url1 は必ず銘柄コードを含む

すべての `url1` は `${code}` を含む。

- 要件: FR-07
- 検証: `auto`（`externalUrls の整合性 › url1 は必ず ${code} を含む`）

## SPEC-EL-06 登録済みサイト一覧（22件）

| # | key | title | url1 | 米国株 |
|---|-----|-------|------|--------|
| 1 | `tradingview.com/chart` | TradingView/スーパーチャート | `https://jp.tradingview.com/chart/?symbol=TSE%3A${code}` | ✓ |
| 2 | `minkabu.jp/stock` | MINKABU/株価情報トップ | `https://minkabu.jp/stock/${code}` | ✓ |
| 3 | `kabutan.jp/stock` | 株探/基本情報 | `https://kabutan.jp/stock/?code=${code}` | ✓ |
| 4 | `finance.yahoo.co.jp/bbs` | Yahoo!ファイナンス/掲示板 | `https://finance.yahoo.co.jp/quote/${code}/bbs` | ✓ |
| 5 | `finance.yahoo.co.jp/` | Yahoo!ファイナンス/詳細情報 | `https://finance.yahoo.co.jp/quote/${code}.T` | ✓ |
| 6 | `www.nikkei.com/company` | 日本経済新聞 | `https://www.nikkei.com/nkd/company/?scode=${code}` | — |
| 7 | `shikiho.toyokeizai.net/stocks` | 四季報 | `https://shikiho.toyokeizai.net/stocks/${code}` | — |
| 8 | `kabubiz.com/getuji` | 株Biz/月次Web | `https://kabubiz.com/getuji/code/${code}.php` | — |
| 9 | `kabubiz.com/riron` | 株Biz/理論株価Web | `https://kabubiz.com/riron/${code:0}000/${code}.php` | — |
| 10 | `kabumap.com/base` | 株マップ.com/銘柄基本情報 | `https://jp.kabumap.com/servlets/kabumap/Action?SRC=basic/top/base&codetext=${code}` | — |
| 11 | `kabuyoho.ifis.co.jp/report` | 株予報 | `https://kabuyoho.ifis.co.jp/index.php?action=tp1&sa=report&bcode=${code}` | — |
| 12 | `kabuyoho.jp/` | 株予報Pro | `https://kabuyoho.jp/reportTop?bcode=${code}` | — |
| 13 | `kabuline.com/search` | 株ライン | `https://kabuline.com/search/tw/${code}` | — |
| 14 | `karauri.net/` | karauri.net | `https://karauri.net/${code}/` | — |
| 15 | `sharedresearch.jp/companies` | シェアードリサーチ | `https://sharedresearch.jp/ja/companies/${code}` | — |
| 16 | `holistic-r.org/report` | 証券リサーチセンター | `https://holistic-r.org/report/${code}/` | — |
| 17 | `nikkeiyosoku.com/stock/` | 投資の森 | `https://nikkeiyosoku.com/stock/${code}/` | — |
| 18 | `www.buffett-code.com/company` | バフェット・コード | `https://www.buffett-code.com/company/${code}/` | — |
| 19 | `www.kabuka.jp.net/rating` | 目標株価まとめ | `https://www.kabuka.jp.net/rating/${code}.html` | — |
| 20 | `ullet/` | Ullet | `https://www.ullet.com/${code}.html` | — |
| 21 | `finance.logmi.jp/` | logmi | `https://finance.logmi.jp/companies?query=${code}` | — |
| 22 | `moomoo.com/` | moomoo証券 | `https://www.moomoo.com/ja/stock/${code}-JP` | ✓ |

米国株対応（`url3` を持つ）は 6 件。

> 既知の不整合: `key` の命名が揺れている（`ullet/`、`karauri.net/` など）。
> ただし SPEC-EL-02 により**変更できない**。新規追加時はドメイン+パス形式に揃える。

- 要件: FR-07
- 検証: `auto`（整合性テスト）／`manual`（各サイトの URL 形式がサイト改修で変わっていないか）

## SPEC-EL-07 廃止済みエントリ

`iMarket`（`tyn-imarket.com/stocks`）は `src/urls.js` 内にコメントアウトで残っている。
オプション画面にもメニューにも出ない。

- 要件: —
- 検証: `manual`

## SPEC-EL-08 externalUrlsMap

`externalUrls` を `key` で引ける連想配列に変換したもの。
Service Worker・Content Script・オプションページが参照する。

- 要件: —
- 検証: `auto`（メニュー生成テストが間接的に検証）

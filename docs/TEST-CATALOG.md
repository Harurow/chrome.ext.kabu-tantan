# テストカタログ

> **このファイルは `npm run docs:tests` で自動生成される。手で編集しない。**
> 説明文を変えたい場合は `scripts/test-catalog.mjs` を編集する。

テスト総数: **29**

テストの方針・手法は [TESTING.md](TESTING.md) を参照。

## Content Script（楽天証券 / SBI証券）

`tests/content-script.spec.mjs` — 7 件

context.route() で対象オリジンにフィクスチャ HTML を返し、実際の注入を検証する。

対応する仕様: SPEC-CS, SPEC-MF

| # | グループ | テスト |
| --- | --- | --- |
| 1 | 楽天証券 Content Script | お気に入りの銘柄コードにリンクメニューを注入する |
| 2 | 楽天証券 Content Script | メニュー項目が銘柄コード入りの外部リンクになっている |
| 3 | 楽天証券 Content Script | ホバーでメニューが開く |
| 4 | 楽天証券 Content Script | 対象外のページにはメニューを注入しない |
| 5 | SBI証券 Content Script | ポートフォリオの銘柄コードにリンクメニューを注入する |
| 6 | SBI証券 Content Script | 銘柄コードごとに異なる URL が生成される |
| 7 | 設定の反映 | オプションで無効にしたサイトはメニューに出ない |

## オプションページ

`tests/options.spec.mjs` — 8 件

chrome-extension:// のオプションページを開き、表示・操作・保存を検証する。

対応する仕様: SPEC-OP, SPEC-ST

| # | グループ | テスト |
| --- | --- | --- |
| 1 | オプションページ | 全ての連携サイトが一覧表示される |
| 2 | オプションページ | 初期状態では全てのトグルが ON |
| 3 | オプションページ | 行がグリッドとして横並びにレイアウトされる |
| 4 | オプションページ | トグルを OFF にして保存すると設定が永続化される |
| 5 | オプションページ | ハンドルをドラッグして並び替えた順序が保存される |
| 6 | オプションページ | 各行のリンクが url0 を新規タブで開く設定になっている |
| 7 | オプションページ | 外部ホストへ一切リクエストしない |
| 8 | オプションページ | Material Icons がローカル同梱フォントとして読み込まれリガチャが効く |

## Service Worker / 共有モジュール

`tests/service-worker.spec.mjs` — 14 件

Service Worker のグローバルスコープを直接 evaluate して、純粋なロジックを検証する。

対応する仕様: SPEC-TC, SPEC-EL, SPEC-SW

| # | グループ | テスト |
| --- | --- | --- |
| 1 | service_worker: getTickerCode | 4桁の国内銘柄コードを jp として認識する |
| 2 | service_worker: getTickerCode | 英字を含む国内銘柄コード（例: 135A）も認識する |
| 3 | service_worker: getTickerCode | 取引所コード付きの米国株を認識する |
| 4 | service_worker: getTickerCode | 取引所コードなしの米国株を認識する |
| 5 | service_worker: getTickerCode | 文中の大文字並びには誤マッチしない |
| 6 | service_worker: getTickerCode | 単語の途中を切り出して別銘柄と誤認しない |
| 7 | service_worker: getTickerCode | 先頭がティッカーなら後ろに文字列が続いても認識する |
| 8 | service_worker: getTickerCode | 銘柄コードが無い文字列は false を返す |
| 9 | service_worker: compareVersion | マイナー/パッチを数値として比較する |
| 10 | urls.js: makeUrl | ${code} を置換する |
| 11 | urls.js: makeUrl | ${code:0} は先頭1文字に置換する |
| 12 | urls.js: makeUrl | ${exchange} は指定時のみ置換する |
| 13 | urls.js: externalUrls の整合性 | key が一意で必須フィールドが揃っている |
| 14 | urls.js: externalUrls の整合性 | url1 は必ず ${code} を含む |

## 回帰テストとして重要なもの

壊れたときに気づきにくい問題を固定しているテスト。**消さないこと。**

| テスト | 何を守っているか |
| --- | --- |
| オプションページ › 行がグリッドとして横並びにレイアウトされる | Materialize 2.x で .col が廃止され .row が CSS Grid 化した影響の検出 |
| オプションページ › ハンドルをドラッグして並び替えた順序が保存される | jQuery UI 1.14.2 が jQuery 4.0.0 上で動くことの実証 |
| オプションページ › 外部ホストへ一切リクエストしない | CDN・外部フォント・外部画像への依存が再混入していないかの検出 |
| オプションページ › Material Icons がローカル同梱フォントとして読み込まれリガチャが効く | Material Icons のサブセット失敗（アイコン名が文字列のまま出る）の検出 |
| service_worker: getTickerCode › 文中の大文字並びには誤マッチしない | 米国株の正規表現から先頭アンカー ^ が失われていないかの検出 |
| service_worker: compareVersion › マイナー/パッチを数値として比較する | バージョン比較が文字列比較に戻っていないかの検出 |

## 対象外

| 対象 | 理由 |
| --- | --- |
| TradingView (`tradingview-cs.js`) | DOM がハッシュ付きクラス名で毎リリース変わる。フィクスチャ化しても実サイトとの乖離を検出できない (CON-08) |
| 楽天証券・内藤証券のセッション連携 | ログイン済みタブが前提のため自動化していない (CON-04) |
| 楽天スーパースクリーナー / SBI銘柄スクリーニング | MutationObserver + iframe 前提で再現コストが見合わない |

これらは変更時に手動確認する。手順は [TESTING.md](TESTING.md) を参照。

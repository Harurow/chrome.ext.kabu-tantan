# セレクタ検証結果

> このファイルは `npm run check:selectors` が生成する。手で編集しない。
> 実行のたびに全体を上書きする（履歴は git で追う）。

| | |
| --- | --- |
| 実行日時 | 2026-10-15 21:04 (JST) |
| 拡張機能バージョン | 1.21.0 |
| Chromium | 156.0.8078.4 |
| 総合判定 | ✅ 破損 0 件 / 未到達 0 件 / 未実施 17 件（対象外 1 件は判定に含めない） |

## サマリ

| サイト | 対象 | ✅ 正常 | ❌ 破損 | ⚠️ 未到達 | — 未実施 | 👤 対象外 |
| --- | --- | --- | --- | --- | --- | --- |
| 楽天証券 | 14 | 0 | 0 | 0 | 13 | 1 |
| 楽天スーパースクリーナー | 1 | 0 | 0 | 0 | 1 | 0 |
| SBI証券 | 2 | 0 | 0 | 0 | 2 | 0 |
| SBI銘柄スクリーニング | 1 | 0 | 0 | 0 | 1 | 0 |
| TradingView | 5 | 5 | 0 | 0 | 0 | 0 |

## 楽天証券

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| お気に入り | — | — | — | — | `--only` の対象外 |
| お気に入り・米国株 | — | — | — | — | `--only` の対象外 |
| お気に入り編集 | — | — | — | — | `--only` の対象外 |
| お気に入り編集・米国株 | — | — | — | — | `--only` の対象外 |
| 保有商品一覧・すべて | — | — | — | — | `--only` の対象外 |
| 保有商品一覧・国内株式 | — | — | — | — | `--only` の対象外 |
| ランキング・売買代金 | — | — | — | — | `--only` の対象外 |
| ランキング・出来高 | — | — | — | — | `--only` の対象外 |
| ランキング・値上り・値下り | — | — | — | — | `--only` の対象外 |
| ランキング・信用残 | — | — | — | — | `--only` の対象外 |
| ランキング・積立 | — | — | — | — | `--only` の対象外 |
| ランキング・楽天内 | — | — | — | — | `--only` の対象外 |
| 国内株式・個別銘柄 | — | — | — | — | `--only` の対象外 |
| 国内株式・株価検索 | 👤 | — | — | — | 検索が POST でアドレスが変わらず、ツールでは検索結果画面に到達できない（フォーム送信は行わない。CON-10）。注入の確認は人が行う |

### 検証したセレクタ（楽天証券）

| ページ | 検出用セレクタ |
| --- | --- |
| お気に入り | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り・米国株 | `table#pcmm-foreign-stock tr > td:nth-of-type(2) div.mbody` |
| お気に入り編集 | `form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り編集・米国株 | `table#pcmm-foreign-stock tr > td:nth-of-type(2) div.mbody` |
| 保有商品一覧・すべて | `div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td, div#table_possess_data table.tbl-bold-border tr > td:contains("米国株式") + td` |
| 保有商品一覧・国内株式 | `table#poss-tbl-sp tr td table tr td nobr` |
| ランキング・売買代金 | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・出来高 | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・値上り・値下り | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・信用残 | `div#str-main-inner div.mbody table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・積立 | `div#str-main-inner table table.tbl-data-01 tr td:nth-of-type(2)` |
| ランキング・楽天内 | `div#daily-ranking table.tbl-data-01 tr td.align-C, div#weekly-ranking table.tbl-data-01 tr td.align-C, div#daily-ranking-margin table.tbl-data-01 tr td.align-C, div#margin-oneday-ranking table.tbl-data-01 tr td.align-C, div#sor-ranking table.tbl-data-01 tr td.align-C` |
| 国内株式・個別銘柄 | `div#line1 h1.hdg-l1-01-title span:first` |
| 国内株式・株価検索 | `div#line1 h1.hdg-l1-01-title span:first` |

## 楽天スーパースクリーナー

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| スーパースクリーナー | — | — | — | — | `--only` の対象外 |

### 検証したセレクタ（楽天スーパースクリーナー）

| ページ | 検出用セレクタ |
| --- | --- |
| スーパースクリーナー | `div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a` |

## SBI証券

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| 個別銘柄 | — | — | — | — | `--only` の対象外 |
| ポートフォリオ | — | — | — | — | `--only` の対象外 |

### 検証したセレクタ（SBI証券）

| ページ | 検出用セレクタ |
| --- | --- |
| 個別銘柄 | `div#main div.mgt15 div.trHead01 table.tbl01 tr.vaT td.tdL H3 span.fm01 span.normal` |
| ポートフォリオ | `div.middleArea2 div.middleAreaM2 table table table tr td.mtext:nth-of-type(2)` |

## SBI銘柄スクリーニング

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| スクリーナー | — | — | — | — | `--only` の対象外 |

### 検証したセレクタ（SBI銘柄スクリーニング）

| ページ | 検出用セレクタ |
| --- | --- |
| スクリーナー | `div#root div.App div.Screener div.resultpane div.ResultListMainDiv table.leftTable tr td.c.fixedtable:nth-of-type(1)` |

## TradingView

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| チャート canvas | ✅ | 14 | 1 | 1 | `aria-label` は `TSE_DLY:` で始まる<br>米国株（BATS）でも `aria-label` は `BATS:` で始まる |
| ツールバー挿入先 | ✅ | 14 | 1 | 1 | |
| ウォッチリストの行 | ✅ | 14 | 18 | — | |
| オーバーレイレイヤー | ✅ | 14 | 1 | 1 | |
| 右クリックメニュー | ✅ | 1 | 1 | 1 | 入れ子の隙間は 0px（親行から入れ子へ途切れずに移れる） |

### 検証したセレクタ（TradingView）

| ページ | 検出用セレクタ |
| --- | --- |
| チャート canvas | `div.chart-gui-wrapper canvas[aria-hidden!="true"]` |
| ツールバー挿入先 | `div.container-OH8c8Nc3` |
| ウォッチリストの行 | `[data-symbol-full],[data-symbol-short]` |
| オーバーレイレイヤー | `div#overlap-manager-root` |
| 右クリックメニュー | `div.context-menu table` |

## 未実施の対象

| サイト | 対象 | 理由 |
| --- | --- | --- |
| 楽天証券 | お気に入り | `--only` の対象外 |
| 楽天証券 | お気に入り・米国株 | `--only` の対象外 |
| 楽天証券 | お気に入り編集 | `--only` の対象外 |
| 楽天証券 | お気に入り編集・米国株 | `--only` の対象外 |
| 楽天証券 | 保有商品一覧・すべて | `--only` の対象外 |
| 楽天証券 | 保有商品一覧・国内株式 | `--only` の対象外 |
| 楽天証券 | ランキング・売買代金 | `--only` の対象外 |
| 楽天証券 | ランキング・出来高 | `--only` の対象外 |
| 楽天証券 | ランキング・値上り・値下り | `--only` の対象外 |
| 楽天証券 | ランキング・信用残 | `--only` の対象外 |
| 楽天証券 | ランキング・積立 | `--only` の対象外 |
| 楽天証券 | ランキング・楽天内 | `--only` の対象外 |
| 楽天証券 | 国内株式・個別銘柄 | `--only` の対象外 |
| 楽天スーパースクリーナー | スーパースクリーナー | `--only` の対象外 |
| SBI証券 | 個別銘柄 | `--only` の対象外 |
| SBI証券 | ポートフォリオ | `--only` の対象外 |
| SBI銘柄スクリーニング | スクリーナー | `--only` の対象外 |

## 対象外の対象（人が確認する）

| サイト | 対象 | 理由 |
| --- | --- | --- |
| 楽天証券 | 国内株式・株価検索 | 検索が POST でアドレスが変わらず、ツールでは検索結果画面に到達できない（フォーム送信は行わない。CON-10）。注入の確認は人が行う |

## 判定の読み方

| 記号 | 意味 |
| --- | --- |
| ✅ | ページ識別セレクタがヒットし、検出用セレクタも1件以上ヒットした |
| ❌ | **ページに到達したと判断できるのに**検出用セレクタが 0 件。サイト改修でセレクタが壊れた疑い |
| ⚠️ | ページに到達したと判断できない（題名が未到達の目印に当たる／題名から判断できない）。ページを開けていない |
| — | 未実施（`--only` で除外・ログインしていない・対象のタブが開かれていない） |
| 👤 | 対象外。ツールの仕組みでは到達できないため人が確認する。**判定ではないので破損・未到達・未実施のどれにも数えない** |

「注入」は拡張機能が実際に挿入した要素の数（参考値。判定には使わない）。

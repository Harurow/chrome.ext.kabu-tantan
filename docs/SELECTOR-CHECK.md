# セレクタ検証結果

> このファイルは `npm run check:selectors` が生成する。手で編集しない。
> 実行のたびに全体を上書きする（履歴は git で追う）。

| | |
| --- | --- |
| 実行日時 | 2026-09-01 12:43 (JST) |
| 拡張機能バージョン | 1.18.0 |
| Chromium | 151.0.7922.34 |
| 総合判定 | ❌ 破損 3 件 / 未到達 0 件 / 未実施 8 件 |

## サマリ

| サイト | 対象 | ✅ 正常 | ❌ 破損 | ⚠️ 未到達 | — 未実施 |
| --- | --- | --- | --- | --- | --- |
| 楽天証券 | 14 | 11 | 3 | 0 | 0 |
| 楽天スーパースクリーナー | 1 | 0 | 0 | 0 | 1 |
| SBI証券 | 2 | 0 | 0 | 0 | 2 |
| SBI銘柄スクリーニング | 1 | 0 | 0 | 0 | 1 |
| TradingView | 4 | 0 | 0 | 0 | 4 |

## 楽天証券

| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |
| --- | --- | --- | --- | --- | --- |
| お気に入り | ✅ | 1 | 70 | 35 | |
| お気に入り・米国株 | ❌ | 0 | 0 | 0 | 先頭の `form#form` が 0 件<br>ページ識別セレクタは 0 件だが、題名から到達と判断した<br>利用者データ（お気に入り・保有銘柄）が 0 件でも同じ結果になる。登録状況を確認すること |
| お気に入り編集 | ✅ | 1 | 70 | 35 | |
| お気に入り編集・米国株 | ❌ | 1 | 0 | 0 | `form table.tbl-data-01` まで 1 件 → `form table.tbl-data-01 td.align-C` で 0 件<br>利用者データ（お気に入り・保有銘柄）が 0 件でも同じ結果になる。登録状況を確認すること |
| 保有商品一覧・すべて | ✅ | 1 | 6 | 6 | |
| 保有商品一覧・国内株式 | ✅ | 1 | 5 | 5 | |
| ランキング・売買代金 | ✅ | 1 | 20 | 20 | |
| ランキング・出来高 | ✅ | 1 | 20 | 20 | |
| ランキング・値上り・値下り | ✅ | 1 | 20 | 20 | |
| ランキング・信用残 | ✅ | 1 | 20 | 20 | |
| ランキング・積立 | ✅ | 2 | 20 | 20 | |
| ランキング・楽天内 | ✅ | 5 | 553 | 550 | |
| 国内株式・個別銘柄 | ✅ | 1 | 1 | 1 | |
| 国内株式・株価検索 | ❌ | 0 | 0 | 0 | 先頭の `div#line1` が 0 件<br>ページ識別セレクタは 0 件だが、題名から到達と判断した |

### お気に入り・米国株の手がかり

| 項目 | 内容 |
| --- | --- |
| 到達先の題名 | お気に入り銘柄情報-米国株式 \| お気に入り銘柄 \| マーケット \| 楽天証券[PC] |
| 到達判定 | 到達したとみなす（題名が未到達の目印に当たらない） |
| 見出し | `h1.hdg-l1-01` |
| 主要コンテナ | `div.pcm-header`, `div.pcm-content`, `div.mbody`, `iframe#suggest_frame0_1788234178686.mf_suggest_frame`, `iframe` |

プレフィックス追跡（検出用セレクタ）

| 段階 | セレクタ | ヒット |
| --- | --- | --- |
| 1 | `form#form` | 0 |

### お気に入り編集・米国株の手がかり

| 項目 | 内容 |
| --- | --- |
| 到達先の題名 | お気に入り銘柄情報-米国株式 \| お気に入り銘柄 \| マーケット \| 楽天証券[PC] |
| 到達判定 | ページ識別セレクタ・検出用セレクタのいずれかがヒットしたため題名を見ていない |
| 見出し | `h1.hdg-l1-01` |
| 主要コンテナ | `div.pcm-header`, `div.pcm-content`, `div.mbody`, `iframe`, `input#ratAccountId` |

プレフィックス追跡（検出用セレクタ）

| 段階 | セレクタ | ヒット |
| --- | --- | --- |
| 1 | `form` | 2 |
| 2 | `form table.tbl-data-01` | 1 |
| 3 | `form table.tbl-data-01 td.align-C` | 0 |

### 国内株式・株価検索の手がかり

| 項目 | 内容 |
| --- | --- |
| 到達先の題名 | 国内株式トップ \| 株価検索 \| 国内株式トップ \| 国内株式 \| 楽天証券[PC] |
| 到達判定 | 到達したとみなす（題名が未到達の目印に当たらない） |
| 見出し | `h1.hdg-l1-01`, `h3.hdg-l3-01`, `h2.index-hdg-l2.mb10`, `h2.flat-hdg-l2-01`, `h2.hdg-l2-01` |
| 主要コンテナ | `div.pcm-header`, `div.pcm-content`, `div.mbody`, `iframe#suggest_frame0_1788234207112.mf_suggest_frame`, `iframe` |

プレフィックス追跡（検出用セレクタ）

| 段階 | セレクタ | ヒット |
| --- | --- | --- |
| 1 | `div#line1` | 0 |

### 検証したセレクタ（楽天証券）

| ページ | 検出用セレクタ |
| --- | --- |
| お気に入り | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り・米国株 | `form#form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り編集 | `form table.tbl-data-01 td.align-C div.mbody nobr` |
| お気に入り編集・米国株 | `form table.tbl-data-01 td.align-C div.mbody nobr` |
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
| チャート canvas | — | — | — | — | `--only` の対象外 |
| ツールバー挿入先 | — | — | — | — | `--only` の対象外 |
| オーバーレイレイヤー | — | — | — | — | `--only` の対象外 |
| 右クリックメニュー | — | — | — | — | `--only` の対象外 |

### 検証したセレクタ（TradingView）

| ページ | 検出用セレクタ |
| --- | --- |
| チャート canvas | `div.chart-gui-wrapper canvas[aria-hidden!="true"]` |
| ツールバー挿入先 | `div.container-OH8c8Nc3` |
| オーバーレイレイヤー | `div#overlap-manager-root` |
| 右クリックメニュー | `div.context-menu table` |

## 未実施の対象

| サイト | 対象 | 理由 |
| --- | --- | --- |
| 楽天スーパースクリーナー | スーパースクリーナー | `--only` の対象外 |
| SBI証券 | 個別銘柄 | `--only` の対象外 |
| SBI証券 | ポートフォリオ | `--only` の対象外 |
| SBI銘柄スクリーニング | スクリーナー | `--only` の対象外 |
| TradingView | チャート canvas | `--only` の対象外 |
| TradingView | ツールバー挿入先 | `--only` の対象外 |
| TradingView | オーバーレイレイヤー | `--only` の対象外 |
| TradingView | 右クリックメニュー | `--only` の対象外 |

## 判定の読み方

| 記号 | 意味 |
| --- | --- |
| ✅ | ページ識別セレクタがヒットし、検出用セレクタも1件以上ヒットした |
| ❌ | **ページに到達したと判断できるのに**検出用セレクタが 0 件。サイト改修でセレクタが壊れた疑い |
| ⚠️ | ページに到達したと判断できない（題名が未到達の目印に当たる／題名から判断できない）。ページを開けていない |
| — | 未実施（`--only` で除外・ログインしていない・対象のタブが開かれていない） |

「注入」は拡張機能が実際に挿入した要素の数（参考値。判定には使わない）。

# SPEC-OP: オプションページ

実装: `src/options.html`, `src/options.js`, `src/options.css`

## SPEC-OP-01 開き方

| 経路 | 実装 |
| --- | --- |
| 拡張機能アイコンをクリック | `chrome.action.onClicked` → `openOptionsPage()` |
| 初回インストール / 1.0.9 未満からの更新 | `chrome.runtime.onInstalled` → `shouldOpenOptionsPage(details)` が真なら `openOptionsPage()`（SPEC-SW-04） |
| `chrome://extensions` の「拡張機能のオプション」 | `manifest.options_page` |

> 2行目の判定関数は 1.20.1 で入った。1.10.0〜1.20.0 は Chrome 本体の更新でも開いていた（SPEC-SW-04 の冒頭）。

- **Chrome 本体の更新・共有モジュールの更新では開かない**（SPEC-SW-04 の判定表）

- 要件: FR-05, FR-10
- 検証: `auto`（2行目。`tests/service-worker.spec.mjs` の describe `service_worker: shouldOpenOptionsPage`）／
  `manual`（1行目・3行目。アイコンのクリックと `chrome://extensions` の「拡張機能のオプション」で開くこと）

## SPEC-OP-02 スクリプトの読み込み順

```html
<script src="third-party/jquery.min.js"></script>
<script src="third-party/jquery-ui.min.js"></script>
<script src="urls.js"></script>
<script src="options.js"></script>
```

Materialize の JS は読み込まない（`M.*` API を使っていないため）。

- 要件: CON-02
- 検証: `auto`（オプションページの各テストが実質的に検証）

## SPEC-OP-03 一覧の構築順

1. `getEnableLinkKeysAsync()` の返す**有効キーを保存順**に並べる
2. 続けて `externalUrls` のうち未出力のもの（= 無効なもの）を定義順で並べる

結果として「有効なものが上、無効なものが下」になる。

- 要件: FR-09
- 検証: `auto`（`オプションページ › 全ての連携サイトが一覧表示される`）

## SPEC-OP-04 1行の DOM 構造

```html
<li class="collection-item row" id="<key>">
  <i class="s1 material-icons handle">drag_handle</i>
  <span class="s7 item-title">タイトル<i class="material-icons tv-badge">show_chart</i></span>
  <a class="s2 item-link" href="<url0>" rel="noopener noreferrer" target="_blank">
    <i class="material-icons">open_in_new</i>
  </a>
  <span class="s2 switch">
    <label><input type="checkbox" class="link-list-item" value="<key>"><span class="lever"></span></label>
  </span>
</li>
```

- `id` に `key` をそのまま入れる。`key` は `.` や `/` を含むため **id セレクタでは引けない**。
  参照するときは属性セレクタ `li[id="..."]` を使う
- グリッドの合計は `s1 + s7 + s2 + s2 = 12`

**Materialize 2.x の `.row` は CSS Grid。`.sN` は `.row` の直接の子でなければ効かない。**
中間に `<div>` を挟むとレイアウトが縦積みに崩壊する。

- 要件: FR-09, CON-06
- 検証: `auto`（`オプションページ › 行がグリッドとして横並びにレイアウトされる`）

## SPEC-OP-05 TradingView バッジ

TradingView の「株Link」メニューにも出るサイトに `show_chart` アイコンを付ける。

```javascript
const isShownOnTradingView = (key) => key.indexOf('tradingview.com') !== 0
```

`tradingview.com/chart` 以外のすべてに付く（SPEC-CS-11 の除外条件と一致させている）。

- 要件: FR-09
- 検証: `manual`

## SPEC-OP-06 トグル

Materialize の switch。`input.link-list-item` の `value` に `key` を持つ。
`input` は視覚的に隠れているため、**操作は `span.lever` をクリックする**。

- 要件: FR-09
- 検証: `auto`（`トグルを OFF にして保存すると設定が永続化される`）

## SPEC-OP-07 並び替え

jQuery UI の `sortable` を使う。

```javascript
linkList.sortable({ axis: 'y', handle: '.handle', distance: 8, update: … })
```

- 縦方向のみ
- `i.material-icons.handle` をつかんだときだけドラッグできる
- 8px 動かすまでドラッグ開始しない

- 要件: FR-09
- 検証: `auto`（`ハンドルをドラッグして並び替えた順序が保存される`）

## SPEC-OP-08 保存ボタンの表示制御

| 状態 | クラス |
| --- | --- |
| 変更なし（初期） | `scale-out`（非表示） |
| トグル変更 or 並び替え後 | `scale-in`（表示） |
| 保存完了後 | `scale-out`（非表示） |

保存中は `lock` フラグで二重実行を防ぐ。

- 要件: FR-09
- 検証: `auto`（同上）

## SPEC-OP-09 保存内容

チェックが入っている `input.link-list-item` を**上から順に**走査し、0 始まりの連番を値にする。

```javascript
{ enableLinkKeys: { '<key>': 0, '<key>': 1, … } }
```

- 要件: FR-09
- 検証: `auto`（同上）

## SPEC-OP-10 ヘッダーの影

`main` のスクロール位置が 0 でないとき `header` に `with-scroll` を付け、影を出す。

- 要件: —
- 検証: `manual`

## SPEC-OP-11 外部リクエストゼロ

オプションページは**外部ホストへ一切リクエストしない**。

| かつての依存 | 現在 |
| --- | --- |
| `fonts.googleapis.com`（Material Icons） | `material-icons.css` + 同梱 woff2 |
| `static.tradingview.com`（favicon バッジ） | Material Icons の `show_chart` |
| `img.shields.io`（Zenn バッジ） | `images/zenn-badge.svg` として同梱（shields.io が返す SVG をそのまま保存。Zenn ロゴは data URI で自己完結、外部参照なし） |

- 要件: NFR-03, CON-07
- 検証: `auto`（`オプションページ › 外部ホストへ一切リクエストしない`）

## SPEC-OP-12 アイコンフォント

Material Icons をサブセット化して同梱する（32KB）。使用アイコンは4種。

| アイコン | 用途 |
| --- | --- |
| `save` | 保存ボタン |
| `open_in_new` | サイトを開くリンク |
| `drag_handle` | 並び替えハンドル |
| `show_chart` | TradingView バッジ |

**リガチャは `liga` ではなく `rlig`（必須リガチャ）。**
`rlig` は指定なしで適用されるため `font-feature-settings` は不要
（Google 配布の CSS にある `font-feature-settings: "liga"` はこのフォントには効かない）。
アイコンを増やしたら `docs/ARCHITECTURE.md` の手順で再サブセットが必要。

ファイル配置:

| ファイル | 位置 | 理由 |
| --- | --- | --- |
| `material-icons.css` | `src/` | **自作の CSS**。Stylelint の検査対象 |
| `material-icons.woff2` | `src/third-party/` | Google 提供のフォント本体（Apache License 2.0） |

- 要件: CON-07
- 検証: `auto`（`Material Icons がローカル同梱フォントとして読み込まれリガチャが効く`）

## SPEC-OP-13 配色

`options.css` の CSS 変数で定義し、`prefers-color-scheme: dark` でダークテーマに切り替える。

- 要件: NFR-10
- 検証: `manual`（OS のダークモードを切り替えて表示確認）

# 【記事ネタ】2年放置した Chrome 拡張のメンテナンス作業ログ (2026-08-23)

> Zenn 記事化用の作業記録。数値・引用元・ハマりどころをそのまま使える形で残しています。
> 記事タイトル案: 「2年放置した Chrome 拡張を、Claude Code と一緒に棚卸しした」

## 0. 作業前の状態

| 項目 | 状態 |
|------|------|
| 最終コミット | `1525309 moomoo証券対応` |
| `npm run lint` | **212 errors で完全に赤** |
| `npm audit` | **14件 (high 10 / moderate 4)** |
| ESLint | 8.43（**8.x は EOL**） |
| Stylelint | 14.16.1 |
| jQuery | 3.7.0 |
| jQuery UI | **1.13.1（CVE-2022-31160 該当）** |
| Materialize | **1.0.0（2018年、本家メンテ停止）** |
| 自動テスト | なし |
| CLAUDE.md | **存在しない** |

コードそのものは動いていたが、**周辺（ドキュメント・lint・依存）が2年分放置**されていた、という典型例。

---

## 1. ドキュメントと実装の乖離

README に載っていなかったもの:

- **内藤証券連携**（`service_worker.js` に実装済み、TradingView メニューにも出る）
- moomoo証券 / 株予報Pro / 投資の森
- 逆に **iMarket は `urls.js` でコメントアウト済みなのに README には残っていた**

その他:

- `manifest.json` = `1.9.21` / `package.json` = `1.0.0` で**バージョン未同期**
- 著作権表記が `2023-2024` のまま
- 株マップ.com の行末に余分な `'` が混入

> 💡 記事ネタ: 「ドキュメントは書いた瞬間から腐る」。今回は
> **`urls.js` から README のリンク一覧を生成するワンライナー**を書いて機械的に同期させた。

```bash
node -e "
const src=require('fs').readFileSync('src/urls.js','utf8');
const list=eval(src.match(/const externalUrls = (\[[\s\S]*?\n\])/)[1]);
for (const u of list) console.log('* [' + u.title + '](' + u.url1.replaceAll('\${code}','7203') + ')');
"
```

---

## 2. 見つかった潜在バグ

### 2-1. バージョン比較が文字列比較だった

```js
// Before — 文字列比較なので '1.9.21' < '1.10.0' を誤判定する
if (details.reason === 'install' || details.previousVersion < "1.0.9") {
```

現状の `1.9.21` ではたまたま動くが、**`1.10.x` に上げた瞬間に壊れる**時限爆弾。
数値比較する `compareVersion()` を実装して置き換えた。

### 2-2. 米国株の正規表現にアンカーが無かった

```js
// Before — ^ が無いので文中の大文字並びに誤マッチする
match = text.match(/\s*([A-Z]{1,5})\s*/)
```

`「株価はNYSEで上昇」` を選択して右クリックすると、`NYSE` をティッカーだと誤認する。
国内株側は `^` が付いていたので、**単なる書き忘れ**だった。

### 2-3. Service Worker に `window` が残っていた

```js
if (chrome.runtime.openOptionsPage) {
  chrome.runtime.openOptionsPage()
} else {
  window.open(...)   // ← Service Worker に window は存在しない
}
```

MV2 → MV3 移行時の残骸。MV3 では `openOptionsPage` は常に存在するので分岐ごと削除。
**ESLint の flat config で `globals: { window: 'off' }` を設定したら検出できた。**

### 2-4. 死にコードだった CSS

`ktt-tv-linkButton` / `ktt-tv-holder` / `li.ktt-tv-menu` は
**commit `b986182`「TradingViewのスーパーチャートのボタンの表示方法を変更」(2024-02) で
JS 側の付与コードだけが消え、CSS が残っていた**もの。
さらに `style.css` に `li.xkau-menu-item`（`x-kabu-menu-item` のタイポ）も発見。

> 💡 **記事の山場**: ここで「拡張機能の CSS は安易に消せない」という話が書ける。次章参照。

---

## 3. 【重要】他社サイトに注入する拡張ならではの落とし穴

ブラウザ拡張は**自分が作っていないサイトの DOM に CSS を追記する**。
そのためセレクタには**対象サイト側で定義済みのクラス**が混ざる。

```css
/* TradingView 側のクラス           ＋ 拡張側のクラス */
html.theme-dark div.apply-common-tooltip.button-hw_3o_pb.ktt-tv-linkButton { ... }
```

`theme-dark` や `button-hw_3o_pb` はリポジトリを grep しても**絶対にヒットしない**。
「使われていないから消す」をやると、対象サイト上でだけ表示が壊れ、
**ローカルの lint でもテストでも検出できない**。

### 判定手順（今回確立したルール）

1. **`manifest.json` の `content_scripts` を見る。**
   どの CSS がどの `matches` に注入されるかが定義されている。
   → 実際 `style.css` は楽天・SBI にしか注入されないのに TradingView 用の
   `ktt-tv-holder` 規則が残っていた。**そもそも読み込まれないので確実に死にコード。**
2. **接頭辞で判定する。** `ktt-tv-` / `x-kabu-` は拡張が自分で付ける独自クラス。
   → `src/*.js` に付与箇所が無ければ確実に死んでいる。接頭辞なしはサイト側の可能性が高いので残す。
3. **`git log -S'<クラス名>' -- src/`** で、付与していた JS がいつ消えたかを追う。
4. サイト側クラスと独自クラスを**同一要素で**組み合わせた規則は、
   独自クラス側が死んでいれば規則ごと死んでいる。

同じ理由で Stylelint の `selector-class-pattern` は無効化が必須（サイト側のハッシュ付き
クラス名 `button-hw_3o_pb` が命名規則に引っかかるため）。

---

## 4. 依存関係の更新

### 4-1. devDependencies

`npm audit` の **14件 (high 10 / moderate 4)** は全て eslint/stylelint の推移的依存
（picomatch, postcss, semver, word-wrap, yaml）で、**配布物には含まれない**。
実リスクは低いが、まとめて解消した。

```
ESLint    8.43   → 9.39.5     (eslint-config-standard → neostandard)
Stylelint 14.16  → 17.14.1
npm audit 14件   → 0件
```

**ハマりどころ:** ESLint 10 に上げようとしたら `neostandard` が peer で弾いた。

```
npm error Could not resolve dependency:
npm error peer eslint@"^9.0.0" from neostandard@0.13.0
```

neostandard の ESLint 10 対応は prerelease (`0.14.0-next.1`) のみだったので、
**安定版を優先して ESLint 9 系に留めた**。8.x の EOL は脱したので目的は達成。

`.eslintrc.json` + `.eslintignore` → `eslint.config.mjs`（flat config）へ移行。

### 4-1b. CSSComb を捨てて Stylelint に一本化

`.csscomb.json` (11KB / 404プロパティの並び順定義) が残っていたが、
**CSSComb 自体が2016年で開発停止**。プロパティ順は `stylelint-order` 系の設定で代替できる。

ここで**依存の落とし穴**を踏んだ。最初に選んだ `stylelint-config-idiomatic-order@10.0.0` は、

```
$ npm ls stylelint-order
├─┬ stylelint-config-idiomatic-order@10.0.0
│ └── stylelint-order@6.0.4        ← peer: stylelint ^14 || ^15 || ^16
└── stylelint-order@8.1.1
```

**Stylelint 17 を使っているのに、内部で 16 までしか対応表明していない v6 を抱え込んでいた。**
たまたま動くが、依存を新しくするのが目的なのに本末転倒。

`stylelint-config-recess-order@7.8.0` は peer を明示している。

```json
"peerDependencies": { "stylelint": "^16.18.0 || ^17.0.0", "stylelint-order": "^7.0.0 || ^8.0.0" }
```

こちらに変えると `stylelint-order@8.1.1 deduped` になりツリーが素直になった。
既存 CSS への影響は **19件・すべて `--fix` で自動整列**。

> 💡 記事ネタ: 「`npm ls <依存名>` で**推移的依存の実バージョンと peer を見る**。
> 上位パッケージが最新でも、中で古いものを抱えていることがある」

### 4-2. 同梱ライブラリ

| ライブラリ | Before | After |
|-----------|--------|-------|
| jQuery | 3.7.0 | **4.0.0** |
| jQuery UI | 1.13.1 | **1.14.2** |
| Materialize | 1.0.0 (Dogfalo) | **@materializecss/materialize 2.3.3** |
| Material Icons | Google Fonts CDN | **ローカル同梱 (woff2)** |
| Materialize JS | 181KB 同梱 | **削除**（`M.*` API 未使用のため不要） |

---

## 5. jQuery 4 への移行 — 事前に「壊れるか」を確かめる

公式アップグレードガイドの Breaking Changes には
「**Selector: Support for legacy custom pseudos dropped**」とだけ書かれていて、
`:first` や `:eq()` がどうなったのか読み取れなかった。

このコードベースは以下を使っている:

- 位置擬似クラス: `tr:first`、`td:eq(1)`、`span:first`
- `:contains()`: `td:contains("国内株式") + td`
- **非標準の属性セレクタ**: `canvas[aria-hidden!="true"]`
- `.hover()` とイベントショートハンド

**推測せず、ソースを直接 grep して確認した。**

```bash
curl -sSL -o jquery-4.0.0.js https://code.jquery.com/jquery-4.0.0.js
grep -n "createPositionalPseudo" jquery-4.0.0.js   # first/last/eq/even/odd/lt/gt → 全部残存
grep -n "contains:" jquery-4.0.0.js                # :contains() → 残存
grep -n '"!="' jquery-4.0.0.js                     # [attr!="x"] → 残存
grep -n "hover:" jquery-4.0.0.js                   # .hover() → 残存
```

**結論: 使用中の API はすべて健在。コード修正ゼロで移行できた。**

> 💡 記事ネタ: 「アップグレードガイドに書いてないことは、minified じゃないソースを落として grep するのが早い」

---

## 6. Materialize 2.x が本命の破壊的変更だった

**`.row` が CSS Grid になり、`.col` クラスが廃止されていた。**

```css
/* Materialize 1.0 — float ベース。孫要素でも効く */
.row .col.s6 { float: left; width: 50%; }

/* Materialize 2.3 — CSS Grid。直接の子にしか効かない */
.row { display: grid; grid-template-columns: repeat(12, 1fr); gap: var(--gap-size); }
.row .s6 { grid-column: auto / span 6; }
```

既存のマークアップはこうなっていた:

```html
<li class="collection-item row">
  <div>                              <!-- ← この div が挟まっている -->
    <span class="col s8">...</span>  <!-- Grid では効かない → 縦積みに崩壊 -->
  </div>
</li>
```

`.sN` を `.row` の**直接の子**にするようマークアップを修正。
また `waves-effect` / `waves-light` は 2.x で**完全に削除**されていた（grep で 0 件）。

検証方法:

```bash
npm pack @materializecss/materialize@2.3.3 && tar xzf *.tgz
grep -c "waves-effect" package/dist/css/materialize.css   # → 0
grep -nE '(^|[ ,])\.col([ ,{.:]|$)' package/dist/css/materialize.css   # → 0
```

---

## 7. 外部リクエストをゼロにした

Before:

- `options.html` → `fonts.googleapis.com`（Material Icons）
- `options.js` → `static.tradingview.com/.../favicon.ico`（バッジ画像）
- `options.html` → `img.shields.io`（Zenn バッジ）

拡張機能から外部ホストを叩くのは、**Chrome ウェブストアの審査観点でもプライバシー観点でも不利**。
Material Icons の woff2 (128KB) をローカル同梱し、TradingView の favicon は
Material Icons の `show_chart` に置き換え、shields.io バッジはテキストリンクにした。

```bash
# Google Fonts の CSS から woff2 の URL を取り出して落とす
curl -sS -A "Mozilla/5.0 ... Chrome/140.0 ..." \
  "https://fonts.googleapis.com/icon?family=Material+Icons" \
  | grep -oE "https://[^)]+\.woff2"
```

**外部リクエストがゼロであることは回帰テストで固定した**（次章）。

### 副作用: フォントを同梱すると太る → サブセット化

Material Icons のフル版は 128KB。使っているアイコンは **4個だけ**なのでサブセット化した。

```bash
python3 -m fontTools.subset /tmp/mi-full.woff2 \
  --text="drag_handle open_in_new save show_chart" \
  --layout-features=liga \
  --flavor=woff2 --output-file=src/third-party/material-icons.woff2
# → 128616 bytes から 488 bytes に！ …が、アイコンが表示されない
```

**488バイトになって喜んだが、テストが落ちた。** 幅が 96px = アイコンではなく
`open_in_new` という文字列がそのまま描画されていた。

```bash
$ python3 -c "from fontTools.ttLib import TTFont; print(TTFont('...').getGlyphOrder())"
['.notdef', 'underscore', 'a', 'c', 'd', 'e', 'g', 'h', ...]
```

**グリフ数18 = 指定した文字の数と完全一致。アイコングリフが1つも入っていない。**

原因: Material Icons のリガチャは `liga` ではなく **`rlig`（Required Ligatures）** だった。

```bash
$ python3 -c "
from fontTools.ttLib import TTFont
gsub=TTFont('/tmp/mi-full.woff2')['GSUB'].table
print(sorted({fr.FeatureTag for fr in gsub.FeatureList.FeatureRecord}))"
['rlig']
```

`--layout-features=liga` を指定したせいで `rlig` が捨てられ、
ligature closure が走らずアイコングリフが取り込まれなかった。

```bash
--layout-features=rlig,liga   # ← 正解。128616 → 32312 bytes
```

紛らわしいのは、**Google Fonts が配布している CSS には `font-feature-settings: 'liga'` と
書いてある**こと。実際のフォントに入っているのは `rlig` で、こちらは必須リガチャなので
指定なしで適用される。CSS の記述を信じて `liga` だけ残すと壊れる。

> 💡 記事ネタ: 「サブセット化は数字が劇的に減るので成功したと錯覚しやすい。
> **描画結果を実測するテストがなかったら気づかずリリースしていた。**」

```js
// アイコン名の文字列がそのまま出ていないかを幅で判定する
const measure = (text) => { /* span を作って getBoundingClientRect().width */ }
expect(measure('open_in_new')).toBeLessThan(40)   // リガチャが効けば1グリフ幅
```

---

## 8. UI 自動テストを Playwright で入れた

拡張機能はビルドもモジュール化も無いので、**関数単体を Node で import できない。**
そこで Playwright で拡張機能を実際に Chromium にロードして検証する。

```js
chromium.launchPersistentContext('', {
  channel: 'chromium',   // 拡張機能は new headless で動く
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
})
```

### テクニック1: Service Worker のグローバルスコープを直接叩く

```js
await serviceWorker.evaluate((t) => getTickerCode(t), '7203')
// → { status: true, type: 'jp', code: '7203' }
```

`importScripts('./urls.js')` 済みなので `urls.js` の関数もそのまま呼べる。
**これが実質的な単体テストになる。**

### テクニック2: content_scripts を実オリジンで発火させる

`matches` は実オリジンでしか発火しないので、ローカル HTML を開いても注入されない。
`context.route()` でレスポンスをフィクスチャに差し替える。

```js
await context.route('https://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do;...',
  (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureHtml }))
```

これで**証券会社にログインせずに Content Script の注入をテストできる。**

### 結果: 27 テスト

回帰テストとして特に価値があるもの:

- **ドラッグ並び替え** — jQuery UI 1.14.2 が jQuery 4.0.0 上で動くことの実証
- **アイコンのリガチャ幅実測** — フォントサブセットの失敗検出
- **グリッドレイアウト** — Materialize 2.x の `.col` 廃止の影響検出
- **外部リクエストゼロ** — CDN 依存の再混入検出
- **米国株の誤マッチ** — 正規表現の `^` が失われていないかの検出

### ハマったところ

| 症状 | 原因 | 対処 |
|------|------|------|
| `Cannot use 'import.meta' outside a module` | `package.json` に `type: module` が無く `.js` が CJS 扱い | テストを `.mjs` にリネーム |
| `Element is outside of the viewport` | Materialize のスイッチは `input` を視覚的に隠している | `span.lever` をクリックする |
| アイコン幅の assert が落ちる | `.s1` は Grid のカラム幅で、グリフ幅ではない | `document.fonts.check()` で判定 |
| 空配列が返る | `evaluateAll` は**自動待機しない** | 先に `toHaveCount()` で待つ |
| `CSS is not defined` | `CSS.escape` は Node 側には無い | 属性セレクタ `li[id="..."]` にする |

---

## 9. フォルダ構成とスクリプト整備

```
Before                      After
├── etc/screen-*.png    →   ├── docs/images/screen-*.png
├── src.zip (残骸)      →   ├── (削除、dist/ に出力)
├── .DS_Store × 5       →   ├── (削除、.gitignore 修正)
├── .eslintrc.json      →   ├── eslint.config.mjs
├── .eslintignore       →   │
├── .stylelintrc        →   ├── stylelint.config.mjs
                            ├── scripts/validate-manifest.mjs
                            ├── scripts/package.mjs
                            ├── tests/
                            ├── CLAUDE.md
                            └── docs/{ARCHITECTURE,TESTING}.md
```

`.gitignore` の `.DS_store` は**小文字の s** だった（macOS は
`core.ignorecase=true` なので偶然効いていた）。

### `npm run validate` で守っていること

ビルドが無い拡張なので、**`manifest.json` の記述ミスは実行時まで気づけない**。
そこで検証スクリプトを書いた。

- `manifest.json` と `package.json` の **version 一致**
- `icons` / `service_worker` / `options_page` / `content_scripts` の **参照先ファイルの実在**
- `_locales` の `__MSG_xxx__` に対応するキーの存在
- `matches` がすべて https であること
- **`js` 配列の読み込み順**（jQuery → `urls.js` → `linkMenu.js`）
- 想定外の `permissions` 追加の警告

---

## 10. 作業後の状態

| 項目 | Before | After |
|------|--------|-------|
| `npm run lint` | 212 errors | ✅ 0 |
| `npm run lint:css` | 5 errors | ✅ 0 |
| `npm audit` | 14件 | ✅ 0件 |
| 自動テスト | なし | ✅ **27件** |
| 既知 CVE (同梱ライブラリ) | 1件 | ✅ 0件 |
| 実行時の外部リクエスト | 3ホスト | ✅ 0 |
| 配布 zip サイズ | 268KB | ✅ **248KB**（フォント同梱後も減） |
| 配布 zip | 手動 | `npm run package` |
| ドキュメント | README のみ（内容も古い） | README / CLAUDE.md / ARCHITECTURE / TESTING |

---

## 記事に入れると良さそうな小ネタ

- `.DS_store` と `.DS_Store` — macOS だから偶然動いていた `.gitignore`
- jQuery UI を **255KB フルビルドで同梱しているが、実際に使っているのは `sortable` だけ**。
  カスタムビルドすれば 1/8 以下になるが、「ビルドステップを持たない」方針とのトレードオフ
- Materialize 2.x は **normalize.css を dist に内包**しているので、別途同梱は不要
- 「AIに任せる範囲」— 死にコード削除は**人間のドメイン知識（対象サイト側のクラス）が無いと
  判断を誤る**。実際、指摘を受けて `git log -S` で裏を取り直した

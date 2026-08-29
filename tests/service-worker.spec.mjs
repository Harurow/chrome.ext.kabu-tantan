import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures/extension.mjs'
import { rootDir } from '../scripts/selector-check/load-selectors.mjs'

// Service Worker のトップレベル関数を実コンテキストで直接検証する。
// ビルドが無くモジュール化もされていないため、これが唯一の単体テスト手段になる。

test.describe('service_worker: getTickerCode', () => {
  const evalTicker = (serviceWorker, text) =>
    serviceWorker.evaluate((t) => getTickerCode(t), text)

  // SPEC-TC-09 の判定表をそのまま流す。
  // 1回の evaluate でまとめて評価し、入力→結果の対応で比較する
  // （どの行が落ちたかが差分に出る）
  const expectTable = async (serviceWorker, rows) => {
    const inputs = rows.map(([input]) => input)
    const results = await serviceWorker.evaluate(
      (texts) => texts.map((t) => getTickerCode(t)), inputs)

    expect(Object.fromEntries(inputs.map((input, i) => [input, results[i]])))
      .toEqual(Object.fromEntries(rows))
  }

  test('4桁の国内銘柄コードを jp として認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, '7203')).toEqual({
      status: true, type: 'jp', code: '7203'
    })
  })

  test('英字を含む国内銘柄コード（例: 135A）も認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, '135A')).toMatchObject({
      status: true, type: 'jp', code: '135A'
    })
  })

  test('取引所コード付きの米国株を認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'AAPL NASDAQ')).toEqual({
      status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ'
    })
  })

  test('取引所コードなしの米国株を認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'TSLA')).toMatchObject({
      status: true, type: 'us', code: 'TSLA'
    })
  })

  // 回帰テスト: 以前は米国株の正規表現に先頭アンカー ^ が無く、
  // 文中の大文字並びに誤マッチしていた
  test('文中の大文字並びには誤マッチしない', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'トヨタ自動車 TOYOTA')).toEqual({ status: false })
    expect(await evalTicker(serviceWorker, '株価はNYSEで上昇')).toEqual({ status: false })
  })

  // 回帰テスト: 先頭アンカーだけでは後続境界が無く、単語の途中を拾って
  // 「別銘柄のページを開く」という最悪の失敗をしていた
  // （例: 'Apple Inc. AAPL NASDAQ' → 'A' = Agilent）
  test('単語の途中を切り出して別銘柄と誤認しない', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'Apple Inc. AAPL NASDAQ')).toEqual({ status: false })
    expect(await evalTicker(serviceWorker, 'TOYOTA')).toEqual({ status: false })
  })

  // 回帰テスト: 後続境界を「害のある記号を並べる」禁止列挙で書いていたため、
  // 列挙にない ASCII 記号・数字・全角の連結記号が素通りし、別の表記の手前を切り出していた
  // （`SP500` → `SP` / `S&P500` → `S` / `A－Z` → `A`。SP・S=SentinelOne・A=Agilent は実在する）。
  // 許可列挙（切り出してよい後続だけを許す）に反転し、未知の後続は既定で落とす（FR-08 判定基準3・4）
  test('区切り記号の手前で切り出して別銘柄と誤認しない', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      // `.`（クラス株・略号）
      ['BRK.B', { status: false }],
      ['BRK.B NASDAQ', { status: false }],
      ['U.S. 株式', { status: false }],
      ['U.S.', { status: false }],
      ['A.B.C', { status: false }],
      // `-`（クラス株・範囲表記）
      ['BRK-B', { status: false }],
      ['A-Z', { status: false }],
      // `/`（クラス株・並記）
      ['BRK/B', { status: false }],
      ['A/B テスト', { status: false }],
      // `+`（格付け表記）
      ['A+', { status: false }],
      ['AA+', { status: false }],
      ['BBB+ 相当の信用力', { status: false }],
      // `&`（社名の連結）
      ['S&P500', { status: false }],
      ['P&G', { status: false }],
      ['AT&T', { status: false }],
      // 許可列挙にない ASCII 記号（禁止列挙では素通りしていた）
      ['AAPL#', { status: false }],
      ['A_B', { status: false }],
      ['AAPL=', { status: false }],
      ['AAPL*', { status: false }],
      // 数字（`SP` は実在ティッカー）
      ['SP500', { status: false }],
      ['AAPL0', { status: false }],
      // 許可列挙にない非 ASCII 記号。未知の記号は既定で落ちる
      ['AAPL※', { status: false }],
      ['AAPL→', { status: false }],
      // 長音符2字（`ー` U+30FC / `ｰ` U+FF70）。Unicode 上は「文字」だが、
      // 日本語 IME でハイフンを打つと出るので連結記号の代用として実際に打たれる
      ['BRKーB', { status: false }],
      ['BRKｰB', { status: false }],
      ['AAPLーMSFT', { status: false }],
      ['AAPLｰMSFT', { status: false }],
      // 記号が直接接している入力は開けなくなる。「開かない」を「別銘柄を開く」より優先する
      ['AAPL.', { status: false }],
      ['AAPL-Apple', { status: false }],
      ['AAPL/MSFT', { status: false }],
      ['AAPL+', { status: false }],
      ['AAPL&', { status: false }]
    ])
  })

  // 許可列挙に反転した以上、落ちない側も同じ強さで固定する。
  // 「直後は空白か終端だけ」まで絞ると `AAPL,` や `AAPLの株価` が落ちて、
  // 現在ふつうに使えている選択を壊す（FR-08 判定基準1・2）
  test('区切り記号が接していなければ従来どおり認識する', async ({ serviceWorker }) => {
    const usAapl = { status: true, type: 'us', code: 'AAPL' }
    await expectTable(serviceWorker, [
      // 境界が働くのは直後に接している場合だけ。空白を挟めば落ちない
      ['AAPL - Apple Inc.', usAapl],
      ['AAPL + MSFT', usAapl],
      ['AAPL & MSFT', usAapl],
      // 空白は半角・全角どちらも通る
      ['AAPL　MSFT', usAapl],
      // 本文文字（非 ASCII の \p{L}）。`AAPLの株価` は u フラグ忘れの検出も兼ねる
      // （u が無いと \p{L} がリテラルになり、例外も lint エラーも出ないままここだけ落ちる）
      ['AAPLの株価', usAapl],
      ['AAPL の株価', usAapl],
      ['AAPL株', usAapl],
      // 終止記号（半角）。銘柄コードを終わらせているだけで別の銘柄表記にならない
      ['AAPL,', usAapl],
      ['AAPL)', usAapl],
      ['AAPL"', usAapl],
      ["AAPL's price", usAapl],
      // 終止記号（全角・和文）
      ['AAPL、', usAapl],
      ['AAPL）', usAapl],
      ['AAPL」', usAapl],
      // 開き括弧も許可する（銘柄コードを別の表記に続けない）
      ['AAPL(Apple Inc.', usAapl],
      ['AAPL（アップル）', usAapl],
      // 反復記号は許可のまま。例外の基準は「文字かどうか」ではなく
      // 「連結記号の代用として実際に打たれるか」で、長音符2字だけがこれに当たる
      ['AAPL々', usAapl],
      ['AAPLゝ', usAapl],
      ['AAPL〆', usAapl],
      // `:` は許可列挙に残す。効くのは取引所プレフィックスの後ろに来る場合だけで、
      // 外すとこの形が道連れで落ちる（先頭の `AAPL:` は判定基準7 で打ち切られる）
      ['NYSE:AAPL:', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['NYSE:AAPL：決算', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }]
    ])
  })

  // FR-08 判定基準5: 連結記号は半角・全角・字形の違いで結果が変わらないこと。
  // 「非 ASCII なら許可」という代理指標だと全角側だけ素通りしていた（`S＆P500` → `S`）
  test('半角と全角で結果が変わらない', async ({ serviceWorker }) => {
    // ASCII の記号・数字 42 種すべてを、半角と全角（+0xFEE0）の対で突き合わせる
    const asciiSymbols = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789']
    const pairs = asciiSymbols.map((half) => [
      `A${half}Z`,
      `A${String.fromCodePoint(half.codePointAt(0) + 0xFEE0)}Z`
    ])

    const results = await serviceWorker.evaluate(
      (texts) => texts.map((t) => getTickerCode(t)), pairs.flat())

    // 半角と全角で結果が一致すること（どちらが開くかは問わない）。**例外なし**。
    // コロンは一度ここだけ食い違っていた（半角は判定基準7 で打ち切り、全角は終止記号として
    // `us A` = Agilent）。取引所プレフィックスの区切りに `：` を含めて揃えた（ADR-0009 の 12）
    const mismatched = pairs
      .map(([half, full], i) => ({ half, full, h: results[i * 2], f: results[i * 2 + 1] }))
      .filter(({ h, f }) => JSON.stringify(h) !== JSON.stringify(f))
    expect(mismatched).toEqual([])
    expect(pairs).toHaveLength(42)

    // 代表例は「どちらも開かない」側であることまで固定する
    await expectTable(serviceWorker, [
      ['S&P500', { status: false }],
      ['S＆P500', { status: false }],
      ['BRK.B', { status: false }],
      ['BRK．B', { status: false }],
      ['A-Z', { status: false }],
      ['A－Z', { status: false }],
      ['AAPL/MSFT', { status: false }],
      ['AAPL／MSFT', { status: false }],
      ['A+', { status: false }],
      ['A＋', { status: false }],
      ['A_B', { status: false }],
      ['A＿B', { status: false }],
      // 半角に相当が無い連結記号（中黒・ダッシュ類・波ダッシュ）も落ちる
      ['AAPL・MSFT', { status: false }],
      ['AAPL･MSFT', { status: false }],
      // 長音符2字はハイフンの代用として打たれるので、半角ハイフンと同じ結果にする
      ['BRK-B', { status: false }],
      ['BRKーB', { status: false }],
      ['BRKｰB', { status: false }],
      // コロンは半角・全角とも取引所プレフィックスの区切りとして打ち切る（判定基準7）
      ['A:Z', { status: false }],
      ['A：Z', { status: false }],
      ['A–Z', { status: false }],
      ['A—Z', { status: false }],
      ['A−Z', { status: false }],
      ['A―Z', { status: false }],
      ['A‐Z', { status: false }],
      ['A〜Z', { status: false }],
      ['A～Z', { status: false }],
      // 全角ラテン文字は分類3から除く（半角英字を許可しない以上、全角だけ通すと食い違う）
      ['AAPLＡ', { status: false }]
    ])
  })

  test('先頭がティッカーなら後ろに文字列が続いても認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'AAPL Apple Inc.')).toMatchObject({
      status: true, type: 'us', code: 'AAPL'
    })
  })

  test('銘柄コードが無い文字列は false を返す', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'こんにちは')).toEqual({ status: false })
  })

  // 回帰テスト: 取引所コード付きのシンボル表記（TradingView の `NYSE:AAPL` 等）を
  // 選択すると、取引所コードそのもの（`NYSE`）を銘柄コードとして開いていた
  test('取引所プレフィックス: FR-14 の既知の弱点を解消する', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      ['NYSE:AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['NYSE AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['NASDAQ:AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      // 区切りが `\s+`（1個以上）になったので空白なしは成立しない
      ['AAPLNASDAQ', { status: false }]
    ])
  })

  test('取引所プレフィックス: コロン区切りを解釈する', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      ['TSE:7203', { status: true, type: 'jp', code: '7203' }],
      ['TSE:135A', { status: true, type: 'jp', code: '135A' }],
      // `_DLY`（遅延配信の接尾辞）は剥がしてから exchanges を引く
      ['TSE_DLY:7203', { status: true, type: 'jp', code: '7203' }],
      ['NASDAQ_DLY:AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['BATS:AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'BATS' }],
      ['NYSE : AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['NYSE:AAPL Apple Inc.', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['TSE:7203 トヨタ自動車', { status: true, type: 'jp', code: '7203' }],
      [' NYSE:AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      // 全角コロンも区切りとして認める。ここを半角だけにすると `NYSE：AAPL` が
      // 優先順位4へ落ちて `us NYSE`（取引所トークン自体）を返していた
      ['NYSE：AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      ['TSE：7203', { status: true, type: 'jp', code: '7203' }],
      ['NASDAQ：AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['TSE_DLY：7203', { status: true, type: 'jp', code: '7203' }]
    ])
  })

  test('取引所プレフィックス: コロン区切りで銘柄コードが取れなければ打ち切る', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      // 後続の規則へ落とすと取引所コードそのものを銘柄コードとして返してしまう
      ['NYSE:', { status: false }],
      ['NYSE:aapl', { status: false }],
      // 後続境界。`ALPHA` を切り出さない
      ['NASDAQ:ALPHABET', { status: false }],
      ['NASDAQ:7203', { status: false }],
      ['TSE:AAPL', { status: false }],
      // 後続境界に区切り記号を含める。クラス株表記から `BRK`（実在する別銘柄）を切り出さない
      ['NYSE:BRK.B', { status: false }],
      ['NASDAQ:BRK.B', { status: false }],
      ['NYSE:BRK-B', { status: false }],
      ['NASDAQ:BRK-B', { status: false }],
      ['NYSE:BRK/B', { status: false }],
      ['NYSE:BRK+B', { status: false }],
      ['NYSE:BRK&B', { status: false }],
      // 未登録の取引所もコロンなら打ち切る（判定基準7）。
      // 次の規則へ落とすと取引所トークンそのものを銘柄コードとして返す
      ['XETR:BMW', { status: false }]
    ])
  })

  // 回帰テスト: 未登録の取引所は SPEC-TC-09 が不成立として優先順位4へ落としていたため、
  // `X:Y` の `X` 自体を米国ティッカーとして返していた（`SP:SPX` → SP Plus Corp）。
  // `X:Y` は「取引所:銘柄」の記号表記で、登録の有無は本拡張の対応範囲の問題でしかない
  test('取引所プレフィックス: 未登録でもコロンなら打ち切る（判定基準7）', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      // いずれも実在する別銘柄を切り出していた
      ['SP:SPX', { status: false }], // SP Plus Corp
      ['CME:ES1!', { status: false }], // CME Group
      ['ICE:BRN1!', { status: false }], // Intercontinental Exchange
      ['SIX:NESN', { status: false }], // Six Flags
      // 指数・海外市場・FX の記号表記
      ['IDX:BBCA', { status: false }],
      ['TVC:NI225', { status: false }],
      ['LSE:VOD', { status: false }],
      ['OANDA:EURUSD', { status: false }],
      ['FX:USDJPY', { status: false }],
      ['XETR:BMW', { status: false }],
      // 副産物。URL を選択しても開かなくなる
      ['HTTPS://EXAMPLE.COM', { status: false }],
      // 承認済みの代償。コロンごと選択する必要があり経路が細い
      ['AAPL:', { status: false }],
      ['AAPL: 100ドル', { status: false }],
      // 全角コロンも同じ扱い。半角だけを見る打ち切り判定だと `us SP` / `us A` を返していた
      ['SP：SPX', { status: false }],
      ['A：Z', { status: false }],
      ['AAPL：決算発表', { status: false }],
      ['XETR：BMW', { status: false }],
      ['CME：ES1!', { status: false }],
      // 区切りは `(\s*[:：]\s*|\s+)` でコロン前後の空白まで飲むので、空白を挟んでも落ちる
      ['AAPL : MSFT', { status: false }],
      ['AAPL ： 決算', { status: false }]
    ])

    // 空白を挟んで落ちるのは**コロンだけ**。他の記号は境界が働かず従来どおり認識する
    await expectTable(serviceWorker, [
      ['AAPL - Apple Inc.', { status: true, type: 'us', code: 'AAPL' }],
      ['AAPL & MSFT', { status: true, type: 'us', code: 'AAPL' }]
    ])

    // 空白区切りは対象外。記号表記かどうかを区別できるのはコロンだけで、
    // フォールバックを消すと `CBOE Global Markets` が落ちる
    await expectTable(serviceWorker, [
      ['SP 500', { status: true, type: 'us', code: 'SP' }],
      ['CME Group', { status: true, type: 'us', code: 'CME' }],
      ['CBOE Global Markets', { status: true, type: 'us', code: 'CBOE' }]
    ])
  })

  test('取引所プレフィックス: 空白区切りは失敗しても後続の規則へ送る', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      ['TSE 7203', { status: true, type: 'jp', code: '7203' }],
      ['NASDAQ AAPL', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      // 取引所コードと同じ綴りの実在ティッカーを守る（Cboe Global Markets）
      ['CBOE Global Markets', { status: true, type: 'us', code: 'CBOE' }],
      ['OTC 市場', { status: true, type: 'us', code: 'OTC' }],
      ['TSE 東証', { status: true, type: 'us', code: 'TSE' }],
      // 病的な入力で意味のある結果ではないが 1.13.0 と同じにする
      ['NYSE NASDAQ', { status: true, type: 'us', code: 'NYSE', exchange: 'NASDAQ' }]
    ])
  })

  test('後置の取引所コードを exchanges の us 登録6件から判定する', async ({ serviceWorker }) => {
    // 1.13.0 は正規表現に NASDAQ|NYSE を直書きしていたため exchange が付かなかった
    await expectTable(serviceWorker, [
      ['AAPL BATS', { status: true, type: 'us', code: 'AAPL', exchange: 'BATS' }],
      ['AAPL AMEX', { status: true, type: 'us', code: 'AAPL', exchange: 'AMEX' }],
      ['AAPL CBOE', { status: true, type: 'us', code: 'AAPL', exchange: 'CBOE' }],
      ['AAPL OTC', { status: true, type: 'us', code: 'AAPL', exchange: 'OTC' }]
    ])
  })

  test('FR-14 の実装で 1.13.0 の判定を変えない（非退行）', async ({ serviceWorker }) => {
    await expectTable(serviceWorker, [
      ['7203', { status: true, type: 'jp', code: '7203' }],
      ['135A', { status: true, type: 'jp', code: '135A' }],
      // 国内4桁（順位1）が取引所プレフィックス（順位2）より先に成立する
      ['7203 TSE', { status: true, type: 'jp', code: '7203' }],
      ['TSLA', { status: true, type: 'us', code: 'TSLA' }],
      ['AAPL Apple Inc.', { status: true, type: 'us', code: 'AAPL' }],
      ['AAPL NASDAQ', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['AAPL NYSE', { status: true, type: 'us', code: 'AAPL', exchange: 'NYSE' }],
      // 取引所トークン側の後続境界は `(?![A-Za-z])` のまま。許可列挙にすると落ちるので変えない
      ['AAPL NASDAQ.', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['AAPL NASDAQ-100', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['AAPL NASDAQ+', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      ['AAPL NASDAQ&', { status: true, type: 'us', code: 'AAPL', exchange: 'NASDAQ' }],
      // 区切りが無く、取引所コードか実在ティッカーかを区別できないため変えない
      ['NYSE', { status: true, type: 'us', code: 'NYSE' }],
      ['TOYOTA', { status: false }],
      ['Apple Inc. AAPL NASDAQ', { status: false }],
      ['株価はNYSEで上昇', { status: false }],
      ['トヨタ自動車 TOYOTA', { status: false }],
      ['こんにちは', { status: false }],
      // 大文字のみ扱う
      ['nyse:aapl', { status: false }]
    ])
  })
})

test.describe('service_worker: compareVersion', () => {
  // 回帰テスト: 以前は文字列比較で '1.9.21' < '1.10.0' を誤判定していた
  test('マイナー/パッチを数値として比較する', async ({ serviceWorker }) => {
    const result = await serviceWorker.evaluate(() => ({
      olderMinor: compareVersion('1.9.21', '1.10.0'),
      newerPatch: compareVersion('1.0.10', '1.0.9'),
      equal: compareVersion('1.9.21', '1.9.21'),
      undef: compareVersion(undefined, '1.0.9')
    }))

    expect(result.olderMinor).toBeLessThan(0)
    expect(result.newerPatch).toBeGreaterThan(0)
    expect(result.equal).toBe(0)
    expect(result.undef).toBeLessThan(0)
  })
})

test.describe('urls.js: makeUrl', () => {
  test('${code} を置換する', async ({ serviceWorker }) => {
    const url = await serviceWorker.evaluate(() =>
      makeUrl('https://kabutan.jp/stock/?code=${code}', '7203'))
    expect(url).toBe('https://kabutan.jp/stock/?code=7203')
  })

  test('${code:0} は先頭1文字に置換する', async ({ serviceWorker }) => {
    const url = await serviceWorker.evaluate(() =>
      makeUrl('https://kabubiz.com/riron/${code:0}000/${code}.php', '7203'))
    expect(url).toBe('https://kabubiz.com/riron/7000/7203.php')
  })

  test('${exchange} は指定時のみ置換する', async ({ serviceWorker }) => {
    const url = await serviceWorker.evaluate(() =>
      makeUrl('https://jp.tradingview.com/chart/?symbol=${exchange}%3A${code}', 'AAPL', 'NASDAQ'))
    expect(url).toBe('https://jp.tradingview.com/chart/?symbol=NASDAQ%3AAAPL')
  })
})

test.describe('urls.js: exchanges', () => {
  // TradingView の `EXCHANGE:CODE` を解釈するための表 (SPEC-EL-09)。
  // `_DLY` は引く前に剥がす規則なので、表に載っていてはいけない
  test('取引所コードは大文字英字のみで、市場種別は jp / us のいずれか', async ({ serviceWorker }) => {
    const report = await serviceWorker.evaluate(() => ({
      total: Object.keys(exchanges).length,
      invalidKey: Object.keys(exchanges).filter((key) => !/^[A-Z]+$/.test(key)),
      withDly: Object.keys(exchanges).filter((key) => key.includes('_DLY')),
      invalidType: Object.entries(exchanges)
        .filter(([, type]) => type !== 'jp' && type !== 'us')
        .map(([key]) => key),
      tse: exchanges.TSE,
      us: Object.keys(exchanges).filter((key) => exchanges[key] === 'us').length
    }))

    expect(report.invalidKey).toEqual([])
    expect(report.withDly).toEqual([])
    expect(report.invalidType).toEqual([])
    expect(report.tse).toBe('jp')
    expect(report.total).toBeGreaterThan(0)
    // `us` 登録が 0 件になると usCodeWithExchangePattern の選択肢が空 `()` になり、
    // `AAPL ` が `exchange: ''` で成立してしまう（SPEC-TC-03 の集合が消える）。
    // 表がこの正規表現の唯一の情報源なので、ここで閉じる
    expect(report.us).toBeGreaterThan(0)
  })
})

test.describe('urls.js: externalUrls の整合性', () => {
  test('key が一意で必須フィールドが揃っている', async ({ serviceWorker }) => {
    const report = await serviceWorker.evaluate(() => {
      const keys = externalUrls.map((u) => u.key)
      return {
        total: externalUrls.length,
        duplicated: keys.filter((k, i) => keys.indexOf(k) !== i),
        missingField: externalUrls
          .filter((u) => !u.key || !u.title || !u.url0 || !u.url1)
          .map((u) => u.key ?? '(key なし)'),
        notHttps: externalUrls
          .flatMap((u) => [u.url0, u.url1, u.url2, u.url3])
          .filter((url) => url && !url.startsWith('https://'))
      }
    })

    expect(report.duplicated).toEqual([])
    expect(report.missingField).toEqual([])
    expect(report.notHttps).toEqual([])
    expect(report.total).toBeGreaterThan(0)
  })

  test('url1 は必ず ${code} を含む', async ({ serviceWorker }) => {
    const missing = await serviceWorker.evaluate(() =>
      externalUrls.filter((u) => !u.url1.includes('${code}')).map((u) => u.key))
    expect(missing).toEqual([])
  })
})

// SPEC-CS-22: 注入の再試行の共有ヘルパー。
// urls.js は Service Worker からも importScripts されるため、
// Content Script を経由せずに停止経路を直接叩ける唯一の場所になる。
// 停止は「成功・打ち切り・切断・例外」の 4 経路。タイマーが存在する場合はすべて同じ stop()
// （clearInterval）を通る（初回の同期呼び出しで成功・例外になった場合は setInterval を張る前に
// 抜けるため、止めるべきタイマーが無い。SPEC-CS-22）。
// 打ち切りでは clearInterval の呼び出し自体を数えて到達を確かめ、
// 例外では 2 回目が無いこと（＝タイマーが張られていないこと）で確かめる。
// 切断（isExtensionAlive() が偽）は Service Worker 上では作れないため手動確認
// （docs/MANUAL-CHECKLIST.md G-6）に委ねる。
test.describe('service_worker: retrySetup', () => {
  test('成功したら再試行を止める', async ({ serviceWorker }) => {
    const result = await serviceWorker.evaluate(async () => {
      let calls = 0
      retrySetup(() => { calls += 1; return true }, { intervalMs: 20, timeoutMs: 1000 })

      // 初回は呼び出し時に同期で走る
      const sync = calls
      await new Promise((resolve) => setTimeout(resolve, 200))
      return { sync, after: calls }
    })

    expect(result.sync).toBe(1)
    expect(result.after).toBe(1)
  })

  test('打ち切り時刻を過ぎたら止める', async ({ serviceWorker }) => {
    const result = await serviceWorker.evaluate(async () => {
      const realClearInterval = clearInterval
      let cleared = 0
      globalThis.clearInterval = (id) => { cleared += 1; realClearInterval(id) }

      try {
        let calls = 0
        retrySetup(() => { calls += 1; return false }, { intervalMs: 20, timeoutMs: 100 })

        await new Promise((resolve) => setTimeout(resolve, 300))
        const atTimeout = calls
        await new Promise((resolve) => setTimeout(resolve, 300))
        return { atTimeout, after: calls, cleared }
      } finally {
        globalThis.clearInterval = realClearInterval
      }
    })

    // 打ち切り後は 1 回も呼ばれない（無限に続かない。FR-13 判定基準2）
    expect(result.after).toBe(result.atTimeout)
    // 100ms / 20ms なので数回は走る（そもそも再試行していない、を弾く）
    expect(result.atTimeout).toBeGreaterThan(1)
    // 停止処理（clearInterval）に到達している
    expect(result.cleared).toBe(1)
  })

  test('setup が例外を投げたら止める', async ({ serviceWorker }) => {
    const result = await serviceWorker.evaluate(async () => {
      // 初回（同期）に投げた場合: 呼び出し元へ例外が出ず、2 回目も無い
      let syncCalls = 0
      let thrown = null
      try {
        retrySetup(() => { syncCalls += 1; throw new Error('boom') }, { intervalMs: 20, timeoutMs: 1000 })
      } catch (e) {
        thrown = String(e)
      }

      // 2 回目以降（tick 中）に投げた場合: clearInterval に到達して止まる
      const realClearInterval = clearInterval
      let cleared = 0
      globalThis.clearInterval = (id) => { cleared += 1; realClearInterval(id) }

      try {
        let tickCalls = 0
        retrySetup(() => {
          tickCalls += 1
          if (tickCalls === 1) return false
          throw new Error('boom')
        }, { intervalMs: 20, timeoutMs: 1000 })

        await new Promise((resolve) => setTimeout(resolve, 200))
        return { thrown, syncCalls, tickCalls, cleared }
      } finally {
        globalThis.clearInterval = realClearInterval
      }
    })

    expect(result.thrown).toBeNull()
    // 初回で投げた分は、待った後も 2 回目が無い
    expect(result.syncCalls).toBe(1)
    // tick で投げた分は 2 回目で止まる
    expect(result.tickCalls).toBe(2)
    expect(result.cleared).toBe(1)
  })
})

// FR-08 判定基準6: 銘柄コードを取り出す3経路（優先順位4の直書き / usCodePattern /
// TradingView の parseExchangeSymbol）で後続境界の値を揃える。
// 実装は共有しない方針（ADR-0009 の 3）なので、揃っていることをソースで固定する。
// 経路ごとに境界がずれると、同じ `NYSE:BRK.B` が経路によって別の結果になる
test.describe('米国ティッカーの後続境界: 3経路で同じ値', () => {
  // `/^…[A-Z]{1,5}…/フラグ` の形の正規表現リテラルを取り出す。
  // 境界に `/` は含まれないため、リテラルの区切りと衝突しない
  const usTickerPatternsOf = (relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
    return [...source.matchAll(/\/\^[^/\n]*\/[a-z]*/g)]
      .map(([literal]) => literal)
      .filter((literal) => literal.includes('[A-Z]{1,5}'))
  }

  // リテラルから後続境界（先読み）の部分だけを切り出す
  const boundaryOf = (literal) =>
    literal.slice(literal.indexOf('(?=$|'), literal.lastIndexOf('])') + 2)

  const patterns = [
    ...usTickerPatternsOf('src/service_worker.js'),
    ...usTickerPatternsOf('src/tradingview-cs.js')
  ]

  test('3経路とも同じ境界で、u フラグが付いている', () => {
    // 経路が増減したら気付けるように件数も固定する
    expect(patterns).toHaveLength(3)

    for (const literal of patterns) {
      // u が無いと \p{L} がリテラル `p{L}` になり、例外も lint エラーも出ないまま
      // 「日本語が続く形」だけが黙って落ちる（ADR-0009 の 10 の罠）
      expect(literal).toMatch(/\/u[a-z]*$/)
      expect(boundaryOf(literal)).toContain('\\p{L}')
    }

    expect(new Set(patterns.map(boundaryOf)).size).toBe(1)
  })
})

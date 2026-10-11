import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures/extension.mjs'
import { rootDir } from '../scripts/selector-check/load-selectors.mjs'
import { STALE_KEY, STALE_KEYS } from './fixtures/storage.mjs'

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
    // undefined を '0' として扱う本関数の契約。オプションページを開く判定ではない。SPEC-SW-04
    expect(result.undef).toBeLessThan(0)
  })
})

// SPEC-SW-04: onInstalled でオプションページを開くかの判定。
// 回帰テスト: 1.10.0〜1.20.0 は reason を見ずに比較しており、
// Chrome 本体の更新（previousVersion が無い）のたびに開いていた
test.describe('service_worker: shouldOpenOptionsPage', () => {
  const judgeAsync = (serviceWorker, cases) =>
    serviceWorker.evaluate((list) => list.map((details) => shouldOpenOptionsPage(details)), cases)

  test('初回インストールでは開く', async ({ serviceWorker }) => {
    expect(await judgeAsync(serviceWorker, [{ reason: 'install' }])).toEqual([true])
  })

  test('1.0.9 未満からの更新では開く', async ({ serviceWorker }) => {
    expect(await judgeAsync(serviceWorker, [
      { reason: 'update', previousVersion: '1.0.8' },
      { reason: 'update', previousVersion: '1.0.0' }
    ])).toEqual([true, true])
  })

  test('1.0.9 以上からの更新では開かない', async ({ serviceWorker }) => {
    expect(await judgeAsync(serviceWorker, [
      { reason: 'update', previousVersion: '1.0.9' },
      { reason: 'update', previousVersion: '1.0.10' },
      { reason: 'update', previousVersion: '1.20.0' }
    ])).toEqual([false, false, false])
  })

  test('Chrome 本体と共有モジュールの更新では開かない', async ({ serviceWorker }) => {
    expect(await judgeAsync(serviceWorker, [
      { reason: 'chrome_update' },
      { reason: 'shared_module_update' },
      // Chrome の仕様では起きないが、起きたら開かない側に倒す
      { reason: 'update' },
      // 未知の理由では開かない
      { reason: 'unknown_reason' }
    ])).toEqual([false, false, false, false])
  })
})

// SPEC-MSG-06: 証券会社の URL（セッション ID を含む）は Service Worker の外に出さない。
// 回帰テスト: 1.20.0 までは :info / :open の応答で URL を Content Script に返していた
test.describe('service_worker: 証券会社の応答', () => {
  /** 応答に現れてはいけない秘密値（タブの URL に仕込む） */
  const SECRET = 'KTTSECRET'

  /**
   * `chrome.tabs.query` / `chrome.tabs.create` を差し替え、ハンドラを直接呼んで応答を集める。
   * `context` はテストごとに作り直されるので差し替えを戻す処理は要らない
   */
  const callBrokerHandlersAsync = (serviceWorker, tabUrls, handlerNames) =>
    serviceWorker.evaluate(async ([urls, names]) => {
      const created = []
      chrome.tabs.query = async ({ url }) => {
        const tabUrl = urls[url]
        return tabUrl == null ? [] : [{ url: tabUrl }]
      }
      chrome.tabs.create = async (props) => {
        created.push(props.url)
        return {}
      }

      const handlers = {
        'rakuten-sec:info': onMessageRakutenSecInfoAsync,
        'rakuten-sec:open': onMessageRakutenSecOpenAsync,
        'naito-sec:info': onMessageNaitoSecInfoAsync,
        'naito-sec:open': onMessageNaitoSecOpenAsync
      }
      const responses = []
      for (const name of names) {
        const request = { type: name, data: { code: '7203', type: 'jp' } }
        responses.push(await new Promise((resolve) => { handlers[name](request, resolve) }))
      }
      return { responses, created }
    }, [tabUrls, handlerNames])

  test('楽天証券の info と open の応答に URL を含めない', async ({ serviceWorker }) => {
    const { responses, created } = await callBrokerHandlersAsync(serviceWorker, {
      'https://member.rakuten-sec.co.jp/*':
        `https://member.rakuten-sec.co.jp/app/home.do;BV_SessionID=${SECRET}?eventType=init`
    }, ['rakuten-sec:info', 'rakuten-sec:open'])

    expect(responses).toEqual([
      { type: 'rakuten-sec:info', data: { available: true } },
      { type: 'rakuten-sec:open', data: { available: true } }
    ])
    // フィールド名を変えて URL を残す誤りも落とすため、応答の文字列全体で見る
    for (const response of responses) {
      expect(JSON.stringify(response)).not.toContain(SECRET)
    }
    // URL は open の tabs.create にだけ使われる
    expect(created).toHaveLength(1)
    expect(created[0]).toContain(SECRET)
    expect(created[0]).toContain('7203')
  })

  // SPEC-SW-06: 回帰テスト。1.20.1 までは直書きの `&dscrCd=6526` が2つ目の dscrCd として残っていた
  test('楽天証券の国内株 URL は dscrCd を1つだけ持ち、値は銘柄コードである', async ({ serviceWorker }) => {
    const { created } = await callBrokerHandlersAsync(serviceWorker, {
      'https://member.rakuten-sec.co.jp/*':
        `https://member.rakuten-sec.co.jp/app/home.do;BV_SessionID=${SECRET}?eventType=init`
    }, ['rakuten-sec:open'])

    expect(created).toHaveLength(1)
    const url = new URL(created[0])
    expect(url.searchParams.getAll('dscrCd')).toEqual(['7203'])
    // パラメータの並びも仕様の表どおりであること
    expect(url.search).toBe('?eventType=init&dscrCd=7203&marketCd=1&chartPeriod=1&gmn=J&smn=01&lmn=01&fmn=01')
  })

  test('内藤証券の info と open の応答に URL を含めない', async ({ serviceWorker }) => {
    const { responses, created } = await callBrokerHandlersAsync(serviceWorker, {
      'https://*.qhit.net/naito/iswebptt2/*':
        `https://example.qhit.net/naito/iswebptt2/stock?qcode=1301&sid=${SECRET}`
    }, ['naito-sec:info', 'naito-sec:open'])

    expect(responses).toEqual([
      { type: 'naito-sec:info', data: { available: true } },
      { type: 'naito-sec:open', data: { available: true } }
    ])
    for (const response of responses) {
      expect(JSON.stringify(response)).not.toContain(SECRET)
    }
    expect(created).toHaveLength(1)
    expect(created[0]).toContain('qcode=7203')
    expect(created[0]).toContain(SECRET)
  })

  test('ログイン済みタブが無ければ available は false で、タブを開かない', async ({ serviceWorker }) => {
    const { responses, created } = await callBrokerHandlersAsync(serviceWorker, {}, [
      'rakuten-sec:info', 'rakuten-sec:open', 'naito-sec:info', 'naito-sec:open'
    ])

    expect(responses).toEqual([
      { type: 'rakuten-sec:info', data: { available: false } },
      { type: 'rakuten-sec:open', data: { available: false } },
      { type: 'naito-sec:info', data: { available: false } },
      { type: 'naito-sec:open', data: { available: false } }
    ])
    expect(created).toHaveLength(0)
  })
})

// SPEC-SW-02 / SPEC-SW-03: コンテキストメニューの再構築を直列化する。
// 回帰テスト: f3af82f〜1.20.2 は排他が無く、契機が近接すると
// get → get → removeAll → removeAll → create×N → create×N と交錯し、
// 後の回の create が全件 duplicate id で失敗していた
test.describe('service_worker: コンテキストメニューの再構築', () => {
  /**
   * 起動時（onInstalled）の再構築を待ち切ってから、`chrome.contextMenus.removeAll` /
   * `chrome.contextMenus.create` / `console.error` を記録付きに差し替える。
   * 記録は Service Worker の `globalThis.kttMenuRecorder` に置き、各テストの evaluate から使う。
   * `removeAll` は記録してから `recorder.removeAll` に渡すので、テストはそこを差し替えて失敗や待機を作る。
   * `context` はテストごとに作り直されるので差し替えを戻す処理は要らない
   * @returns {Promise<string[]>} 期待するキーの列（有効キーのうち externalUrlsMap にあるもの）
   */
  const installMenuRecorderAsync = (serviceWorker) =>
    serviceWorker.evaluate(async () => {
      await remakeContextMenus()
      const keys = (await getEnableLinkKeysAsync()).filter((key) => externalUrlsMap[key])

      const originalRemoveAll = chrome.contextMenus.removeAll.bind(chrome.contextMenus)
      const originalCreate = chrome.contextMenus.create.bind(chrome.contextMenus)
      const originalError = console.error.bind(console)
      // create のコールバックが呼ばれたかを1件ずつ持つ。
      // 完了を待たない実装でも lastError を取りこぼさないよう、記録を返す前に全件待つ
      const callbacks = []
      const recorder = {
        calls: [],
        lastErrors: [],
        errors: [],
        originalRemoveAll,
        removeAll: originalRemoveAll,
        resultAsync: async () => {
          await Promise.all(callbacks)
          return { calls: recorder.calls, lastErrors: recorder.lastErrors, errors: recorder.errors }
        }
      }

      chrome.contextMenus.removeAll = () => {
        recorder.calls.push('removeAll')
        return recorder.removeAll()
      }
      // 渡されたコールバックの有無にかかわらず自前のコールバックで呼び、
      // lastError を記録してから渡されたコールバックを同期で呼ぶ（lastError はその間だけ読める）
      chrome.contextMenus.create = (properties, callback) => {
        recorder.calls.push(properties.id)
        let settle
        callbacks.push(new Promise((resolve) => { settle = resolve }))
        return originalCreate(properties, () => {
          const message = chrome.runtime.lastError?.message
          if (message) {
            recorder.lastErrors.push(message)
          }
          try {
            callback?.()
          } finally {
            settle()
          }
        })
      }
      console.error = (...args) => {
        recorder.errors.push(args.map(String).join(' '))
        originalError(...args)
      }

      globalThis.kttMenuRecorder = recorder
      return keys
    })

  /**
   * 記録した呼び出し列を removeAll で区切り、区間ごとの create の id 列にする
   * @param {string[]} calls `kttMenuRecorder.calls`
   * @returns {string[][]}
   */
  const splitByRemoveAll = (calls) => {
    const sections = []
    for (const call of calls) {
      if (call === 'removeAll' || sections.length === 0) {
        sections.push([])
      }
      if (call !== 'removeAll') {
        sections.at(-1).push(call)
      }
    }
    return sections
  }

  test('並行して呼んでも create の lastError が出ない', async ({ serviceWorker }) => {
    const keys = await installMenuRecorderAsync(serviceWorker)

    const { calls, lastErrors, errors } = await serviceWorker.evaluate(async () => {
      await Promise.all([remakeContextMenus(), remakeContextMenus()])
      return globalThis.kttMenuRecorder.resultAsync()
    })

    expect(lastErrors).toEqual([])
    expect(errors).toEqual([])
    // 交錯していれば removeAll, removeAll, … の順になる
    expect(calls).toEqual(['removeAll', ...keys, 'removeAll', ...keys])
  })

  test('前の再構築が失敗しても次の再構築は走る', async ({ serviceWorker }) => {
    const keys = await installMenuRecorderAsync(serviceWorker)

    const { settled, calls, lastErrors, errors } = await serviceWorker.evaluate(async () => {
      const recorder = globalThis.kttMenuRecorder
      let count = 0
      recorder.removeAll = () => {
        count += 1
        return count === 1 ? Promise.reject(new Error('KTT-TEST')) : recorder.originalRemoveAll()
      }

      const settled = await Promise.all([remakeContextMenus(), remakeContextMenus()])
        .then(() => 'fulfilled', (error) => `rejected: ${error}`)
      return { settled, ...await recorder.resultAsync() }
    })

    expect(settled).toBe('fulfilled')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('KTT-TEST')
    // 1回目は removeAll の失敗で中断し create を1件も呼ばない。2回目は全件を順に作る
    expect(calls).toEqual(['removeAll', 'removeAll', ...keys])
    expect(lastErrors).toEqual([])
  })

  test('create の失敗を console.error に出し、残りの項目も作る', async ({ serviceWorker }) => {
    const keys = await installMenuRecorderAsync(serviceWorker)
    // 先頭キーと末尾キーを区別できること
    expect(keys.length).toBeGreaterThan(1)

    const { settled, calls, lastErrors, errors } = await serviceWorker.evaluate(async () => {
      const recorder = globalThis.kttMenuRecorder
      // 既存の項目が残るので、create は実際に duplicate id で失敗する
      recorder.removeAll = async () => {}

      const settled = await remakeContextMenus()
        .then(() => 'fulfilled', (error) => `rejected: ${error}`)
      return { settled, ...await recorder.resultAsync() }
    })

    expect(settled).toBe('fulfilled')
    // 1件目の失敗で止まらない
    expect(calls.filter((call) => call !== 'removeAll')).toEqual(keys)
    // 前提: 全件が実際に失敗している
    expect(lastErrors).toHaveLength(keys.length)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('duplicate id')
    expect(errors[0]).toContain(keys[0])
    expect(errors[0]).toContain(keys.at(-1))
  })

  test('各回は自分の番になった時点の設定で作る', async ({ serviceWorker }) => {
    const keys = await installMenuRecorderAsync(serviceWorker)
    // 設定変更の前後で項目の列が区別できること
    expect(keys.length).toBeGreaterThan(1)

    const { calls } = await serviceWorker.evaluate(async (firstKey) => {
      const recorder = globalThis.kttMenuRecorder
      let reached
      const reachedFirst = new Promise((resolve) => { reached = resolve })
      let release
      const held = new Promise((resolve) => { release = resolve })
      let count = 0
      recorder.removeAll = async () => {
        count += 1
        if (count === 1) {
          reached()
          await held
        }
        return recorder.originalRemoveAll()
      }

      // A と B を積んでから設定を変える。
      // A の番はマイクロタスクで始まるので、A が設定を読んで removeAll で止まるまで待ってから set する
      // (待たずに set すると、A の get が set より後に出て変更後の設定を読む)
      remakeContextMenus()
      remakeContextMenus()
      await reachedFirst
      await chrome.storage.sync.set({ enableLinkKeys: { [firstKey]: 0 } })

      release()
      await remakeContextMenus()
      return recorder.resultAsync()
    }, keys[0])

    const sections = splitByRemoveAll(calls)

    // A・B・onChanged 由来の回・待ち切りの回（onChanged の到着時機は問わない）
    expect(sections.length).toBeGreaterThanOrEqual(3)
    // A は自分の番が来た時点（設定の変更前）の設定で作る
    expect(sections[0]).toEqual(keys)
    // B 以降は変更後の設定で作る。B が呼び出し時点で設定を読んでいれば keys になる
    for (const section of sections.slice(1)) {
      expect(section).toEqual([keys[0]])
    }
  })

  // SPEC-ST-03 / NFR-05: サイト廃止で消えた key が storage に残っていても、その項目だけ作らない。
  // ガード（`if (!externalUrlsMap[key])`）が無いと title の読み出しで TypeError になり、
  // create の失敗として集計されて console.error に出る
  test('storage に残った未知のキーは読み飛ばし、エラーを出さない', async ({ serviceWorker }) => {
    // set が onChanged 経由で積む再構築を、記録を差し替える前に待ち切る。
    // 差し替えの途中でその回が走ると、removeAll だけが差し替え前に出て create が記録され、
    // 区間が途中からの列になる。onChanged の受信を待ってから積めば、その回はキューで先に済む
    // （Service Worker 本体の onChanged リスナーはトップレベルで先に登録されている）
    await serviceWorker.evaluate(async (staleKeys) => {
      const changed = new Promise((resolve) => {
        const listener = () => {
          chrome.storage.onChanged.removeListener(listener)
          resolve()
        }
        chrome.storage.onChanged.addListener(listener)
      })
      await chrome.storage.sync.set({ enableLinkKeys: staleKeys })
      await changed
      await remakeContextMenus()
    }, STALE_KEYS)
    const keys = await installMenuRecorderAsync(serviceWorker)
    // 前提: 設定が Service Worker に届いている（未知キーを除いた設定順）
    expect(keys).toEqual(['kabutan.jp/stock', 'minkabu.jp/stock'])

    const { calls, lastErrors, errors } = await serviceWorker.evaluate(async () => {
      await remakeContextMenus()
      return globalThis.kttMenuRecorder.resultAsync()
    })

    expect(lastErrors).toEqual([])
    expect(errors).toEqual([])
    expect(calls).not.toContain(STALE_KEY)

    // onChanged 由来の回は差し替え前に済ませてあるので通常は1区間。
    // 区間がいくつあっても（仕様は onChanged 由来の回が記録に入るかを問わない）、どれも同じ列で作る
    const sections = splitByRemoveAll(calls)
    expect(sections.length).toBeGreaterThanOrEqual(1)
    for (const section of sections) {
      expect(section).toEqual(['kabutan.jp/stock', 'minkabu.jp/stock'])
    }
  })
})

// SPEC-SW-05 / SPEC-SW-10: 右クリックメニューの項目を押しても開けないとき、小窓で理由を知らせる（FR-29）。
// 回帰テスト: 1.20.3 までは、米国株のページを持たない遷移先や銘柄コードと読み取れない文字列で
// 項目を押すと、タブも開かず何も出さずに抜けていた（利用者から見ると「押したのに反応しない」）。
// Chrome の右クリックメニューそのものは Playwright から押せないので、押された後の処理を直接呼ぶ
test.describe('service_worker: 開けない項目を押したときの小窓', () => {
  /**
   * `chrome.tabs.create` を「引数を記録して `{}` を返す」関数に差し替える。
   * `realWindows` が偽なら `chrome.windows.create` も「引数を記録して `{ id: -1 }` を返す」関数に差し替える（実際には開かない）。
   * `console.error` は引数を文字列化して記録し、元の関数にも渡す。記録は `globalThis.kttOpenRecorder` に置く。
   * `context` はテストごとに作り直されるので差し替えを戻す処理は要らない
   */
  const installOpenRecorderAsync = (serviceWorker, { realWindows = false } = {}) =>
    serviceWorker.evaluate((real) => {
      const originalError = console.error.bind(console)
      const recorder = { tabsCreate: [], windowsCreate: [], errors: [] }

      chrome.tabs.create = async (properties) => {
        recorder.tabsCreate.push(properties)
        return {}
      }
      if (!real) {
        chrome.windows.create = async (properties) => {
          recorder.windowsCreate.push(properties)
          return { id: -1 }
        }
      }
      console.error = (...args) => {
        recorder.errors.push(args.map(String).join(' '))
        originalError(...args)
      }

      globalThis.kttOpenRecorder = recorder
    }, realWindows)

  /** 扱う遷移先の一覧を externalUrls から作る（直書きしない） */
  const getKeySetsAsync = (serviceWorker) =>
    serviceWorker.evaluate(() => ({
      usUnsupportedKeys: externalUrls.filter((u) => !u.url3 && !u.url2).map((u) => u.key),
      url3Keys: externalUrls.filter((u) => u.url3).map((u) => u.key),
      url2Keys: externalUrls.filter((u) => u.url2).map((u) => u.key)
    }))

  /**
   * 1回ごとに記録を空にしてから `onContextMenuClickedAsync` を呼び、1回分ずつの記録を返す。
   * `chrome-extension://` の URL は Node の URL では origin が取れないので、分解は Service Worker 側で行う
   * @param {{ menuItemId: string, selectionText: string, tab?: object }[]} clicks
   */
  const clickAndRecordAsync = (serviceWorker, clicks) =>
    serviceWorker.evaluate(async (list) => {
      const recorder = globalThis.kttOpenRecorder
      const results = []
      for (const { menuItemId, selectionText, tab } of list) {
        recorder.tabsCreate = []
        recorder.windowsCreate = []
        recorder.errors = []
        const settled = await onContextMenuClickedAsync({ menuItemId, selectionText }, tab)
          .then(() => 'fulfilled', (error) => `rejected: ${error}`)
        results.push({
          label: `${menuItemId} / ${selectionText}`,
          menuItemId,
          selectionText,
          settled,
          tabsCreate: recorder.tabsCreate,
          windowsCreate: recorder.windowsCreate.map((properties) => {
            const url = new URL(properties.url)
            return { ...properties, urlBase: url.origin + url.pathname, urlParams: [...url.searchParams] }
          }),
          errors: recorder.errors
        })
      }
      return { noticeBase: chrome.runtime.getURL('notice.html'), results }
    }, clicks)

  test('米国株のページが無い遷移先を押すと、タブを開かず小窓を1つ開く', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const { usUnsupportedKeys } = await getKeySetsAsync(serviceWorker)
    expect(usUnsupportedKeys.length).toBeGreaterThan(0)

    const clicks = usUnsupportedKeys.flatMap((key) =>
      ['AAPL', 'NASDAQ:AAPL', 'AAPL NASDAQ'].map((selectionText) => ({ menuItemId: key, selectionText })))
    const { noticeBase, results } = await clickAndRecordAsync(serviceWorker, clicks)

    expect(results).toHaveLength(clicks.length)
    for (const r of results) {
      expect(r.tabsCreate, r.label).toEqual([])
      expect(r.windowsCreate, r.label).toHaveLength(1)
      expect(r.windowsCreate[0], r.label).toMatchObject({ type: 'popup', focused: true, width: 440, height: 280 })
      expect(r.windowsCreate[0].urlBase, r.label).toBe(noticeBase)
      // 選択文字列は渡さない。code は getTickerCode の結果
      expect(r.windowsCreate[0].urlParams, r.label).toEqual([
        ['reason', 'us-unsupported'], ['key', r.menuItemId], ['code', 'AAPL']
      ])
      expect(r.errors, r.label).toEqual([])
    }
  })

  test('開ける場合はこれまでどおりタブを開き、小窓を開かない', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const clicks = await serviceWorker.evaluate(() => [
      ...externalUrls.map((u) =>
        ({ menuItemId: u.key, selectionText: '7203', expected: makeUrl(u.url1, '7203') })),
      ...externalUrls.filter((u) => u.url3).map((u) =>
        ({ menuItemId: u.key, selectionText: 'AAPL', expected: makeUrl(u.url3, 'AAPL') })),
      ...externalUrls.filter((u) => u.url2).map((u) =>
        ({ menuItemId: u.key, selectionText: 'NASDAQ:AAPL', expected: makeUrl(u.url2, 'AAPL', 'NASDAQ') }))
    ])
    const { results } = await clickAndRecordAsync(serviceWorker, clicks)

    expect(results).toHaveLength(clicks.length)
    results.forEach((r, i) => {
      expect(r.tabsCreate, r.label).toEqual([{ url: clicks[i].expected }])
    })
    expect(results.flatMap((r) => r.windowsCreate)).toEqual([])
  })

  // FR-29 判定基準4（2026-10-11 利用者回答 (a)）: 知らせるが、選択した文字列は小窓に出さない
  test('銘柄コードと解釈できない文字列では、選択した文字列を渡さずに小窓を開く', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const texts = ['こんにちは', '株価はNYSEで上昇', 'SP:SPX', 'BRK.B']
    const { noticeBase, results } = await clickAndRecordAsync(serviceWorker,
      texts.map((selectionText) => ({ menuItemId: 'kabutan.jp/stock', selectionText })))

    expect(results).toHaveLength(texts.length)
    for (const r of results) {
      expect(r.tabsCreate, r.label).toEqual([])
      expect(r.windowsCreate, r.label).toHaveLength(1)
      expect(r.windowsCreate[0].urlBase, r.label).toBe(noticeBase)
      expect(r.windowsCreate[0].urlParams, r.label).toEqual([
        ['reason', 'not-ticker'], ['key', 'kabutan.jp/stock']
      ])
      expect(r.windowsCreate[0].url, r.label).not.toContain(r.selectionText)
      expect(r.windowsCreate[0].url, r.label).not.toContain(encodeURIComponent(r.selectionText))
    }
  })

  // 項目は定義にある遷移先からしか作らないので利用者の操作では起きない。防御の分岐（FR-29 の洗い出し 3）
  test('未知の遷移先キーは小窓もタブも開かず、console.error に出す', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const { results: [r] } = await clickAndRecordAsync(serviceWorker,
      [{ menuItemId: STALE_KEY, selectionText: '7203' }])

    expect(r.tabsCreate).toEqual([])
    expect(r.windowsCreate).toEqual([])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('unknown key')
    expect(r.errors[0]).toContain(STALE_KEY)
  })

  test('小窓は押した元のウィンドウの中央に開く', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const { usUnsupportedKeys } = await getKeySetsAsync(serviceWorker)
    const base = await serviceWorker.evaluate(async () =>
      (await chrome.windows.getAll({ windowTypes: ['normal'] }))[0])
    // 前提: 元のウィンドウの位置と大きさが取れている
    for (const name of ['left', 'top', 'width', 'height']) {
      expect(typeof base[name], name).toBe('number')
    }

    const key = usUnsupportedKeys[0]
    const { results } = await clickAndRecordAsync(serviceWorker, [
      { menuItemId: key, selectionText: 'AAPL', tab: { id: -1, windowId: base.id } },
      { menuItemId: key, selectionText: 'AAPL', tab: undefined },
      { menuItemId: key, selectionText: 'AAPL', tab: { id: -1, windowId: -1 } }
    ])

    for (const r of results) {
      expect(r.windowsCreate).toHaveLength(1)
      expect(r.errors).toEqual([])
    }
    // (i) 元のウィンドウの中央
    expect(results[0].windowsCreate[0].left).toBe(base.left + Math.max(0, Math.round((base.width - 440) / 2)))
    expect(results[0].windowsCreate[0].top).toBe(base.top + Math.max(0, Math.round((base.height - 280) / 2)))
    // (ii) tab が無い / (iii) windowId が負: 位置は Chrome に任せる
    for (const r of results.slice(1)) {
      expect(Object.keys(r.windowsCreate[0])).not.toContain('left')
      expect(Object.keys(r.windowsCreate[0])).not.toContain('top')
    }
  })

  test('何度押しても小窓は1つだけで、最後に押した内容を出す', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker, { realWindows: true })
    const { usUnsupportedKeys } = await getKeySetsAsync(serviceWorker)

    const { noticeUrls, tabsCreate } = await serviceWorker.evaluate(async (key) => {
      const [base] = await chrome.windows.getAll({ windowTypes: ['normal'] })
      const tab = { id: -1, windowId: base.id }
      for (const selectionText of ['AAPL', 'MSFT', 'TSLA']) {
        await onContextMenuClickedAsync({ menuItemId: key, selectionText }, tab)
      }

      const noticeBase = chrome.runtime.getURL('notice.html')
      const popups = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })
      const noticeUrls = popups
        .map((popup) => (popup.tabs ?? [])
          .flatMap((t) => [t.pendingUrl, t.url])
          .find((url) => url?.startsWith(noticeBase)))
        .filter((url) => url !== undefined)
      return { noticeUrls, tabsCreate: globalThis.kttOpenRecorder.tabsCreate }
    }, usUnsupportedKeys[0])

    expect(noticeUrls).toHaveLength(1)
    expect(new URL(noticeUrls[0]).searchParams.get('code')).toBe('TSLA')
    expect(tabsCreate).toEqual([])
  })

  test('小窓を開けなくても例外を外へ出さない', async ({ serviceWorker }) => {
    await installOpenRecorderAsync(serviceWorker)
    const { usUnsupportedKeys } = await getKeySetsAsync(serviceWorker)
    await serviceWorker.evaluate(() => {
      chrome.windows.create = async () => { throw new Error('KTT-TEST') }
    })

    const { results: [r] } = await clickAndRecordAsync(serviceWorker,
      [{ menuItemId: usUnsupportedKeys[0], selectionText: 'AAPL' }])

    expect(r.settled).toBe('fulfilled')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('KTT-TEST')
  })

  test('クリックのハンドラは onClicked に登録されている', async ({ serviceWorker }) => {
    expect(await serviceWorker.evaluate(() =>
      chrome.contextMenus.onClicked.hasListener(onContextMenuClickedAsync))).toBe(true)
  })
})

// SPEC-MF-03 / FR-29 判定基準6: 権限を増やさない（既存利用者に再承認を求めない）。
// npm run validate は想定外の権限を警告するだけで止まらないので、増やしたら落ちる検査はここが担う
test.describe('manifest: 権限', () => {
  test('permissions は3つのままで、ホスト権限・任意権限・web_accessible_resources を宣言しない', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'src', 'manifest.json'), 'utf8'))

    expect(manifest.permissions).toEqual(['tabs', 'contextMenus', 'storage'])
    for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'web_accessible_resources']) {
      expect(Object.hasOwn(manifest, key), key).toBe(false)
    }
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

// FR-08 判定基準6: 銘柄コードを取り出す**リテラル3本**（urls.js の usCodePattern /
// service_worker.js の優先順位4の直書き / TradingView の parseExchangeSymbol）で
// 後続境界の値を揃える。
// 実装は共有しない方針（ADR-0009 の 3）なので、揃っていることをソースで固定する。
// 経路ごとに境界がずれると、同じ `NYSE:BRK.B` が経路によって別の結果になる。
//
// **通る経路は5本**（選択文字列2 ＋ TradingView ＋ 注入経路 ＋ ウォッチリスト）だが、
// 注入経路（SPEC-TC-10）は新しいリテラルを作らず urls.js の usCodePattern を共有するため
// リテラルは3本のまま（ADR-0014 の 3）。**読む対象に urls.js を足さないと、
// 1.17.0 の移設で件数が 3→2 に落ちてここが落ちる**（＝移設を検知する。期待値は下げない）
test.describe('米国ティッカーの後続境界: リテラル3本で同じ値', () => {
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
    ...usTickerPatternsOf('src/urls.js'),
    ...usTickerPatternsOf('src/service_worker.js'),
    ...usTickerPatternsOf('src/tradingview-cs.js')
  ]

  test('リテラル3本とも同じ境界で、u フラグが付いている', () => {
    // リテラルが増減したら気付けるように件数も固定する
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

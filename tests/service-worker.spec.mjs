import { test, expect } from './fixtures/extension.mjs'

// Service Worker のトップレベル関数を実コンテキストで直接検証する。
// ビルドが無くモジュール化もされていないため、これが唯一の単体テスト手段になる。

test.describe('service_worker: getTickerCode', () => {
  const evalTicker = (serviceWorker, text) =>
    serviceWorker.evaluate((t) => getTickerCode(t), text)

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
    expect(await evalTicker(serviceWorker, 'NASDAQ:AAPL')).toEqual({ status: false })
  })

  test('先頭がティッカーなら後ろに文字列が続いても認識する', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'AAPL Apple Inc.')).toMatchObject({
      status: true, type: 'us', code: 'AAPL'
    })
  })

  test('銘柄コードが無い文字列は false を返す', async ({ serviceWorker }) => {
    expect(await evalTicker(serviceWorker, 'こんにちは')).toEqual({ status: false })
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
      tse: exchanges.TSE
    }))

    expect(report.invalidKey).toEqual([])
    expect(report.withDly).toEqual([])
    expect(report.invalidType).toEqual([])
    expect(report.tse).toBe('jp')
    expect(report.total).toBeGreaterThan(0)
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

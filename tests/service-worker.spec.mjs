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

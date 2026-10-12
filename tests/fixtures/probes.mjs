/**
 * 「起きないこと」を確かめるための観測手段（NFR-14 / SPEC-CS-19。手動確認 G を自動化するのに使う）。
 *
 * 切断状態では**何もしないのが正しい**ので、テストは「足されない」「例外が出ない」「止まった」を見ることになる。
 * 件数を数えるだけでは「足してすぐ消す」を見逃すため、操作の前から観測を仕込んでおく。
 */

/** 拡張が足す要素の目印（TradingView の行・ボタン・背景 / 楽天・SBI のメニュー） */
const INJECTED_MARKERS = ['data-kabu-tantan', 'ktt-tv-', 'x-kabu-']

/**
 * ページ側（main world）に MutationObserver を仕込み、拡張が足した要素を記録する。
 * Content Script の isolated world とは DOM を共有するので、拡張の変更もここで見える
 * @param {string[]} markers
 */
const recordAddedNodes = (markers) => {
  window.__addedNodes = []
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && markers.some((marker) => node.outerHTML.includes(marker))) {
          window.__addedNodes.push(node.outerHTML.slice(0, 120))
        }
      }
    }
  }).observe(document, { childList: true, subtree: true })
}

/**
 * 拡張が足した要素の記録を始める。
 *
 * **行は 300ms 以内に消える**（右クリックメニューの行は、問い合わせに失敗すると取り除かれる）ので、
 * 件数を後から数えても「一瞬だけ現れた」を見逃す。操作の前に呼ぶこと。
 * `fromStart` なら次の遷移の最初から記録する（読み込み直後の振る舞いを見るとき）
 * @param {import('@playwright/test').Page} page
 * @param {{ fromStart?: boolean }} [options]
 */
export const recordAddedNodesAsync = (page, { fromStart = false } = {}) => fromStart
  ? page.addInitScript(recordAddedNodes, INJECTED_MARKERS)
  : page.evaluate(recordAddedNodes, INJECTED_MARKERS)

/**
 * 記録を始めてから拡張が足した要素（先頭 120 文字）
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export const addedNodesAsync = (page) => page.evaluate(() => window.__addedNodes)

/**
 * ページの例外とコンソールのエラーを集める（「コンソールに例外が出ない」の代わり）。
 * Content Script（isolated world）の例外も、切断後を含めてここに届く（2026-10-12 実測）
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} 届いたものを順に積む配列
 */
export const collectErrors = (page) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`)
    }
  })
  return errors
}

/**
 * 要素の中心を左クリックし、そのクリックを最初に受け取った要素のタグ名を返す。
 * 透明な全画面の層（背景）が残っていれば、ページの要素ではなく層が受け取る（NFR-14 の判定基準 2）
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<string | null>}
 */
export const clickReceiverAsync = async (page, locator) => {
  await page.evaluate(() => {
    window.__clickReceiver = null
    document.addEventListener('click', (e) => {
      window.__clickReceiver = e.target.tagName.toLowerCase()
    }, { capture: true, once: true })
  })
  const box = await locator.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return page.evaluate(() => window.__clickReceiver)
}

/**
 * Content Script の isolated world で、再試行のタイマーを数えられるようにする。
 * 再試行は `setInterval` 1本で駆動し、止めるときは `clearInterval` を通る（SPEC-CS-22 / ADR-0008）
 */
const COUNT_INTERVALS = `(() => {
  const active = globalThis.__activeIntervals = new Set()
  const setIntervalOriginal = globalThis.setInterval
  const clearIntervalOriginal = globalThis.clearInterval
  globalThis.setInterval = (...args) => {
    const id = setIntervalOriginal.apply(globalThis, args)
    active.add(id)
    return id
  }
  globalThis.clearInterval = (id) => {
    active.delete(id)
    return clearIntervalOriginal.call(globalThis, id)
  }
})()`

/**
 * Content Script の isolated world を CDP で掴む。
 *
 * Playwright は isolated world を公開しないので、`Runtime.executionContextCreated` で
 * origin が `chrome-extension://<id>` の isolated world を拾う。**遷移の前に呼ぶこと。**
 * 拡張機能を再読み込みした後も古い world は残るので、切断状態の Content Script の中を調べられる。
 * 掴むのは最初に作られた1つだけ（タブを再読み込みした後の world は見ない）
 *
 * `countIntervals` なら、world ができた直後に `setInterval` / `clearInterval` を数えるよう差し替える。
 * Content Script が最初にタイマーを張るのは読み込みの 500ms 後（`$(() => setTimeout(…, 500))` の先）なので間に合う
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {string} extensionId
 * @param {{ countIntervals?: boolean }} [options]
 */
export const watchContentScriptAsync = async (context, page, extensionId, { countIntervals = false } = {}) => {
  const cdp = await context.newCDPSession(page)
  const origin = `chrome-extension://${extensionId}`
  let contextId = null

  /** world の中で式を評価し、値を返す（例外はそのまま投げる） */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true
    })
    if (exceptionDetails) {
      throw new Error(`Content Script の中で評価できなかった: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    }
    return result.value
  }

  const created = new Promise((resolve, reject) => {
    cdp.on('Runtime.executionContextCreated', ({ context: world }) => {
      if (contextId !== null || world.auxData?.type !== 'isolated' || world.origin !== origin) {
        return
      }
      contextId = world.id
      // 差し替えを待ってから知らせる（テストが数え始める前に済ませる）
      const ready = countIntervals ? evaluate(COUNT_INTERVALS) : Promise.resolve()
      ready.then(() => resolve(), reject)
    })
  })
  await cdp.send('Runtime.enable')

  return {
    /** world ができた（`countIntervals` なら差し替えも済んだ）ときに解決する */
    created,
    evaluate,
    /** 動いている再試行のタイマーの数（`countIntervals` のときだけ使える） */
    activeIntervalsAsync: () => evaluate('globalThis.__activeIntervals.size')
  }
}

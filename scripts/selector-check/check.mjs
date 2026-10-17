/**
 * 1対象の検証と判定・再分類 (SPEC-SC-09, 10, 11, 24)。
 *
 * ここが持ってよいのは「件数・判定・例外メッセージ」と、拡張が足した行の位置の差（px）だけ。
 * ページ本文・URL・認証情報は**記録しない** (SPEC-SC-14 / NFR-12)。
 * 到達のために組み立て URL を一時的に扱うが、結果ファイルにも標準出力にも出さない。
 */

import { collectFactsAsync, attachTrackingAsync, decideReach, sanitize } from './diagnostics.mjs'
import { evaluateScripts } from './load-selectors.mjs'

// 消毒（URL を潰し 120 文字で切る）の実装は diagnostics.mjs にある。
// 手がかりの整形と同じ関数を通す必要があるため、ここからは再輸出だけを行う (SPEC-SC-14)
export { sanitize }

/** 判定 */
export const OK = 'ok'
export const BROKEN = 'broken'
export const UNREACHED = 'unreached'
export const SKIPPED = 'skipped'

/**
 * 検証ツールの対象外。**判定ではない**ので ❌ / ⚠️ / — のどれにも混ぜない。
 *
 * ツールの仕組みでは到達できないと分かっていて、確認を人に委ねた対象に付く
 * （楽天証券の株価検索は検索が POST でURLが変わらず、フォーム送信は CON-10 で行わない）。
 * `—`（未実施）に混ぜると「毎回やり残しが1件ある」表示になり、
 * 本当のやり残しと区別できなくなる ＝ 誤った ❌ を常態化させたのと同じ失敗になる。
 */
export const EXCLUDED = 'excluded'

/** 遷移後の既定待機（Content Script の固定待機 500/1500ms + 描画待ち） */
const DEFAULT_SETTLE_MS = 2000

/** jQuery が入っていないフレームを踏んだときの目印（セレクタ破損と区別する） */
class JQueryMissingError extends Error {}

/** 到達判定で ⚠️ → ❌ に再分類した根拠 (SPEC-SC-24) */
const RECLASSIFIED_NOTE = 'ページ識別セレクタは 0 件だが、題名から到達と判断した'

/** 利用者データが 0 件でも同じ観測になる対象への注意書き (SPEC-SC-10 の補足規則) */
const USER_DATA_NOTE = '利用者データ（お気に入り・保有銘柄）が 0 件でも同じ結果になる。登録状況を確認すること'

/**
 * 同梱 jQuery を検証用に読み込む初期化スクリプトを作る (SPEC-SC-09)。
 *
 * `addInitScript` で入れるので対象サイトの CSP に阻まれず、外部からも取得しない (CON-07)。
 * ただし jQuery 4 は document-start（`documentElement` が未生成）で評価すると例外になるため、
 * **本体の評価は初回利用時まで遅らせる**。
 * 読み込み後は `noConflict(true)` でサイト側の `$` / `jQuery` を元に戻す (NFR-01)。
 *
 * @param { string } jquerySource `src/third-party/jquery.min.js` の中身
 */
export const createBootstrapScript = (jquerySource) => `
window.__kabuCheckLoad = function () {
${jquerySource}
  window.__kabuCheck$ = window.jQuery.noConflict(true)
}
window.__kabuCheckJq = function () {
  if (typeof window.__kabuCheck$ !== 'function') {
    window.__kabuCheckLoad()
  }
  return window.__kabuCheck$
}
`

/**
 * 同梱 jQuery でセレクタを評価して件数を返す (SPEC-SC-09)。
 * @param { import('@playwright/test').Frame } frame
 * @param { string } selector
 */
const countAsync = async (frame, selector) => {
  const result = await frame.evaluate((s) => {
    if (typeof window.__kabuCheckJq !== 'function') {
      return { missing: true }
    }
    try {
      return { count: window.__kabuCheckJq()(s).length }
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) }
    }
  }, selector)

  if (result.missing) {
    throw new JQueryMissingError('検証用 jQuery が注入されていない')
  }
  if (result.error !== undefined) {
    throw new Error(result.error)
  }
  return result.count
}

/** ページ識別セレクタは1つでもヒットすれば到達とみなす (SPEC-SC-04) */
const countPageAsync = async (frame, pageSelectors) => {
  let total = 0
  for (const selector of pageSelectors ?? []) {
    total += await countAsync(frame, selector)
  }
  return total
}

/** URL 部分一致で対象フレームを集める（`reach: 'tab'`） */
const collectFrames = (context, urlPart) => {
  const frames = []
  for (const page of context.pages()) {
    if (page.isClosed()) continue
    for (const frame of page.frames()) {
      if (frame.url().includes(urlPart)) {
        frames.push({ page, frame })
      }
    }
  }
  return frames
}

/** 結果の器を作る。ここに無いフィールドは結果ファイルに出さない（ホワイトリスト） */
const createResult = (site, target, entry) => ({
  site: site.site,
  siteLabel: site.label,
  key: target.key,
  title: entry.title,
  selector: entry.selector,
  status: SKIPPED,
  reason: '',
  pageHits: null,
  hits: null,
  injectedHits: null,
  notes: [],
  // ⚠️/❌ のときだけ手がかりが入る (SPEC-SC-20)
  diagnostics: null
})

/**
 * 判定を決める (SPEC-SC-10)。
 *
 * ここで決まるのは**暫定判定**で、⚠️ は後段の到達判定で ❌ に変わりうる (SPEC-SC-24)。
 * そのため `requiresUserData` の注意書きはここでは付けない。
 * 付ける場所は再分類まで終わった後の1箇所（`noteUserData()`）。
 */
const judge = (result) => {
  if (result.pageHits > 0 && result.hits > 0) {
    result.status = OK
  } else if (result.pageHits > 0 && result.hits === 0) {
    result.status = BROKEN
  } else if (result.pageHits === 0 && result.hits === 0) {
    result.status = UNREACHED
  } else {
    // 識別 0 件・検出 1 件以上は論理的に起こりえない = 識別セレクタが誤っている (SPEC-SC-05)
    result.status = OK
    result.notes.push('ページ識別セレクタの見直しが必要')
  }

  if (result.status === OK && result.hits > 0 && result.injectedHits === 0) {
    result.notes.push('セレクタはヒットするが注入が 0 件。待機時間・設定・例外を疑う')
  }
}

/**
 * TradingView のチャートが認識している銘柄の**接頭辞だけ**を調べる (SPEC-SC-11)。
 * `aria-label` の全文は取り出さない (NFR-12)。
 * @returns { string | null } 一致した接頭辞
 */
const detectSymbolPrefixAsync = async (frame, selector) => frame.evaluate(({ s, prefixes }) => {
  if (typeof window.__kabuCheckJq !== 'function') return null
  const label = window.__kabuCheckJq()(s).attr('aria-label')
  if (!label) return null
  return prefixes.find((prefix) => label.startsWith(prefix)) ?? null
}, { s: selector, prefixes: ['TSE_DLY:', 'TSE:', 'BATS:'] })

/** チャート中央で右クリックしてコンテキストメニューを開く (SPEC-SC-11 / CON-10 の許容操作) */
const openContextMenuAsync = async (page, frame, chartSelector) => {
  const box = await frame.evaluate((s) => {
    const element = window.__kabuCheckJq()(s)[0]
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, chartSelector)

  if (!box || box.width === 0 || box.height === 0) {
    return false
  }

  // 価格軸・時間軸を避けるためチャート領域の中央を狙う
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await page.waitForTimeout(500)
  return true
}

/**
 * 入れ子の隙間を備考の1行にする (SPEC-SC-11)。
 *
 * 1px に満たない差は描画の端数として 0px に丸める。
 * @param { number | null } gap 親メニューの外枠の端と親行の端の差（px）。測れなければ null
 * @param { number } delayMs 入れ子が閉じるまでの猶予（`src/tradingview-cs.js` の `submenuCloseDelayMs`）
 */
export const describeSubmenuGap = (gap, delayMs) => {
  if (gap === null) {
    return '入れ子の隙間を測れなかった（拡張の親行か外枠が見つからない）'
  }
  const px = Math.max(0, Math.round(gap))
  if (px === 0) {
    return '入れ子の隙間は 0px（親行から入れ子へ途切れずに移れる）'
  }
  return `要確認: 入れ子の隙間が ${px}px ある。猶予 ${delayMs}ms より長くかけて越えると入れ子が閉じる`
}

/**
 * 親行と入れ子のあいだの横の隙間を測る (SPEC-SC-11)。
 *
 * 入れ子は親メニューの外枠の端に置く（`src/tradingview-cs.js` の `positionSubmenu()`。右に開くのが基本で、
 * 画面の右端では左に開く）ので、隙間は「外枠の端 − 親行の端」で決まり、**入れ子を開かずに測れる。**
 * 右クリック（CON-10 の許容操作）より先の操作は要らない。返すのは位置の差（px）だけ (NFR-12)。
 * @param { import('@playwright/test').Frame } frame
 * @param { string } markerSelector 拡張が足す区切り行の目印。親行はその次の行
 * @param { string } boxSelector 右クリックメニューの外枠（`contextMenuBoxSelector`）
 * @returns { Promise<{ gap: number | null }> }
 */
export const measureSubmenuGapAsync = async (frame, markerSelector, boxSelector) => frame.evaluate(({ marker, box }) => {
  const parentRow = document.querySelector(marker)?.nextElementSibling
  const menu = parentRow?.closest(box)
  if (!parentRow || !menu) return { gap: null }
  const row = parentRow.getBoundingClientRect()
  const outer = menu.getBoundingClientRect()
  return { gap: Math.max(outer.right - row.right, row.left - outer.left) }
}, { marker: markerSelector, box: boxSelector })

/**
 * 隙間を測って備考に足す。測れなかったときは備考に書くだけで、判定は変えない
 * （隙間はセレクタの破損ではないので、評価の例外として ❌ に落とさない）
 */
const noteSubmenuGapAsync = async (frame, site, markerSelector, result) => {
  try {
    // 外枠のセレクタと猶予は src から読む。検証ツール側に書き写さない (NFR-13)
    const { boxSelector, delayMs } = evaluateScripts([site.source],
      '({ boxSelector: contextMenuBoxSelector, delayMs: submenuCloseDelayMs })')
    const { gap } = await measureSubmenuGapAsync(frame, markerSelector, boxSelector)
    result.notes.push(describeSubmenuGap(gap, delayMs))
  } catch (err) {
    result.notes.push(`入れ子の隙間を測れなかった: ${sanitize(err.message)}`)
  }
}

/**
 * 組み立て URL を作る (SPEC-SC-06)。
 */
const buildUrl = (target, runner, entry) => (typeof target.url === 'function'
  ? target.url({ session: runner.session, entry })
  : target.url)

/**
 * 検証せずに終える結果を作る（件数を数えず、理由だけ残す）。
 *
 * 対象外の対象は `--only` で外したときもログインが無いときも**未実施に落とさない**。
 * 「人が確認する対象」であることは実行のたびに変わらないので、`—` に混ぜると
 * 本当のやり残しと区別がつかなくなる。理由は `target.excluded` の文字列を使う。
 */
export const createSkippedResult = (site, target, entry, reason) => {
  const result = createResult(site, target, entry)
  result.status = target.excluded ? EXCLUDED : SKIPPED
  result.reason = target.excluded || reason
  return result
}

/**
 * 1対象を検証する。
 * 例外は必ず内部で捕捉し、呼び出し側は次の対象へ進める (FR-15)。
 */
export const checkTargetAsync = async (runner, site, target, entry, resolved) => {
  // 対象外は**検証そのものを行わない**。関数の先頭で返すことで、遷移も件数の評価も
  // 走らないことを呼び出し側に依存せず保証する
  if (target.excluded) {
    return createSkippedResult(site, target, entry, '')
  }

  const result = createResult(site, target, entry)

  let page = runner.page
  let frame = runner.lastFrame

  try {
    if (target.reach === 'goto') {
      const url = buildUrl(target, runner, entry)
      page = runner.page
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
      } catch (err) {
        result.status = UNREACHED
        result.reason = 'ページを開けなかった'
        result.notes.push(`遷移に失敗した: ${sanitize(err.message)}`)
        return result
      }
      frame = page.mainFrame()
      await page.waitForTimeout(target.settleMs ?? DEFAULT_SETTLE_MS)
    } else if (target.reach === 'tab') {
      const candidates = collectFrames(runner.context, target.frameUrl)
      if (candidates.length === 0) {
        result.status = SKIPPED
        result.reason = '対象のタブが開かれていない'
        return result
      }

      // 同じ URL のページが複数ある（SBI の ETGate など）ため、
      // ページ識別セレクタ → 検出用セレクタ の順にヒットするフレームを選ぶ
      let picked = null
      let fallback = null
      for (const candidate of candidates) {
        try {
          if (await countPageAsync(candidate.frame, target.pageSelectors) > 0) {
            picked = candidate
            break
          }
          if (!fallback && await countAsync(candidate.frame, entry.selector) > 0) {
            fallback = candidate
          }
        } catch {
          // このフレームは評価できない。次の候補を見る
        }
      }

      const chosen = picked ?? fallback
      if (!chosen) {
        result.status = SKIPPED
        result.reason = '対象のページが開かれていない（識別セレクタ・検出用セレクタともにヒットしない）'
        return result
      }

      page = chosen.page
      frame = chosen.frame
      await page.waitForTimeout(target.settleMs ?? 0)
    } else {
      // reach: 'after' — 直前の対象で使ったフレームをそのまま見る
      if (!frame) {
        result.status = SKIPPED
        result.reason = '前段の対象に到達できていない'
        return result
      }
      page = runner.page
    }

    runner.page = page
    runner.lastFrame = frame

    if (target.action === 'context-menu') {
      const chart = resolved.get('chart-canvas')
      const opened = chart ? await openContextMenuAsync(page, frame, chart.selector) : false
      if (!opened) {
        result.notes.push('チャート領域を特定できず右クリックできなかった')
      }
    }

    result.pageHits = await countPageAsync(frame, target.pageSelectors)
    result.hits = await countAsync(frame, entry.selector)
    // `injected: false` は「拡張がこの対象に何も足さない」。数えずに `—` にする（0 件と書くと注入失敗に読める）
    const injectedSelector = target.injected ?? site.injected
    if (injectedSelector !== false) {
      result.injectedHits = await countAsync(frame, injectedSelector)
    }

    judge(result)

    if (target.extra === 'tv-submenu-gap') {
      await noteSubmenuGapAsync(frame, site, injectedSelector, result)
    }

    if (target.extra === 'tv-symbol') {
      const prefix = await detectSymbolPrefixAsync(frame, entry.selector)
      result.notes.push(prefix
        ? `\`aria-label\` は \`${prefix}\` で始まる`
        : '`aria-label` が `TSE:` / `TSE_DLY:` のいずれでも始まらない')
    }
  } catch (err) {
    if (err instanceof JQueryMissingError) {
      result.status = UNREACHED
      result.reason = '検証できなかった'
      result.notes.push(sanitize(err.message))
    } else {
      // セレクタ評価の例外は破損として扱う (SPEC-SC-09)
      result.status = BROKEN
      result.reason = 'セレクタの評価に失敗した'
      result.notes.push(sanitize(err.message))
    }
  }

  // ⚠️/❌ の対象からだけ原因切り分けの手がかりを採る (SPEC-SC-20)。1対象につき1回だけ。
  // 順序は「facts 採取 → 到達判定と再分類 → プレフィックス追跡」で固定する (SPEC-SC-24)。
  // 追跡するセレクタは**確定した判定**で決まるため、再分類を追跡より前に置く必要がある
  if (frame && (result.status === BROKEN || result.status === UNREACHED)) {
    await collectFactsAsync(frame, result)
    const reclassified = reclassifyByReach(result)
    await attachTrackingAsync(frame, result, trackingSourceOf(result, target, entry))

    // 備考の並びは「追跡の要約 → 再分類の根拠 → 利用者データの注意書き」＝事実 → 判断 → 注意 (SPEC-SC-24)。
    // 再分類そのものは追跡より前に済ませる必要があるため、根拠の1行だけをここまで遅らせる
    if (reclassified) {
      result.notes.push(RECLASSIFIED_NOTE)
    }
  }

  noteUserData(result, target)

  return result
}

/**
 * ❌ に確定した対象にだけ利用者データの注意書きを付ける (SPEC-SC-10 の補足規則)。
 *
 * ❌ に確定する経路は `judge()` / 再分類 (SPEC-SC-24) / セレクタ評価の例外 の3つある。
 * **経路を問わず1回だけ**付けるために、すべての経路が合流するここ1箇所で行う。
 *
 * 再分類の経路でこそ効く。`requiresUserData: true` の4対象はページ識別セレクタ自体がデータ表なので、
 * 登録が 0 件だと識別・検出がともに 0 件になり、題名は正常なページのものになる＝再分類にそのまま当たる。
 */
const noteUserData = (result, target) => {
  if (result.status === BROKEN && target.requiresUserData) {
    result.notes.push(USER_DATA_NOTE)
  }
}

/**
 * 到達判定の結果を書き戻し、⚠️ → ❌ を再分類する (SPEC-SC-24)。
 *
 * 「識別 0 件」だけで未到達と決めない。ページ識別セレクタは検出用セレクタの祖先なので
 * 両者は相関し、根元から壊れると識別も必ず 0 件になる (SPEC-SC-05)。
 * 適用条件の判断と文言の選択は純関数 `decideReach()` に閉じてあり、**ここは書き戻すだけ**。
 *
 * 再分類した対象に `ページ識別セレクタの見直しが必要` は付けない。
 * 付けると破損のたびに誤った指摘が出る (SPEC-SC-05)。
 *
 * @returns { boolean } 再分類したか（根拠の1行は追跡の後に足すため呼び出し側へ返す）
 */
const reclassifyByReach = (result) => {
  if (!result.diagnostics) {
    return false
  }

  const { reclassify, reason } = decideReach({
    pageHits: result.pageHits,
    hits: result.hits,
    title: result.diagnostics.title
  })
  result.diagnostics.reach = reason

  // 再分類は「⚠️ を ❌ に変える」操作なので、呼ばれた時点で ⚠️ の対象にだけ効かせる。
  // セレクタ評価の例外で既に ❌ になっている対象は `judge()` を通っておらず
  // `pageHits` / `hits` が 0 のまま残るため、条件3に当たって
  // 「何も再分類していないのに根拠が付く」ことがあった (SPEC-SC-24)
  if (reclassify && result.status === UNREACHED) {
    result.status = BROKEN
    return true
  }
  return false
}

/**
 * プレフィックス追跡の対象セレクタを決める (SPEC-SC-21)。
 * ❌ はページに着いているので検出用セレクタを、
 * ⚠️ は祖先ごと存在しないのでページ識別セレクタ（先頭1つ）を追う。
 */
const trackingSourceOf = (result, target, entry) => (result.status === BROKEN
  ? { source: '検出用セレクタ', selector: entry.selector }
  : { source: 'ページ識別セレクタ', selector: (target.pageSelectors ?? [])[0] ?? '' })

/**
 * 同じ document のまま指数へ切り替え、国内株へ戻す (SPEC-SC-11 / A-8)。
 * 銘柄検索は CON-10 で許された銘柄切り替えにだけ使う。
 * canvas の参照はブラウザ内に保ち、属性の全文は取り出さない。
 */
export const checkTradingViewSwitchAsync = async (page, chartSelector) => {
  const originalDocument = await page.evaluateHandle(() => document)
  const originalCanvas = await page.evaluateHandle((s) => window.__kabuCheckJq()(s)[0], chartSelector)
  try {
    // 非表示のボタンが最初から無い状態を「隠れた」と数えない。
    await page.locator('div.ktt-tv-kabuLinkMenu').waitFor({ state: 'visible' })
    const observations = []
    for (const { symbol, pattern, visible } of [
      { symbol: 'SP:SPX', pattern: '^SP(?:_DLY|_NAUTH)?:SPX\\b', visible: false },
      { symbol: 'TSE:7203', pattern: '^TSE(?:_DLY)?:7203\\b', visible: true }
    ]) {
      await page.locator('#header-toolbar-symbol-search').press('Enter')
      const search = page.getByRole('dialog').getByRole('searchbox')
      await search.fill(symbol)
      await search.press('Enter')
      // 切り替え完了は対象銘柄の属性で待つ。ボタンだけでは違う銘柄でも通ってしまう。
      await page.waitForFunction(({ selector, pattern }) => {
        const label = window.__kabuCheckJq()(selector).attr('aria-label') ?? ''
        return new RegExp(pattern).test(label)
      }, { selector: chartSelector, pattern }, { timeout: 15000 })
      const sameDocument = await originalDocument.evaluate((original) => original === document)
      const sameCanvas = await originalCanvas.evaluate((original, s) => original === window.__kabuCheckJq()(s)[0], chartSelector)
      if (sameDocument && sameCanvas) {
        await page.locator('div.ktt-tv-kabuLinkMenu').waitFor({ state: visible ? 'visible' : 'hidden' })
      }
      observations.push({
        sameDocument,
        sameCanvas,
        // hidden は要素が消えた場合も通るので、ボタンが残っていることも数える。
        buttonPresent: await page.locator('div.ktt-tv-kabuLinkMenu').count() === 1
      })
    }
    return observations.every(({ sameDocument, sameCanvas, buttonPresent }) => sameDocument && sameCanvas && buttonPresent)
      ? '銘柄切り替え: 同じ document・canvas のまま、指数でボタンが隠れ、国内株に戻すと再表示された'
      : '要確認: 銘柄切り替えで document・canvas が置き換わったか、ボタンが消えた'
  } finally {
    await originalCanvas.dispose()
    await originalDocument.dispose()
  }
}

/**
 * TradingView の後始末・銘柄切り替え・米国株の補足検査 (SPEC-SC-11)。
 * 結果には接頭辞と、要素の同一性・表示切り替えの判定だけを残す。
 */
export const finishTradingViewAsync = async (runner, resolved, results) => {
  const chart = resolved.get('chart-canvas')
  const chartResult = results.find((result) => result.key === 'chart-canvas')
  if (!chart || !chartResult || chartResult.status === SKIPPED) {
    return
  }

  try {
    // 開いたメニューは選択せずに閉じる (CON-10)
    await runner.page.keyboard.press('Escape')
    try {
      chartResult.notes.push(await checkTradingViewSwitchAsync(runner.page, chart.selector))
    } catch (err) {
      chartResult.notes.push(`銘柄切り替えを確認できなかった: ${sanitize(err.message)}`)
    }
    await runner.page.goto('https://jp.tradingview.com/chart/?symbol=BATS%3AAAPL', { waitUntil: 'domcontentloaded' })
    await runner.page.waitForTimeout(5000)

    const prefix = await detectSymbolPrefixAsync(runner.page.mainFrame(), chart.selector)
    chartResult.notes.push(prefix === 'BATS:'
      ? '米国株（BATS）でも `aria-label` は `BATS:` で始まる'
      : '米国株（BATS）で `aria-label` が `BATS:` で始まらない')
  } catch (err) {
    chartResult.notes.push(`米国株の補足検査に失敗: ${sanitize(err.message)}`)
  }
}

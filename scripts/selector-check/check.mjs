/**
 * 1対象の検証と判定・再分類 (SPEC-SC-09, 10, 11, 24, 26)。
 *
 * ここが持ってよいのは「件数・判定・例外メッセージ」だけ。
 * ページ本文・URL・認証情報は**記録しない** (SPEC-SC-14 / NFR-12)。
 * 到達のために href・`referer`・`pathname` を一時的に扱う経路はあるが (SPEC-SC-26)、
 * 結果ファイルにも標準出力にも出さない。
 */

import { collectFactsAsync, attachTrackingAsync, decideReach, sanitize } from './diagnostics.mjs'
import { collectAnchorsAsync, readPathnameAsync, matchesTargetPath, pickLink, describeReach, LINK_PATH_MISMATCH_NOTE, LINK_TRUNCATED_NOTE, LINK_NO_CANDIDATE, LINK_NOT_QUALIFIED } from './links.mjs'

// 消毒（URL を潰し 120 文字で切る）の実装は diagnostics.mjs にある。
// 手がかりの整形と同じ関数を通す必要があるため、ここからは再輸出だけを行う (SPEC-SC-14)
export { sanitize }

/** 判定 */
export const OK = 'ok'
export const BROKEN = 'broken'
export const UNREACHED = 'unreached'
export const SKIPPED = 'skipped'

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
 * 組み立て URL を作る (SPEC-SC-06)。
 * `reach: 'link'` では**たどれなかったときの退避先**として使う (SPEC-SC-26)。
 */
const buildUrl = (target, runner, entry) => (typeof target.url === 'function'
  ? target.url({ session: runner.session, entry })
  : target.url)

/**
 * ポータルから対象ページへのリンクを探す (SPEC-SC-26 の「リンクを探す範囲」)。
 *
 * 走査順は `context.pages()` → `page.frames()` → フレーム内は document order で、
 * **最初に資格を満たしたアンカー**を採る。走査は読み取りだけで、ハブのページを遷移させない。
 * 対象ごとに走査するので、直前にたどり着いたそのサイトのページも2件目以降のハブになる。
 *
 * 資格審査は純関数 `pickLink()` に閉じてあり、ここは走査と結果の集約だけを行う。
 *
 * **サイト固有の値は検証中のサイト定義から受け取る** (SPEC-SC-26「値は「検証中のサイト定義」から引く」)。
 * ここで特定サイトの定数を名指しで読むと、他サイトに `reach: 'link'` を付けたときに
 * **別サイトのオリジンでハブを走査して黙って 0 件になる**（例外も判定の変化も出ない。ADR-0011 の 9-6）。
 *
 * @param { import('@playwright/test').BrowserContext } context
 * @param { { url: string } } entry `menuSelectors` のエントリ
 * @param { { origin?: string, openQuery?: Record<string, string> } } link 検証中のサイトの `link`
 * @returns { Promise<{ href: string | null, referer: string | null, reason: string, truncated: boolean }> }
 */
const findPortalLinkAsync = async (context, entry, link) => {
  // ハブも遷移先も、そのサイト自身のオリジンに限る（サイト外への離脱を作らない。CON-10）。
  // オリジンが無ければ**走査せず**退避する。他サイトのオリジンを流用しない (SPEC-SC-26 の規則3)
  const origin = link?.origin
  if (!origin) {
    return { href: null, referer: null, reason: LINK_NO_CANDIDATE, truncated: false }
  }

  // 資格審査に使うサイト固有の値は純関数へ引数で渡す（links.mjs には持たせない）。
  // `openQuery` が無ければ「クエリ無しだけを許す」に倒れる（安全側。SPEC-SC-26 の規則4）
  const pickContext = { entryUrl: entry.url, origin, openQuery: link.openQuery }
  let sawCandidate = false
  let truncated = false

  for (const page of context.pages()) {
    if (page.isClosed() || !page.url().startsWith(`${origin}/`)) continue

    for (const frame of page.frames()) {
      let collected
      try {
        collected = await collectAnchorsAsync(frame, entry.url)
      } catch {
        // 読めないフレームは飛ばす（判定には影響させない）
        continue
      }
      if (collected.candidates.length === 0) continue

      sawCandidate = true
      // 上限で切り捨てたフレームがあれば覚えておく（退避理由の読み違えを防ぐ）
      truncated = truncated || collected.truncated === true
      const picked = pickLink(collected.candidates, pickContext)
      if (picked.href) {
        return { href: picked.href, referer: frame.url(), reason: picked.reason, truncated: false }
      }
    }
  }

  // 候補すら無かったのか、候補はあったが資格を満たさなかったのかを退避理由に残す
  return {
    href: null,
    referer: null,
    reason: sawCandidate ? LINK_NOT_QUALIFIED : LINK_NO_CANDIDATE,
    truncated
  }
}

/**
 * ポータルのリンクをたどって対象ページを開く (SPEC-SC-26 の「遷移」「到達後のパス確認」)。
 *
 * **CON-10 の担保をこの関数1つに閉じる。** 実際に遷移するのはここだけで、
 * `page.goto()` に渡るのは「資格審査を通した href」か「組み立て URL」のどちらかしかない。
 * `links.mjs` と同じく、この関数にクリック・フォーム送信の呼び出しが現れないことを
 * 自動テストが文字列として固定する (SPEC-SC-16 の `到達リンク`)。
 * **そのため、この関数にはコメントにも当該の呼び出し形を書かない。**
 *
 * @returns { Promise<{ opened: boolean, measurable: boolean }> }
 *   `opened` が偽なら遷移そのものに失敗している（呼び出し側は打ち切る）。
 *   `measurable` が偽なら着いた先が対象ページでない（件数を数えない）
 */
const followPortalLinkAsync = async (runner, site, target, entry, result) => {
  const page = runner.page
  // オリジン・許すクエリは検証中のサイト定義から引く (SPEC-SC-26)
  const link = await findPortalLinkAsync(runner.context, entry, site.link)

  // 到達方法の1行は**判定を問わず**残す。遷移の成否より前に決まるのでここで積む。
  // 備考の先頭に来る (SPEC-SC-23 の備考 8)
  result.notes.push(describeReach(link.reason))
  if (link.truncated) {
    // 「資格を満たさない」と「上限より後ろを見ていない」を読み分けられるようにする
    result.notes.push(LINK_TRUNCATED_NOTE)
  }

  // たどれなければ従来どおり組み立て URL を直打ちする＝最悪でも現状と同じ観測になる
  const url = link.href ?? buildUrl(target, runner, entry)
  try {
    // referer はアンカーを見つけたフレームの URL。実際にそのリンクを押したときに
    // ブラウザが送る値と同じで、偽装ではない (ADR-0011 の 3)。値は出力しない (NFR-12)
    await page.goto(url, link.referer
      ? { referer: link.referer, waitUntil: 'domcontentloaded' }
      : { waitUntil: 'domcontentloaded' })
  } catch (err) {
    result.status = UNREACHED
    result.reason = 'ページを開けなかった'
    result.notes.push(`遷移に失敗した: ${sanitize(err.message)}`)
    return { opened: false, measurable: false }
  }
  await page.waitForTimeout(target.settleMs ?? DEFAULT_SETTLE_MS)

  // パス確認はリンクをたどれたときだけ行う。直打ちへ退避した場合は従来どおりの経路
  // （件数を数えて到達判定に掛ける）に戻す (SPEC-SC-26 の判定表)。
  // 一致規則は Node 側の純関数1箇所だけに置く（ページ側は pathname を返すだけ）
  if (link.href && !matchesTargetPath(await readPathnameAsync(page.mainFrame()), entry.url)) {
    // 開けてはいるので「開けなかった」ではない。着いた先が違うことをそのまま書く
    result.status = UNREACHED
    result.reason = 'たどった先が対象ページでない'
    result.notes.push(LINK_PATH_MISMATCH_NOTE)
    return { opened: true, measurable: false }
  }

  return { opened: true, measurable: true }
}

/**
 * 1対象を検証する。
 * 例外は必ず内部で捕捉し、呼び出し側は次の対象へ進める (FR-15)。
 */
export const checkTargetAsync = async (runner, site, target, entry, resolved) => {
  const result = createResult(site, target, entry)

  let page = runner.page
  let frame = runner.lastFrame
  // たどった先が対象ページでなかったときは件数を数えない (SPEC-SC-26)。
  // 別のページで検出用セレクタがたまたま当たり、誤って ✅ を出すのを防ぐ
  let measurable = true

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
    } else if (target.reach === 'link') {
      // ポータルのリンクをたどる (SPEC-SC-26)。遷移と到達後のパス確認は1つの関数に閉じてある
      page = runner.page
      const followed = await followPortalLinkAsync(runner, site, target, entry, result)
      if (!followed.opened) {
        return result
      }
      frame = page.mainFrame()
      measurable = followed.measurable
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

    if (measurable) {
      result.pageHits = await countPageAsync(frame, target.pageSelectors)
      result.hits = await countAsync(frame, entry.selector)
      result.injectedHits = await countAsync(frame, target.injected ?? site.injected)

      judge(result)

      if (target.extra === 'tv-symbol') {
        const prefix = await detectSymbolPrefixAsync(frame, entry.selector)
        result.notes.push(prefix
          ? `\`aria-label\` は \`${prefix}\` で始まる`
          : '`aria-label` が `TSE:` / `TSE_DLY:` のいずれでも始まらない')
      }
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
 * TradingView の後始末と米国株の補足検査 (SPEC-SC-11 手順 7・8)。
 * 結果には接頭辞の判定だけを残す。
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

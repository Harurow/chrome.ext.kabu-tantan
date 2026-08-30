/**
 * ポータルのリンクをたどる到達 (SPEC-SC-26)。
 *
 * 楽天証券の4ページ（お気に入り2・保有商品一覧2）は、セッション借用付きの組み立て URL を
 * `goto` するとエラー画面に飛ばされる (SPEC-SC-18)。そこでログイン済みページに実在する
 * `a[href]` の href を読み取り、**その URL へ `page.goto()` するだけ**にする。
 *
 * **クリックしない。** 資格審査を通した href へ GET で遷移するので、`onclick` も
 * `addEventListener` のハンドラも定義上発火せず、POST・フォーム送信が起きる経路が
 * 実装上存在しない (CON-10)。このファイルにクリック・フォーム送信の呼び出しが現れないことを
 * 自動テストが機械的に固定する (SPEC-SC-16 の `到達リンク`)。
 * **その検査は文字列の出現で行うため、コードにもコメントにも当該の呼び出し形を書かない。**
 *
 * 手がかりは**遷移先 URL のパスとクエリだけ**。表示名・クラス名・`id`・DOM 構造は使わない
 * （楽天証券ポータルの実 DOM を見て起こした値は本ファイルに1つも無い。ADR-0011 の 2）。
 *
 * 分担は SPEC-SC-20 と同じで、**ページ側は生の値だけを返し、判断は Node 側の純関数で行う**。
 * ログインが要る経路は自動テストにできないため、純関数に落とせるところを最大化してある。
 */

import { isSuspiciousToken, sanitize, TOKEN_WITHHELD } from './diagnostics.mjs'

/** 候補として持ち帰るアンカーの上限（document order の先頭から。SPEC-SC-26） */
export const MAX_CANDIDATES = 20

/** 備考に出すクエリのキー名の上限 (SPEC-SC-26 の「キー名だけを出す」規則4) */
export const MAX_QUERY_KEYS = 10

/* ------------------------------------------------------------------ *
 * 純関数（自動テストの対象。SPEC-SC-16 の `到達リンク`）
 * ------------------------------------------------------------------ */

/** リンクをたどれた */
export const LINK_FOLLOWED = 'followed'

/** パスを含むアンカーが1件も無い */
export const LINK_NO_CANDIDATE = 'no-candidate'

/** パスを含むアンカーはあるが資格を満たさない */
export const LINK_NOT_QUALIFIED = 'not-qualified'

/**
 * 到達方法の1行 (SPEC-SC-23 の備考 8)。**判定を問わず必ず1行出す。**
 * ✅ が「リンク経由の ✅」なのか「直打ちでたまたま取れた ✅」なのかを読めるようにするため。
 *
 * 文言に `<` `>` を使わない（結果ファイルは markdownlint に掛かり、
 * バッククォートの外の山括弧は MD033 で落ちる。SPEC-SC-26）。
 */
const REACH_NOTES = {
  [LINK_FOLLOWED]: '到達方法: ポータルのリンクをたどった',
  [LINK_NO_CANDIDATE]: '到達方法: URL 直打ち（パス一致のリンクが見つからない）',
  [LINK_NOT_QUALIFIED]: '到達方法: URL 直打ち（パス一致のリンクが GET 遷移の条件を満たさない）'
}

/** たどった先が対象ページでなかったときの備考 (SPEC-SC-26 の「到達後のパス確認」) */
export const LINK_PATH_MISMATCH_NOTE = 'たどった先のパスが対象ページのものでない'

/**
 * 候補を上限で切り捨てたときの備考。
 *
 * 切り捨てが起きると、`not-qualified`（＝素の `a href` でない）と
 * 「上限より後ろにある有資格のアンカーを見ていない」が同じ文言になってしまう。
 * 次の一手（上限の引き上げ／ハブの取り方の見直し）を結果ファイルだけで決められるよう、
 * 切り捨てが起きたことを1行で区別する。
 */
export const LINK_TRUNCATED_NOTE =
  `パス一致のアンカーが ${MAX_CANDIDATES} 件を超えたため、先頭 ${MAX_CANDIDATES} 件しか見ていない`

/**
 * 到達方法の1行を返す (SPEC-SC-26 の「たどれなかったときの退避」)。
 *
 * 退避の2文言（`no-candidate` / `not-qualified`）は必ず別の文にする。
 * 「リンクが無い」のか「リンクはあるが素の `a href` でない」のかで次の一手が変わるため
 * （ADR-0011 の 7）。
 * @param { string } reason
 */
export const describeReach = (reason) => REACH_NOTES[reason] ?? REACH_NOTES[LINK_NO_CANDIDATE]

/* ------------------------------------------------------------------ *
 * 退避理由の内訳 (SPEC-SC-26 の「退避理由の内訳」)
 * ------------------------------------------------------------------ */

/**
 * 資格の条件名。**固定の6語**で、サイトの DOM にも URL にも依存しない (SPEC-SC-14)。
 * `not-qualified` だけでは「クエリで落ちた（許す集合を広げうる）」のか
 * 「インラインハンドラで落ちた（到達方法を諦める）」のかが区別できず、
 * 次の一手が正反対なのに決められない (ADR-0011 の 10)。
 */
export const REJECT_RAW_HREF = 'rawHref'
export const REJECT_SCHEME = 'スキーム'
export const REJECT_ORIGIN = 'オリジン'
export const REJECT_PATH = 'パス'
export const REJECT_INLINE_HANDLER = 'インラインハンドラ'
export const REJECT_QUERY = 'クエリ'

/**
 * 条件番号（SPEC-SC-26 の「アンカーの資格」1〜6）の順。
 * 審査の順序と内訳の並び順を**この1つの配列**で決める。
 * 件数の降順にしないのは、実行間で並びが動くと差分が読めなくなるため。
 */
export const REJECT_CONDITIONS = [
  REJECT_RAW_HREF,
  REJECT_SCHEME,
  REJECT_ORIGIN,
  REJECT_PATH,
  REJECT_INLINE_HANDLER,
  REJECT_QUERY
]

/**
 * 資格を満たさなかった条件ごとの件数を1行にする (SPEC-SC-23 の備考 11)。
 * 0 件の条件は書かない。1件も無ければ `null`（呼び出し側は積まない）。
 * @param { Record<string, number> | undefined } rejected 条件名 → 件数
 * @returns { string | null }
 */
export const describeRejected = (rejected) => {
  const parts = REJECT_CONDITIONS
    .filter((name) => (rejected?.[name] ?? 0) > 0)
    .map((name) => `${name} ${rejected[name]} 件`)
  return parts.length === 0 ? null : `資格を満たさなかった内訳: ${parts.join(' / ')}`
}

/**
 * クエリのキー名1個を記録してよい形にする。
 * `BV_SessionID` などが混ざるため、SPEC-SC-22 の不記録判定を通す (SPEC-SC-14)。
 *
 * **判定は生の値で、出力は消毒を通す。** 不記録判定を先に置くのは、
 * `sanitize()` が URL を `[url]` に潰すと「疑わしさ」が消えてしまうため。
 * 消毒を通すのは、`isSuspiciousToken` の長い英数字列の規則が
 * ハイフン・ドットで区切られた長いキーを取り逃し、**長さの上限が効かない経路**になるから。
 * @param { string } key
 */
const formatQueryKey = (key) => {
  if (isSuspiciousToken(key)) {
    return TOKEN_WITHHELD
  }

  const text = sanitize(key)
  // バッククォートを含むキーはコードスパンを壊す（伏せ字と同じく形の問題として落とす）
  return text === '' || text.includes('`') ? TOKEN_WITHHELD : text
}

/**
 * 資格6（クエリ）で落ちた候補のキー名を1行にする (SPEC-SC-23 の備考 12)。
 *
 * **キー名だけを出し、値は出さない。** 許す集合 (`openQuery`) を広げてよいかは
 * キーの意味で決まり、値は判断に要らない (SPEC-SC-14 / ADR-0011 の 7 の 5)。
 *
 * 重複を除いてアルファベット順に並べ、伏せ字と消毒を通し、上限 10 個で切る。
 * **キー名は1つずつバッククォートで囲む。** 伏せ字 `<withheld>` が素のまま備考セルに出ると
 * markdownlint の MD033 に当たり、生成物が `npm run lint:md` で落ちる (SPEC-SC-26 の規則6)。
 *
 * @param { string[] | undefined } keys 生のキー名（重複・順不同でよい）
 * @returns { string | null }
 */
export const describeQueryKeys = (keys) => {
  const raw = (keys ?? []).map((key) => String(key ?? '')).filter((key) => key !== '')
  // 並べ替えは伏せ字の**前**に行う（キー名のアルファベット順であって、伏せ字の順ではない）。
  // 伏せた後にもう一度重複を除くのは、別々のキーが同じ `<withheld>` になりうるため
  const sorted = [...new Set(raw)].sort()
  const list = [...new Set(sorted.map(formatQueryKey))].slice(0, MAX_QUERY_KEYS)
  return list.length === 0
    ? null
    : `資格を満たさなかったクエリのキー: ${list.map((key) => `\`${key}\``).join(', ')}`
}

/**
 * `no-candidate` のときの走査の規模を1行にする (SPEC-SC-23 の備考 13)。
 *
 * 「リンクが無い」には3つの別の原因（ハブが無い／フレームを読めていない／
 * 本当にリンクが無い）があり、文言だけでは区別できない (SPEC-SC-26)。
 * **出すのは件数だけ**で、URL もページ名も出さない (NFR-12)。
 *
 * **読めなかったフレームの数は別に数える。** `links 0` だけでは
 * 「フレームを読めていない」と「本当にリンクが 0 件」が同じ見え方になり、
 * 3 つの原因のうち 2 つが区別できない（0 件のときは1行の書式を変えない）。
 *
 * @param { { frames?: number, links?: number, matched?: number, unreadable?: number } | undefined } scan
 */
export const describeScan = (scan) => {
  const frames = scan?.frames ?? 0
  const links = scan?.links ?? 0
  const matched = scan?.matched ?? 0
  const unreadable = scan?.unreadable ?? 0
  const base = `ハブ ${frames} フレームを走査し、リンク ${links} 件のうちパス一致は ${matched} 件`
  return unreadable === 0 ? base : `${base}（うち読めなかったフレーム ${unreadable} 件）`
}

/**
 * `menuSelectors[].url` から対象ページのパスを取り出す。
 * 楽天証券の定義は末尾に `;`（パスパラメータの始まり）が付くものがある。
 * @param { string } entryUrl
 */
export const targetPathOf = (entryUrl) => {
  const url = String(entryUrl ?? '')
  return url.endsWith(';') ? url.slice(0, -1) : url
}

/**
 * 遷移先のパスが対象ページのものかを判定する (SPEC-SC-26)。
 *
 * **単純な前方一致にしない。** 現物では `…_lst.do` と `…_lst_edit.do` は `.do` の位置が違って
 * 衝突しないが、楽天証券が `.do` を廃した命名に変えたときに静かに別ページへ行くのを防ぐ。
 *
 * 到達後のパス確認 (`readPathnameAsync()` の戻り値) もこの関数で判定する。
 * **一致規則はこの1箇所だけに置く。**
 *
 * @param { string } pathname URL の pathname（クエリ・フラグメントは見ない）
 * @param { string } entryUrl `menuSelectors[].url`（例 `/app/info_jp_prc_reg_lst.do;`）
 * @returns { boolean }
 */
export const matchesTargetPath = (pathname, entryUrl) => {
  const path = targetPathOf(entryUrl)
  if (path === '') {
    return false
  }
  // pathname に混ざっていてもクエリ・フラグメントは判定に使わない
  const actual = String(pathname ?? '').split(/[?#]/)[0]
  return actual === path || actual.startsWith(`${path};`)
}

/**
 * クエリが「そのページを開く」ことだけを意味するかを判定する (SPEC-SC-26 の資格 6)。
 *
 * 楽天証券の `.do` は**同一パスのクエリで操作を切り替える**設計で、行ごとの操作（削除・解除など）が
 * 同じパスに GET で並んでいれば、パス一致だけでは「遷移」と「操作」を区別できない。
 * 判断がつかないものは採らない (CON-10)。
 *
 * 許すクエリの集合は**サイト固有の値なので引数で受け取る**（`links.mjs` は持たない）。
 * 渡されなければ「クエリ無しだけを許す」に倒れる（安全側に閉じる）。
 *
 * @param { string } search `URL` の `search`（先頭の `?` を含む）
 * @param { Record<string, string> | undefined } openQuery 許すキーと値（例 `{ eventType: 'init' }`）
 */
const isOpeningQuery = (search, openQuery) => {
  if (search === '') {
    return true
  }

  const allowed = new Map(Object.entries(openQuery ?? {}))
  const actual = [...new URLSearchParams(search)]

  // 件数も見る。同じキーの重複や、許した組に別のキーを足した形をすり抜けさせない
  return actual.length === allowed.size &&
    actual.every(([key, value]) => allowed.get(key) === value)
}

/**
 * アンカー1件が GET 遷移の資格を満たすかを判定する (SPEC-SC-26 の「アンカーの資格」)。
 *
 * | # | 条件 | 排除するもの |
 * | 1 | `rawHref` が空でなく `#` で始まらない | 自分自身へのリンク |
 * | 2 | スキームが `https:` | `javascript:` / `data:` / `mailto:` |
 * | 3 | オリジンが対象サイト | サイト外への離脱 (CON-10) |
 * | 4 | pathname が対象のパスに一致 | 別ページへの遷移 |
 * | 5 | インラインハンドラを持たない | 実体が送信のリンク (CON-10) |
 * | 6 | クエリが空、または `openQuery` と完全に一致 | 同一パスで操作を切り替えるリンク (CON-10) |
 *
 * **真偽値ではなく「最初に落ちた条件」を返す** (SPEC-SC-26 の「退避理由の内訳」)。
 * 条件は上表の 1〜6 の順に見る。1候補につき数えるのは最初の1つだけで、
 * どこまで審査したかによって内訳が動かないようにする。
 * 解決できない `href` は条件2（スキーム）で落とす（スキームを確かめられない）。
 *
 * @param { { rawHref: string, href: string, hasInlineHandler: boolean } } candidate
 * @param { { entryUrl: string, origin: string, openQuery?: Record<string, string> } } context
 * @returns { string | null } 落ちた条件の名前。資格を満たすなら `null`
 */
const isQualified = (candidate, { entryUrl, origin, openQuery }) => {
  const rawHref = String(candidate?.rawHref ?? '').trim()
  if (rawHref === '' || rawHref.startsWith('#')) {
    return REJECT_RAW_HREF
  }

  let url
  try {
    url = new URL(String(candidate.href ?? ''))
  } catch {
    return REJECT_SCHEME
  }

  if (url.protocol !== 'https:') {
    return REJECT_SCHEME
  }
  if (url.origin !== origin) {
    return REJECT_ORIGIN
  }
  if (!matchesTargetPath(url.pathname, entryUrl)) {
    return REJECT_PATH
  }
  if (candidate.hasInlineHandler) {
    return REJECT_INLINE_HANDLER
  }
  if (!isOpeningQuery(url.search, openQuery)) {
    return REJECT_QUERY
  }
  return null
}

/**
 * 資格6 で落ちた候補のクエリのキー名を取り出す。**値は取り出さない** (SPEC-SC-14)。
 * @param { string } href 解決済みの絶対 URL
 * @returns { string[] }
 */
const queryKeysOf = (href) => {
  try {
    return [...new URL(String(href ?? '')).searchParams.keys()]
  } catch {
    return []
  }
}

/**
 * 候補から遷移してよい href を1つ選ぶ (SPEC-SC-26)。純関数。
 *
 * **なぜ落としたかを返す**（備考の退避理由をここで決めるため。ADR-0011 の 8）。
 * 退避理由の一語だけでは次の一手が決まらないため、
 * **条件ごとの件数**と、資格6 で落ちた候補の**クエリのキー名**も返す
 * (SPEC-SC-26 の「退避理由の内訳」)。たどれた場合は内訳を出さないので空で返す。
 *
 * @param { { rawHref: string, href: string, hasInlineHandler: boolean }[] } candidates document order
 * @param { { entryUrl: string, origin: string, openQuery?: Record<string, string> } } context
 * @returns { { href: string | null, reason: string, rejected: Record<string, number>, queryKeys: string[] } }
 */
export const pickLink = (candidates, context) => {
  const list = candidates ?? []
  if (list.length === 0) {
    return { href: null, reason: LINK_NO_CANDIDATE, rejected: {}, queryKeys: [] }
  }

  const rejected = {}
  const queryKeys = []

  // 走査順（document order）の先頭から、最初に資格を満たしたものを採る
  for (const candidate of list) {
    const rejection = isQualified(candidate, context)
    if (rejection === null) {
      return { href: candidate.href, reason: LINK_FOLLOWED, rejected: {}, queryKeys: [] }
    }

    rejected[rejection] = (rejected[rejection] ?? 0) + 1
    if (rejection === REJECT_QUERY) {
      queryKeys.push(...queryKeysOf(candidate.href))
    }
  }

  return { href: null, reason: LINK_NOT_QUALIFIED, rejected, queryKeys }
}

/* ------------------------------------------------------------------ *
 * 採取（ブラウザに触る部分）
 * ------------------------------------------------------------------ */

/**
 * フレームから `a[href]` の**生の値**だけを持ち帰る (SPEC-SC-26)。
 * 判断はしない（資格審査は Node 側の `pickLink()`）。読み取りだけでページを遷移させない。
 *
 * パス一致の総数 (`matched`) も数える。上限で切り捨てたかを Node 側が知らないと、
 * 「見ていないだけ」を「資格を満たさない」と誤って報告してしまう。
 *
 * @param { import('@playwright/test').Frame } frame
 * @param { string } entryUrl `menuSelectors[].url`
 * @returns { Promise<{ total: number, matched: number, truncated: boolean, candidates: { rawHref: string, href: string, hasInlineHandler: boolean }[] }> }
 */
export const collectAnchorsAsync = (frame, entryUrl) => frame.evaluate(({ path, max }) => {
  const anchors = Array.from(document.querySelectorAll('a[href]'))
  const candidates = []
  let matched = 0

  for (const anchor of anchors) {
    // 解決済みの絶対 URL で絞る（相対 href でも対象パスに解決されうる）
    const href = anchor.href || ''
    if (!href.includes(path)) continue

    matched += 1
    if (candidates.length >= max) continue

    candidates.push({
      rawHref: anchor.getAttribute('href') || '',
      href,
      hasInlineHandler: Array.from(anchor.attributes).some((attr) => attr.name.toLowerCase().startsWith('on'))
    })
  }

  return { total: anchors.length, matched, truncated: matched > max, candidates }
}, { path: targetPathOf(entryUrl), max: MAX_CANDIDATES })

/**
 * たどり着いた先の `pathname` を持ち帰る (SPEC-SC-26 の「到達後のパス確認」)。
 *
 * **ページ側は判断しない。** 一致規則は Node 側の `matchesTargetPath()` の1箇所だけに置く
 * （同じ規則をページ側にも書くと、片方だけ緩んでも自動テストが掛からない）。
 * `pathname` には楽天証券のセッション（パスパラメータ）が入るが、
 * 候補の `href` と同じく**判定に使うだけで結果ファイルにも標準出力にも出さない** (NFR-12 / SPEC-SC-14)。
 *
 * @param { import('@playwright/test').Frame } frame
 * @returns { Promise<string> }
 */
export const readPathnameAsync = (frame) => frame.evaluate(() => window.location.pathname)

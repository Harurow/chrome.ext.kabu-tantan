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

/** 候補として持ち帰るアンカーの上限（document order の先頭から。SPEC-SC-26） */
export const MAX_CANDIDATES = 20

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
 * @param { { rawHref: string, href: string, hasInlineHandler: boolean } } candidate
 * @param { { entryUrl: string, origin: string, openQuery?: Record<string, string> } } context
 */
const isQualified = (candidate, { entryUrl, origin, openQuery }) => {
  const rawHref = String(candidate?.rawHref ?? '').trim()
  if (rawHref === '' || rawHref.startsWith('#')) {
    return false
  }
  if (candidate.hasInlineHandler) {
    return false
  }

  let url
  try {
    url = new URL(String(candidate.href ?? ''))
  } catch {
    // 解決できない href は採らない
    return false
  }

  return url.protocol === 'https:' &&
    url.origin === origin &&
    matchesTargetPath(url.pathname, entryUrl) &&
    isOpeningQuery(url.search, openQuery)
}

/**
 * 候補から遷移してよい href を1つ選ぶ (SPEC-SC-26)。純関数。
 *
 * **なぜ落としたかを返す**（備考の退避理由をここで決めるため。ADR-0011 の 8）。
 *
 * @param { { rawHref: string, href: string, hasInlineHandler: boolean }[] } candidates document order
 * @param { { entryUrl: string, origin: string, openQuery?: Record<string, string> } } context
 * @returns { { href: string | null, reason: string } }
 */
export const pickLink = (candidates, context) => {
  const list = candidates ?? []
  if (list.length === 0) {
    return { href: null, reason: LINK_NO_CANDIDATE }
  }

  // 走査順（document order）の先頭から、最初に資格を満たしたものを採る
  const found = list.find((candidate) => isQualified(candidate, context))
  return found
    ? { href: found.href, reason: LINK_FOLLOWED }
    : { href: null, reason: LINK_NOT_QUALIFIED }
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

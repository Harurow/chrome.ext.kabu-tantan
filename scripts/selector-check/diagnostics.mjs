/**
 * ⚠️/❌ の対象から原因切り分けの手がかりを採る (SPEC-SC-20, 21, 22)。
 *
 * **採ってよいのは「到達先の題名（消毒後）」「要素のタグ名・`id`・`class` 名」
 * 「セレクタ文字列と件数」だけ**（SPEC-SC-14 のホワイトリスト）。
 * テキスト内容・`id`/`class` 以外の属性・URL・クエリ・セッション ID は採らない (NFR-12 / CON-10)。
 *
 * `id` / `class` にもセッション情報が混ざりうるため、題名と同じ判定を通し、
 * 当たったトークンだけを `<withheld>` に置き換える (SPEC-SC-20)。
 *
 * ページ側では**生の値**（`{ tag, id, classes }`）だけを返し、
 * 整形・切り詰め・消毒は Node 側の純関数で行う。この分担があるから自動テストできる (SPEC-SC-16)。
 */

/** プレフィックス追跡の最大段階数 (SPEC-SC-21) */
export const MAX_STAGES = 12

/** 見出し・主要コンテナの最大件数 (SPEC-SC-20) */
export const MAX_ELEMENTS = 5

/** 記述子に載せる class の最大個数 (SPEC-SC-20) */
export const MAX_CLASSES = 5

/** `id` / `class` 1個あたりの最大文字数 (SPEC-SC-20) */
export const MAX_TOKEN = 40

/** 記述子・題名の最大文字数 (SPEC-SC-20, 22) */
export const MAX_TEXT = 120

/** ページの骨格ではないので主要コンテナから除く要素 (SPEC-SC-20) */
const IGNORED_TAGS = ['script', 'style', 'link', 'meta', 'noscript', 'template']

/** 拡張機能自身が注入した要素の目印 (SPEC-CS-13) */
const EXTENSION_CLASS_PREFIXES = ['x-kabu-', 'ktt-tv-']

/**
 * 出力してよい形に文字列を落とす。
 * URL（セッションIDを含む）を潰し、120文字で切る (SPEC-SC-14)。
 *
 * 手がかり（題名・記述子）と既存の例外メッセージの両方がこれを通る。
 * `check.mjs` から再輸出しているので、呼び出し側の import はどちらでもよい。
 * @param { unknown } value
 */
export const sanitize = (value) => String(value ?? '')
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_TEXT)

/* ------------------------------------------------------------------ *
 * セッション情報らしさの判定 (SPEC-SC-22)
 * ------------------------------------------------------------------ */

/**
 * セッション情報・URL が混ざっている疑いを検出するパターン。
 *
 * 題名 (SPEC-SC-22) と記述子のトークン (SPEC-SC-20) の**両方**がこれを通る。
 * 題名だけを厳しく見ても、`<div id="form_BV_SessionID_...">` のような
 * `id` / `class` から漏れては意味が無いため (NFR-12 / CON-10)。
 *
 * **実例を観測したらここに足す。** 判定をこの1箇所に閉じてあるのはそのため (ADR-0004 の 2)。
 */
const SUSPICIOUS_PATTERNS = [
  // 1. URL の混入
  /https?:\/\//i,
  // 2. 対象サイトで実際に使われているセッションパラメータ名
  /(BV_SessionID|BV_EngineID|JSESSIONID|PHPSESSID|session[_-]?id|token|OutSide|_TRANID)/i,
  // 3. クエリ文字列の混入
  /[?&][A-Za-z_][\w.-]*=/,
  // 4. セッション ID の実体（日本語の題名には現れない長さの英数字列）
  /[A-Za-z0-9]{20,}/,
  // 5. UUID 形のセッション ID（ハイフンで切れるためパターン4では当たらない）
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i
]

/** 題名を記録しないときに残す文言 (SPEC-SC-22) */
export const TITLE_WITHHELD = '題名にセッション情報らしき文字列が含まれるため記録しない'

/** 記述子のトークンを記録しないときに残す文言 (SPEC-SC-20) */
export const TOKEN_WITHHELD = '<withheld>'

/**
 * 文字列が「疑わしい」か判定する (SPEC-SC-20, 22)。
 * 題名なら1つでも当たれば**丸ごと記録しない**。
 * 記述子なら当たったトークンだけを伏せる。
 * @param { unknown } value 題名、または `id` / `class` 名1個
 * @returns { boolean }
 */
export const isSuspiciousToken = (value) => {
  const text = String(value ?? '')
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 結果ファイルに書く題名を決める (SPEC-SC-22)。
 * @param { unknown } title `document.title` の生値
 * @returns { string } 記録してよい題名、または不記録の理由
 */
export const formatTitle = (title) => {
  const text = String(title ?? '').trim()
  if (text === '') {
    return '（題名なし）'
  }
  if (isSuspiciousToken(text)) {
    return TITLE_WITHHELD
  }
  return sanitize(text)
}

/* ------------------------------------------------------------------ *
 * 要素の記述子 (SPEC-SC-20)
 * ------------------------------------------------------------------ */

/**
 * `id` / `class` 名1個を記録してよい形にする (SPEC-SC-20)。
 * 疑わしいトークンは 40 文字に切っても 40 文字分が残ってしまうため、**丸ごと伏せる**。
 * 判定は切り詰める**前**の生値に対して行う（切ってからでは当たらなくなる）。
 * @param { unknown } value
 * @returns { string }
 */
const formatToken = (value) => {
  const text = String(value ?? '').trim()
  return isSuspiciousToken(text) ? TOKEN_WITHHELD : text.slice(0, MAX_TOKEN)
}

/**
 * 要素の生の値を `tag#id.class1.class2` 形式の記述子1個にする (SPEC-SC-20)。
 * テキスト・`id`/`class` 以外の属性・`style` は受け取らないし出さない。
 * タグ名は `div` / `table` などしか来ないので伏せ字の対象にしない。
 * @param { { tag?: string, id?: string, classes?: string[] } } raw ページ側が返した生の値
 * @returns { string }
 */
export const describeElement = (raw) => {
  const tag = String(raw?.tag ?? '').trim().toLowerCase()
  const id = raw?.id ? `#${formatToken(raw.id)}` : ''
  const classes = Array.isArray(raw?.classes) ? raw.classes : []
  const classPart = classes
    .filter((name) => String(name ?? '').trim() !== '')
    .slice(0, MAX_CLASSES)
    .map((name) => `.${formatToken(name)}`)
    .join('')

  return sanitize(`${tag}${id}${classPart}`)
}

/**
 * 要素の並びを記述子の配列にする。文書順の先頭 `MAX_ELEMENTS` 件だけ (SPEC-SC-20)。
 * @param { object[] } list
 * @returns { string[] }
 */
export const describeElements = (list) => (Array.isArray(list) ? list : [])
  .slice(0, MAX_ELEMENTS)
  .map(describeElement)
  .filter((descriptor) => descriptor !== '')

/* ------------------------------------------------------------------ *
 * セレクタのプレフィックス追跡 (SPEC-SC-21)
 * ------------------------------------------------------------------ */

/**
 * トップレベルの空白でセレクタを区切る。
 * `[` `]` / `(` `)` の内側とクォート内では切らない（`td:contains("国内株式")` を壊さない）。
 * @param { string } selector
 * @returns { string[] }
 */
const splitTopLevel = (selector) => {
  const tokens = []
  let current = ''
  let depth = 0
  let quote = null

  for (const ch of selector) {
    if (quote !== null) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '[' || ch === '(') {
      depth += 1
      current += ch
      continue
    }
    if (ch === ']' || ch === ')') {
      depth = Math.max(0, depth - 1)
      current += ch
      continue
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (current !== '') {
    tokens.push(current)
  }
  return tokens
}

/**
 * 結合子（`>` / `+` / `~`）を単独の段階にせず、直後のトークンと結合する (SPEC-SC-21)。
 * @param { string[] } tokens
 * @returns { string[] }
 */
const mergeCombinators = (tokens) => {
  const merged = []
  let pending = ''

  for (const token of tokens) {
    if (token === '>' || token === '+' || token === '~') {
      pending = pending === '' ? token : `${pending} ${token}`
      continue
    }
    merged.push(pending === '' ? token : `${pending} ${token}`)
    pending = ''
  }

  // 末尾に結合子だけが残る不正なセレクタでも情報を落とさない
  if (pending !== '') {
    merged.push(pending)
  }
  return merged
}

/**
 * セレクタを追跡する段階に分ける (SPEC-SC-21)。
 *
 * - カンマを含むセレクタは**分割しない**。断片ごとに全体の件数だけを出す
 * - それ以外は先頭から1トークンずつ増やしたプレフィックスにする
 * - 段階は最大 `MAX_STAGES`。超えた分は出さず `omitted` で知らせる
 *
 * @param { string } selector
 * @returns { { mode: 'prefix' | 'fragments', stages: string[], omitted: boolean } }
 */
export const planPrefixTracking = (selector) => {
  const normalized = String(selector ?? '').replace(/\s+/g, ' ').trim()

  if (normalized === '') {
    return { mode: 'prefix', stages: [], omitted: false }
  }

  if (normalized.includes(',')) {
    const fragments = normalized.split(',').map((part) => part.trim()).filter(Boolean)
    return {
      mode: 'fragments',
      stages: fragments.slice(0, MAX_STAGES),
      omitted: fragments.length > MAX_STAGES
    }
  }

  const tokens = mergeCombinators(splitTopLevel(normalized))
  const stages = []
  let prefix = ''
  for (const token of tokens) {
    prefix = prefix === '' ? token : `${prefix} ${token}`
    stages.push(prefix)
  }

  return {
    mode: 'prefix',
    stages: stages.slice(0, MAX_STAGES),
    omitted: stages.length > MAX_STAGES
  }
}

/**
 * 結果表の備考に入れる1行要約を作る (SPEC-SC-21)。
 * @param { { mode: string } } plan
 * @param { { selector: string, hits: number }[] } rows 実際に評価した段階
 * @returns { string }
 */
export const summarizeTracking = (plan, rows) => {
  if (plan.mode === 'fragments') {
    return 'カンマを含むため分割しない（断片ごとの件数は下記）'
  }
  if (rows.length === 0) {
    return ''
  }

  const zeroIndex = rows.findIndex((row) => row.hits === 0)
  if (zeroIndex === 0) {
    return `先頭の \`${rows[0].selector}\` が 0 件`
  }
  if (zeroIndex > 0) {
    const last = rows[zeroIndex - 1]
    return `\`${last.selector}\` まで ${last.hits} 件 → \`${rows[zeroIndex].selector}\` で 0 件`
  }
  return '全段階がヒットする（件数の内訳は下記）'
}

/* ------------------------------------------------------------------ *
 * 採取（ブラウザに触る部分）
 * ------------------------------------------------------------------ */

/** 検証用 jQuery が無くて追跡できないときの文言 (SPEC-SC-20) */
export const TRACKING_UNAVAILABLE = '検証用 jQuery が注入されていないためプレフィックス追跡を行えない'

/**
 * ページ側から**生の値**だけを取り出す (SPEC-SC-20)。
 * 素の DOM API だけを使うので、検証用 jQuery が入っていないフレームでも採れる。
 * @param { import('@playwright/test').Frame } frame
 */
const collectRawAsync = (frame) => frame.evaluate(({ ignoredTags, extensionPrefixes }) => {
  const raw = (element) => ({
    tag: element.tagName ? element.tagName.toLowerCase() : '',
    id: element.id || '',
    classes: Array.from(element.classList || [])
  })
  const isExtensionElement = (element) => Array.from(element.classList || [])
    .some((name) => extensionPrefixes.some((prefix) => name.startsWith(prefix)))

  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(raw)
  const containers = Array.from(document.body ? document.body.children : [])
    .filter((element) => !ignoredTags.includes(element.tagName.toLowerCase()))
    .filter((element) => !isExtensionElement(element))
    .map(raw)

  return { title: document.title || '', headings, containers }
}, { ignoredTags: IGNORED_TAGS, extensionPrefixes: EXTENSION_CLASS_PREFIXES })

/**
 * 段階ごとの件数を検証用 jQuery で数える (SPEC-SC-21)。
 * jQuery 独自セレクタ（`:contains()` / `:first`）を含むため素の DOM API では評価できない。
 * @param { import('@playwright/test').Frame } frame
 * @param { string } selector
 * @returns { Promise<{ missing?: boolean, error?: string, count?: number }> }
 */
const countStageAsync = (frame, selector) => frame.evaluate((s) => {
  if (typeof window.__kabuCheckJq !== 'function') {
    return { missing: true }
  }
  try {
    return { count: window.__kabuCheckJq()(s).length }
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) }
  }
}, selector)

/**
 * プレフィックス追跡を実行する (SPEC-SC-21)。
 * **0 件になった段階で打ち切る**（そこから先はすべて 0 件で情報が増えない）。
 * @param { import('@playwright/test').Frame } frame
 * @param { string } selector
 */
const trackPrefixAsync = async (frame, selector) => {
  const plan = planPrefixTracking(selector)
  const rows = []

  for (const stage of plan.stages) {
    const result = await countStageAsync(frame, stage)
    if (result.missing) {
      return { ...plan, rows: [], unavailable: TRACKING_UNAVAILABLE }
    }
    if (result.error !== undefined) {
      return { ...plan, rows, unavailable: `段階の評価に失敗した: ${sanitize(result.error)}` }
    }

    rows.push({ selector: stage, hits: result.count })

    // プレフィックスは 0 件になったらそれ以降も必ず 0 件になる
    if (plan.mode === 'prefix' && result.count === 0) {
      break
    }
  }

  return { ...plan, rows, unavailable: null }
}

/**
 * ⚠️/❌ の対象に手がかりを付ける (SPEC-SC-20, 21, 22, 23)。
 *
 * - 追跡するセレクタは ❌ なら検出用セレクタ、⚠️ ならページ識別セレクタの先頭1つ
 * - 採取が失敗しても**判定は変えない**（手がかりは補助情報。ADR-0004 の 4）
 *
 * @param { import('@playwright/test').Frame } frame
 * @param { object } result 判定済みの結果（`diagnostics` と `notes` を書き足す）
 * @param { { source: string, selector: string } } tracking 追跡するセレクタとその素性
 */
export const attachDiagnosticsAsync = async (frame, result, tracking) => {
  try {
    const rawInfo = await collectRawAsync(frame)
    const tracked = tracking.selector
      ? await trackPrefixAsync(frame, tracking.selector)
      : { mode: 'prefix', stages: [], omitted: false, rows: [], unavailable: '追跡できるセレクタが無い' }

    result.diagnostics = {
      title: formatTitle(rawInfo.title),
      headings: describeElements(rawInfo.headings),
      containers: describeElements(rawInfo.containers),
      tracking: {
        source: tracking.source,
        mode: tracked.mode,
        rows: tracked.rows,
        omitted: tracked.omitted,
        unavailable: tracked.unavailable
      }
    }

    const summary = tracked.unavailable ?? summarizeTracking(tracked, tracked.rows)
    if (summary !== '') {
      result.notes.push(summary)
    }
  } catch (err) {
    // 判定・終了コードには影響させない (ADR-0004 の 4)
    result.notes.push(`手がかりを採れなかった: ${sanitize(err && err.message ? err.message : err)}`)
  }
}

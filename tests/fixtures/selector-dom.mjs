/**
 * 検出用セレクタから最小限の DOM を組み立てる（SPEC-CS-27「セレクタから DOM を組み立てる規則」）。
 *
 * **セレクタ文字列をテストに書かないためのヘルパー。** フィクスチャは
 * `menuSelectors`（SPEC-CS-15）を実行時に読み、その値からこの関数で DOM を作る。
 * ハッシュ付きクラス名がテストコードに現れないので
 * CON-08 の条件1 を満たし、セレクタを差し替えればフィクスチャが自動で追従する（条件2）。
 *
 * **未対応の記法は黙って無視せず例外にする。** 無視すると「セレクタと合っていない
 * フィクスチャ」でテストが緑になり、何も守っていない状態になる。
 */

/** 対応する記法（上から順に試す） */
const TAG = /^[a-zA-Z][a-zA-Z0-9-]*/
const CLASS = /^\.(-?[_a-zA-Z][\w-]*)/
const ID = /^#(-?[_a-zA-Z][\w-]*)/
// `[attr]` / `[attr="v"]` / `[attr!="v"]`（`!=` は jQuery 拡張で CSS には無い）
const ATTR = /^\[([_a-zA-Z][\w:-]*)(?:(!?=)"([^"]*)")?\]/

/** HTML の属性値・テキストに埋め込む文字を無害化する */
export const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * セレクタの1段（複合セレクタ）を解釈する。
 * @param {string} compound 例 `canvas[aria-hidden!="true"]`
 * @returns {{ tag: string, id: string | null, classes: string[], attrs: Record<string, string> }}
 */
export const parseCompound = (compound) => {
  const spec = { tag: 'div', id: null, classes: [], attrs: {} }
  let rest = compound

  const tag = TAG.exec(rest)
  if (tag) {
    spec.tag = tag[0]
    rest = rest.slice(tag[0].length)
  }

  while (rest.length > 0) {
    const cls = CLASS.exec(rest)
    if (cls) {
      spec.classes.push(cls[1])
      rest = rest.slice(cls[0].length)
      continue
    }

    const id = ID.exec(rest)
    if (id) {
      spec.id = id[1]
      rest = rest.slice(id[0].length)
      continue
    }

    const attr = ATTR.exec(rest)
    if (attr) {
      const [matched, name, operator, value] = attr
      // `[attr!="v"]` は「その属性を付けない」と解釈する（jQuery 拡張。SPEC-CS-27）
      if (operator !== '!=') {
        spec.attrs[name] = value ?? ''
      }
      rest = rest.slice(matched.length)
      continue
    }

    throw new Error(
      `セレクタから DOM を組み立てられません: "${compound}" の "${rest}" は未対応の記法です` +
      '（対応するのは tag / .class / #id / [attr] / [attr="v"] / [attr!="v"] だけ。SPEC-CS-27）')
  }

  return spec
}

/**
 * セレクタを空白区切りの子孫チェーンとして読む。
 * @param {string} selector 例 `div.outer canvas[aria-hidden!="true"]`
 */
export const parseSelectorChain = (selector) => {
  const compounds = String(selector).trim().split(/\s+/).filter((part) => part.length > 0)
  if (compounds.length === 0) {
    throw new Error('セレクタが空です')
  }
  return compounds.map(parseCompound)
}

/** 1段を開始タグに直す */
const openTag = (spec, extraAttrs, extraStyle) => {
  const attrs = { ...spec.attrs, ...extraAttrs }
  const parts = [spec.tag]
  if (spec.id != null) parts.push(`id="${escapeHtml(spec.id)}"`)
  if (spec.classes.length > 0) parts.push(`class="${escapeHtml(spec.classes.join(' '))}"`)
  if (extraStyle) parts.push(`style="${escapeHtml(extraStyle)}"`)
  for (const [name, value] of Object.entries(attrs)) {
    parts.push(`${name}="${escapeHtml(value)}"`)
  }
  return `<${parts.join(' ')}>`
}

/**
 * 検出用セレクタから DOM（HTML 文字列）を作る。
 *
 * @param {string} selector 子孫チェーン
 * @param {object} [options]
 * @param {Record<string, string>} [options.rootAttrs] いちばん外側の要素に足す属性
 * @param {string} [options.rootStyle] いちばん外側の要素に足すインラインスタイル（テスト用の採寸）
 * @param {Record<string, string>} [options.leafAttrs] いちばん内側の要素に足す属性
 * @param {string} [options.leafStyle] いちばん内側の要素に足すインラインスタイル
 * @param {string} [options.html] いちばん内側の要素の中身
 * @returns {string} HTML 文字列
 */
export const domFromSelector = (selector, options = {}) => {
  const chain = parseSelectorChain(selector)
  const last = chain.length - 1

  const open = chain.map((spec, depth) => openTag(
    spec,
    { ...(depth === 0 ? options.rootAttrs : null), ...(depth === last ? options.leafAttrs : null) },
    [depth === 0 ? options.rootStyle : null, depth === last ? options.leafStyle : null]
      .filter(Boolean).join(' ') || null))

  const close = chain.map((spec) => `</${spec.tag}>`).reverse()

  return `${open.join('')}${options.html ?? ''}${close.join('')}`
}

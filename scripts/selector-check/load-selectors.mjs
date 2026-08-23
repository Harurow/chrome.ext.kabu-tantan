/**
 * Content Script から検出用セレクタ (`menuSelectors`) を読み出す (SPEC-SC-03)。
 *
 * 拡張機能はビルドを持たず `export` が使えない (CON-02) ため、
 * `node:vm` でソースを評価して `menuSelectors` だけを取り出す。
 * **検証ツール側にセレクタ文字列を書き写さないための仕組み** (NFR-13)。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 何を呼ばれても自分を返す stub。
 * トップレベルの `$(() => …)` を無害化するために使う。
 */
const createChainableStub = () => {
  const target = function () {}
  const proxy = new Proxy(target, {
    get: () => proxy,
    apply: () => proxy,
    construct: () => proxy,
    has: () => true
  })
  return proxy
}

/**
 * サンドボックスを作る。
 * `require` / `process` / `fs` は**渡さない**（Content Script は本来これらを使わない）。
 */
const createSandbox = () => {
  const jq = createChainableStub()
  return {
    $: jq,
    jQuery: jq,
    MutationObserver: class {
      observe () {}
      disconnect () {}
    },
    setTimeout: () => 0,
    document: {},
    chrome: {},
    console
  }
}

/**
 * Content Script から `menuSelectors` を取り出す。
 * @param { string } relativePath リポジトリルートからの相対パス (例: `src/rakuten-cs.js`)
 * @returns { { key?: string, title: string, url?: string, selector: string }[] }
 */
export const loadMenuSelectors = (relativePath) => {
  const filename = path.join(rootDir, relativePath)
  const source = fs.readFileSync(filename, 'utf8')

  let value
  try {
    value = vm.runInNewContext(`${source}\n;menuSelectors`, createSandbox(), { filename, timeout: 1000 })
  } catch (err) {
    throw new Error(`${relativePath} から menuSelectors を取り出せません: ${err.message}`)
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${relativePath} の menuSelectors が配列ではありません`)
  }

  return value
}

/**
 * `key ?? title` を突き合わせキーにした Map を作る (SPEC-SC-02)。
 * @param { { key?: string, title: string }[] } entries
 */
export const indexByKey = (entries) => {
  const map = new Map()
  for (const entry of entries) {
    const key = entry.key ?? entry.title
    if (map.has(key)) {
      throw new Error(`menuSelectors のキーが重複しています: ${key}`)
    }
    map.set(key, entry)
  }
  return map
}

/**
 * サイト定義と `menuSelectors` を突き合わせる。
 * 欠け・余りがあれば例外にする（SPEC-SC-02。実行は中止、`npm test` でも検出する）。
 * @param { { site: string, label: string, source: string, targets: { key: string }[] } } site
 */
export const resolveSite = (site) => {
  const entries = indexByKey(loadMenuSelectors(site.source))
  const wanted = site.targets.map((target) => target.key)

  const missing = wanted.filter((key) => !entries.has(key))
  const extra = [...entries.keys()].filter((key) => !wanted.includes(key))

  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `targets.mjs にあって ${site.source} に無い: ${missing.join(', ')}` : null,
      extra.length > 0 ? `${site.source} にあって targets.mjs に無い: ${extra.join(', ')}` : null
    ].filter(Boolean).join(' / ')
    throw new Error(`${site.label} の定義が食い違っています — ${details}`)
  }

  return site.targets.map((target) => ({ target, entry: entries.get(target.key) }))
}

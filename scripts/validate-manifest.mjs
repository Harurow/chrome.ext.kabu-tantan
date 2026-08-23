/**
 * manifest.json の構造を検証する。
 * ビルドが無い拡張なので、参照先ファイルの実在チェックを CI の代わりの安全網にする。
 */
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

const errors = []
const warnings = []

const fail = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

/** src/ からの相対パス（先頭 / は src ルート扱い）で実在確認する */
const exists = async (ref) => {
  try {
    await access(path.join(srcDir, ref.replace(/^\//, '')))
    return true
  } catch {
    return false
  }
}

const manifest = JSON.parse(await readFile(path.join(srcDir, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

// --- 必須フィールド ---
if (manifest.manifest_version !== 3) {
  fail(`manifest_version は 3 である必要があります (現在: ${manifest.manifest_version})`)
}

for (const key of ['name', 'version', 'description', 'default_locale', 'icons']) {
  if (!manifest[key]) {
    fail(`必須フィールドが欠けています: ${key}`)
  }
}

// --- バージョン ---
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  fail(`version の形式が不正です: ${manifest.version}`)
}
if (manifest.version !== pkg.version) {
  fail(`version 不一致: manifest.json=${manifest.version} / package.json=${pkg.version}`)
}

// --- アイコン ---
for (const [size, ref] of Object.entries(manifest.icons ?? {})) {
  if (!await exists(ref)) {
    fail(`icons[${size}] のファイルが存在しません: ${ref}`)
  }
}

// --- ロケール ---
if (manifest.default_locale) {
  const messagesPath = `_locales/${manifest.default_locale}/messages.json`
  if (!await exists(messagesPath)) {
    fail(`default_locale のメッセージファイルが存在しません: ${messagesPath}`)
  } else {
    const messages = JSON.parse(await readFile(path.join(srcDir, messagesPath), 'utf8'))
    const used = JSON.stringify(manifest).match(/__MSG_(\w+)__/g) ?? []
    for (const token of new Set(used)) {
      const key = token.slice(6, -2)
      if (!messages[key]) {
        fail(`${messagesPath} に未定義のメッセージキー: ${key}`)
      }
    }
  }
}

// --- Service Worker ---
const sw = manifest.background?.service_worker
if (!sw) {
  fail('background.service_worker が定義されていません')
} else if (!await exists(sw)) {
  fail(`service_worker のファイルが存在しません: ${sw}`)
}

// --- options ページ ---
if (manifest.options_page && !await exists(manifest.options_page)) {
  fail(`options_page のファイルが存在しません: ${manifest.options_page}`)
}

// --- content_scripts ---
const contentScripts = manifest.content_scripts ?? []
if (contentScripts.length === 0) {
  warn('content_scripts が空です')
}

for (const [i, cs] of contentScripts.entries()) {
  const label = `content_scripts[${i}]`

  if (!Array.isArray(cs.matches) || cs.matches.length === 0) {
    fail(`${label}.matches が空です`)
  }
  for (const m of cs.matches ?? []) {
    if (!m.startsWith('https://')) {
      fail(`${label}.matches に https 以外が含まれます: ${m}`)
    }
  }

  for (const kind of ['js', 'css']) {
    for (const ref of cs[kind] ?? []) {
      if (!await exists(ref)) {
        fail(`${label}.${kind} のファイルが存在しません: ${ref}`)
      }
    }
  }

  // 読み込み順の前提: jQuery → 共有モジュール → 個別 Content Script
  const js = cs.js ?? []
  const jqIdx = js.findIndex((f) => f.includes('jquery'))
  const urlsIdx = js.indexOf('urls.js')
  if (jqIdx >= 0 && urlsIdx >= 0 && jqIdx > urlsIdx) {
    fail(`${label}.js の読み込み順が不正です: jquery は urls.js より前である必要があります`)
  }
  const menuIdx = js.indexOf('linkMenu.js')
  if (menuIdx >= 0 && urlsIdx >= 0 && urlsIdx > menuIdx) {
    fail(`${label}.js の読み込み順が不正です: urls.js は linkMenu.js より前である必要があります`)
  }
}

// --- 権限 ---
const permissions = manifest.permissions ?? []
const known = ['tabs', 'contextMenus', 'storage']
for (const p of permissions) {
  if (!known.includes(p)) {
    warn(`想定外の permission が追加されています。ストア審査の説明が必要です: ${p}`)
  }
}

// --- 出力 ---
for (const w of warnings) {
  console.warn(`⚠️  ${w}`)
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`❌ ${e}`)
  }
  console.error(`\nmanifest 検証に失敗しました (${errors.length} 件)`)
  process.exit(1)
}

console.log(`✅ manifest 検証 OK (${manifest.name} v${manifest.version} / content_scripts: ${contentScripts.length} 件)`)

/**
 * コミットを作るコマンドを、レビュー承認済みのときだけ通す。
 *
 * commit-gate.sh から呼ばれる。stdin に PreToolUse フックの JSON を受け取り、
 * ブロックする場合だけ deny の JSON を stdout に出す。
 *
 * bash の正規表現だけでは
 *   - `git log --grep="git commit"` の誤検知
 *   - `FOO=bar git commit` / `git revert` の取りこぼし
 * を同時に潰せないため、ここでトークン単位に解析する。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { computeChangeHash } from '../../scripts/lib/change-hash.mjs'

/** コミットを新しく作りうる git サブコマンド */
const COMMIT_SUBCOMMANDS = new Set([
  'commit', 'revert', 'merge', 'cherry-pick', 'rebase', 'am'
])

/** 履歴を作らない形。これらが付いていれば通す */
const SAFE_FLAGS = new Set(['--dry-run', '--abort', '--quit', '--skip'])

/** 次のトークンを値として取るサブコマンドオプション。
 *  値の中身が SAFE_FLAGS と一致しても安全扱いしないために必要
 *  （例: git commit -m "--dry-run"） */
const SUB_OPTS_WITH_VALUE = new Set([
  '-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message',
  '--author', '--date', '-S', '--gpg-sign', '--fixup', '--squash', '-s', '--strategy',
  '-X', '--strategy-option', '--onto', '--exec', '-t', '--template'
])

/** 実際に「履歴を作らない安全な呼び出し」か判定する */
const hasSafeFlag = (args) => {
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t === '--') break                               // 以降は pathspec であってフラグではない
    if (SUB_OPTS_WITH_VALUE.has(t)) { i++; continue }   // 値は判定対象にしない
    if (SAFE_FLAGS.has(t)) return true
  }
  return false
}

/**
 * トークン列の任意の位置から `git <コミットを作るサブコマンド>` を探す。
 *
 * ラッパーコマンド（sudo / nice / stdbuf / script / parallel ...）は種類が多く、
 * どのオプションが値を取るかも個別に違う。列挙して読み飛ばす方式では必ず漏れるため、
 * 「どこかに git が現れ、その直後のサブコマンドがコミットを作るなら止める」で押さえる。
 *
 * 取りこぼすより誤って止める方が安全側。誤検知しても理由が表示されるので気づける。
 */
const findGitCommitAnywhere = (tokens) => {
  for (let g = 0; g < tokens.length; g++) {
    if (basename(tokens[g]) !== 'git') continue

    let i = g + 1
    while (i < tokens.length) {
      const t = tokens[i]
      if (GIT_OPTS_WITH_VALUE.has(t)) { i += 2; continue }
      if (t.startsWith('-')) { i++; continue }
      break
    }
    const sub = tokens[i]
    if (sub && COMMIT_SUBCOMMANDS.has(sub) && !hasSafeFlag(tokens.slice(i + 1))) {
      return `git ${sub}`
    }
  }
  return null
}

/** git のグローバルオプションのうち、次のトークンを値として取るもの */
const GIT_OPTS_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** 内部で git commit を作る他のコマンド */
const OTHER_COMMIT_COMMANDS = [
  { cmd: 'npm', args: ['version'] },
  { cmd: 'yarn', args: ['version'] },
  { cmd: 'pnpm', args: ['version'] }
]

/** 引数として別のコマンド文字列を取るシェル */
const SHELL_COMMANDS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }))
  process.exit(0)
}

/**
 * コマンド文字列を、区切り文字ごとのトークン列に割る。
 * 引用符の中身は1トークンとして保持する（勝手に分解しない）。
 * @returns {string[][]} セグメントごとのトークン配列
 */
const tokenize = (command) => {
  const segments = []
  let tokens = []
  let token = ''
  let hasToken = false
  let quote = null

  const endToken = () => {
    if (hasToken) { tokens.push(token); token = ''; hasToken = false }
  }
  const endSegment = () => {
    endToken()
    if (tokens.length) { segments.push(tokens); tokens = [] }
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote) {
      if (ch === quote) quote = null
      else { token += ch; hasToken = true }
      continue
    }

    if (ch === '"' || ch === "'") { quote = ch; hasToken = true; continue }
    if (ch === '\\' && i + 1 < command.length) { token += command[++i]; hasToken = true; continue }

    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n' || ch === '(' || ch === ')' || ch === '`') {
      endSegment(); continue
    }
    if (ch === ' ' || ch === '\t') { endToken(); continue }

    token += ch
    hasToken = true
  }
  endSegment()

  return segments
}

/**
 * セグメント先頭の環境変数代入（FOO=bar）と、後ろのコマンドをそのまま実行する
 * 補助コマンド（sudo / env / timeout / xargs など）を取り除く。
 */
const stripPrefixes = (tokens) => {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]

    // FOO=bar
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue }

    const name = t.slice(t.lastIndexOf('/') + 1)

    if (['sudo', 'command', 'nohup', 'stdbuf', 'setsid', 'doas'].includes(name)) { i++; continue }

    // env: 後続のオプションと VAR=val を読み飛ばす
    if (name === 'env') {
      i++
      while (i < tokens.length) {
        const a = tokens[i]
        if (a === '-u' || a === '--unset') { i += 2; continue }
        if (a.startsWith('-')) { i++; continue }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) { i++; continue }
        break
      }
      continue
    }

    // timeout / time: 数値やオプションを読み飛ばす
    if (name === 'timeout' || name === 'time') {
      i++
      while (i < tokens.length) {
        const a = tokens[i]
        if (a.startsWith('-')) { i++; continue }
        if (name === 'timeout' && /^[0-9]+(\.[0-9]+)?[smhd]?$/.test(a)) { i++; continue }
        break
      }
      continue
    }

    // xargs: オプションを読み飛ばした先が実行されるコマンド
    if (name === 'xargs') {
      i++
      while (i < tokens.length) {
        const a = tokens[i]
        if (['-I', '-i', '-n', '-P', '-d', '-E', '-s', '-L'].includes(a)) { i += 2; continue }
        if (a.startsWith('-')) { i++; continue }
        break
      }
      continue
    }

    break
  }
  return tokens.slice(i)
}

const basename = (t) => t.slice(t.lastIndexOf('/') + 1)

/**
 * トークン列がコミットを作るコマンドか判定する。
 * @returns {string | null} 検出したコマンド名。作らなければ null
 */
const createsCommit = (rawTokens, depth = 0) => {
  if (depth > 3) return null
  const tokens = stripPrefixes(rawTokens)
  if (tokens.length === 0) return null

  const cmd = basename(tokens[0])

  // シェル経由（bash -c '...' / bash -lc '...'）は中身を解析し直す
  if (SHELL_COMMANDS.has(cmd)) {
    // -c だけでなく -lc / -xc のような連結短オプションも拾う
    const ci = tokens.findIndex((t) => /^-[a-zA-Z]*c$/.test(t))
    if (ci >= 0 && tokens[ci + 1]) {
      for (const seg of tokenize(tokens[ci + 1])) {
        const hit = createsCommit(seg, depth + 1)
        if (hit) return hit
      }
    }
    return null
  }

  // find ... -exec <コマンド> ... \;
  if (cmd === 'find') {
    const ei = tokens.findIndex((t) => t === '-exec' || t === '-execdir' || t === '-ok')
    if (ei >= 0) {
      const rest = tokens.slice(ei + 1)
      const end = rest.findIndex((t) => t === ';' || t === '+')
      const hit = createsCommit(end >= 0 ? rest.slice(0, end) : rest, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (cmd === 'eval') {
    for (const seg of tokenize(tokens.slice(1).join(' '))) {
      const hit = createsCommit(seg, depth + 1)
      if (hit) return hit
    }
    return null
  }

  if (cmd === 'git') {
    // グローバルオプションを読み飛ばして最初のサブコマンドを探す
    let i = 1
    while (i < tokens.length) {
      const t = tokens[i]
      if (GIT_OPTS_WITH_VALUE.has(t)) { i += 2; continue }
      if (t.startsWith('-')) { i++; continue }
      break
    }
    const sub = tokens[i]
    if (!sub || !COMMIT_SUBCOMMANDS.has(sub)) return null
    if (hasSafeFlag(tokens.slice(i + 1))) return null
    return `git ${sub}`
  }

  for (const { cmd: c, args } of OTHER_COMMIT_COMMANDS) {
    if (cmd === c && args.every((a, n) => tokens[1 + n] === a)) {
      // `npm version`（引数なし）は表示するだけでコミットしない
      const rest = tokens.slice(1 + args.length).filter((t) => !t.startsWith('-'))
      if (rest.length === 0) return null
      return `${c} ${args.join(' ')} ${rest[0]}`
    }
  }

  // ラッパーコマンド経由（sudo / nice / stdbuf / script / parallel など）の取りこぼし対策
  return findGitCommitAnywhere(tokens)
}

// ---- 本体 ----

let payload
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch (e) {
  deny(`コミットゲートがフック入力を解析できませんでした（安全側に倒してブロックします）: ${e.message}`)
}

const command = payload?.tool_input?.command ?? ''
if (!command) process.exit(0)

const hits = tokenize(command).map((seg) => createsCommit(seg)).filter(Boolean)
if (hits.length === 0) process.exit(0)

const what = [...new Set(hits)].join(', ')
const projectDir = process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

let approval
try {
  approval = JSON.parse(readFileSync(path.join(projectDir, '.claude', 'review-approved.json'), 'utf8'))
} catch {
  deny(`コミットがブロックされました（検出: ${what}）: レビュー未承認です。

このプロジェクトでは、以下がすべて揃うまでコミットできません。
  1. npm run check が通る（lint + validate + テスト全件）
  2. reviewer のレビューで 🔴 Critical が無い
  3. npm run approve で承認を記録する

reviewer のレビューを通してから 'npm run approve' を実行してください。
（npm run approve は、同じ作業ツリーで npm run check が通った記録が無ければ、npm run check も実行します）`)
}

let current
try {
  current = (await computeChangeHash(projectDir)).hash
} catch (e) {
  deny(`コミットゲートが変更内容のハッシュを計算できませんでした（安全側に倒してブロックします）: ${e.message}`)
}

if (current !== approval.hash) {
  deny(`コミットがブロックされました（検出: ${what}）: 承認後にファイルが変更されています。

  承認時刻: ${approval.approvedAt ?? '不明'}
  承認時のhash: ${String(approval.hash).slice(0, 16)}…
  現在のhash:   ${current.slice(0, 16)}…

承認は変更内容に紐づいています。変更したなら reviewer のレビューをやり直し、
再度 'npm run approve' を実行してください。`)
}

process.exit(0)

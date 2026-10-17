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
import { computeChangeHash, committedTreeAsync, remainingStepsAsync } from '../../scripts/lib/change-hash.mjs'

/** コミットを新しく作りうる git サブコマンド（pull はマージやリベースのコミットを作りうる） */
const COMMIT_SUBCOMMANDS = new Set([
  'commit', 'revert', 'merge', 'cherry-pick', 'rebase', 'am', 'pull'
])

/** 履歴を作らない形。これらが付いていれば通す
 *  （--skip は入れない。rebase / cherry-pick / am の --skip は、残りの手順を続けてコミットを作る） */
const SAFE_FLAGS = new Set(['--dry-run', '--abort', '--quit'])

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
 * git pull に置いてよいオプション（どれも値を取らない）。ほかのオプションがあれば止める
 * （値を取るオプションの値に --ff-only を置く形 git pull -o --ff-only や、--rebase / -r を通さないため）
 */
const PULL_SAFE_OPTIONS = new Set(['--ff-only', '--ff', '--no-ff', '--dry-run', '--no-rebase', '-q', '--quiet', '-v', '--verbose', '--no-edit', '--prune', '--tags'])

/**
 * git pull がコミットを作らないか。--dry-run か、早送りだけ（--ff-only。--ff / --no-ff とは後に書いた方が勝ち、
 * --ff-only --no-ff はマージコミットを作る）。--ff-only は設定の pull.rebase より優先される（git 2.54 で確かめた）
 */
const isSafePull = (args) =>
  args.every((t) => !t.startsWith('-') || PULL_SAFE_OPTIONS.has(t)) &&
  (args.includes('--dry-run') || lastWins(args, ['--ff-only'], ['--ff', '--no-ff']))

/** 履歴を作らない呼び出しか（git pull は isSafePull、ほかは安全なフラグ） */
const isSafeInvocation = (sub, args) => sub === 'pull' ? isSafePull(args) : hasSafeFlag(args)

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
    if (sub && COMMIT_SUBCOMMANDS.has(sub) && !isSafeInvocation(sub, tokens.slice(i + 1))) {
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
 * 各セグメントの配列には、トークンが引用符で始まったかを quoted に添える（"<b>" をリダイレクトと取り違えないため）。
 * @returns {string[][]} セグメントごとのトークン配列
 */
const tokenize = (command) => {
  const segments = []
  let tokens = []
  let quoted = []
  let token = ''
  let hasToken = false
  let startsQuoted = false
  let quote = null

  const endToken = () => {
    if (hasToken) { tokens.push(token); quoted.push(startsQuoted); token = ''; hasToken = false; startsQuoted = false }
  }
  const endSegment = () => {
    endToken()
    if (tokens.length) { tokens.quoted = quoted; segments.push(tokens); tokens = []; quoted = [] }
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote) {
      if (ch === quote) quote = null
      else { token += ch; hasToken = true }
      continue
    }

    if (ch === '"' || ch === "'") { startsQuoted ||= !hasToken; quote = ch; hasToken = true; continue }
    if (ch === '\\' && i + 1 < command.length) { token += command[++i]; hasToken = true; continue }

    // 2>&1 / >&2 / &>file の & は区切りではなくリダイレクトの一部
    if (ch === '&' && (/[<>]$/.test(token) || command[i + 1] === '>')) { token += ch; hasToken = true; continue }

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
    if (isSafeInvocation(sub, tokens.slice(i + 1))) return null
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

/** コミットより前に置いてよい git のサブコマンド（作業ツリーを変えない） */
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse'])

/** コミットより前に置いてよいコマンド（作業ツリーを変えない） */
// set は入れない（set -a のあとの代入は、続く git commit の環境に入る）
const READ_ONLY_COMMANDS = new Set(['cd', 'echo', 'printf', 'pwd', 'true', 'cat', 'head', 'tail', 'grep', 'wc', 'ls', 'date'])

/** --continue で続きを1回のコミットとして確かめられるサブコマンド（git commit と同じく index の中身をコミットする） */
const CONTINUABLE = new Set(['merge', 'cherry-pick', 'revert', 'rebase', 'am'])

/**
 * git commit の値を取るオプション。値をパスと取り違えないために使う（例: git commit -am "msg"）
 * 短いものは文字（-m msg と -mmsg の両方の書き方がある）。--name=value は1つのトークン
 */
const COMMIT_VALUE_SHORT = 'mFCct'
const COMMIT_VALUE_LONG = ['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--fixup', '--squash', '--template', '--trailer', '--cleanup', '--pathspec-from-file']

/**
 * ヒアドキュメントの始まり（<< の後ろ）。区切りは 'EOF' / "EOF" / \EOF / EOF（空白や ;&|<>() の手前まで）
 * 区切りの直後が行末・空白・演算子でないもの（<<E"O"F のように一部だけ引用したもの。bash の区切りは EOF）は読まない
 */
const HEREDOC = /^(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|<>()'"]+))(?=$|[\s;&|<>()])/

/**
 * ヒアドキュメントの中身（<<'EOF' … EOF）を取り除く。中身はコマンドではないので、判定に使わない
 * （取り除かないと、コミットメッセージに書いた「git commit」をコマンドと取り違える）
 *
 * 取り除き過ぎると、承認の無い git commit を隠して通してしまう（fail-open）。そのため
 *   - 引用符の外の << だけを読む（echo "<<EOF" はヒアドキュメントではない）。引用符は行をまたいで追う
 *   - 終わりの行が見つかったときだけ取り除く。見つからなければ残す（$((a<<b)) のシフトや、閉じていないもの）
 */
const stripHeredocs = (command) => {
  const lines = command.split('\n')
  const out = []
  let quote = null
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    out.push(line)
    const pending = []
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quote) {
        if (ch === '\\' && quote === '"') i++
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '\\') { i++; continue }
      if (ch === "'" || ch === '"') { quote = ch; continue }
      if (ch === '<' && line[i + 1] === '<' && line[i - 1] !== '<' && line[i + 2] !== '<') {
        const m = HEREDOC.exec(line.slice(i + 2))
        if (m) {
          pending.push({ dash: m[1] === '-', delim: m[2] ?? m[3] ?? m[4] })
          i += 1 + m[0].length
        }
      }
    }
    for (const { dash, delim } of pending) {
      let end = k + 1
      while (end < lines.length && (dash ? lines[end].replace(/^\t+/, '') : lines[end]) !== delim) end++
      if (end >= lines.length) break
      k = end
    }
  }
  return out.join('\n')
}

/** git のグローバルオプションを読み飛ばし、サブコマンドの位置を返す（tokens[0] が git） */
const subcommandIndex = (tokens) => {
  let i = 1
  while (i < tokens.length) {
    const t = tokens[i]
    if (GIT_OPTS_WITH_VALUE.has(t)) { i += 2; continue }
    if (t.startsWith('-')) { i++; continue }
    break
  }
  return i
}

/** git の場所を変える指定があるか（判定したリポジトリと、コミットするリポジトリ・index がずれる） */
const relocatesGit = (rawTokens, tokens, sub) =>
  rawTokens.some((t) => /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)=/.test(t)) ||
  tokens.slice(1, sub).some((t, n, global) => t === '-C' || /^--(git-dir|work-tree)(=|$)/.test(t) || (t === '-c' && /^core\.worktree=/i.test(global[n + 1] ?? '')))

/** リダイレクトの形（2>&1、>file、<<'EOF' など）。演算子の後ろが空なら、次のトークンが対象 */
const REDIRECT = /^(\d*|&)(>>|>\||>&|>|<<<|<<-?|<>|<&|<)(.*)$/

/** stripPrefixes で前を削ったトークン列に対応する、引用符で始まったかの印 */
const quotedOf = (rawTokens, tokens) => (rawTokens.quoted ?? []).slice(rawTokens.length - tokens.length)

/**
 * リダイレクトを取り除き、/dev/null 以外のファイルに書き出すものがあるかを返す
 * 取り除かないと、git commit -m x >/dev/null の /dev/null や <<'EOF' をパスと取り違える。引用符で始まったトークンは見ない
 * @returns {{ args: string[], writes: boolean }}
 */
const stripRedirects = (tokens, quoted = []) => {
  const args = []
  let writes = false
  for (let i = 0; i < tokens.length; i++) {
    const m = quoted[i] ? null : tokens[i].match(REDIRECT)
    if (!m) {
      // a>b のように語の後ろに付いた書き出しも、書き出しとみなす
      writes ||= !quoted[i] && tokens[i].includes('>')
      args.push(tokens[i])
      continue
    }
    const target = m[3] !== '' ? m[3] : tokens[++i] ?? ''
    const duplicate = (m[2] === '>&' || m[2] === '<&') && /^(\d+-?|-)$/.test(target)
    writes ||= m[2].includes('>') && !duplicate && target !== '/dev/null'
  }
  return { args, writes }
}

/**
 * git commit の引数を、フラグ（書かれた順）とオプションでない引数（パス）に分ける
 * 短いオプションの束（-am）はばらす。--name=value は --name にする
 */
const parseCommitArgs = (args) => {
  const flags = []
  const operands = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    if (t.startsWith('--')) {
      const name = t.split('=')[0]
      flags.push(name)
      if (!t.includes('=') && COMMIT_VALUE_LONG.includes(name)) i++
    } else if (t.startsWith('-') && t.length > 1) {
      for (let k = 1; k < t.length; k++) {
        flags.push(`-${t[k]}`)
        if (COMMIT_VALUE_SHORT.includes(t[k])) {
          // 値を取る短いオプション。残りの文字が値で、無ければ次のトークンが値
          if (k === t.length - 1) i++
          break
        }
      }
    } else {
      operands.push(t)
    }
  }
  return { flags, operands }
}

/** フラグが有効か。後に書いた方が勝つ（-a --no-all なら無効）。長いオプションは一意な省略も同じものとみなす */
const lastWins = (flags, on, off) => {
  const known = [...on, ...off]
  let state = false
  for (const f of flags) {
    const hits = f.startsWith('--') ? known.filter((k) => k.startsWith('--') && k.startsWith(f) && f.length >= 4) : known.filter((k) => k === f)
    const name = hits.includes(f) ? f : (hits.length === 1 ? hits[0] : null)
    if (name && on.includes(name)) state = true
    else if (name && off.includes(name)) state = false
  }
  return state
}

/**
 * セグメントが（シェルやラッパーを介さない）git commit か、merge などの --continue なら、その読み取りを返す
 * @returns {{ relocates: boolean, all: boolean, partial: boolean, continues: string | null } | null}
 *   all: -a（追跡しているファイルの変更を足す） / partial: パスの指定や -o / -i / -p など、一部だけのコミット /
 *   continues: --continue したサブコマンド（git commit なら null）
 */
const plainGitCommit = (rawTokens) => {
  const tokens = stripPrefixes(rawTokens)
  if (basename(tokens[0] ?? '') !== 'git') return null
  // xargs は引数（パス）を足すので、何がコミットされるか読めない。ラッパーを介したコミットとして扱う
  if (rawTokens.slice(0, rawTokens.length - tokens.length).some((t) => basename(t) === 'xargs')) return null
  const sub = subcommandIndex(tokens)
  const { args } = stripRedirects(tokens.slice(sub + 1), quotedOf(rawTokens, tokens).slice(sub + 1))
  // --continue は、git commit と同じく index の中身をコミットする。ほかの引数を添えたものは読まない
  if (CONTINUABLE.has(tokens[sub]) && args.length === 1 && args[0] === '--continue') {
    return { relocates: relocatesGit(rawTokens, tokens, sub), all: false, partial: false, continues: tokens[sub] }
  }
  if (tokens[sub] !== 'commit' || hasSafeFlag(tokens.slice(sub + 1))) return null
  const { flags, operands } = parseCommitArgs(args)
  const has = (...names) => names.some((n) => flags.some((f) => f === n || (f.startsWith('--') && f.length >= 4 && n.startsWith(f))))
  return {
    relocates: relocatesGit(rawTokens, tokens, sub),
    all: lastWins(flags, ['-a', '--all'], ['--no-all']),
    partial: operands.length > 0 || has('-o', '--only', '-i', '--include', '-p', '--patch', '--interactive', '--pathspec-from-file'),
    continues: null
  }
}

/** git add -A（すべての変更を index に入れる）か。場所を変える指定や書き出しがあるものは含めない */
const isGitAddAll = (rawTokens) => {
  const tokens = stripPrefixes(rawTokens)
  if (basename(tokens[0] ?? '') !== 'git') return false
  const sub = subcommandIndex(tokens)
  if (tokens[sub] !== 'add' || relocatesGit(rawTokens, tokens, sub)) return false
  const { args, writes } = stripRedirects(tokens.slice(sub + 1), quotedOf(rawTokens, tokens).slice(sub + 1))
  if (writes) return false
  return args.some((t) => t === '-A' || t === '--all') && args.every((t) => ['-A', '--all', '-v', '--verbose'].includes(t))
}

/** 作業ツリーを変えないコマンド（コミットより前に置いてよいもの）か */
const isReadOnly = (rawTokens) => {
  const tokens = stripPrefixes(rawTokens)
  // GIT_INDEX_FILE= などの代入は、続く git commit の index や場所を変えうる（set -a のあとや、もとから export されている変数）
  if (rawTokens.slice(0, rawTokens.length - tokens.length).some((t) => /^GIT_[A-Za-z0-9_]*=/.test(t))) return false
  if (tokens.length === 0) return true
  if (stripRedirects(tokens, quotedOf(rawTokens, tokens)).writes) return false
  const cmd = basename(tokens[0])
  if (cmd === 'git') {
    const sub = subcommandIndex(tokens)
    return READ_ONLY_GIT.has(tokens[sub]) && !tokens.slice(sub + 1).some((t) => t.startsWith('--output') || t.startsWith('--ext-diff'))
  }
  return READ_ONLY_COMMANDS.has(cmd)
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

const segments = tokenize(stripHeredocs(command))
const hits = segments.map((seg) => createsCommit(seg)).filter(Boolean)
if (hits.length === 0) process.exit(0)

const what = [...new Set(hits)].join(', ')
const projectDir = process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

// まず形を見る（承認があっても通さない形は、承認より先に理由を出す）。docs/notes/workflow.md「コミットされる中身を確かめる」
// 中身を確かめられるのは、git commit と、merge などの --continue（どちらも index の中身をコミットする）だけ。
// ほかのコミットを作るコマンドは、作る中身を前もって比べられないので、承認があっても止める
const found = segments.map((seg, at) => ({ at, hit: createsCommit(seg), commit: plainGitCommit(seg) })).filter((c) => c.hit)
const unchecked = found.find((c) => !c.commit)
if (unchecked?.hit === 'git commit') {
  deny(`コミットがブロックされました（検出: ${what}）: シェルやラッパーを介した git commit は、コミットされる中身を判定できません。
git commit を直接実行してください。`)
}
if (unchecked?.hit === 'git pull') {
  deny(`コミットがブロックされました（検出: ${what}）: git pull はマージやリベースのコミットを作りうるので、承認があっても止めます。
取り込むだけなら git pull --ff-only で実行してください（早送りできなければ止まり、コミットを作りません）。`)
}
if (unchecked) {
  deny(`コミットがブロックされました（検出: ${what}）: git commit 以外でコミットを作るコマンド（merge・cherry-pick・revert・rebase・am と、その --skip、npm version など）は、
作る中身を前もって承認した中身と比べられないので、承認があっても止めます。
途中で止まった merge などを続けるなら、git add -A && GIT_EDITOR=true git merge --continue のように --continue だけを付けて実行してください（git commit と同じく確かめます。
GIT_EDITOR=true は、merge・rebase の --continue がメッセージのエディタを開いて、端末の無い Bash で止まらないようにするため。--no-edit は --continue と一緒に書けません）。
それ以外が要るときは、利用者に相談してください。`)
}
if (found.length > 1) {
  deny(`コミットがブロックされました（検出: ${what}）: 1回の Bash の呼び出しで git commit を2回以上行わないでください。
ゲートは実行の前に判定するため、2回目は1回目のあとの中身で判定できません。別々に実行してください。`)
}

const [{ at, commit }] = found
if (commit.relocates) {
  deny(`コミットがブロックされました（検出: ${what}）: git -C / --git-dir / --work-tree や GIT_DIR などで git の場所を変えたコミットは判定できません。`)
}
if (commit.partial) {
  deny(`コミットがブロックされました（検出: ${what}）: パスを指定したコミットや、一部だけのコミット（-o / -i / -p など）は通しません。
変更はすべてコミットします（一部だけだと、テストしていない組み合わせが履歴に入りうる）。git add -A && git commit で実行してください。`)
}

const before = segments.slice(0, at)
const changer = before.find((seg) => !isReadOnly(seg) && !isGitAddAll(seg))
if (changer) {
  deny(`コミットがブロックされました（検出: ${what}）: git commit の前に、作業ツリーや環境を変えうるコマンド（${changer.join(' ').slice(0, 80)}）があります。
ゲートは実行の前に判定するため、判定した中身とコミットされる中身がずれます。前に置けるのは git add -A と、読むだけのコマンド（git status / diff / log、cd、grep など）だけです
（set や、GIT_ で始まる変数への代入も置けません）。別々に実行してください。`)
}

let approval
try {
  approval = JSON.parse(readFileSync(path.join(projectDir, '.claude', 'review-approved.json'), 'utf8'))
} catch {
  deny(`コミットがブロックされました（検出: ${what}）: レビュー未承認です。

このプロジェクトでは、以下がすべて揃うまでコミットできません。
  1. npm run check が通る（lint + validate + テスト全件。文書だけの変更は npm run check:docs）
  2. reviewer のレビューで 🔴 Critical が無い
  3. npm run approve で承認を記録する

reviewer のレビューを通してから 'npm run approve' を実行してください。
（npm run approve は、同じ作業ツリーで npm run check が通った記録が無ければ、npm run check も実行します）`)
}

let current
let head
try {
  ({ hash: current, head } = await computeChangeHash(projectDir))
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

// 承認は HEAD にも結びつける。ハッシュは作業ツリーの中身（tree）なので、コミットしても変わらない。
// HEAD を比べないと承認がコミットで使い切られず、そのあとの2回目のコミットが承認なしで通る
if (head !== approval.head) {
  deny(`コミットがブロックされました（検出: ${what}）: 承認したあとに HEAD が動いています（承認した中身をコミットした・ブランチを切り替えた、など）。
承認は1回のコミットで使い切られます。続けてコミットするなら、reviewer のレビューを通してから、再度 'npm run approve' を実行してください。`)
}

// --continue のあとに手順が残っていると、同じ呼び出しの中で、確かめていないコミットが続けて作られる
if (commit.continues) {
  let left
  try {
    left = await remainingStepsAsync(projectDir, commit.continues)
  } catch (e) {
    deny(`コミットゲートが ${commit.continues} の途中の状態を読めませんでした（安全側に倒してブロックします）: ${e.message}`)
  }
  if (left > 0) {
    deny(`コミットがブロックされました（検出: ${what}）: ${commit.continues} の手順が、今のものの後に ${left} 個残っています。
--continue すると、残りの手順のコミットも同じ呼び出しの中で作られ、承認した中身と比べられません。利用者に相談してください。`)
  }
}

// コミットされる中身（index）まで承認した中身と比べる。作業ツリーだけを比べると、一部だけステージした・
// ステージしてから作業ツリーを戻した、といったコミットで、テストしていない中身が履歴に入る。
// 確かめ方は chrome.ext.silent-tab・chrome.ext.love-g-rss-reader のコミットゲートと同じ
let committed
try {
  committed = await committedTreeAsync(projectDir, { addAll: before.some(isGitAddAll), addTracked: commit.all })
} catch (e) {
  deny(`コミットゲートがコミットされる中身を求められませんでした（安全側に倒してブロックします）: ${e.message}`)
}
if (committed !== current) {
  deny(`コミットがブロックされました（検出: ${what}）: コミットされる中身（ステージ済みの中身）が、テストして承認した作業ツリーの中身と違います。
一部だけ git add した・git add していない・ステージしてから作業ツリーを戻した、などが考えられます。
変更はすべてコミットします。git add -A && git commit で実行してください。`)
}

process.exit(0)

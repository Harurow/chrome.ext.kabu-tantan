/**
 * コミットゲートのフック（.claude/hooks/commit-gate.mjs）が、コミットされる中身まで承認した中身と比べること
 * （docs/WORKFLOW.md「コミットされる中身を確かめる」）。
 *
 * ブラウザを起動しない。一時の git リポジトリで承認を記録し（全件のチェックは差し替えた関数で演じる）、
 * フックに Bash の呼び出しを渡して、通すか止めるかを見る。
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { computeChangeHash } from '../scripts/lib/change-hash.mjs'
import { runRecordedCheckAsync, approveAsync } from '../scripts/lib/check-record.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(repoRoot, '.claude', 'hooks', 'commit-gate.mjs')

let root

const gitAsync = (...args) => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root })
const write = (file, content) => writeFile(path.join(root, file), content)

/** 全件のチェックが通ったことにして承認を記録する */
const approve = async () => {
  const result = await approveAsync({
    root,
    runCheckAsync: async () => (await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })).code,
    runDocsCheckAsync: async () => 0
  })
  expect(result.ok).toBe(true)
}

/** フックに Bash の呼び出しを渡し、止めたかどうかと理由を返す */
const gate = (command) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.on('error', reject)
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`フックが異常終了した (${code})`))
    const decision = out ? JSON.parse(out).hookSpecificOutput : null
    resolve({ denied: decision?.permissionDecision === 'deny', reason: decision?.permissionDecisionReason ?? '' })
  })
  child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }))
})

test.beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ktt-commit-gate-'))
  await gitAsync('init', '-q')
  await gitAsync('config', 'user.email', 'test@example.invalid')
  await gitAsync('config', 'user.name', 'test')
  // 本物と同じ .gitignore（記録と承認のファイルは無視される）
  await write('.gitignore', await readFile(path.join(repoRoot, '.gitignore')))
  await write('a.txt', 'base\n')
  await gitAsync('add', '.gitignore', 'a.txt')
  await gitAsync('commit', '-q', '-m', 'init')
  await write('a.txt', 'changed\n')
})

test.afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test.describe('コミットゲート: コミットされる中身を確かめる', () => {
  test('承認した作業ツリーを git add -A && git commit で入れるなら通す', async () => {
    await write('b.txt', 'new\n')
    await approve()

    expect((await gate('git add -A && git commit -m x')).denied).toBe(false)
  })

  test('承認のあとで git add -A を別に実行していれば、git commit だけでも通す', async () => {
    await approve()
    await gitAsync('add', '-A')

    expect((await gate('git commit -m x')).denied).toBe(false)
  })

  test('承認がなければ止める', async () => {
    const result = await gate('git add -A && git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('レビュー未承認')
  })

  test('承認のあとで作業ツリーを変えたら止める', async () => {
    await approve()
    await write('a.txt', 'changed after approval\n')

    const result = await gate('git add -A && git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('承認後にファイルが変更されています')
  })

  test('git add していない git commit は止める', async () => {
    await approve()

    const result = await gate('git commit -m x')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('コミットされる中身')
  })

  test('ステージしてから作業ツリーだけ戻した中身は、git commit では止め、git add -A && git commit なら通す', async () => {
    // index にはテストしていない中身、作業ツリーにはテストする中身がある
    await write('a.txt', 'staged but not tested\n')
    await gitAsync('add', 'a.txt')
    await write('a.txt', 'changed\n')
    await approve()

    expect((await gate('git commit -m x')).denied).toBe(true)
    expect((await gate('git add -A && git commit -m x')).denied).toBe(false)
  })

  test('一部だけステージした状態の git commit は止める', async () => {
    await write('b.txt', 'new\n')
    await gitAsync('add', 'a.txt')
    await approve()

    expect((await gate('git commit -m x')).denied).toBe(true)
  })

  test('承認の hash は、ステージの状態によらず作業ツリーの中身で決まる', async () => {
    await write('b.txt', 'new\n')
    const unstaged = await computeChangeHash(root)
    await gitAsync('add', '-A')
    const staged = await computeChangeHash(root)

    expect(staged.hash).toBe(unstaged.hash)
  })

  test('パスを指定したコミットと、一部だけのコミット（-o / -i / -p）は止める', async () => {
    await approve()

    for (const command of [
      'git add -A && git commit -m x a.txt',
      'git add -A && git commit -m x -- a.txt',
      'git add -A && git commit -o a.txt -m x',
      'git add -A && git commit -i -m x',
      'git add -A && git commit -p -m x',
      'git add -A && git commit --pat -m x',
      'git add -A && git commit --pathspec-from-file=list.txt -m x'
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('一部だけのコミット')
    }
  })

  test('git commit -am "msg" の msg をパスと取り違えず、追跡しているファイルだけの変更なら通す', async () => {
    await approve()

    expect((await gate('git commit -am "a.txt"')).denied).toBe(false)
    expect((await gate('git commit -a -m a.txt')).denied).toBe(false)
  })

  test('git commit -a は未追跡のファイルを入れないので、未追跡のファイルがあれば止める', async () => {
    await write('b.txt', 'new\n')
    await approve()

    expect((await gate('git commit -am x')).denied).toBe(true)
  })

  test('git commit の前に作業ツリーを変えうるコマンドがあれば止め、読むだけのコマンドなら通す', async () => {
    await approve()

    const changer = await gate('echo x > b.txt && git add -A && git commit -m x')
    expect(changer.denied).toBe(true)
    expect(changer.reason).toContain('作業ツリーを変えうるコマンド')

    expect((await gate('git status && git add -A && git commit -m x >/dev/null')).denied).toBe(false)
  })

  test('引用符の中の < や > はリダイレクトとみなさない（-m の値の後ろのパスを見逃さない・echo の引数は書き出しではない）', async () => {
    await approve()

    expect((await gate('git add -A && git commit -m "<b>" a.txt')).denied).toBe(true)
    expect((await gate('echo "a>b" && git add -A && git commit -m x')).denied).toBe(false)
  })

  test('2>&1 の & を区切りと取り違えない', async () => {
    await approve()

    expect((await gate('git status 2>&1 && git add -A && git commit -m x 2>&1')).denied).toBe(false)
  })

  test('シェルを介した git commit と、git の場所を変えた git commit は止める', async () => {
    await approve()

    for (const command of [
      "bash -c 'git add -A && git commit -m x'",
      'git add -A && git -C . commit -m x',
      'git add -A && GIT_INDEX_FILE=/tmp/other-index git commit -m x',
      'git add -A && git -c core.worktree=/tmp commit -a -m x'
    ]) {
      expect((await gate(command)).denied, command).toBe(true)
    }
  })

  test('承認した中身をコミットした後は、revert / merge / cherry-pick / 2回目の commit を止める（承認は1回のコミットで使い切る）', async () => {
    await approve()
    await gitAsync('add', '-A')
    await gitAsync('commit', '-q', '-m', 'approved')

    for (const command of [
      'git revert --no-edit HEAD',
      'git merge other',
      'git cherry-pick other',
      'git commit --allow-empty -m y'
    ]) {
      expect((await gate(command)).denied, command).toBe(true)
    }
  })

  test('ヒアドキュメントに見えるものが、承認の無い git commit を隠さない', async () => {
    for (const command of [
      'echo "a <<b"\ngit commit -m x',
      'echo "<<EOF"\ngit commit -m x\nEOF',
      'cat <<END-X >/dev/null\nhi\nEND-X\ngit commit -m x',
      // 区切りを END までしか読まないと、後ろの END の行まで取り除いて本物の git commit を隠す
      'cat <<END-X >/dev/null\nhi\nEND-X\ngit commit -m x\nEND',
      // 一部だけ引用した区切り（bash の区切りは EOF）を E と読むと、後ろの E の行まで取り除く
      'cat <<E"O"F >/dev/null\nx\nEOF\ngit commit -m x\nE',
      "cat <<'E'OF >/dev/null\nx\nEOF\ngit commit -m x\nE",
      'echo $((a<<b))\ngit commit -m x'
    ]) {
      const result = await gate(command)
      expect(result.denied, command).toBe(true)
      expect(result.reason, command).toContain('レビュー未承認')
    }
  })

  test('xargs を介した git commit は止める（xargs が足すパスが見えない）', async () => {
    await write('b.txt', 'new\n')
    await approve()
    await gitAsync('add', '-A')

    expect((await gate('echo a.txt | xargs git commit -m x')).denied).toBe(true)
  })

  test('1回の呼び出しで git commit を2回行うものは止める', async () => {
    await approve()

    const result = await gate('git add -A && git commit -m x && git commit --allow-empty -m y')

    expect(result.denied).toBe(true)
    expect(result.reason).toContain('2回以上')
  })

  test('コミットメッセージのヒアドキュメントに git commit と書いても、コマンドと取り違えない', async () => {
    await approve()

    const command = "git add -A && git commit -F - <<'EOF'\n変更はすべて git add -A && git commit で入れる\ngit commit -m は使わない\nEOF\ngit log --oneline -1"

    expect((await gate(command)).denied).toBe(false)
    expect((await gate("git add -A && git commit -m \"$(cat <<'EOF'\ngit commit で入れる\nEOF\n)\" && git log --oneline -1")).denied).toBe(false)
  })
})

/**
 * コミットゲートの、全件のチェックが通った記録（docs/WORKFLOW.md「コミットゲート」）。
 *
 * ブラウザを起動しない。一時の git リポジトリで、全件のチェックを差し替えた関数で演じ、
 * 記録を残す条件と、npm run approve が流し直さずに承認する条件を確かめる。
 */
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { computeChangeHash } from '../scripts/lib/change-hash.mjs'
import { runRecordedCheckAsync, approveAsync, CHECK_RECORD, APPROVAL_FILE } from '../scripts/lib/check-record.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let root

const gitAsync = (...args) => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root })

const existsAsync = async (file) => access(path.join(root, file)).then(() => true, () => false)
const readJsonAsync = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'))

// 通るチェック（記録まで行う）。呼ばれた回数を数える
const passingCheck = () => {
  const check = async () => {
    check.calls++
    return (await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })).code
  }
  check.calls = 0
  return check
}

test.beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ktt-check-record-'))
  await gitAsync('init', '-q')
  await gitAsync('config', 'user.email', 'test@example.invalid')
  await gitAsync('config', 'user.name', 'test')
  // 本物と同じ .gitignore（記録と承認のファイルは無視される）
  await writeFile(path.join(root, '.gitignore'), await readFile(path.join(repoRoot, '.gitignore')))
  await writeFile(path.join(root, 'a.txt'), 'base\n')
  await gitAsync('add', '.gitignore', 'a.txt')
  await gitAsync('commit', '-q', '-m', 'init')
  await writeFile(path.join(root, 'a.txt'), 'changed\n')
})

test.afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test.describe('コミットゲート: 全件のチェックの記録', () => {
  test('通ったら、流す前と同じ作業ツリー（HEAD と hash）を記録する', async () => {
    const result = await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })

    expect(result).toEqual({ code: 0, recorded: true })
    const record = await readJsonAsync(CHECK_RECORD)
    const state = await computeChangeHash(root)
    expect(record.head).toBe(state.head)
    expect(record.hash).toBe(state.hash)
  })

  test('落ちたら記録せず、前の記録も消す', async () => {
    await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })
    expect(await existsAsync(CHECK_RECORD)).toBe(true)

    const result = await runRecordedCheckAsync({ root, runStepsAsync: async () => 1, env: {} })

    expect(result).toEqual({ code: 1, recorded: false, reason: 'failed' })
    expect(await existsAsync(CHECK_RECORD)).toBe(false)
  })

  test('途中で作業ツリーが変わったら、通っても記録せずに失敗にする', async () => {
    const result = await runRecordedCheckAsync({
      root,
      runStepsAsync: async () => {
        await writeFile(path.join(root, 'a.txt'), 'changed during check\n')
        return 0
      },
      env: {}
    })

    expect(result).toEqual({ code: 1, recorded: false, reason: 'changed' })
    expect(await existsAsync(CHECK_RECORD)).toBe(false)
  })

  test('EXTENSION_PATH を指定したときは、作業ツリーの src/ を試していないので記録しない', async () => {
    const result = await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: { EXTENSION_PATH: '/tmp/unpacked' } })

    expect(result).toEqual({ code: 0, recorded: false, reason: 'extension-path' })
    expect(await existsAsync(CHECK_RECORD)).toBe(false)
  })
})

test.describe('コミットゲート: 作業ツリーのハッシュ', () => {
  test('日本語の名前の未追跡ファイルも、中身を変えればハッシュが変わる', async () => {
    await writeFile(path.join(root, 'メモ.txt'), 'first\n')
    const first = await computeChangeHash(root)
    await writeFile(path.join(root, 'メモ.txt'), 'second\n')
    const second = await computeChangeHash(root)

    expect(second.hash).not.toBe(first.hash)
    expect(second.files).toContain('メモ.txt')
  })

  test('名前を変えたファイルは、新しい名前だけを一覧に出す', async () => {
    await gitAsync('checkout', '--', 'a.txt')
    await gitAsync('mv', 'a.txt', 'c.txt')

    const state = await computeChangeHash(root)

    expect(state.files).toEqual(['c.txt'])
  })
})

test.describe('コミットゲート: npm run approve がチェックを使い回す条件', () => {
  test('同じ作業ツリーで通った記録があれば、チェックを流さずに承認する', async () => {
    await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })
    const check = passingCheck()

    const result = await approveAsync({ root, note: 'n', runCheckAsync: check })

    expect(result.ok).toBe(true)
    expect(result.reused).toBe(true)
    expect(check.calls).toBe(0)
    // コミットゲートは今の hash と承認の hash を比べる
    const approval = await readJsonAsync(APPROVAL_FILE)
    expect(approval.hash).toBe((await computeChangeHash(root)).hash)
    expect(approval.reusedCheck).toBe(true)
    expect(approval.files).toEqual(['a.txt'])
  })

  test('記録の後に作業ツリーを変えたら、チェックを流し直してから承認する', async () => {
    await runRecordedCheckAsync({ root, runStepsAsync: async () => 0, env: {} })
    await writeFile(path.join(root, 'b.txt'), 'new file\n')
    const check = passingCheck()

    const result = await approveAsync({ root, runCheckAsync: check })

    expect(result.ok).toBe(true)
    expect(result.reused).toBe(false)
    expect(check.calls).toBe(1)
    const approval = await readJsonAsync(APPROVAL_FILE)
    expect(approval.hash).toBe((await computeChangeHash(root)).hash)
    expect(approval.reusedCheck).toBe(false)
  })

  test('HEAD が違えば、差分の hash が同じでもチェックを流し直す', async () => {
    const state = await computeChangeHash(root)
    await mkdir(path.join(root, path.dirname(CHECK_RECORD)), { recursive: true })
    await writeFile(path.join(root, CHECK_RECORD), JSON.stringify({ head: '0'.repeat(40), hash: state.hash }))
    const check = passingCheck()

    const result = await approveAsync({ root, runCheckAsync: check })

    expect(result.ok).toBe(true)
    expect(check.calls).toBe(1)
  })

  test('チェックが落ちたら承認しない', async () => {
    const result = await approveAsync({ root, runCheckAsync: async () => 1 })

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })

  test('チェックが通っても今の作業ツリーの記録が無ければ承認しない（途中で変わった・EXTENSION_PATH）', async () => {
    const result = await approveAsync({ root, runCheckAsync: async () => 0 })

    expect(result).toEqual({ ok: false, reason: 'not-recorded' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })

  test('チェックの途中で変わってから通ったときは、チェックが通った状態で承認する', async () => {
    const before = await computeChangeHash(root)
    const check = passingCheck()

    const result = await approveAsync({
      root,
      runCheckAsync: async () => {
        await writeFile(path.join(root, 'b.txt'), 'written before the check\n')
        return check()
      }
    })

    expect(result.ok).toBe(true)
    const approval = await readJsonAsync(APPROVAL_FILE)
    const after = await computeChangeHash(root)
    expect(approval.hash).toBe(after.hash)
    expect(approval.hash).not.toBe(before.hash)
  })

  test('変更が無ければ、チェックを流さずに止める', async () => {
    await gitAsync('checkout', '--', 'a.txt')
    const check = passingCheck()

    const result = await approveAsync({ root, runCheckAsync: check })

    expect(result).toEqual({ ok: false, reason: 'no-changes' })
    expect(check.calls).toBe(0)
  })
})

/**
 * コミットゲートの、全件のチェックが通った記録（docs/notes/workflow.md「コミットゲート」）。
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

  test('途中で HEAD だけが動いたら、作業ツリーの中身が同じでも記録しない', async () => {
    const result = await runRecordedCheckAsync({
      root,
      runStepsAsync: async () => {
        // 中身を変えずに HEAD だけを動かす（ほかのセッションのコミットなど）
        await gitAsync('commit', '-q', '--allow-empty', '-m', 'during check')
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

  test('approve が作業ツリーを読んでからチェックが始まるまでに変わったときは、チェックが通った状態で承認する', async () => {
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

  test('approve が流したチェックのあとで HEAD だけが動いたら、作業ツリーの中身が同じでも承認しない', async () => {
    const check = passingCheck()

    const result = await approveAsync({
      root,
      runCheckAsync: async () => {
        const code = await check()
        await gitAsync('commit', '-q', '--allow-empty', '-m', 'after check')
        return code
      }
    })

    expect(result).toEqual({ ok: false, reason: 'not-recorded' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })

  test('変更が無ければ、チェックを流さずに止める', async () => {
    await gitAsync('checkout', '--', 'a.txt')
    const check = passingCheck()

    const result = await approveAsync({ root, runCheckAsync: check })

    expect(result).toEqual({ ok: false, reason: 'no-changes' })
    expect(check.calls).toBe(0)
  })
})

test.describe('コミットゲート: 文書だけの変更は文書の検査だけで承認する', () => {
  // 呼ばれた回数を数える、通る文書の検査
  const docsCheck = () => {
    const check = async () => {
      check.calls++
      return 0
    }
    check.calls = 0
    return check
  }

  const commitAsync = async (file, content) => {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true })
    await writeFile(path.join(root, file), content)
    await gitAsync('add', file)
    await gitAsync('commit', '-q', '-m', `add ${file}`)
  }

  test.beforeEach(async () => {
    // 外側の beforeEach が変えた a.txt（Markdown でない）を戻す
    await gitAsync('checkout', '--', 'a.txt')
  })

  test('変更が src/ の外の Markdown だけなら、全件を流さず文書の検査だけで承認する（全件の記録は書かない）', async () => {
    // 名前は実在しないものにする（このファイルに書いた名前の文書は、本物のリポジトリで全件扱いになるため）
    await commitAsync('GUIDE-BASE.md', 'base\n')
    await writeFile(path.join(root, 'GUIDE-BASE.md'), 'changed\n')
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'docs', '要件.md'), 'new\n')
    const check = passingCheck()
    const docs = docsCheck()

    const result = await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(result.ok).toBe(true)
    expect(result.docsOnly).toBe(true)
    expect(check.calls).toBe(0)
    expect(docs.calls).toBe(1)
    const approval = await readJsonAsync(APPROVAL_FILE)
    expect(approval.hash).toBe((await computeChangeHash(root)).hash)
    expect(approval.docsOnly).toBe(true)
    expect(await existsAsync(CHECK_RECORD)).toBe(false)
  })

  test('src/ に置いた Markdown は文書扱いにせず、全件を流す', async () => {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'notes.md'), 'new\n')
    const check = passingCheck()
    const docs = docsCheck()

    const result = await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(result.ok).toBe(true)
    expect(result.docsOnly).toBe(false)
    expect(check.calls).toBe(1)
    expect(docs.calls).toBe(0)
  })

  test('Markdown とそれ以外の変更が混ざっていれば、全件を流す', async () => {
    await writeFile(path.join(root, 'a.txt'), 'changed\n')
    await writeFile(path.join(root, 'NOTE.md'), 'new\n')
    const check = passingCheck()
    const docs = docsCheck()

    await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(check.calls).toBe(1)
    expect(docs.calls).toBe(0)
  })

  test('テストやスクリプトが名前に触れている Markdown（テストが読む文書）は、全件を流す', async () => {
    // tests/selector-defs.spec.mjs が docs/notes/manual-checklist.md を読むのと同じ形
    await commitAsync('tests/read-doc.spec.mjs', "readFileSync(path.join(root, 'docs', 'CHECKLIST.md'))\n")
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'CHECKLIST.md'), 'new\n')
    const check = passingCheck()
    const docs = docsCheck()

    await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(check.calls).toBe(1)
    expect(docs.calls).toBe(0)
  })

  test('src/ から名前を変えて出した Markdown は、元の場所も見て全件を流す', async () => {
    await commitAsync('src/a.md', 'base\n')
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await gitAsync('mv', 'src/a.md', 'docs/a.md')
    const check = passingCheck()
    const docs = docsCheck()

    await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(check.calls).toBe(1)
    expect(docs.calls).toBe(0)
  })

  test('ステージしてから作業ツリーだけ戻したコードの変更があれば、全件を流す', async () => {
    // git diff HEAD は作業ツリーとしか比べないので、ステージ済みの中身も見ないと漏れる
    await commitAsync('src/x.js', 'base\n')
    await writeFile(path.join(root, 'src', 'x.js'), 'staged\n')
    await gitAsync('add', 'src/x.js')
    await writeFile(path.join(root, 'src', 'x.js'), 'base\n')
    await writeFile(path.join(root, 'NOTE.md'), 'new\n')
    const check = passingCheck()
    const docs = docsCheck()

    await approveAsync({ root, runCheckAsync: check, runDocsCheckAsync: docs })

    expect(check.calls).toBe(1)
    expect(docs.calls).toBe(0)
  })

  test('文書の検査が落ちたら承認しない', async () => {
    await writeFile(path.join(root, 'NOTE.md'), 'new\n')

    const result = await approveAsync({ root, runCheckAsync: passingCheck(), runDocsCheckAsync: async () => 1 })

    expect(result).toEqual({ ok: false, reason: 'docs-failed' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })

  test('文書の検査の途中で HEAD だけが動いたら、作業ツリーの中身が同じでも承認しない', async () => {
    await writeFile(path.join(root, 'NOTE.md'), 'new\n')

    const result = await approveAsync({
      root,
      runCheckAsync: passingCheck(),
      runDocsCheckAsync: async () => {
        await gitAsync('commit', '-q', '--allow-empty', '-m', 'during docs check')
        return 0
      }
    })

    expect(result).toEqual({ ok: false, reason: 'docs-changed' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })

  test('文書の検査の途中で作業ツリーが変わったら、通っても承認しない', async () => {
    await writeFile(path.join(root, 'NOTE.md'), 'new\n')

    const result = await approveAsync({
      root,
      runCheckAsync: passingCheck(),
      runDocsCheckAsync: async () => {
        await writeFile(path.join(root, 'NOTE.md'), 'changed during check\n')
        return 0
      }
    })

    expect(result).toEqual({ ok: false, reason: 'docs-changed' })
    expect(await existsAsync(APPROVAL_FILE)).toBe(false)
  })
})

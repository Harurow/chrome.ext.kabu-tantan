/**
 * 全件のチェック（`npm run check`）が通った作業ツリーを記録し、`npm run approve` で使い回す。
 *
 * レビューで流した全件のチェックと、その直後の approve が、同じ作業ツリーに対して
 * 約3分のテストを続けて2回流していた。記録と今の作業ツリーが同じなら、approve は流し直さない。
 *
 * 作業ツリーは HEAD と computeChangeHash の hash の組で表す（hash は HEAD からの差分しか見ないので、
 * HEAD が違えば差分が同じでも別の状態として扱う）。コミットゲートも同じ hash で判定する。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { computeChangeHash } from './change-hash.mjs'

export const CHECK_RECORD = '.claude/check-passed.json'
export const APPROVAL_FILE = '.claude/review-approved.json'

const readJsonAsync = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

const writeJsonAsync = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

const sameTree = (a, b) => !!a && !!b && a.head === b.head && a.hash === b.hash

/**
 * 全件のチェックを流し、通って作業ツリーが流す前と同じなら記録する。
 *
 * 記録は流す前に消す（落ちた・中断した・途中で変わったときに、古い記録が残らないように）。
 * EXTENSION_PATH を指定したときは、テストが作業ツリーの src/ を見ていないので記録しない。
 *
 * @param {{ root: string, runStepsAsync: () => Promise<number>, env?: Record<string, string | undefined> }} options
 * @returns {Promise<{ code: number, recorded: boolean, reason?: 'failed' | 'changed' | 'extension-path' }>}
 */
export const runRecordedCheckAsync = async ({ root, runStepsAsync, env = process.env }) => {
  const recordFile = path.join(root, CHECK_RECORD)
  await rm(recordFile, { force: true })

  const before = await computeChangeHash(root)
  const code = await runStepsAsync()
  if (code !== 0) return { code, recorded: false, reason: 'failed' }

  if (env.EXTENSION_PATH) return { code, recorded: false, reason: 'extension-path' }

  const after = await computeChangeHash(root)
  if (!sameTree(before, after)) return { code: 1, recorded: false, reason: 'changed' }

  await writeJsonAsync(recordFile, { head: after.head, hash: after.hash, passedAt: new Date().toISOString() })
  return { code, recorded: true }
}

/**
 * 今の作業ツリーで全件のチェックが通っていれば承認を記録する。
 *
 * 同じ作業ツリーの記録があれば、チェックを流し直さない。無ければ runCheckAsync で流し、
 * 流したあとの記録が今の作業ツリーと一致したときだけ承認する（途中で変わったときは承認しない）。
 * 承認の hash は、チェックが通った作業ツリーのもの。
 *
 * @param {{ root: string, note?: string, runCheckAsync: () => Promise<number> }} options
 * @returns {Promise<{ ok: boolean, reused?: boolean, reason?: 'no-changes' | 'failed' | 'not-recorded', approval?: object }>}
 */
export const approveAsync = async ({ root, note = '', runCheckAsync }) => {
  const recordFile = path.join(root, CHECK_RECORD)
  const current = await computeChangeHash(root)
  if (current.files.length === 0) return { ok: false, reason: 'no-changes' }

  const reused = sameTree(await readJsonAsync(recordFile), current)
  let checked = current

  if (!reused) {
    const code = await runCheckAsync()
    if (code !== 0) return { ok: false, reason: 'failed' }

    checked = await computeChangeHash(root)
    if (!sameTree(await readJsonAsync(recordFile), checked)) return { ok: false, reason: 'not-recorded' }
  }

  const approval = {
    hash: checked.hash,
    head: checked.head,
    approvedAt: new Date().toISOString(),
    note: note || null,
    reusedCheck: reused,
    files: checked.files
  }
  await writeJsonAsync(path.join(root, APPROVAL_FILE), approval)
  return { ok: true, reused, approval }
}

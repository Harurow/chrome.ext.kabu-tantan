/**
 * 作業ツリーの今の中身を表すハッシュを求める。
 *
 * レビュー承認をこのハッシュに紐づけることで、
 * 「承認後に1文字でも変更したら承認は無効」を機械的に保証する。
 *
 * ハッシュは、作業ツリーの変更をすべて（未追跡のファイルも）コミットしたときにできる tree の ID。
 * 一時的な index に HEAD を読み込み、git add --all して write-tree で求める（本物の index は触らない）。
 * ステージの状態（git add したか・一部だけか）によらず、作業ツリーの中身だけで決まる。
 * 実際にコミットされる中身（index）が作業ツリーと同じかは、コミットゲートが committedTreeAsync で別に確かめる。
 * 求め方は chrome.ext.silent-tab・chrome.ext.love-g-rss-reader と同じ。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/** 承認ファイルとチェックの記録は対象から外す（書くたびにハッシュが変わってしまうため。.gitignore でも無視している） */
const EXCLUDE = new Set(['.claude/review-approved.json', '.claude/check-passed.json'])

const git = async (args, cwd, env = process.env) => {
  const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/** 一時的な index で fn を実行する。本物の index は触らない */
const withTempIndexAsync = async (fn) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ktt-gate-'))
  try {
    return await fn({ ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 作業ツリーの中身の tree の ID（変更をすべてコミットしたときの tree）
 * @param {string} repoRoot リポジトリのルート
 * @returns {Promise<string>}
 */
export const worktreeTreeAsync = (repoRoot) => withTempIndexAsync(async (env) => {
  await git(['read-tree', 'HEAD'], repoRoot, env)
  await git(['add', '--all', '--', '.'], repoRoot, env)
  await git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...EXCLUDE], repoRoot, env)
  return (await git(['write-tree'], repoRoot, env)).trim()
})

/**
 * 今 git commit したときにコミットされる中身（index）の tree の ID。本物の index は触らず、コピーで求める
 * @param {string} repoRoot リポジトリのルート
 * @param {{ addAll?: boolean, addTracked?: boolean }} [options]
 *   addAll: 同じコマンドで先に git add -A するとき / addTracked: git commit -a のとき（追跡しているファイルの変更を足す）
 * @returns {Promise<string>} 解決していない衝突があるときなどは例外
 */
export const committedTreeAsync = async (repoRoot, { addAll = false, addTracked = false } = {}) => {
  const indexPath = path.resolve(repoRoot, (await git(['rev-parse', '--git-path', 'index'], repoRoot)).trim())
  return withTempIndexAsync(async (env) => {
    try {
      await copyFile(indexPath, env.GIT_INDEX_FILE)
    } catch {
      // index がまだ無い
      await git(['read-tree', 'HEAD'], repoRoot, env)
    }
    if (addAll) await git(['add', '--all', '--', '.'], repoRoot, env)
    if (addTracked) await git(['add', '--update', '--', '.'], repoRoot, env)
    return (await git(['write-tree'], repoRoot, env)).trim()
  })
}

/**
 * merge などを --continue したあとに残っている手順の数。残っていれば、同じ呼び出しの中で、確かめていないコミットが続けて作られる。
 * cherry-pick / revert は sequencer/todo に今の手順と残りがあり（1つだけのときは sequencer が無い）、
 * rebase は rebase-merge/git-rebase-todo に残りだけがあり、am（と rebase の apply）は rebase-apply/next・last に今と最後の番号がある
 * （git 2.54 で確かめた）。途中の状態が読めないときは例外（コミットゲートは止める）
 * @param {string} repoRoot リポジトリのルート
 * @param {string} subcommand merge / cherry-pick / revert / rebase / am
 * @returns {Promise<number>}
 */
export const remainingStepsAsync = async (repoRoot, subcommand) => {
  const gitPath = async (name) => path.resolve(repoRoot, (await git(['rev-parse', '--git-path', name], repoRoot)).trim())
  const exists = async (name) => stat(await gitPath(name)).then(() => true, () => false)
  /** 手順の行（空行と # で始まる行を除く）の数 */
  const steps = async (name) => (await readFile(await gitPath(name), 'utf8')).split('\n').filter((l) => l.trim() && !l.startsWith('#')).length
  const applyLeft = async () => {
    const [next, last] = await Promise.all(['rebase-apply/next', 'rebase-apply/last'].map(async (name) => (await readFile(await gitPath(name), 'utf8')).trim()))
    if (!/^\d+$/.test(next) || !/^\d+$/.test(last)) throw new Error('rebase-apply の next / last を読めません')
    return Math.max(0, Number(last) - Number(next))
  }

  if (subcommand === 'cherry-pick' || subcommand === 'revert') {
    return await exists('sequencer') ? Math.max(0, await steps('sequencer/todo') - 1) : 0
  }
  if (subcommand === 'rebase') {
    if (await exists('rebase-merge')) return steps('rebase-merge/git-rebase-todo')
    return await exists('rebase-apply') ? applyLeft() : 0
  }
  if (subcommand === 'am') return await exists('rebase-apply') ? applyLeft() : 0
  return 0
}

/**
 * @param {string} repoRoot リポジトリのルート
 * @returns {Promise<{ hash: string, head: string, files: string[] }>} hash: 作業ツリーの中身の tree の ID
 */
export const computeChangeHash = async (repoRoot) => {
  const hash = await worktreeTreeAsync(repoRoot)

  const head = (await git(['rev-parse', 'HEAD'], repoRoot)).trim()

  // 変更のあったファイル一覧（報告用）。-z では名前の変更・複製の次の欄が元の名前なので読み飛ばす
  const entries = (await git(['status', '--porcelain', '-z'], repoRoot)).split('\0')
  const changed = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    if (/[RC]/.test(entry.slice(0, 2))) i++
    const file = entry.slice(3)
    if (!EXCLUDE.has(file)) changed.push(file)
  }

  return { hash, head, files: changed }
}

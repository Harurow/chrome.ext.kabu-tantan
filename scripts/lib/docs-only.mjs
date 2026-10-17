/**
 * 作業ツリーの変更が「文書だけ」かを判定する（docs/notes/workflow.md「文書だけの変更は文書の検査だけで承認する」）。
 *
 * 文書だけ = HEAD からの変更（ステージ済み・未ステージ・削除・未追跡。名前の変更は元と先の両方）がすべて Markdown で、
 * 拡張機能・テスト・スクリプトの置き場（src/ tests/ scripts/）の外にあり、
 * tests/ と scripts/ のどのファイルもその名前に触れていないもの。
 * ステージ済みは `git diff --cached` でも見る（`git diff HEAD` は作業ツリーとしか比べないので、ステージしてから作業ツリーだけ戻した変更が漏れる）。
 *
 * テストが読む文書（tests/selector-defs.spec.mjs は docs/notes/manual-checklist.md を読む）は、コードに名前が書かれているので
 * 変えると全件のチェックになる。コメントで触れているだけのものも全件に倒す（読むかどうかを見分けない。迷うなら流す）。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/** ここに置かれた Markdown は文書扱いにしない */
const CODE_DIRS = ['src/', 'tests/', 'scripts/']

/** 名前に触れていないかを見るディレクトリ */
const SCANNED_DIRS = ['tests', 'scripts']

const gitAsync = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/**
 * HEAD からの変更のパス。名前の変更は元と先の両方を返す（`src/a.md` → `docs/a.md` を文書だけにしないため）
 * @param {string} root リポジトリのルート
 * @returns {Promise<string[]>}
 */
export const listChangedPathsAsync = async (root) => {
  const worktree = (await gitAsync(['diff', 'HEAD', '--name-only', '--no-renames', '-z'], root)).split('\0')
  const staged = (await gitAsync(['diff', '--cached', 'HEAD', '--name-only', '--no-renames', '-z'], root)).split('\0')
  const untracked = (await gitAsync(['ls-files', '--others', '--exclude-standard', '-z'], root)).split('\0')
  return [...new Set([...worktree, ...staged, ...untracked])].filter(Boolean).sort()
}

const readScannedTextsAsync = async (root) => {
  const texts = []
  for (const dir of SCANNED_DIRS) {
    let entries
    try {
      entries = await readdir(path.join(root, dir), { recursive: true, withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.filter((item) => item.isFile())) {
      // parentPath は Node 20.12 から。それより前（engines は >=20）は path にある
      texts.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'))
    }
  }
  return texts
}

/**
 * @param {string} root リポジトリのルート
 * @returns {Promise<boolean>} 変更が無いときは false
 */
export const isDocsOnlyChangeAsync = async (root) => {
  const paths = await listChangedPathsAsync(root)
  if (paths.length === 0) return false

  const isDocument = (file) => file.endsWith('.md') && !CODE_DIRS.some((dir) => file.startsWith(dir))
  if (!paths.every(isDocument)) return false

  const texts = await readScannedTextsAsync(root)
  return paths.every((file) => !texts.some((text) => text.includes(path.posix.basename(file))))
}

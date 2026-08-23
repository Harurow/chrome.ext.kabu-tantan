/**
 * Chrome ウェブストア提出用の zip を dist/ に作成する。
 * src/ をそのまま固めるだけ（ビルドステップは無い）。
 */
import { readFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')
const distDir = path.join(root, 'dist')

const manifest = JSON.parse(await readFile(path.join(srcDir, 'manifest.json'), 'utf8'))
const zipName = `kabu-tantan-${manifest.version}.zip`
const zipPath = path.join(distDir, zipName)

await mkdir(distDir, { recursive: true })
await rm(zipPath, { force: true })

// -r 再帰 / -X 拡張属性を含めない / -x 除外パターン
await execFileAsync('zip', [
  '-r', '-X', zipPath, '.',
  '-x', '*.DS_Store', '-x', '__MACOSX/*'
], { cwd: srcDir })

const { stdout } = await execFileAsync('unzip', ['-l', zipPath])
const entries = stdout.trim().split('\n').length - 5

console.log(`✅ ${path.relative(root, zipPath)} を作成しました (${entries} ファイル)`)

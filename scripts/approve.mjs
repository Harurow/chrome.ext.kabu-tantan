/**
 * コミット承認を記録する。
 *
 *   1. `npm run check`（lint + validate + テスト全件）を実行する
 *   2. 通れば、現在の変更内容のハッシュを .claude/review-approved.json に書く
 *
 * .claude/hooks/commit-gate.sh がこのファイルを見て git commit を許可する。
 * 承認はハッシュに紐づくので、承認後に変更すると自動的に無効になる。
 *
 * ⚠️ このスクリプトは「テストが通ったこと」しか保証しない。
 *    reviewer のレビューを通したかどうかは人間/lead の責任。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { computeChangeHash } from './lib/change-hash.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const note = process.argv.slice(2).join(' ').trim()

const run = (cmd, args) => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' })
  child.on('close', (code) => resolve(code ?? 1))
})

console.log('▶ npm run check を実行します（lint + validate + テスト全件）\n')
const code = await run('npm', ['run', 'check'])

if (code !== 0) {
  console.error('\n❌ npm run check が失敗しました。承認は記録しません。')
  console.error('   修正してから再度 npm run approve を実行してください。')
  process.exit(1)
}

const { hash, head, files } = await computeChangeHash(root)

if (files.length === 0) {
  console.error('\n❌ コミット対象の変更がありません。')
  process.exit(1)
}

const approval = {
  hash,
  head,
  approvedAt: new Date().toISOString(),
  note: note || null,
  files
}

const out = path.join(root, '.claude', 'review-approved.json')
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(approval, null, 2) + '\n', 'utf8')

console.log('\n✅ 承認を記録しました')
console.log(`   対象: ${files.length} ファイル`)
console.log(`   hash: ${hash.slice(0, 16)}…`)
if (note) console.log(`   note: ${note}`)
console.log('\n   git commit が可能になりました。')
console.log('   ⚠️ ここからファイルを変更すると承認は無効になります（再レビューが必要）。')

/**
 * コミット承認を記録する。
 *
 *   1. 今の作業ツリーで `npm run check`（lint + validate + テスト全件）が通っていることを確かめる。
 *      同じ作業ツリーで通った記録（.claude/check-passed.json）があれば流し直さず、無ければ流す。
 *      変更が文書だけ（scripts/lib/docs-only.mjs）なら、全件ではなく `npm run check:docs`（lint:md とテストカタログの陳腐化検査）だけを流す
 *   2. 通っていれば、その作業ツリーのハッシュを .claude/review-approved.json に書く
 *
 * .claude/hooks/commit-gate.sh がこのファイルを見て git commit を許可する。
 * 承認はハッシュに紐づくので、承認後に変更すると自動的に無効になる。
 *
 * ⚠️ このスクリプトは「テストが通ったこと」しか保証しない。
 *    reviewer のレビューを通したかどうかは、コミットするセッションと利用者の責任。
 */
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { approveAsync, CHECK_RECORD } from './lib/check-record.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const note = process.argv.slice(2).join(' ').trim()

const runCheckAsync = () => new Promise((resolve) => {
  console.log('▶ npm run check を実行します（lint + validate + テスト全件）\n')
  const child = spawn('npm', ['run', 'check'], { cwd: root, stdio: 'inherit' })
  child.on('close', (code) => resolve(code ?? 1))
})

const runDocsCheckAsync = () => new Promise((resolve) => {
  console.log('▶ 変更は文書（Markdown）だけなので、npm run check:docs だけを実行します（lint:md + テストカタログの陳腐化検査）')
  console.log('  テスト全件は流しません（docs/WORKFLOW.md「文書だけの変更は文書の検査だけで承認する」）\n')
  const child = spawn('npm', ['run', 'check:docs'], { cwd: root, stdio: 'inherit' })
  child.on('close', (code) => resolve(code ?? 1))
})

const result = await approveAsync({ root, note, runCheckAsync, runDocsCheckAsync })

if (!result.ok) {
  if (result.reason === 'no-changes') {
    console.error('\n❌ コミット対象の変更がありません。')
  } else if (result.reason === 'docs-failed') {
    console.error('\n❌ npm run check:docs が失敗しました。承認は記録しません。')
    console.error('   修正してから再度 npm run approve を実行してください。')
  } else if (result.reason === 'docs-changed') {
    console.error('\n❌ 文書の検査の途中で作業ツリーが変わりました。どの状態で通ったか分からないので、承認は記録しません。')
    console.error('   変更を終えてから、もう一度 npm run approve を実行してください。')
  } else if (result.reason === 'failed') {
    console.error('\n❌ npm run check が失敗しました。承認は記録しません。')
    console.error('   修正してから再度 npm run approve を実行してください。')
  } else {
    console.error('\n❌ 今の作業ツリーで npm run check が通った記録がありません（チェックの途中で変わったか、EXTENSION_PATH を指定した）。')
    console.error('   承認は記録しません。変更を終えてから、もう一度 npm run approve を実行してください。')
  }
  process.exit(1)
}

const { approval, reused, docsOnly } = result
if (docsOnly) {
  console.log('\n✔ 文書だけの変更なので、文書の検査だけで承認します。')
} else if (reused) {
  console.log(`✔ 同じ作業ツリーで npm run check が通った記録（${CHECK_RECORD}）があるので、流し直しません。`)
}
console.log('\n✅ 承認を記録しました')
console.log(`   対象: ${approval.files.length} ファイル`)
console.log(`   hash: ${approval.hash.slice(0, 16)}…`)
if (note) console.log(`   note: ${note}`)
console.log('\n   git commit が可能になりました。')
console.log('   ⚠️ ここからファイルを変更すると承認は無効になります（再レビューが必要）。')

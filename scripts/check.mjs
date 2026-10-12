/**
 * `npm run check` の本体。lint + validate + テスト全件 + テストカタログの陳腐化検査（`npm run check:steps`）を流し、
 * 通って作業ツリーが流す前と同じなら、その作業ツリー（HEAD と hash）を .claude/check-passed.json に記録する。
 *
 * `npm run approve` は、今の作業ツリーがこの記録と同じなら全件を流し直さない（scripts/lib/check-record.mjs）。
 */
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { runRecordedCheckAsync, CHECK_RECORD } from './lib/check-record.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runStepsAsync = () => new Promise((resolve) => {
  const child = spawn('npm', ['run', 'check:steps'], { cwd: root, stdio: 'inherit' })
  child.on('close', (code) => resolve(code ?? 1))
})

const { code, recorded, reason } = await runRecordedCheckAsync({ root, runStepsAsync })

if (recorded) {
  console.log(`\n✅ 全件のチェックが通りました。作業ツリーを ${CHECK_RECORD} に記録しました`)
  console.log('   同じ作業ツリーのまま npm run approve を実行すると、チェックを流し直しません。')
} else if (reason === 'changed') {
  console.error('\n❌ チェックの途中で作業ツリーが変わりました。どの状態で通ったか分からないので、記録しません。')
  console.error('   変更を終えてから、もう一度 npm run check を実行してください。')
} else if (reason === 'extension-path') {
  console.log('\n⚠️ EXTENSION_PATH を指定したので、作業ツリーの src/ を試していません。記録しません。')
}

process.exit(code)

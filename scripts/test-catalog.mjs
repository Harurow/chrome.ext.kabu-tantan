/**
 * Playwright のテスト一覧から docs/TEST-CATALOG.md を生成する。
 * 手書きだと必ず実態とズレるため、テスト定義を唯一の情報源にする。
 */
import { writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 各テストファイルが何を守っているかの説明。ファイルを増やしたらここにも足す。
const FILE_INFO = {
  'service-worker.spec.mjs': {
    title: 'Service Worker / 共有モジュール',
    detail: 'Service Worker のグローバルスコープを直接 evaluate して、純粋なロジックを検証する。',
    specs: 'SPEC-TC, SPEC-EL, SPEC-SW'
  },
  'options.spec.mjs': {
    title: 'オプションページ',
    detail: 'chrome-extension:// のオプションページを開き、表示・操作・保存を検証する。',
    specs: 'SPEC-OP, SPEC-ST'
  },
  'content-script.spec.mjs': {
    title: 'Content Script（楽天証券 / SBI証券）',
    detail: 'context.route() で対象オリジンにフィクスチャ HTML を返し、実際の注入を検証する。',
    specs: 'SPEC-CS, SPEC-MF'
  },
  'selector-defs.spec.mjs': {
    title: 'セレクタ定義（半自動検証の土台）',
    detail: 'ブラウザを起動せず、src/*-cs.js の menuSelectors と scripts/selector-check/targets.mjs の対応、および検証ツールの中断時の後始末を検証する。' +
      'セレクタ文字列の二重管理を機械的に禁じる（NFR-13）。',
    specs: 'SPEC-SC, SPEC-CS'
  }
}

// 回帰テストとして特に重要なもの（テスト名の部分一致で判定）
const REGRESSION = {
  並び替え: 'jQuery UI 1.14.2 が jQuery 4.0.0 上で動くことの実証',
  グリッド: 'Materialize 2.x で .col が廃止され .row が CSS Grid 化した影響の検出',
  外部ホスト: 'CDN・外部フォント・外部画像への依存が再混入していないかの検出',
  誤マッチ: '米国株の正規表現から先頭アンカー ^ が失われていないかの検出',
  リガチャ: 'Material Icons のサブセット失敗（アイコン名が文字列のまま出る）の検出',
  compareVersion: 'バージョン比較が文字列比較に戻っていないかの検出',
  'インライン HTML': 'セレクタ検証の生成物が markdownlint（MD033）で落ち、npm run check を止める問題の検出'
}

const { stdout } = await execFileAsync(
  'npx', ['playwright', 'test', '--list', '--reporter=json'],
  { cwd: root, maxBuffer: 32 * 1024 * 1024 }
)

const report = JSON.parse(stdout)

/** suite を再帰的に辿ってテストを集める */
const collect = (suite, trail = []) => {
  const here = suite.title ? [...trail, suite.title] : trail
  const rows = []
  for (const spec of suite.specs ?? []) {
    rows.push({ group: here.slice(1).join(' › '), title: spec.title, line: spec.line })
  }
  for (const child of suite.suites ?? []) {
    rows.push(...collect(child, here))
  }
  return rows
}

const byFile = new Map()
for (const suite of report.suites ?? []) {
  const file = path.basename(suite.file ?? suite.title ?? '')
  byFile.set(file, collect(suite))
}

const total = [...byFile.values()].reduce((n, rows) => n + rows.length, 0)

const regressionRows = []
const lines = [
  '# テストカタログ',
  '',
  '> **このファイルは `npm run docs:tests` で自動生成される。手で編集しない。**',
  '> 説明文を変えたい場合は `scripts/test-catalog.mjs` を編集する。',
  '',
  `テスト総数: **${total}**`,
  '',
  'テストの方針・手法は [TESTING.md](TESTING.md) を参照。',
  ''
]

for (const [file, rows] of byFile) {
  const info = FILE_INFO[file] ?? { title: file, detail: '', specs: '—' }
  lines.push(`## ${info.title}`, '')
  lines.push(`\`tests/${file}\` — ${rows.length} 件`, '')
  if (info.detail) lines.push(info.detail, '')
  lines.push(`対応する仕様: ${info.specs}`, '')
  lines.push('| # | グループ | テスト |', '| --- | --- | --- |')

  rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.group || '—'} | ${r.title} |`)
    // 回帰テストの判定はグループ名も含めて見る（例: "compareVersion" はグループ側にある）
    const haystack = `${r.group} ${r.title}`
    for (const [needle, why] of Object.entries(REGRESSION)) {
      if (haystack.includes(needle)) {
        regressionRows.push({ file, label: `${r.group} › ${r.title}`, why })
      }
    }
  })
  lines.push('')
}

lines.push('## 回帰テストとして重要なもの', '')
lines.push('壊れたときに気づきにくい問題を固定しているテスト。**消さないこと。**', '')
lines.push('| テスト | 何を守っているか |', '| --- | --- |')
for (const r of regressionRows) {
  lines.push(`| ${r.label} | ${r.why} |`)
}
lines.push('')

lines.push('## 対象外', '')
lines.push('| 対象 | 理由 |', '| --- | --- |')
lines.push('| TradingView (`tradingview-cs.js`) | DOM がハッシュ付きクラス名で毎リリース変わる。フィクスチャ化しても実サイトとの乖離を検出できない (CON-08) |')
lines.push('| 楽天証券・内藤証券のセッション連携 | ログイン済みタブが前提のため自動化していない (CON-04) |')
lines.push('| 楽天スーパースクリーナー / SBI銘柄スクリーニング | MutationObserver + iframe 前提で再現コストが見合わない |')
lines.push('')
lines.push('これらは変更時に手動確認する。手順は [TESTING.md](TESTING.md) を参照。')
lines.push('')

const out = path.join(root, 'docs', 'TEST-CATALOG.md')
const content = lines.join('\n')
const rel = path.relative(root, out)

// --check: 生成物が最新か検証するだけ（書き込まない）。npm run check から呼ばれる
if (process.argv.includes('--check')) {
  let existing = null
  try {
    existing = await readFile(out, 'utf8')
  } catch {
    console.error(`❌ ${rel} がありません。'npm run docs:tests' を実行してください。`)
    process.exit(1)
  }
  if (existing !== content) {
    console.error(`❌ ${rel} がテスト定義と食い違っています。`)
    console.error("   テストを増減したら 'npm run docs:tests' で再生成してください。")
    process.exit(1)
  }
  console.log(`✅ ${rel} は最新です (${total} 件)`)
  process.exit(0)
}

await writeFile(out, content, 'utf8')
console.log(`✅ ${rel} を生成しました (${total} 件)`)

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
    title: 'Content Script（楽天証券 / SBI証券 / スクリーナー2種）',
    detail: 'context.route() で対象オリジンにフィクスチャ HTML を返し、実際の注入を検証する。' +
      '固定待機が明けた後に要素が現れるフィクスチャで、注入の再試行（SPEC-CS-22）も見る。',
    specs: 'SPEC-CS, SPEC-MF'
  },
  'tradingview.spec.mjs': {
    title: 'TradingView（拡張が自分で作った DOM の振る舞い）',
    detail: 'menuSelectors / watchlistSymbolAttrs から組み立てたフィクスチャに、右クリックメニューと入れ子・「株Link」ボタンのメニューを再現して検証する。' +
      '**このファイルが緑でも実サイトが壊れていないことにはならない**（改訂後の CON-08 / FR-26 判定基準7）。' +
      '見ているのは自分たちのコードの退行だけで、サイト改修は npm run check:selectors（FR-12）と手動確認 A が見る。',
    specs: 'SPEC-CS-24, SPEC-CS-25, SPEC-CS-27'
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
  'インライン HTML': 'セレクタ検証の生成物が markdownlint（MD033）で落ち、npm run check を止める問題の検出',
  遅れて現れた: '固定待機が明けた後に現れた要素へ注入できなくなる退行の検出（FR-13 / SPEC-CS-22）',
  後から現れた: 'スクリーナーの常設監視が結果一覧の器に戻り、検索前に開いたタブで注入されなくなる退行の検出（FR-13）',
  二重注入: '再試行でパスを繰り返す設計になったことによる二重注入の検出（FR-13 判定基準3）',
  retrySetup: '再試行が止まらず、他社サイト上でタイマーが走り続ける問題の検出（FR-13 判定基準2 / NFR-01）',
  未対応の記法: 'フィクスチャがセレクタと食い違ったまま緑になる状態の検出（改訂後の CON-08 の条件1・2 / FR-26 判定基準2）',
  'Esc の送出': '代行クリックの戻りを握る delegating が消え、他社サイトへ Esc を2回投げる退行の検出（FR-25 / NFR-01）',
  'margin-top を元に戻す': '遷移先0件でメニューを元に戻すとき、ずらした位置が痕跡として残る退行の検出（FR-24 / SPEC-CS-24 の手順5）',
  'storage に残った未知のキー': 'サイト廃止で消えた key が storage に残った利用者で、その key を読み飛ばすガードが消える（メニュー・行が欠ける、またはエラー欄にエラーが出る）か、保存し直しても key が残り続ける退行の検出（NFR-05 / SPEC-ST-03）'
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
lines.push('| TradingView の**実 DOM と見た目**（挿入先が実在するか / 模倣した見た目が揃っているか / サイト側メニューの開閉・スクロール） | フィクスチャでは実サイトとの乖離を検出できない (CON-08)。`npm run check:selectors` (FR-12) と手動確認 A が見る |')
lines.push('| TradingView の**起点の判定**（FR-19）と**項目の集合と順序**（FR-07 / FR-18） | FR-26 の段階3・4 で自動テストへ移す予定。それまでは手動確認 A |')
lines.push('| 楽天証券・内藤証券のセッション連携 | ログイン済みタブが前提のため自動化していない (CON-04) |')
lines.push('| 楽天スーパースクリーナー / SBI銘柄スクリーニング の**見た目と実 DOM** | 注入そのものは 1.13.0 で自動化した（常設監視を document.body に上げたためフィクスチャで再現できる）。実 DOM との乖離は `npm run check:selectors` と手動確認 C-2 / C-4 で見る |')
lines.push('')
lines.push('これらは変更時に手動確認する。手順は [TESTING.md](TESTING.md) を参照。')
lines.push('')
lines.push('> **TradingView の自動テストが緑でも、実サイトが壊れていない根拠にはならない**')
lines.push('> （改訂後の CON-08 の条件3 / FR-26 判定基準7）。見ているのは**自分たちのコードの退行だけ**で、')
lines.push('> **サイト改修を見る目は1つも増えていない。** 手動確認が短くなったことを')
lines.push('> 「TradingView は安全になった」と読み替えないこと。')
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

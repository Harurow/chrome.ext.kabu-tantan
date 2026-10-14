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
    detail: 'Service Worker のグローバルスコープを直接 evaluate して、純粋なロジックを検証する。' +
      '右クリックメニューの項目を押した後の処理（タブを開くか・小窓を開くか）も、同じ関数を直接呼んで見る。' +
      'manifest の権限はブラウザを使わず src/manifest.json を読んで固定する。',
    specs: 'SPEC-TC, SPEC-EL, SPEC-SW, SPEC-MF-03'
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
      '「株Link」ボタンの表示の切り替え（銘柄の切り替え・遅れて現れるツールバー）は canvas の aria-label を書き換えて演じ、' +
      '楽天証券のタブの有無はフィクスチャのタブを実際に開け閉めして作る。' +
      'ウォッチリストの行の起点（国内株・米国株・指数などの対象外の行・行の差し替え後・チャートの非退行）は、行を差し替えて演じる（FR-26 の段階3）。' +
      '項目の集合と順序（入れ子とボタン・国内株と米国株・設定順）と、入れ子の開閉と位置（猶予・Esc・外クリック・右端の反転・高さ・キー（拡張側だけ）・0件）も見る（FR-26 の段階4）。TradingView 自身のメニューのキー操作と、実サイトの余白の隙間をゆっくり越える動きは見ていない（2026-10-15。手動の行を残すかは本人の判断待ち）。' +
      '**このファイルが緑でも実サイトが壊れていないことにはならない**（改訂後の CON-08 / FR-26 判定基準7）。' +
      '見ているのは自分たちのコードの退行だけで、サイト改修は npm run check:selectors（FR-12）と手動確認 A が見る。' +
      'ただしウォッチリストの行の属性が実サイトで今も同じか（行の要素が使い回されるときに属性が追随するかを含む）は、どれも見ていない（2026-10-15。本人の判断待ち）。',
    specs: 'SPEC-CS-12, SPEC-CS-22, SPEC-CS-24, SPEC-CS-25, SPEC-CS-27, SPEC-CS-28'
  },
  'disconnected.spec.mjs': {
    title: '切断状態（拡張機能の再読み込みの後に残った古いタブ）',
    detail: 'chrome://extensions の chrome.developerPrivate で拡張機能を実際に再読み込みし（開発者モードが要る）、' +
      '古いタブで操作しても例外を出さず、要素を一瞬も足さないことを、TradingView・スクリーナー2種・楽天証券・SBI証券で検証する。' +
      '「一瞬も」は操作の前にページ側へ仕込んだ MutationObserver で見る。各テストで、切断の前（または別のタブ）に同じ操作が効くことを対照として示す。' +
      '起動直後の窓と再試行の途中は、CDP で Content Script の isolated world を掴んで、窓を踏んだこと・再試行が回っていたことを確かめてから切断する。',
    specs: 'SPEC-CS-19, SPEC-CS-22, NFR-14'
  },
  'notice.spec.mjs': {
    title: '開けないときの小窓（FR-29）',
    detail: 'Service Worker のクリック処理（onContextMenuClickedAsync）を直接呼んで実際に小窓を開き、文言・閉じ方・外部リクエスト・収まりを検証する。' +
      '想定外の引数は notice.html に直接遷移して見る。' +
      'Chrome の右クリックメニューそのものを押す操作と、実際のウィンドウでの見え方は自動化できない（SPEC-SW-10 の手動確認 M-1）。',
    specs: 'SPEC-NT, SPEC-SW-10'
  },
  'selector-defs.spec.mjs': {
    title: 'セレクタ定義（半自動検証の土台）',
    detail: 'ブラウザを起動せず、src/*-cs.js の menuSelectors と scripts/selector-check/targets.mjs の対応、および検証ツールの中断時の後始末を検証する。' +
      'セレクタ文字列の二重管理を機械的に禁じる（NFR-13）。',
    specs: 'SPEC-SC, SPEC-CS'
  },
  'check-record.spec.mjs': {
    title: 'コミットゲート（全件のチェックの記録）',
    detail: 'ブラウザを起動せず、一時の git リポジトリで、npm run check が通った作業ツリーを記録する条件と、' +
      'npm run approve が同じ作業ツリーならチェックを流し直さずに承認する条件を検証する。全件のチェックは差し替えた関数で演じる。' +
      '承認とチェックの記録が使う作業ツリーのハッシュ（日本語の名前の未追跡ファイル・名前の変更）も見る。',
    specs: 'docs/WORKFLOW.md「コミットゲート」'
  },
  'commit-gate.spec.mjs': {
    title: 'コミットゲート（コミットされる中身）',
    detail: 'ブラウザを起動せず、一時の git リポジトリで承認を記録し、フック（.claude/hooks/commit-gate.mjs）に Bash の呼び出しを渡して、' +
      'コミットされる中身（index）が承認した作業ツリーの中身と同じときだけ通すことを検証する。' +
      '一部だけのステージ・パスの指定・git commit -a と未追跡のファイル・前に置くコマンド（set・GIT_ の代入を含む）・シェル経由・ヒアドキュメント・引用符とリダイレクト、' +
      'commit 以外でコミットを作るコマンド（merge などと --skip・git pull）を止めること、--continue の中身と残りの手順（cherry-pick・revert・rebase・am を実際に衝突させる）を見る。',
    specs: 'docs/WORKFLOW.md「コミットされる中身を確かめる」'
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
  タブを開かず小窓を1つ開く: '右クリックメニューで米国株のページが無い遷移先を押しても、黙って何もしない（1.20.3 までの振る舞い）に戻る退行の検出（FR-29 判定基準1）',
  選択した文字列を: '選択文字列が小窓の URL や表示に載る退行の検出（FR-29 判定基準7 / NFR-03）',
  'HTML として解釈しない': '小窓がクエリの値を HTML として差し込む退行の検出（SPEC-NT-02）',
  'permissions は3つのまま': '権限が増えて既存利用者に再承認を求める状態の検出。npm run validate は警告で止まらないので、ここが止める（FR-29 判定基準6 / SPEC-MF-03）',
  'storage に残った未知のキー': 'サイト廃止で消えた key が storage に残った利用者で、その key を読み飛ばすガードが消える（メニュー・行が欠ける、またはエラー欄にエラーが出る）か、保存し直しても key が残り続ける退行の検出（NFR-05 / SPEC-ST-03）',
  一瞬も現れない: '拡張機能の再読み込みの後に残ったタブで、右クリックのたびに行が足されてすぐ消える（1.11.x までの症状）退行の検出。門は二重で、片方だけ消えても落ちない（NFR-14 判定基準2 / SPEC-CS-19）',
  メニューも背景も出ず: '「株Link」ボタンの背景（透明な全画面の層）を問い合わせより先に敷く実装に戻り、切断状態や遷移先0件のときに層が残ってページのクリックを吸う退行の検出（NFR-14 / SPEC-CS-12）',
  ボタンを足す前の: '起動時の門が消え、読み込み直後に切断されたタブに押しても動かない「株Link」ボタンが残る退行の検出（SPEC-CS-19「起動時の門」）',
  再試行の途中で切断: '再試行の tick ごとの切断判定が消え、起動時に読んだ設定で切断後も注入し続ける（タイマーも止まらない）退行の検出（FR-13 判定基準4 / NFR-14 判定基準2）',
  表示を切り替えない: 'canvas の監視が切断後も動き続ける退行の検出。切断していなければ同じ変化で隠れることを、同じテストで先に示す（SPEC-CS-19。手動確認 A-8 と対）',
  銘柄の切り替えに追随: '「株Link」ボタンと canvas の監視を別々に設置する実装になり、遅れて出たボタンが銘柄の切り替えで隠れなくなる退行の検出（FR-13 判定基準6 / ADR-0008 の 4）'
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
lines.push('| TradingView のウォッチリスト以外（ツールバー・銘柄検索・ほかのウィジェット）で項目が**出ない**こと（FR-19 判定基準5） | サイト側の DOM に依存する（候補の属性をほかのウィジェットも持つか）。フィクスチャでは言えない (CON-08)。手動確認 A-17。拡張側の起点の判定は 2026-10-15 に自動化した（FR-26 の段階3） |')
lines.push('| 楽天証券・内藤証券に**実際にログインした**状態と、開いたページが正しいか | ログイン済みタブが前提 (CON-04)。タブの有無で証券会社の項目が出る・消えること（「株Link」ボタンは楽天証券のフィクスチャのタブを実際に開け閉めし、右クリックの入れ子は `chrome.tabs.query` を差し替えて作る）、URL をページに出さないこと、Service Worker が該当銘柄の URL を開こうとすることは自動テストが見る。実ログインで開いたページは手動確認 B |')
lines.push('| Chrome の右クリックメニューを実際に押す操作と、開けないときの小窓の実際のウィンドウでの見え方（FR-29） | Playwright から Chrome 自身の右クリックメニューの項目を押す手段が無く（2026-10-11 に試行。ヘッドレス・画面ありとも `onClicked` が発火しない）、小窓の表示領域は Playwright が 1280×720 に置き換える。押した後の処理と登録（`hasListener`）、424×220 での収まりは自動テストが見る。実機は SPEC-SW-10 の手動確認 M-1 |')
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

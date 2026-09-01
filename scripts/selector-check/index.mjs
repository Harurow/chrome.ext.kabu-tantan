/**
 * 実サイトのセレクタ検証ツール (SPEC-SC-01, 07, 15)。
 *
 * ```bash
 * npm run check:selectors                          # 全サイト
 * npm run check:selectors -- --only=tradingview    # TradingView だけ
 * ```
 *
 * - **開発者が手で起動したときだけ**対象サイトへアクセスする。`npm run check` には含めない (CON-10)
 * - ログインは人が行う。ツールは代行しない (CON-04)
 * - 一時プロファイルは必ず破棄する (NFR-12 / SPEC-SC-08)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { rootDir, resolveSite } from './load-selectors.mjs'
import { sites, siteKeys } from './targets.mjs'
import { checkTargetAsync, createSkippedResult, finishTradingViewAsync, createBootstrapScript, sanitize, OK, BROKEN, UNREACHED, SKIPPED, EXCLUDED } from './check.mjs'
import { renderReport } from './report.mjs'

const USAGE = `
株リンク — 実サイトのセレクタ検証ツール

  npm run check:selectors [-- <オプション>]

オプション:
  --only=<サイト,...>  検証するサイトを絞る (${siteKeys.join(' / ')})
  --out=<パス>         結果ファイルの出力先 (既定: docs/SELECTOR-CHECK.md)
  --dry-run            ブラウザを起動せず、準備手順の表示と Enter 待ち・後始末だけを行う
  --help, -h           この使い方を表示する

流れ:
  1. ヘッド有りのブラウザが一時プロファイルで起動する
  2. 端末に出る準備手順に従い、自分でログイン／対象ページを開く（時間制限なし）
  3. 端末で Enter を押すと検証が始まる
  4. 結果が docs/SELECTOR-CHECK.md に書き出され、ブラウザとプロファイルが破棄される

終了コード:
  0 = 破損なし / 1 = 破損あり / 2 = 未到達あり / 3 = ツールの実行エラー

環境変数:
  SELECTOR_CHECK_CHANNEL  ブラウザチャネル (既定: chromium。chrome も可)
`.trim()

const EXIT_BROKEN = 1
const EXIT_UNREACHED = 2
const EXIT_ERROR = 3

const extensionPath = path.join(rootDir, 'src')
const jqueryPath = path.join(extensionPath, 'third-party', 'jquery.min.js')

/* ------------------------------------------------------------------ *
 * 一時プロファイルの後始末 (SPEC-SC-08)
 * ------------------------------------------------------------------ */

let userDataDir = null

/**
 * 一時プロファイルを使っている Chromium を確実に落とす。
 *
 * 中断時は Playwright の後始末（非同期）が終わる前にこちらが終了するため、
 * 生き残ったブラウザがプロファイルを書き戻して残骸になる。
 * `--user-data-dir` にこの実行専用の一時パスが入っているので、それを目印に落とす。
 */
const killBrowsers = () => {
  if (!userDataDir || process.platform === 'win32') return
  // pkill -f のパターンは ERE。TMPDIR にメタ文字があっても取り違えないようにエスケープする
  const pattern = userDataDir.replace(/[.[\]{}()*+?^$|\\]/g, (matched) => `\\${matched}`)
  try {
    execFileSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' })
  } catch {
    // 該当プロセスが無ければ pkill は 1 を返す。無視してよい
  }
}

/**
 * 冪等な後始末。finally / シグナル / 捕捉漏れ / exit のすべてから呼ぶ。
 * 終了しかけの Chromium がロックファイルを書き戻すことがあるので数回試す。
 */
const cleanup = () => {
  if (!userDataDir) return
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // ここでは握りつぶす。残存は最後に existsSync で検査する
    }
    if (!fs.existsSync(userDataDir)) return
  }
}

/** Enter 待ちの readline。中断時に端末のモードを戻すために保持する */
let activeInterface = null
let shuttingDown = false

/**
 * 中断時の終了処理。**シグナル経路と readline 経路の両方から呼ぶ**。
 *
 * 端末（TTY）では readline が raw モードにするため、Ctrl+C は
 * カーネルの SIGINT ではなく readline の 'SIGINT' イベントとして届く。
 * `process.on('SIGINT')` だけでは拾えず、ツールが停止しなくなる（SPEC-SC-08）。
 */
const shutdown = (label, code) => {
  if (shuttingDown) return
  shuttingDown = true
  // raw モードを解除して端末を元に戻す
  activeInterface?.close()
  finalCleanup()

  // 消せたかを確認してから報告する。消せていないなら実行エラー扱い (NFR-12)
  if (userDataDir && fs.existsSync(userDataDir)) {
    console.error(`\n❌ 一時プロファイルが削除できていません: ${userDataDir}`)
    process.exit(EXIT_ERROR)
  }

  console.log(`\n中断しました（${label}）。一時プロファイルは削除しました。`)
  process.exit(code)
}

/** ブラウザを落としてからプロファイルを消す。どの経路からでもこれを呼ぶ */
const finalCleanup = () => {
  killBrowsers()
  cleanup()
}

process.on('exit', finalCleanup)
process.on('SIGINT', () => shutdown('SIGINT', 130))
process.on('SIGTERM', () => shutdown('SIGTERM', 143))
// SIGHUP（端末を閉じる / SSH 切断）はリスナーが無いと 'exit' すら実行されずに終了する。
// ログイン済みの Cookie を抱えたプロファイルが残るため必ず捕まえる (NFR-12)
process.on('SIGHUP', () => shutdown('SIGHUP', 129))
process.on('uncaughtException', (err) => {
  finalCleanup()
  console.error(`❌ 予期しないエラー: ${sanitize(err && err.stack ? err.stack : err)}`)
  process.exit(EXIT_ERROR)
})
process.on('unhandledRejection', (err) => {
  finalCleanup()
  console.error(`❌ 未処理の Promise 例外: ${sanitize(err && err.stack ? err.stack : err)}`)
  process.exit(EXIT_ERROR)
})

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/** @param { string[] } argv */
const parseArgs = (argv) => {
  const options = { only: null, out: path.join(rootDir, 'docs', 'SELECTOR-CHECK.md'), help: false, dryRun: false }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--only' || arg === '--out') {
      throw new Error(`${arg} は = でつなげて指定します（例: ${arg}=…）`)
    } else if (arg.startsWith('--only=')) {
      options.only = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
    } else if (arg.startsWith('--out=')) {
      options.out = path.resolve(rootDir, arg.slice('--out='.length))
    } else {
      throw new Error(`知らないオプションです: ${arg}`)
    }
  }

  if (options.only) {
    const unknown = options.only.filter((key) => !siteKeys.includes(key))
    if (unknown.length > 0) {
      throw new Error(`--only の対象外の値です: ${unknown.join(', ')}（有効: ${siteKeys.join(' / ')}）`)
    }
  }

  return options
}

/** Enter が押されるまで待つ。**時間制限を設けない** (FR-15) */
const waitForEnterAsync = () => new Promise((resolve) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    // 端末での Ctrl+C を readline 経由で受けられるようにする。
    // SELECTOR_CHECK_FORCE_TERMINAL は TTY を持たない自動テストから同じ経路を通すためのもの
    terminal: process.env.SELECTOR_CHECK_FORCE_TERMINAL === '1' ? true : undefined
  })
  activeInterface = rl

  // raw モードの端末では Ctrl+C がここに来る（process の SIGINT は発生しない）
  rl.on('SIGINT', () => shutdown('SIGINT', 130))

  let done = false
  const proceed = () => {
    // 中断中は先へ進めない（`shutdown()` が rl を閉じるため 'close' がここに来る）
    if (done || shuttingDown) return
    done = true
    activeInterface = null
    rl.close()
    resolve()
  }

  // stdin が閉じている（`< /dev/null` や CI）場合は Enter を待てない。
  // 準備なしで先へ進む（ログイン不要の対象だけが実施され、他は「未実施」になる。FR-16）
  rl.on('close', () => {
    if (!done && !shuttingDown) {
      console.log('\n（stdin が閉じているため、準備なしで検証を開始します）')
    }
    proceed()
  })

  rl.question('\n準備ができたら Enter を押してください > ', proceed)
})

/**
 * 楽天証券のセッションを借用する (SPEC-SC-06 / CON-04)。
 * `.do` の直後から `?` の手前までのパスパラメータ列をそのまま取り出す。
 * **取り出した文字列は結果ファイルにも標準出力にも出さない** (SPEC-SC-14)。
 */
const borrowRakutenSession = (context) => {
  for (const page of context.pages()) {
    if (page.isClosed()) continue
    const url = page.url()
    if (!url.startsWith('https://member.rakuten-sec.co.jp/')) continue
    const matched = /\.do(;[^?#]+)/.exec(url)
    if (matched) {
      return matched[1]
    }
  }
  return null
}

/** 準備手順を表示する (SPEC-SC-07 手順3) */
const printPreparation = (scoped) => {
  console.log('\n──────── 準備 ────────')
  const steps = []
  for (const site of scoped) {
    for (const step of site.prepare ?? []) {
      steps.push(`${site.label}: ${step}`)
    }
  }
  if (steps.length === 0) {
    console.log('（ログイン不要の対象だけです。そのまま Enter を押してください）')
  } else {
    steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`))
  }
  console.log('\n  ※ ログイン操作はツールでは行いません。ID・パスワードは保存されません。')
  console.log('  ※ 用意しなかった対象は「未実施」として記録されます（破損とは区別されます）。')
  console.log('──────────────────────')
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

const runAsync = async (options) => {
  // 1. 定義の突き合わせ。ここで失敗したら結果ファイルは書かない (SPEC-SC-07 手順1)
  const resolvedSites = sites.map((site) => ({ site, resolved: new Map() }))
  for (const item of resolvedSites) {
    for (const { target, entry } of resolveSite(item.site)) {
      item.resolved.set(target.key, entry)
    }
  }

  const inScope = (site) => !options.only || options.only.includes(site.site)
  const scoped = sites.filter(inScope)

  const version = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8')).version

  // 2. 一時プロファイルでブラウザを起動する (SPEC-SC-08)
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabu-selector-check-'))

  // --dry-run: ブラウザを起動せず、準備手順の表示・Enter 待ち・後始末だけを通す。
  // 中断時の後始末（SPEC-SC-08）を自動テストから検証するための経路
  if (options.dryRun) {
    console.log(`一時プロファイル: ${userDataDir}`)
    printPreparation(scoped)
    await waitForEnterAsync()
    console.log('--dry-run のため検証は行いません。')
    return { results: [], out: options.out, dryRun: true }
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.SELECTOR_CHECK_CHANNEL || 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  })

  // Playwright はブラウザ起動時に自前の exit ハンドラを登録する。
  // その**後ろに**登録し、ブラウザを確実に落としてからプロファイルを消し直す。
  // 先に消すだけだと、終了処理中の Chromium がディレクトリを書き戻して残ることがある
  process.on('exit', finalCleanup)

  const results = []
  let browserVersion = '不明'

  try {
    // 対象ごとの Playwright 操作にはタイムアウトを設ける（Enter 待ちだけは無制限。SPEC-SC-07）
    context.setDefaultTimeout(15000)

    browserVersion = context.browser()?.version() ?? '不明'

    // jQuery 独自セレクタを評価するため、同梱 jQuery を全ページに入れる (SPEC-SC-09)
    await context.addInitScript({ content: createBootstrapScript(fs.readFileSync(jqueryPath, 'utf8')) })

    // 初期ページは初期化スクリプトの登録前に生成されており jQuery が入らない。
    // 作り直してから閉じる（利用者が誤って使わないように）
    const workPage = await context.newPage()
    for (const page of context.pages()) {
      if (page !== workPage) await page.close()
    }

    // 3. 準備手順の提示とログインタブの用意
    printPreparation(scoped)
    for (const site of scoped) {
      if (!site.login) continue
      const page = await context.newPage()
      try {
        await page.goto(site.login, { waitUntil: 'domcontentloaded' })
      } catch {
        console.log(`  （${site.label} のログインページを開けませんでした。手で開いてください）`)
      }
    }

    // 4-5. 人がログインし、Enter を押す
    await waitForEnterAsync()

    const session = borrowRakutenSession(context)

    // 6. 対象を上から順に検証する。失敗しても次へ進む (FR-15)
    for (const { site, resolved } of resolvedSites) {
      const targets = resolveSite(site)

      if (!inScope(site)) {
        targets.forEach(({ target, entry }) => results.push(createSkippedResult(site, target, entry, '`--only` の対象外')))
        continue
      }

      if (site.site === 'rakuten' && !session) {
        // 対象外は未実施に混ぜない（結果ファイルと同じ数え方にする）
        const willSkip = targets.filter(({ target }) => !target.excluded).length
        console.log(`\n楽天証券: ログイン済みのタブが見つかりません → ${willSkip} 対象は未実施にします`)
        targets.forEach(({ target, entry }) => results.push(createSkippedResult(site, target, entry, '楽天証券にログインしていない')))
        continue
      }

      console.log(`\n▶ ${site.label}（${targets.length} 対象）`)
      const runner = { context, page: workPage, lastFrame: null, session }
      const siteResults = []

      for (const { target, entry } of targets) {
        const result = await checkTargetAsync(runner, site, target, entry, resolved)
        siteResults.push(result)
        console.log(`   ${symbolOf(result.status)} ${result.title}`)
      }

      if (site.site === 'tradingview') {
        await finishTradingViewAsync(runner, resolved, siteResults)
      }

      results.push(...siteResults)
    }

    // 7. 結果ファイルを上書き生成する
    const report = renderReport({
      generatedAt: new Date(),
      version,
      browserVersion,
      sites,
      results
    })
    fs.writeFileSync(options.out, report, 'utf8')
  } finally {
    // 8. ブラウザを閉じる（プロファイル削除は呼び出し元の finally で行う）
    await context.close().catch(() => {})
  }

  return { results, out: options.out }
}

const symbolOf = (status) => ({ [OK]: '✅', [BROKEN]: '❌', [UNREACHED]: '⚠️', [SKIPPED]: '—', [EXCLUDED]: '👤' })[status]

/* ------------------------------------------------------------------ *
 * エントリポイント
 * ------------------------------------------------------------------ */

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (err) {
  console.error(`❌ ${err.message}\n`)
  console.error(USAGE)
  process.exit(EXIT_ERROR)
}

if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

let exitCode = 0
try {
  const { results, out, dryRun } = await runAsync(options)

  if (dryRun) {
    console.log('（--dry-run: 結果ファイルは書き出していません）')
  }

  const broken = results.filter((r) => r.status === BROKEN).length
  const unreached = results.filter((r) => r.status === UNREACHED).length
  const skipped = results.filter((r) => r.status === SKIPPED).length
  // 対象外は終了コードにも判定の件数にも効かせない
  const excluded = results.filter((r) => r.status === EXCLUDED).length

  if (!dryRun) {
    console.log(`\n❌ 破損 ${broken} 件 / ⚠️ 未到達 ${unreached} 件 / — 未実施 ${skipped} 件 / 👤 対象外 ${excluded} 件 → ${path.relative(rootDir, out)}`)
  }

  if (broken > 0) {
    exitCode = EXIT_BROKEN
  } else if (unreached > 0) {
    exitCode = EXIT_UNREACHED
  }
} catch (err) {
  console.error(`❌ 実行できませんでした: ${sanitize(err.message)}`)
  exitCode = EXIT_ERROR
} finally {
  finalCleanup()
}

// 一時プロファイルが残っていないことを確認する (SPEC-SC-08 / NFR-12)
if (userDataDir && fs.existsSync(userDataDir)) {
  console.error(`❌ 一時プロファイルが削除できていません: ${userDataDir}`)
  exitCode = EXIT_ERROR
}

process.exit(exitCode)

/**
 * セレクタ定義の整合性 (SPEC-SC-16)。
 *
 * ブラウザを起動しない。`npm run check:selectors` が
 * `src/*-cs.js` の `menuSelectors` を唯一の情報源にできる状態を機械的に守る (NFR-13)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { lint } from 'markdownlint-cli2/markdownlint/promise'
import jsoncParse from 'markdownlint-cli2/parsers/jsonc'
import { loadMenuSelectors, indexByKey, resolveSite, rootDir } from '../scripts/selector-check/load-selectors.mjs'
import { sites } from '../scripts/selector-check/targets.mjs'
import { checkTargetAsync, BROKEN, UNREACHED } from '../scripts/selector-check/check.mjs'
import {
  planPrefixTracking,
  summarizeTracking,
  describeElement,
  describeElements,
  isSuspiciousToken,
  formatTitle,
  judgeReach,
  decideReach,
  sanitize,
  URL_PLACEHOLDER,
  MAX_STAGES,
  MAX_TOKEN,
  MAX_TEXT,
  TITLE_EMPTY,
  TITLE_WITHHELD,
  TOKEN_WITHHELD,
  TRACKING_UNAVAILABLE,
  REACH_NOT_EVALUATED,
  REACH_NOT_CONSULTED,
  REACH_REACHED,
  REACH_UNREACHED,
  REACH_UNKNOWN
} from '../scripts/selector-check/diagnostics.mjs'
import { renderReport } from '../scripts/selector-check/report.mjs'

// 各 Content Script が持つべき検出用セレクタの件数
const EXPECTED_COUNTS = {
  'src/rakuten-cs.js': 12,
  'src/rakuten-scr-cs.js': 1,
  'src/sbi-cs.js': 2,
  'src/sbi-scr-cs.js': 1,
  'src/tradingview-cs.js': 4
}

test.describe('セレクタ定義', () => {
  test('5本の Content Script すべてから menuSelectors を取り出せる', () => {
    const sources = sites.map((site) => site.source)
    expect(sources.slice().sort()).toEqual(Object.keys(EXPECTED_COUNTS).slice().sort())

    for (const [source, count] of Object.entries(EXPECTED_COUNTS)) {
      const entries = loadMenuSelectors(source)
      expect(entries, source).toHaveLength(count)
    }
  })

  test('全エントリが文字列の title と selector を持つ', () => {
    for (const source of Object.keys(EXPECTED_COUNTS)) {
      for (const entry of loadMenuSelectors(source)) {
        expect(typeof entry.title, `${source} の title`).toBe('string')
        expect(entry.title.length, `${source} の title`).toBeGreaterThan(0)
        expect(typeof entry.selector, `${source}: ${entry.title} の selector`).toBe('string')
        expect(entry.selector.trim().length, `${source}: ${entry.title} の selector`).toBeGreaterThan(0)
      }
    }
  })

  test('楽天証券は url を、TradingView は key を持つ', () => {
    for (const entry of loadMenuSelectors('src/rakuten-cs.js')) {
      // 楽天証券は URL 部分一致で適用ページを絞る (SPEC-CS-07)。
      // 検証ツールはこの値から遷移先 URL を組み立てる (SPEC-SC-06)
      expect(typeof entry.url, `楽天証券: ${entry.title}`).toBe('string')
      expect(entry.url.startsWith('/app/'), `楽天証券: ${entry.title}`).toBe(true)
    }

    for (const entry of loadMenuSelectors('src/tradingview-cs.js')) {
      // TradingView は title が日本語のため key で引く (SPEC-CS-15)
      expect(typeof entry.key, `TradingView: ${entry.title}`).toBe('string')
      expect(entry.key.length, `TradingView: ${entry.title}`).toBeGreaterThan(0)
    }
  })

  test('targets.mjs と menuSelectors が key ?? title で1対1に対応する', () => {
    for (const site of sites) {
      const entries = indexByKey(loadMenuSelectors(site.source))
      const wanted = site.targets.map((target) => target.key)

      expect(wanted.slice().sort(), `${site.label} の対象`).toEqual([...entries.keys()].sort())
      expect(new Set(wanted).size, `${site.label} の対象の重複`).toBe(wanted.length)
    }
  })

  test('targets.mjs のどの対象も selector フィールドを持たない', () => {
    for (const site of sites) {
      expect(Object.keys(site), `${site.label}`).not.toContain('selector')
      for (const target of site.targets) {
        expect(Object.keys(target), `${site.label}: ${target.key}`).not.toContain('selector')
      }
    }
  })

  // --- CON-11 のガード（SPEC-CS-21 の G1・G2） -----------------------------
  // 他の拡張機能が `<body>` / `<html>` に付けるクラスを検出用セレクタに取り込むと、
  // その拡張を入れていない環境では常に 0 件になる（`body.vsc-initialized` の実例）。
  // 画面上は「何も起きない」だけで気づけないため、ここで機械的に止める。

  test('どの検出用セレクタも body / html を起点にしない', () => {
    // 起点の判定。カンマ区切りの断片ごとに先頭トークンを見る
    const startsAtRoot = /^\s*(body|html)\b/i
    // 起点でなくても `body.foo` / `html[dir]` のように条件を付けた時点で同じ危険がある
    const qualifiedRoot = /(^|[\s>+~,(])(body|html)[.#[:]/i

    for (const site of sites) {
      for (const entry of loadMenuSelectors(site.source)) {
        const where = `${site.source}: ${entry.title}`
        for (const fragment of entry.selector.split(',')) {
          expect(startsAtRoot.test(fragment), `${where} の断片 "${fragment.trim()}"`).toBe(false)
        }
        expect(qualifiedRoot.test(entry.selector), `${where}`).toBe(false)
      }
    }
  })

  test('どの検出用セレクタにも既知の他拡張クラスが現れない', () => {
    // 名前の列挙は原理的に網羅できない。上の G1（位置で弾く）の補助として置く。
    // 実例を観測したらここに足す
    const FOREIGN_EXTENSION_CLASSES = [
      'vsc-initialized', // Video Speed Controller（実際に混入していた）
      'grammarly-', // Grammarly
      'gsc-', // Google 系ウィジェット
      '__web-inspector', // DevTools 系
      'translated-ltr', // Google 翻訳
      'translated-rtl', // Google 翻訳
      'darkreader' // Dark Reader
    ]

    for (const site of sites) {
      for (const entry of loadMenuSelectors(site.source)) {
        for (const name of FOREIGN_EXTENSION_CLASSES) {
          expect(entry.selector.toLowerCase(), `${site.source}: ${entry.title}`).not.toContain(name)
        }
      }
    }
  })
})

/**
 * 中断時の後始末 (SPEC-SC-08)。
 *
 * `--dry-run` でブラウザを起動せずに Enter 待ちまで進め、そこへ割り込みを入れる。
 * 端末（TTY）では Ctrl+C が readline の 'SIGINT' イベントとして届き、
 * `process.on('SIGINT')` には流れない。TTY を用意できないので
 * `SELECTOR_CHECK_FORCE_TERMINAL=1` で readline を terminal モードにし、
 * stdin に `\x03`（Ctrl+C）を書いて同じ経路を通す。
 */
test.describe('検証ツールの中断', () => {
  const cliPath = path.join(rootDir, 'scripts', 'selector-check', 'index.mjs')

  /**
   * `--dry-run` で起動し、Enter 待ちになったところで interrupt を実行する。
   * @param { (child: import('node:child_process').ChildProcess) => void } interrupt
   * @param { boolean } forceTerminal
   */
  const interruptAsync = (interrupt, forceTerminal = false) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, '--dry-run', '--only=tradingview'], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: forceTerminal ? { ...process.env, SELECTOR_CHECK_FORCE_TERMINAL: '1' } : process.env
    })

    let out = ''
    let fired = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`中断できずタイムアウトした: ${out}`))
    }, 15000)

    child.stdout.on('data', (chunk) => {
      out += chunk
      // 一時プロファイルの生成と Enter 待ちが揃ってから割り込む
      if (!fired && out.includes('一時プロファイル: ') && out.includes('準備ができたら')) {
        fired = true
        setTimeout(() => interrupt(child), 100)
      }
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      const dir = /一時プロファイル: (\S+)/.exec(out)?.[1]
      resolve({ code, dir, out })
    })
  })

  test('SIGINT で終了コード 130 になり一時プロファイルが残らない', async () => {
    const { code, dir } = await interruptAsync((child) => child.kill('SIGINT'))
    expect(dir).toBeTruthy()
    expect(code).toBe(130)
    expect(fs.existsSync(dir)).toBe(false)
  })

  test('SIGTERM で終了コード 143 になり一時プロファイルが残らない', async () => {
    const { code, dir } = await interruptAsync((child) => child.kill('SIGTERM'))
    expect(dir).toBeTruthy()
    expect(code).toBe(143)
    expect(fs.existsSync(dir)).toBe(false)
  })

  test('SIGHUP で終了コード 129 になり一時プロファイルが残らない', async () => {
    // SIGHUP はリスナーが無いと process.on('exit') すら実行されずに終了する。
    // 端末を閉じた / SSH が切れた場合にログイン済みプロファイルを残さないための固定 (NFR-12)
    const { code, dir } = await interruptAsync((child) => child.kill('SIGHUP'))
    expect(dir).toBeTruthy()
    expect(code).toBe(129)
    expect(fs.existsSync(dir)).toBe(false)
  })

  test('端末での Ctrl+C（readline 経由）でも一時プロファイルが残らない', async () => {
    // \x03 は Ctrl+C。terminal モードの readline はこれを 'SIGINT' イベントにする
    const { code, dir } = await interruptAsync((child) => child.stdin.write('\x03'), true)
    expect(dir).toBeTruthy()
    expect(code).toBe(130)
    expect(fs.existsSync(dir)).toBe(false)
  })
})

/**
 * ⚠️/❌ の手がかり (SPEC-SC-20, 21, 22, 23)。
 *
 * `diagnostics.mjs` / `report.mjs` の純関数だけを検査する。ブラウザは起動しない。
 * ページ側は生の値（タグ名・`id`・`class` の配列）を返し、
 * 整形・切り詰め・消毒は Node 側で行う分担になっているからテストできる。
 */

/** 手がかり節の検査に使う結果の雛形（`checkTargetAsync` が返す形） */
const baseResult = {
  site: 'rakuten',
  siteLabel: '楽天証券',
  key: '国内株式・株価検索',
  title: '国内株式・株価検索',
  selector: 'div#line1 h1.hdg-l1-01-title span:first',
  status: 'ok',
  reason: '',
  pageHits: 1,
  hits: 1,
  injectedHits: 0,
  notes: [],
  diagnostics: null
}

/** `renderReport()` の入力を1件分だけ組み立てる */
const reportInput = (results) => ({
  generatedAt: new Date('2026-08-23T12:00:00Z'),
  version: '1.12.0',
  browserVersion: '141.0.0.0',
  sites: [{ site: 'rakuten', label: '楽天証券' }],
  results
})

test.describe('手がかり', () => {
  test('セレクタを子孫結合子で分割し > + ~ を後続トークンと結合する', () => {
    const plan = planPrefixTracking('div#table_possess_data table.tbl-bold-border tr > td:contains("国内 株式") + td')

    expect(plan.mode).toBe('prefix')
    expect(plan.omitted).toBe(false)
    // 結合子は単独の段階にしない。クォート内の空白では切らない
    expect(plan.stages).toEqual([
      'div#table_possess_data',
      'div#table_possess_data table.tbl-bold-border',
      'div#table_possess_data table.tbl-bold-border tr',
      'div#table_possess_data table.tbl-bold-border tr > td:contains("国内 株式")',
      'div#table_possess_data table.tbl-bold-border tr > td:contains("国内 株式") + td'
    ])

    // 属性セレクタの中の空白でも切らない
    expect(planPrefixTracking('div.chart-gui-wrapper canvas[aria-hidden!="true"]').stages).toEqual([
      'div.chart-gui-wrapper',
      'div.chart-gui-wrapper canvas[aria-hidden!="true"]'
    ])

    // 段階は 12 まで。超えた分は出さずに omitted で知らせる
    const long = planPrefixTracking(Array.from({ length: 15 }, (_, i) => `div.d${i}`).join(' '))
    expect(long.stages).toHaveLength(MAX_STAGES)
    expect(long.omitted).toBe(true)
  })

  test('カンマを含むセレクタは分割しない', () => {
    const selector = `div#daily-ranking table.tbl-data-01 tr td.align-C,
                      div#weekly-ranking table.tbl-data-01 tr td.align-C`
    const plan = planPrefixTracking(selector)

    expect(plan.mode).toBe('fragments')
    // 断片ごとに「全体の」セレクタが残る（プレフィックスに刻まない）
    expect(plan.stages).toEqual([
      'div#daily-ranking table.tbl-data-01 tr td.align-C',
      'div#weekly-ranking table.tbl-data-01 tr td.align-C'
    ])
    expect(summarizeTracking(plan, [])).toBe('カンマを含むため分割しない（断片ごとの件数は下記）')

    // プレフィックス追跡の要約は「どこで 0 件になったか」を1行で示す
    const prefixPlan = planPrefixTracking('div#line1 h1.hdg-l1-01-title span:first')
    expect(summarizeTracking(prefixPlan, [
      { selector: 'div#line1', hits: 1 },
      { selector: 'div#line1 h1.hdg-l1-01-title', hits: 0 }
    ])).toBe('`div#line1` まで 1 件 → `div#line1 h1.hdg-l1-01-title` で 0 件')
    expect(summarizeTracking(prefixPlan, [{ selector: 'div#line1', hits: 0 }]))
      .toBe('先頭の `div#line1` が 0 件')
    expect(summarizeTracking(prefixPlan, [{ selector: 'div#line1', hits: 1 }]))
      .toBe('全段階がヒットする（件数の内訳は下記）')
  })

  test('要素の記述子が tag#id.class 形式になり件数・文字数で切られる', () => {
    expect(describeElement({ tag: 'DIV', id: 'str-main-inner', classes: ['mbody', 'pcOnly'] }))
      .toBe('div#str-main-inner.mbody.pcOnly')
    expect(describeElement({ tag: 'section', id: '', classes: [] })).toBe('section')

    // class は先頭 5 個まで
    const many = describeElement({ tag: 'div', id: '', classes: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(many).toBe('div.a.b.c.d.e')

    // id・class は各 40 文字、全体は 120 文字で切る
    // （長い英数字列そのものはセッションIDとみなして伏せるため、区切りを挟んだ名前で試す）
    const longId = 'idpart-'.repeat(10).slice(0, 60)
    const longClass = 'clspart-'.repeat(10).slice(0, 60)
    const long = describeElement({
      tag: 'div',
      id: longId,
      classes: Array.from({ length: 5 }, () => longClass)
    })
    expect(long).toHaveLength(MAX_TEXT)
    expect(long.startsWith(`div#${longId.slice(0, MAX_TOKEN)}.${longClass.slice(0, MAX_TOKEN)}`)).toBe(true)

    // 文書順の先頭 5 件だけを記述子にする
    const list = Array.from({ length: 8 }, (_, i) => ({ tag: 'div', id: `d${i}`, classes: [] }))
    expect(describeElements(list)).toEqual(['div#d0', 'div#d1', 'div#d2', 'div#d3', 'div#d4'])
  })

  test('記述子の id・class もセッション情報らしければトークン単位で伏せる', () => {
    // id にセッションパラメータ名が混ざる形（BroadVision 系で原理的にありうる）
    expect(describeElement({ tag: 'div', id: 'form_BV_SessionID_kJqRnB', classes: [] }))
      .toBe(`div#${TOKEN_WITHHELD}`)

    // 40 文字で切っても 40 文字分が残ってしまうため、切り詰めではなく丸ごと伏せる
    const longSession = `sid${'A1b2C3d4E5'.repeat(6)}`
    expect(describeElement({ tag: 'div', id: longSession, classes: [] }))
      .toBe(`div#${TOKEN_WITHHELD}`)

    // 当たったトークンだけを伏せ、他は手がかりとして残す
    expect(describeElement({
      tag: 'div',
      id: 'str-main-inner',
      classes: ['mbody', '550e8400-e29b-41d4-a716-446655440000', 'pcOnly']
    })).toBe(`div#str-main-inner.mbody.${TOKEN_WITHHELD}.pcOnly`)

    // タグ名は div / table などしか来ないので伏せ字にしない
    expect(describeElement({ tag: 'table', id: '', classes: [] })).toBe('table')

    // 対象サイトで実際に使っている id・class は伏せない（伏せすぎると手がかりにならない）
    const real = [
      { tag: 'div', id: 'str-main-inner', classes: ['mbody'] },
      { tag: 'div', id: 'margin-oneday-ranking', classes: ['tbl-data-01', 'tbl-bold-border'] },
      { tag: 'div', id: 'table_possess_data', classes: ['pagenavcontrolbox', 'ResultListMainDiv'] },
      { tag: 'div', id: 'overlap-manager-root', classes: ['container-OH8c8Nc3', 'chart-gui-wrapper'] }
    ]
    for (const raw of real) {
      expect(describeElement(raw), JSON.stringify(raw)).not.toContain(TOKEN_WITHHELD)
    }
  })

  test('題名にセッションID様・クエリ様・長い英数字列・URL が含まれると記録しない', () => {
    const suspicious = [
      '楽天証券 https://member.rakuten-sec.co.jp/app/',
      '楽天証券;BV_SessionID=abc',
      '楽天証券｜info.do?eventType=init',
      `楽天証券 ${'A1b2C3d4E5f6G7h8I9j0'}`,
      // UUID 形はハイフンで切れるため 20 文字以上の英数字列の判定には当たらない
      '楽天証券 550e8400-e29b-41d4-a716-446655440000'
    ]
    for (const title of suspicious) {
      expect(isSuspiciousToken(title), title).toBe(true)
      expect(formatTitle(title), title).toBe(TITLE_WITHHELD)
    }
  })

  test('通常の題名は 120 文字までそのまま記録する', () => {
    expect(isSuspiciousToken('楽天証券｜国内株式・株価検索')).toBe(false)
    expect(formatTitle('楽天証券｜国内株式・株価検索')).toBe('楽天証券｜国内株式・株価検索')
    // 前後の空白は畳み、120 文字で切る
    expect(formatTitle('  SBI証券｜株式・投資信託  ')).toBe('SBI証券｜株式・投資信託')
    expect(formatTitle('あ'.repeat(200))).toHaveLength(MAX_TEXT)
    expect(formatTitle('')).toBe('（題名なし）')
  })

  test('正常の対象には手がかり節を出さない', () => {
    const report = renderReport(reportInput([{ ...baseResult, status: 'ok', pageHits: 1, hits: 3 }]))

    expect(report).not.toContain('の手がかり')
    expect(report).not.toContain('プレフィックス追跡')
  })

  test('未到達・破損の対象には手がかり節を出す', () => {
    const report = renderReport(reportInput([{
      ...baseResult,
      status: 'unreached',
      pageHits: 0,
      hits: 0,
      notes: ['先頭の `div#line1` が 0 件'],
      diagnostics: {
        // 目印1（`/^エラー(\s|[|｜]|$)/`）に当たる実測値。判定は実装と揃える（SPEC-SC-23 / 24）
        title: 'エラー | 楽天証券[PC]',
        reach: REACH_UNREACHED,
        headings: ['h1#logo'],
        containers: ['div#str-header', 'div#str-main'],
        tracking: {
          source: 'ページ識別セレクタ',
          mode: 'prefix',
          rows: [{ selector: 'div#line1', hits: 0 }],
          omitted: false,
          unavailable: null
        }
      }
    }]))

    expect(report).toContain('### 国内株式・株価検索の手がかり')
    // セル内の `|` は `\|` に置き換えて出る（report.mjs の cell()）
    expect(report).toContain('| 到達先の題名 | エラー \\| 楽天証券[PC] |')
    expect(report).toContain('| 見出し | `h1#logo` |')
    expect(report).toContain('| 主要コンテナ | `div#str-header`, `div#str-main` |')
    expect(report).toContain('プレフィックス追跡（ページ識別セレクタ）')
    expect(report).toContain('| 1 | `div#line1` | 0 |')
    // 要約は結果表の備考にも出る
    expect(report).toContain('先頭の `div#line1` が 0 件')

    // 見出し・主要コンテナが空でも行ごと省かない（0件であること自体が手がかり）
    const empty = renderReport(reportInput([{
      ...baseResult,
      status: 'broken',
      pageHits: 1,
      hits: 0,
      diagnostics: {
        title: TITLE_WITHHELD,
        // 識別が 1 件ヒットしているので、実装は題名を見ない (SPEC-SC-24 の条件2)
        reach: REACH_NOT_CONSULTED,
        headings: [],
        containers: [],
        tracking: {
          source: '検出用セレクタ',
          mode: 'prefix',
          rows: [],
          omitted: false,
          unavailable: TRACKING_UNAVAILABLE
        }
      }
    }]))

    expect(empty).toContain('| 見出し | （0件） |')
    expect(empty).toContain('| 主要コンテナ | （0件） |')
    expect(empty).toContain(TITLE_WITHHELD)
    expect(empty).toContain(TRACKING_UNAVAILABLE)
  })

  // --- 到達判定 (SPEC-SC-24 / FR-22) --------------------------------------

  test('judgeReach() が 2026-08-23 の実データを分ける', () => {
    // 実データ: ツールがエラー画面に飛ばされた4ページ（⚠️ のまま）
    expect(judgeReach('エラー | 楽天証券[PC]'))
      .toEqual({ reached: false, reason: REACH_UNREACHED })

    // 実データ: 到達できているのに ⚠️ になっていたページ（⚠️ → ❌ に再分類される）
    expect(judgeReach('国内株式トップ | 株価検索 | 国内株式トップ | 国内株式 | 楽天証券[PC]'))
      .toEqual({ reached: true, reason: REACH_REACHED })

    // 実データ: SBI証券のポートフォリオ
    expect(judgeReach('ポートフォリオ｜SBI証券').reached).toBe(true)

    // 未観測の備え（ログイン画面・メンテナンス・英語 UI）
    expect(judgeReach('ログイン｜楽天証券').reached).toBe(false)
    expect(judgeReach('システムメンテナンスのお知らせ').reached).toBe(false)
    expect(judgeReach('Sign in — TradingView').reached).toBe(false)

    // 目印は前方一致で見る。語を含むだけの正常な題名を未到達にしない
    expect(judgeReach('エラーコードの調べ方｜楽天証券').reached).toBe(true)
    expect(judgeReach('ログイン履歴｜SBI証券').reached).toBe(true)
  })

  test('題名が空・不記録のときは到達とみなさない', () => {
    // 「反証が無い」のではなく「判断材料が無い」ので ⚠️ のままにする (ADR-0006 の 2)
    for (const title of [TITLE_EMPTY, TITLE_WITHHELD, '', '   ']) {
      expect(judgeReach(title), JSON.stringify(title))
        .toEqual({ reached: false, reason: REACH_UNKNOWN })
    }

    // formatTitle() の出力をそのまま渡しても同じ結論になる
    expect(judgeReach(formatTitle('')).reached).toBe(false)
    expect(judgeReach(formatTitle('楽天証券;BV_SessionID=abc')))
      .toEqual({ reached: false, reason: REACH_UNKNOWN })
  })

  test('decideReach() が5値を返し分ける', () => {
    const reached = '国内株式トップ | 株価検索 | 楽天証券[PC]'

    // 1. 件数を数えられなかった（検証用 jQuery 未注入・セレクタ評価の例外）。
    //    ここが「識別セレクタがヒットした」と出ていたのが 1.12.2 の誤り (ADR-0006 の 6-1)
    for (const counts of [
      { pageHits: null, hits: null },   // 遷移前に評価できなかった
      { pageHits: 0, hits: null },      // 識別は数えられたが検出用の評価で例外
      { pageHits: null, hits: 0 },      // 識別の評価で例外
      { pageHits: undefined, hits: 0 },
      { pageHits: 0, hits: Number.NaN },
      { pageHits: '0', hits: 0 }        // 数値でなければ件数として扱わない
    ]) {
      const decided = decideReach({ ...counts, title: reached })
      expect(decided, JSON.stringify(counts)).toEqual({ reclassify: false, reason: REACH_NOT_EVALUATED })
      // 事実に反する文言（識別がヒットした）を出さない
      expect(decided.reason).not.toBe(REACH_NOT_CONSULTED)
    }

    // 2. 両方が数値で、どちらかが 1 件以上 → 題名を見ない
    for (const counts of [
      { pageHits: 1, hits: 1 },   // ✅
      { pageHits: 1, hits: 0 },   // ❌（識別はヒットした）
      { pageHits: 0, hits: 24 }   // 識別セレクタが誤っている (SPEC-SC-05)
    ]) {
      expect(decideReach({ ...counts, title: reached }), JSON.stringify(counts))
        .toEqual({ reclassify: false, reason: REACH_NOT_CONSULTED })
    }

    // 3. ともに 0 件で、どの目印にも当たらない → ⚠️ → ❌ に再分類する（ここだけ true）
    expect(decideReach({ pageHits: 0, hits: 0, title: reached }))
      .toEqual({ reclassify: true, reason: REACH_REACHED })

    // 4. ともに 0 件で、目印に当たった → ⚠️ のまま
    expect(decideReach({ pageHits: 0, hits: 0, title: 'エラー | 楽天証券[PC]' }))
      .toEqual({ reclassify: false, reason: REACH_UNREACHED })

    // 5. ともに 0 件で、題名が空・不記録 → 判断材料が無いので ⚠️ のまま
    for (const title of [TITLE_EMPTY, TITLE_WITHHELD, '']) {
      expect(decideReach({ pageHits: 0, hits: 0, title }), JSON.stringify(title))
        .toEqual({ reclassify: false, reason: REACH_UNKNOWN })
    }

    // 5値がすべて別の文言であること（読み手が区別できる）
    expect(new Set([REACH_NOT_EVALUATED, REACH_NOT_CONSULTED, REACH_REACHED, REACH_UNREACHED, REACH_UNKNOWN]).size)
      .toBe(5)
  })

  // 再分類の配線 (SPEC-SC-24)。`decideReach()` の判断ではなく
  // 「呼ばれた時点の記号」で再分類が起きるかを、`checkTargetAsync()` を通して確かめる。
  // ブラウザは使わず、Playwright の Frame を模したスタブを渡す

  /**
   * Frame のスタブ。`evaluate(fn, arg)` を **引数の形** で分岐する。
   * - 文字列 → セレクタの件数（`countAsync` / `countStageAsync`）
   * - `{ ignoredTags }` → 題名・見出し・主要コンテナ（`collectRawAsync`）
   *
   * `jqueryMissing: true` は検証用 jQuery が入っていないフレームを模す。
   * 件数を数える経路だけが `{ missing: true }` を返し、題名の採取（素の DOM API）は成立する
   * ＝実サイトで `addInitScript` の効かないフレームを踏んだときと同じ観測になる。
   * @param { { hits: Record<string, number>, title: string, throwOn?: string, jqueryMissing?: boolean } } stub
   */
  const stubFrame = ({ hits, title, throwOn, jqueryMissing }) => ({
    evaluate: async (_fn, arg) => {
      if (arg && typeof arg === 'object') {
        return { title, headings: [], containers: [] }
      }
      if (jqueryMissing) {
        return { missing: true }
      }
      if (arg === throwOn) {
        return { error: 'Syntax error, unrecognized expression' }
      }
      return { count: hits[arg] ?? 0 }
    }
  })

  /** 楽天証券の1対象を、リポジトリの実データ（targets.mjs + menuSelectors）のまま検証に流す */
  const runTargetAsync = async (stub) => {
    const site = sites.find((item) => item.site === 'rakuten')
    const { target, entry } = resolveSite(site).find((item) => item.target.key === '国内株式・個別銘柄')
    const frame = stubFrame(stub)
    const runner = {
      page: { waitForTimeout: async () => {} },
      // reach を 'after' に差し替えて遷移を省く。判定の配線はそのまま通る
      lastFrame: frame,
      session: ''
    }
    return {
      entry,
      result: await checkTargetAsync(runner, site, { ...target, reach: 'after' }, entry, new Map())
    }
  }

  const RECLASSIFIED_NOTE = 'ページ識別セレクタは 0 件だが、題名から到達と判断した'

  test('識別・検出がともに 0 件の ⚠️ は題名から ❌ に再分類され、根拠が1行付く', async () => {
    const { entry, result } = await runTargetAsync({
      hits: {},   // 識別・検出・注入すべて 0 件
      title: '国内株式トップ | 株価検索 | 楽天証券[PC]'
    })

    expect(result.status).toBe(BROKEN)
    expect(result.pageHits).toBe(0)
    expect(result.hits).toBe(0)
    expect(result.diagnostics.reach).toBe(REACH_REACHED)
    expect(result.notes).toContain(RECLASSIFIED_NOTE)
    // 再分類後は検出用セレクタを追う (SPEC-SC-21)
    expect(result.diagnostics.tracking.source).toBe('検出用セレクタ')
    expect(entry.selector).toContain('div#line1')
  })

  test('セレクタ評価の例外で ❌ になった対象には再分類の根拠を付けない', async () => {
    // 識別・検出は 0 件で数えられたが、注入の評価で例外 → judge() を通らずに ❌ になる経路。
    // `pageHits` / `hits` が 0 のまま残るため decideReach() は条件3（再分類）を返すが、
    // 呼ばれた時点で ⚠️ ではないので **何も再分類していない**。根拠の1行を付けてはならない
    const { result } = await runTargetAsync({
      hits: {},
      title: '国内株式トップ | 株価検索 | 楽天証券[PC]',
      throwOn: 'span.x-kabu-root'
    })

    expect(result.status).toBe(BROKEN)
    expect(result.status).not.toBe(UNREACHED)
    expect(result.pageHits).toBe(0)
    expect(result.hits).toBe(0)
    expect(result.injectedHits).toBeNull()
    expect(result.reason).toBe('セレクタの評価に失敗した')
    expect(result.notes).not.toContain(RECLASSIFIED_NOTE)
    // 例外由来の ❌ は「接頭辞の無い消毒済み例外メッセージ」で他の2経路と読み分ける (ADR-0006 の 6-4)。
    // 接頭辞が付くと読み分けが成り立たなくなるため、要素の完全一致で固定する
    expect(result.notes).toContain('Syntax error, unrecognized expression')
  })

  test('検証用 jQuery が未注入の対象は ⚠️ のままで、❌ の読み分けを壊さない', async () => {
    // ADR-0006 の 6-4：❌ の経路（`judge()` / 再分類 / セレクタ評価の例外）は
    // **備考に接頭辞なしの例外メッセージが載るか**で読み分ける。
    // 接頭辞なしで積まれるメッセージはもう1つ（`検証用 jQuery が注入されていない`）あり、
    // その読み分けは「こちらは必ず ⚠️ に落ちて ❌ の行には現れない」ことに依存している。
    // 未注入では件数を数え切れないため `decideReach()` の条件1（`REACH_NOT_EVALUATED`）に落ち、
    // 再分類されない ── この性質が破れたら 6-4 の (a) は成り立たず (b) を採り直す判断が要る
    const { result } = await runTargetAsync({
      hits: {},
      // 題名は正常なページのもの。題名だけ見れば「到達」だが、件数が無いので判断に使わない
      title: '国内株式トップ | 株価検索 | 楽天証券[PC]',
      jqueryMissing: true
    })

    // セレクタ破損（❌）ではなく未到達（⚠️）に落ちる (SPEC-SC-09)
    expect(result.status).toBe(UNREACHED)
    expect(result.status).not.toBe(BROKEN)
    expect(result.reason).toBe('検証できなかった')

    // 件数を1つも数え切れていない = `decideReach()` の条件1
    expect(result.pageHits).toBeNull()
    expect(result.hits).toBeNull()
    expect(result.injectedHits).toBeNull()
    expect(result.diagnostics.reach).toBe(REACH_NOT_EVALUATED)
    // 題名を見た他の文言に化けていないこと（事実に反する根拠を出さない。ADR-0006 の 6-1）
    expect(result.diagnostics.reach).not.toBe(REACH_REACHED)
    expect(result.diagnostics.reach).not.toBe(REACH_NOT_CONSULTED)

    // 備考には接頭辞の無い例外メッセージがそのまま載る（要素の完全一致で固定する）
    expect(result.notes).toContain('検証用 jQuery が注入されていない')
    // 再分類は起きていないので根拠の1行は付かない
    expect(result.notes).not.toContain(RECLASSIFIED_NOTE)

    // 追跡も未注入で行えないが、こちらは専用の固定文言なので読み分けの目印を汚さない
    expect(result.notes).toContain(TRACKING_UNAVAILABLE)
    // ⚠️ の対象はページ識別セレクタを追う (SPEC-SC-21)
    expect(result.diagnostics.tracking.source).toBe('ページ識別セレクタ')
  })
})

/**
 * 結果ファイルの書式 (SPEC-SC-13, 14)。
 *
 * `npm run check:selectors` の生成物 `docs/SELECTOR-CHECK.md` は `lint:md` の対象。
 * 生成物が markdownlint に落ちると、検証を走らせた直後に `npm run check` が
 * 落ちてコミットゲートで詰まる。生成側の消毒がそれを起こさないことを固定する。
 */
test.describe('結果ファイルの書式', () => {
  /** `.markdownlint-cli2.jsonc` を唯一の情報源にする（設定を二重管理しない） */
  const markdownlintConfig = () => jsoncParse(
    fs.readFileSync(path.join(rootDir, '.markdownlint-cli2.jsonc'), 'utf8')
  ).config

  test('消毒した URL・伏せ字を含む結果ファイルがインライン HTML を漏らさない', async () => {
    // Playwright の page.goto / jQuery のセレクタ例外は、失敗メッセージに URL を含むのが普通。
    // これらは check.mjs / diagnostics.mjs で sanitize() を通ってから結果ファイルに載る
    const gotoError = 'page.goto: net::ERR_ABORTED at https://member.rakuten-sec.co.jp/app/info.do?eventType=init&BV_SessionID=@@@@0123456789.1234567890@@@@'
    const stageError = 'Syntax error, unrecognized expression: https://member.rakuten-sec.co.jp/app/'

    const report = renderReport(reportInput([
      {
        ...baseResult,
        key: '遷移に失敗した対象',
        title: '遷移に失敗した対象',
        status: 'unreached',
        pageHits: 0,
        hits: 0,
        reason: 'ページを開けなかった',
        // 備考セル（バッククォートで包まれない）に載る。check.mjs の組み立てと同じ
        notes: [`遷移に失敗した: ${sanitize(gotoError)}`],
        diagnostics: {
          // 題名・記述子は伏せ字（`<withheld>`）になる形を入れる
          title: TITLE_WITHHELD,
          reach: REACH_UNKNOWN,
          headings: describeElements([{ tag: 'div', id: 'form_BV_SessionID_kJqRnB', classes: [] }]),
          containers: describeElements([{ tag: 'div', id: 'str-main', classes: ['550e8400-e29b-41d4-a716-446655440000'] }]),
          tracking: {
            source: 'ページ識別セレクタ',
            mode: 'prefix',
            rows: [],
            // 段階が 0 件のときは素の行として出る（バッククォートの外）
            omitted: false,
            unavailable: `段階の評価に失敗した: ${sanitize(stageError)}`
          }
        }
      },
      {
        ...baseResult,
        key: '追跡が途中で失敗した対象',
        title: '追跡が途中で失敗した対象',
        status: 'broken',
        pageHits: 1,
        hits: 0,
        notes: [`手がかりを採れなかった: ${sanitize(gotoError)}`],
        diagnostics: {
          // ページ識別セレクタがヒットした ❌ なので、題名は見ずに判定している
          title: '楽天証券｜国内株式・株価検索',
          reach: REACH_NOT_CONSULTED,
          headings: describeElements([{ tag: 'h1', id: 'logo', classes: [] }]),
          containers: describeElements([{ tag: 'div', id: 'str-header', classes: [] }]),
          tracking: {
            source: '検出用セレクタ',
            mode: 'prefix',
            rows: [{ selector: 'div#line1', hits: 1 }],
            // 段階表がある場合も、失敗の文言は素の行として表の後に出る
            omitted: true,
            unavailable: `段階の評価に失敗した: ${sanitize(stageError)}`
          }
        }
      }
    ]))

    // 検査対象が本当に含まれていること（含まれていなければテストが素通りしてしまう）
    expect(report).toContain(URL_PLACEHOLDER)
    expect(report).toContain(TOKEN_WITHHELD)
    // 消毒が効いていること（URL の実体は残らない）
    expect(report).not.toContain('rakuten-sec.co.jp')

    // 実際に markdownlint を通す。MD033 の allowed_elements は <br> だけなので、
    // `<url>` や `<withheld>` がバッククォートの外に出れば必ずここで落ちる
    const { content } = await lint({ strings: { content: report }, config: markdownlintConfig() })
    const violations = content.map((v) => `${v.lineNumber}: ${v.ruleNames.join('/')} ${v.errorDetail ?? ''}`.trim())
    expect(violations, report).toEqual([])
  })

  test('手がかり節に到達判定の行が必ず1行出る', async () => {
    /** 到達判定だけを変えた手がかりを作る */
    const diagnostics = (title, reach) => ({
      title,
      reach,
      headings: ['h1.hdg-l1-01-title'],
      containers: ['div#str-main'],
      tracking: {
        source: reach === REACH_REACHED ? '検出用セレクタ' : 'ページ識別セレクタ',
        mode: 'prefix',
        rows: [{ selector: 'div#line1', hits: 0 }],
        omitted: false,
        unavailable: null
      }
    })

    const report = renderReport(reportInput([
      {
        // 題名が未到達の目印に当たった対象（⚠️ のまま）
        ...baseResult,
        key: 'エラー画面に飛ばされた対象',
        title: 'エラー画面に飛ばされた対象',
        status: 'unreached',
        pageHits: 0,
        hits: 0,
        diagnostics: diagnostics('エラー | 楽天証券[PC]', REACH_UNREACHED)
      },
      {
        // 識別 0 件でも題名から到達と判断して再分類した対象（⚠️ → ❌）
        ...baseResult,
        key: '題名から到達と判断した対象',
        title: '題名から到達と判断した対象',
        status: 'broken',
        pageHits: 0,
        hits: 0,
        notes: ['ページ識別セレクタは 0 件だが、題名から到達と判断した'],
        diagnostics: diagnostics('国内株式トップ | 株価検索 | 楽天証券[PC]', REACH_REACHED)
      }
    ]))

    // ⚠️ と ❌ の両方にちょうど1行ずつ出る (FR-22 判定基準6)
    const rows = report.split('\n').filter((line) => line.startsWith('| 到達判定 |'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain(REACH_UNREACHED)
    expect(rows[1]).toContain(REACH_REACHED)

    // 再分類の根拠は備考にも残る（❌ の行を「識別セレクタはヒットした」と誤読させない）
    expect(report).toContain('ページ識別セレクタは 0 件だが、題名から到達と判断した')
    // 判定の読み方も到達判定に合わせた文面になっている
    expect(report).toContain('| ❌ | **ページに到達したと判断できるのに**検出用セレクタが 0 件。サイト改修でセレクタが壊れた疑い |')

    const { content } = await lint({ strings: { content: report }, config: markdownlintConfig() })
    expect(content.map((v) => `${v.lineNumber}: ${v.ruleNames.join('/')}`), report).toEqual([])
  })
})

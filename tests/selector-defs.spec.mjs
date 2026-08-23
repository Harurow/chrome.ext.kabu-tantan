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
import { loadMenuSelectors, indexByKey, rootDir } from '../scripts/selector-check/load-selectors.mjs'
import { sites } from '../scripts/selector-check/targets.mjs'
import {
  planPrefixTracking,
  summarizeTracking,
  describeElement,
  describeElements,
  isSuspiciousToken,
  formatTitle,
  MAX_STAGES,
  MAX_TOKEN,
  MAX_TEXT,
  TITLE_WITHHELD,
  TOKEN_WITHHELD,
  TRACKING_UNAVAILABLE
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
  extra: [],
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
        title: '楽天証券｜ログイン',
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
    expect(report).toContain('| 到達先の題名 | 楽天証券｜ログイン |')
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
})

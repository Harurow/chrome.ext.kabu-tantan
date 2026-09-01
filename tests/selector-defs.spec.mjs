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
import { sites, RAKUTEN_OPEN_QUERY, RAKUTEN_ORIGIN } from '../scripts/selector-check/targets.mjs'
import { checkTargetAsync, OK, BROKEN, UNREACHED } from '../scripts/selector-check/check.mjs'
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
import {
  matchesTargetPath,
  targetPathOf,
  pickLink,
  describeReach,
  describeRejected,
  describeQueryKeys,
  describeScan,
  readPathnameAsync,
  MAX_CANDIDATES,
  MAX_QUERY_KEYS,
  REJECT_CONDITIONS,
  REJECT_RAW_HREF,
  REJECT_SCHEME,
  REJECT_ORIGIN,
  REJECT_PATH,
  REJECT_INLINE_HANDLER,
  REJECT_QUERY,
  LINK_FOLLOWED,
  LINK_NO_CANDIDATE,
  LINK_NOT_QUALIFIED,
  LINK_PATH_MISMATCH_NOTE,
  LINK_TRUNCATED_NOTE
} from '../scripts/selector-check/links.mjs'
import { renderReport } from '../scripts/selector-check/report.mjs'

// 各 Content Script が持つべき検出用セレクタの件数
const EXPECTED_COUNTS = {
  'src/rakuten-cs.js': 14,
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

  test('楽天証券の4ページは実測どおりのクエリを付けて直打ちする', () => {
    // 2026-08-30 に利用者が提示したアドレスバーの写し（SPEC-SC-06「楽天証券4ページのクエリ」）。
    // 1.15.0 まではここが**クエリ無し**で、`eventType` で処理を振り分ける `.do` に
    // エラー画面を返されていた（ADR-0011 の 13）。値を推測で削るとその状態に戻る
    const POSSESS = '?eventType=directInit&type=&sub_type=&local=&gmn=S&smn=01&lmn=01&fmn=01'
    const MEASURED = {
      お気に入り: '?eventType=init&gmn=J&smn=01&lmn=01&fmn=02',
      お気に入り編集: '?eventType=init&pageNumber=1',
      // 空値（`type=` / `sub_type=` / `local=`）も実測どおり持つ（規則1）
      保有商品一覧・すべて: POSSESS,
      保有商品一覧・国内株式: POSSESS
    }

    const site = sites.find((item) => item.site === 'rakuten')
    const session = ';BV_SessionID=NNNN0123456789.0123456789NN'
    const buildUrl = (key) => {
      const { target, entry } = resolveSite(site).find((item) => item.target.key === key)
      // 直打ちに戻っていること（`link` に戻すのは実測で駄目だったときだけ。ADR-0011 の 13 の段取り4）
      expect(target.reach, key).toBe('goto')
      const path = entry.url.endsWith(';') ? entry.url.slice(0, -1) : entry.url
      return { url: target.url({ session, entry }), expectedPrefix: `${RAKUTEN_ORIGIN}${path}${session}` }
    }

    for (const [key, query] of Object.entries(MEASURED)) {
      const { url, expectedPrefix } = buildUrl(key)
      // パス + セッション + クエリ の順（実測の URL もこの並び。規則3）
      expect(url, key).toBe(`${expectedPrefix}${query}`)
    }

    // 対象ごとに違うので共有定数にしない（規則2）。お気に入り2ページのクエリは互いに異なる
    expect(MEASURED.お気に入り).not.toBe(MEASURED.お気に入り編集)

    // 米国株の2ページは**未実測**。そのページを開くことだけを意味する `eventType=init` に絞る
    // （国内株版の `gmn` / `pageNumber` は写さない。外れてもエラー画面＝⚠️ で今日より悪くならない）
    for (const key of ['お気に入り・米国株', 'お気に入り編集・米国株']) {
      const { url, expectedPrefix } = buildUrl(key)
      expect(url, key).toBe(`${expectedPrefix}?eventType=init`)
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
 * ポータルのリンクをたどる到達 (SPEC-SC-26)。
 *
 * `links.mjs` の純関数と、`check.mjs` の `reach: 'link'` 分岐を検査する。
 * ログインが要る経路は自動テストにできないため (CON-10)、ページ側は生の値を返し、
 * 資格審査と選択は Node 側の純関数で行う分担にしてある（ADR-0011 の 8）。
 * ページ側のコールバックは引数しか参照しないので Node 上でそのまま走らせる。
 * **ブラウザは起動しない。**
 */
test.describe('到達リンク', () => {
  // 手がかりは `menuSelectors[].url` だけ。楽天証券ポータルの実 DOM を見て起こした値は使わない
  const FAVORITE = '/app/info_jp_prc_reg_lst.do;'
  const FAVORITE_EDIT = '/app/info_jp_prc_reg_lst_edit.do;'
  const ORIGIN = 'https://member.rakuten-sec.co.jp'
  const SESSION = ';BV_SessionID=NNNN0123456789.0123456789NN'

  /** 資格を満たす候補（テストごとに1条件だけ落として使う） */
  const qualified = (path = `${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}`) => ({
    rawHref: path,
    href: path,
    hasInlineHandler: false
  })

  test('matchesTargetPath() が .do とパスパラメータ付きに一致しクエリ・フラグメントを無視する', () => {
    // 完全一致
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do', FAVORITE)).toBe(true)
    // パスパラメータ（楽天証券はセッションを `;` で持つ）
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do;BV_SessionID=NNNN.0123456789NN', FAVORITE)).toBe(true)
    // `menuSelectors` 側の末尾 `;` が無い定義（`market_ranking_rakuten.do` など）でも同じ
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do', '/app/info_jp_prc_reg_lst.do')).toBe(true)

    // クエリ・フラグメントは判定に使わない（URL.pathname には出ないが、混ざっても結果を変えない）
    expect(matchesTargetPath(new URL(`${ORIGIN}/app/info_jp_prc_reg_lst.do?eventType=init#top`).pathname, FAVORITE)).toBe(true)
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do?eventType=init', FAVORITE)).toBe(true)
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do#top', FAVORITE)).toBe(true)

    // 空の定義は何にも一致させない（誤って全リンクを拾わない）
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do', '')).toBe(false)
  })

  test('matchesTargetPath() が別ページを取り違えない', () => {
    // 前方一致だと `_edit` 側が本体に当たりうる。規則は「完全一致 or `;` が続く」だけ
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst_edit.do', FAVORITE)).toBe(false)
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst_edit.do;BV_SessionID=NNNN', FAVORITE)).toBe(false)
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst.do', FAVORITE_EDIT)).toBe(false)

    // 逆方向（`_edit` の定義には `_edit` のパスだけが当たる）
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst_edit.do', FAVORITE_EDIT)).toBe(true)
    expect(matchesTargetPath('/app/info_jp_prc_reg_lst_edit.do;BV_SessionID=NNNN', FAVORITE_EDIT)).toBe(true)
  })

  test('pickLink() が資格を満たす候補のうち先頭の href を返す', () => {
    const first = qualified(`${ORIGIN}/app/info_jp_prc_reg_lst.do;BV_SessionID=1`)
    const second = qualified(`${ORIGIN}/app/info_jp_prc_reg_lst.do;BV_SessionID=2`)

    // document order の先頭から見て、最初に資格を満たしたものを採る (SPEC-SC-26)。
    // たどれた場合は内訳を出さないので、落ちた候補があっても空で返す (SPEC-SC-26 の規則5)
    expect(pickLink([{ ...qualified(), hasInlineHandler: true }, first, second], { entryUrl: FAVORITE, origin: ORIGIN }))
      .toEqual({ href: first.href, reason: LINK_FOLLOWED, rejected: {}, queryKeys: [] })
    expect(describeReach(LINK_FOLLOWED)).toBe('到達方法: ポータルのリンクをたどった')
  })

  test('pickLink() が資格を満たさない候補を1条件ずつ落として除外する', () => {
    const context = { entryUrl: FAVORITE, origin: ORIGIN, openQuery: RAKUTEN_OPEN_QUERY }
    const base = qualified()

    // 1条件だけ崩した候補を並べる。どれも単独で除外されること（＝各条件が効いていること）と、
    // **どの条件で落ちたか**まで見る（次の一手が条件ごとに正反対のため。SPEC-SC-26 の「退避理由の内訳」）
    const rejected = {
      'javascript: スキーム': [{ rawHref: 'javascript:void(0)', href: 'javascript:void(0)', hasInlineHandler: false }, REJECT_SCHEME],
      '# 始まり': [{ ...base, rawHref: '#' }, REJECT_RAW_HREF],
      '空の href': [{ ...base, rawHref: '' }, REJECT_RAW_HREF],
      '空白だけの href': [{ ...base, rawHref: '   ' }, REJECT_RAW_HREF],
      別オリジン: [{ rawHref: 'https://www.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do', href: 'https://www.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do', hasInlineHandler: false }, REJECT_ORIGIN],
      'http スキーム': [{ rawHref: 'http://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do', href: 'http://member.rakuten-sec.co.jp/app/info_jp_prc_reg_lst.do', hasInlineHandler: false }, REJECT_SCHEME],
      別パス: [{ ...base, rawHref: `${ORIGIN}/app/info_jp_prc_reg_lst_edit.do`, href: `${ORIGIN}/app/info_jp_prc_reg_lst_edit.do` }, REJECT_PATH],
      インラインハンドラ付き: [{ ...base, hasInlineHandler: true }, REJECT_INLINE_HANDLER],
      // スキームを確かめられないので条件2 で落とす
      '解決できない href': [{ ...base, href: 'not a url' }, REJECT_SCHEME],
      // 条件6。同じパスでもクエリで操作が変わる（削除・解除など）ものは採らない
      操作を切り替えるクエリ: [{ ...base, href: `${base.href}?eventType=delete` }, REJECT_QUERY]
    }

    for (const [label, [candidate, condition]] of Object.entries(rejected)) {
      const picked = pickLink([candidate], context)
      expect(picked.href, label).toBeNull()
      expect(picked.reason, label).toBe(LINK_NOT_QUALIFIED)
      // 数えるのは**最初に落ちた条件**1つだけ
      expect(picked.rejected, label).toEqual({ [condition]: 1 })
    }

    // まとめて渡しても資格を満たすものが1つも無ければ `not-qualified`
    const all = pickLink(Object.values(rejected).map(([candidate]) => candidate), context)
    expect(all.href).toBeNull()
    expect(all.reason).toBe(LINK_NOT_QUALIFIED)
    // 崩していない候補は通る（上の除外が条件由来であることの対照）
    expect(pickLink([base], context))
      .toEqual({ href: base.href, reason: LINK_FOLLOWED, rejected: {}, queryKeys: [] })

    expect(describeReach(LINK_NOT_QUALIFIED))
      .toBe('到達方法: URL 直打ち（パス一致のリンクが GET 遷移の条件を満たさない）')
  })

  test('pickLink() がクエリを見て「開くだけ」のリンクだけを採る（資格6）', () => {
    // 楽天証券の `.do` は同一パスのクエリで操作を切り替える。パスだけで採ると、
    // 行ごとの操作リンク（削除・解除など）が document order の先頭にあれば踏んでしまう (CON-10)
    const context = { entryUrl: FAVORITE, origin: ORIGIN, openQuery: RAKUTEN_OPEN_QUERY }
    const link = (query) => qualified(`${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}${query}`)

    // 通る形。`pinned` は値まで一致、`anyValue` は値を問わない。
    // (a) `anyValue` のキーは値が何でも通る／(b) `pinned` のキーは無くてもよい
    for (const query of [
      '', '?eventType=init',
      '?eventType=init&gmn=J&l-id=xxxx',            // 2026-08-30 に実測したお気に入りの形
      '?gmn=J', '?l-id=header_favorite',            // `pinned` が無くても通る
      '?eventType=init&gmn=J&fmn=1&lmn=01&smn=02',  // `anyValue` は値を問わない
      // `anyValue` は**空値でも通る**。`pinned` の `?eventType=` は落ちる（下）ので、
      // この非対称は意図したもの（値を見ないキーに「空だから危ない」と言える根拠が無い）
      '?l-id='
    ]) {
      expect(pickLink([link(query)], context), `"${query}"`)
        .toEqual({ href: link(query).href, reason: LINK_FOLLOWED, rejected: {}, queryKeys: [] })
    }

    // 落ちる形。(c) どちらにも無いキーは落ちる（許可列挙）／(d) 重複キーは `anyValue` でも落ちる。
    // 落ちた条件は6（クエリ）で、`RAKUTEN_OPEN_QUERY` を広げうるかの判断材料になる
    for (const query of [
      '?eventType=delete',                  // `pinned` の値違い
      // 本命の形。**メニュー階層を伴う操作リンク**（`anyValue` を足しても操作は通さない）
      '?eventType=delete&gmn=J',
      '?eventType=',                        // 空値も値違い（`anyValue` の空値とは扱いが違う）
      '?eventtype=init',                    // 大小違い（どちらの集合にも無い）
      '?rowNo=3', '?eventType=init&rowNo=3', // 未知のキー
      // 「絞り込み」と読めるが確証が無いキーは許さない (CON-10。ADR-0011 の 11)
      '?local=1', '?type=1', '?sub_type=1', '?eventType=init&gmn=J&type=1',
      '?eventType=init&eventType=init',     // 重複キー（`pinned`）
      '?gmn=J&gmn=K'                        // 重複キー（`anyValue` でも落とす）
    ]) {
      const picked = pickLink([link(query)], context)
      expect(picked.href, query).toBeNull()
      expect(picked.reason, query).toBe(LINK_NOT_QUALIFIED)
      expect(picked.rejected, query).toEqual({ [REJECT_QUERY]: 1 })
    }

    // 先頭に操作リンクが並んでいても、後ろの「開くだけ」のリンクを採る
    expect(pickLink([link('?eventType=delete'), link('?rowNo=1'), link('?gmn=J')], context))
      .toEqual({ href: link('?gmn=J').href, reason: LINK_FOLLOWED, rejected: {}, queryKeys: [] })

    // 許すクエリを渡さなければクエリ付きは一切通らない（安全側の既定。規則7）。
    // 片方だけ渡した場合も、渡さなかった側は空集合に倒れる（`?? {}` / `?? []` の既定）
    const partial = [
      // [ラベル, openQuery, `?eventType=init` が通るか, `?gmn=J` が通るか]
      ['未指定', undefined, false, false],
      ['pinned だけ', { pinned: RAKUTEN_OPEN_QUERY.pinned }, true, false],
      ['anyValue だけ', { anyValue: RAKUTEN_OPEN_QUERY.anyValue }, false, true]
    ]
    for (const [label, openQuery, pinnedOk, anyValueOk] of partial) {
      for (const [query, allowed] of [['?eventType=init', pinnedOk], ['?gmn=J', anyValueOk]]) {
        const picked = pickLink([link(query)], { entryUrl: FAVORITE, origin: ORIGIN, openQuery })
        const at = `${label} ${query}`
        expect(picked.href, at).toBe(allowed ? link(query).href : null)
        expect(picked.reason, at).toBe(allowed ? LINK_FOLLOWED : LINK_NOT_QUALIFIED)
        expect(picked.rejected, at).toEqual(allowed ? {} : { [REJECT_QUERY]: 1 })
      }
      // どの既定でもクエリ無しは通る（規則1）
      expect(pickLink([link('')], { entryUrl: FAVORITE, origin: ORIGIN, openQuery }).reason, label)
        .toBe(LINK_FOLLOWED)
    }

    // 許す値の情報源は組み立て URL と同じ（`targets.mjs` の1箇所。新しい推測値を増やさない）。
    // `RAKUTEN_STOCK_QUERY` は `pinned` から組み立てる
    const stockUrl = rakutenSite().targets
      .find((target) => target.key === '国内株式・個別銘柄')
      .url({ session: SESSION, entry: { url: '/app/info_jp_prc_dtl.do;' } })
    expect(new URL(stockUrl).search.startsWith(`?${new URLSearchParams(RAKUTEN_OPEN_QUERY.pinned)}`)).toBe(true)
    // 組み立て URL が持つメニュー階層のキーは `anyValue` 側で許してある（同じキーを二重に定義しない）
    for (const key of ['gmn', 'smn', 'lmn', 'fmn']) {
      expect(RAKUTEN_OPEN_QUERY.anyValue, key).toContain(key)
    }
  })

  test('pickLink() が候補 0 件のとき no-candidate を返し、退避の文言が not-qualified と異なる', () => {
    const context = { entryUrl: FAVORITE, origin: ORIGIN }

    // 候補が無ければ審査そのものが起きないので、内訳も空になる（11・12 は出ない。備考 13 だけ）
    expect(pickLink([], context)).toEqual({ href: null, reason: LINK_NO_CANDIDATE, rejected: {}, queryKeys: [] })
    expect(pickLink(undefined, context)).toEqual({ href: null, reason: LINK_NO_CANDIDATE, rejected: {}, queryKeys: [] })

    // 「リンクが無い」と「リンクはあるが素の a href でない」は次の一手が違う（ADR-0011 の 7）。
    // 結果ファイルを読む人が区別できるよう、文言を必ず分ける
    expect(describeReach(LINK_NO_CANDIDATE)).toBe('到達方法: URL 直打ち（パス一致のリンクが見つからない）')
    expect(describeReach(LINK_NO_CANDIDATE)).not.toBe(describeReach(LINK_NOT_QUALIFIED))
    expect(new Set([LINK_FOLLOWED, LINK_NO_CANDIDATE, LINK_NOT_QUALIFIED].map(describeReach)).size).toBe(3)

    // 備考は markdownlint に掛かる。山括弧を含めない (SPEC-SC-26 / `結果ファイルの書式` 18)
    for (const reason of [LINK_FOLLOWED, LINK_NO_CANDIDATE, LINK_NOT_QUALIFIED]) {
      expect(describeReach(reason), reason).not.toMatch(/[<>]/)
    }
    expect(LINK_PATH_MISMATCH_NOTE).not.toMatch(/[<>]/)

    // 切り捨ての1行も退避理由と混ざらない（「見ていない」を「資格を満たさない」と読ませない）
    expect(LINK_TRUNCATED_NOTE).toContain(String(MAX_CANDIDATES))
    expect(LINK_TRUNCATED_NOTE).not.toMatch(/[<>]/)
    for (const reason of [LINK_FOLLOWED, LINK_NO_CANDIDATE, LINK_NOT_QUALIFIED]) {
      expect(LINK_TRUNCATED_NOTE, reason).not.toBe(describeReach(reason))
    }
  })

  test('readPathnameAsync() はページ側で判定せず pathname をそのまま返す', async () => {
    // 一致規則を持つのは `matchesTargetPath()` の1箇所だけ。ページ側にも同じ2条件を書くと
    // 片方だけ緩んでも自動テストが掛からない（ページ側はブラウザが要る）ため、判定を持たせない
    const stubFrame = { evaluate: (fn) => fn() }
    const original = globalThis.window

    try {
      for (const pathname of [
        '/app/info_jp_prc_reg_lst.do',
        `/app/info_jp_prc_reg_lst.do${SESSION}`,
        '/app/error.do'
      ]) {
        globalThis.window = { location: { pathname } }
        expect(await readPathnameAsync(stubFrame)).toBe(pathname)
      }
    } finally {
      globalThis.window = original
    }
  })

  // --- `reach: 'link'` の分岐（ブラウザ無しで丸ごと通す） ---------------------

  /** 楽天証券のサイト定義（リポジトリの実データをそのまま使う） */
  const rakutenSite = () => sites.find((item) => item.site === 'rakuten')

  /** ページ側が見る `a[href]` の代役。属性は生の値だけを持つ */
  const anchorOf = (href, { rawHref = href, inlineHandler = false } = {}) => ({
    href,
    getAttribute: () => rawHref,
    attributes: inlineHandler ? [{ name: 'href' }, { name: 'onclick' }] : [{ name: 'href' }]
  })

  /**
   * `checkTargetAsync()` を `reach: 'link'` で走らせる。
   *
   * **`reach` はテスト側で注入する。** 1.18.0 で実データの4対象は `reach: 'goto'` に戻ったが
   * （ADR-0011 の 13）、機構は `reach` の1語で往復できる状態に保つため、
   * 配線はここで固定し続ける（SPEC-SC-26「結果が出るまで本節の記述と実装は消さない」）。
   * `url`（退避先の組み立て URL）・`pageSelectors` は実データのまま使う。
   *
   * ページ側の関数（`collectAnchorsAsync` / `readPathnameAsync`）は**実物のコールバックを
   * Node 上で実行する**。引数しか参照しないので、`document` / `window` を差し替えれば動く。
   * 切り捨ての数え方までスタブに書き写さずに済む（NFR-13）。
   */
  // `readable: false` は「フレームを読めなかった」を模す（評価が例外で終わる）。
  // 読めないフレームは判定に影響しないが、件数だけは残る (SPEC-SC-26 の3原因)
  const runLinkTargetAsync = async ({ anchors = [], pathname = '', hits = {}, readable = true, site = rakutenSite() }) => {
    const found = resolveSite(site).find((item) => item.target.key === 'お気に入り')
    const entry = found.entry
    const target = { ...found.target, reach: 'link' }
    const gotos = []

    const frame = {
      url: () => `${ORIGIN}/app/home.do`,
      evaluate: async (fn, arg) => {
        if (arg && typeof arg === 'object' && 'max' in arg) {
          if (!readable) {
            throw new Error('frame is not readable')
          }
          globalThis.document = { querySelectorAll: () => anchors }
          try {
            return await fn(arg)
          } finally {
            delete globalThis.document
          }
        }
        if (arg === undefined) {
          globalThis.window = { location: { pathname } }
          try {
            return await fn()
          } finally {
            delete globalThis.window
          }
        }
        // 手がかり採取（オブジェクト引数）と件数（文字列引数）は他のテストと同じ形で模す
        if (arg && typeof arg === 'object') {
          return { title: 'お気に入り | 楽天証券[PC]', headings: [], containers: [] }
        }
        return { count: hits[arg] ?? 0 }
      }
    }

    const page = {
      isClosed: () => false,
      url: () => `${ORIGIN}/app/home.do`,
      frames: () => [frame],
      mainFrame: () => frame,
      goto: async (url, options) => { gotos.push({ url, options }) },
      waitForTimeout: async () => {}
    }

    const runner = {
      context: { pages: () => [page] },
      page,
      lastFrame: null,
      session: SESSION
    }

    return { entry, target, gotos, result: await checkTargetAsync(runner, site, target, entry, new Map()) }
  }

  test('リンクをたどれたら、その href へ referer 付きで遷移して件数を数える', async () => {
    const site = rakutenSite()
    const { entry } = resolveSite(site).find((item) => item.target.key === 'お気に入り')
    const href = `${ORIGIN}${targetPathOf(entry.url)}${SESSION}`

    const { gotos, result } = await runLinkTargetAsync({
      anchors: [anchorOf(href)],
      pathname: `${targetPathOf(entry.url)}${SESSION}`,
      hits: { 'form#form table.tbl-data-01': 1, [entry.selector]: 3, 'span.x-kabu-root': 3 }
    })

    expect(gotos).toHaveLength(1)
    expect(gotos[0].url).toBe(href)
    // referer はアンカーを見つけたフレームの URL (ADR-0011 の 3)
    expect(gotos[0].options.referer).toBe(`${ORIGIN}/app/home.do`)
    expect(result.status).toBe(OK)
    expect(result.hits).toBe(3)
    // 到達方法の1行は判定を問わず備考の先頭に出る (SPEC-SC-23 の備考 8)
    expect(result.notes[0]).toBe(describeReach(LINK_FOLLOWED))
    // href・referer・pathname は結果に載せない (NFR-12)
    expect(JSON.stringify(result)).not.toContain('BV_SessionID')
  })

  test('操作を切り替えるクエリのリンクが先頭にあっても踏まない', async () => {
    // C-1 の回帰。`.do` は同一パスのクエリで操作が変わるため、パス一致だけで先頭を採ると
    // 実口座で削除・解除の GET を踏みうる (CON-10)
    const site = rakutenSite()
    const { entry } = resolveSite(site).find((item) => item.target.key === 'お気に入り')
    const openHref = `${ORIGIN}${targetPathOf(entry.url)}${SESSION}`

    const { gotos } = await runLinkTargetAsync({
      anchors: [anchorOf(`${openHref}?eventType=delete&rowNo=1`), anchorOf(openHref)],
      pathname: `${targetPathOf(entry.url)}${SESSION}`,
      hits: { 'form#form table.tbl-data-01': 1, [entry.selector]: 3, 'span.x-kabu-root': 3 }
    })

    expect(gotos).toHaveLength(1)
    expect(gotos[0].url).toBe(openHref)
  })

  test('たどった先が対象ページでなければ件数を数えず、理由が「開けなかった」にならない', async () => {
    const { result } = await runLinkTargetAsync({
      anchors: [anchorOf(`${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}`)],
      // 楽天証券がエラー画面へ飛ばした場合。ページは開けているので「開けなかった」ではない
      pathname: '/app/error.do',
      hits: { 'form#form table.tbl-data-01': 1, 'span.x-kabu-root': 3 }
    })

    expect(result.status).toBe(UNREACHED)
    expect(result.reason).toBe('たどった先が対象ページでない')
    expect(result.notes).toContain(LINK_PATH_MISMATCH_NOTE)
    // 別ページで検出用セレクタがたまたま当たって ✅ を出さないよう、数えない (SPEC-SC-26)
    expect(result.pageHits).toBeNull()
    expect(result.hits).toBeNull()
    expect(result.injectedHits).toBeNull()
  })

  test('候補を上限で切り捨てたら、退避の理由と別の1行で区別できる', async () => {
    // 上限より後ろに有資格のアンカーがあっても見えない。`not-qualified`（＝素の a href でない）と
    // 同じ文言だけを出すと、次の一手を誤らせる
    const base = `${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}`
    const anchors = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) =>
      anchorOf(`${base}?rowNo=${i}`))

    const { target, gotos, result } = await runLinkTargetAsync({
      anchors,
      pathname: '/app/error.do',
      hits: {}
    })

    expect(result.notes).toContain(describeReach(LINK_NOT_QUALIFIED))
    expect(result.notes).toContain(LINK_TRUNCATED_NOTE)
    // 退避なので組み立て URL を直打ちする（1.13.0 までと同じ観測に戻る）
    expect(gotos).toHaveLength(1)
    expect(gotos[0].url).toBe(target.url({ session: SESSION, entry: { url: '/app/info_jp_prc_reg_lst.do;' } }))
    // 直打ちへ退避したときはパス確認を掛けない（着いた先が違っても件数は数える）
    expect(result.pageHits).toBe(0)
  })

  test('切り捨てが起きていなければ、切り捨ての1行は出ない', async () => {
    const base = `${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}`
    const { result } = await runLinkTargetAsync({
      anchors: [anchorOf(base, { inlineHandler: true })],
      pathname: '/app/error.do',
      hits: {}
    })

    expect(result.notes).toContain(describeReach(LINK_NOT_QUALIFIED))
    expect(result.notes).not.toContain(LINK_TRUNCATED_NOTE)
  })

  test('links.mjs のソースにクリック・フォーム送信が現れない', () => {
    // CON-10 の構造的な担保。リンクは**踏まず**、資格審査を通した href へ goto するだけにする。
    // `addEventListener` で付いたハンドラは外から見えないため、クリックすると
    // 実体が POST・フォーム送信であるリンクを踏む可能性を消せない (ADR-0011 の 3)
    const source = fs.readFileSync(path.join(rootDir, 'scripts', 'selector-check', 'links.mjs'), 'utf8')

    expect(source).not.toContain('.click(')
    expect(source).not.toContain('submit(')
    // 検査が空振りしていないこと（ファイルを読めており、goto する経路が実在すること）
    expect(source).toContain('matchesTargetPath')
  })

  test('check.mjs の遷移する側もクリックせず、goto に渡る URL が2つに限られる', () => {
    // 実際に `page.goto()` を呼ぶのは `check.mjs` 側。担保が一番要る行がここにある。
    // 「たどれなかったらクリックで再試行」を足すとしたら書かれる場所もここ
    const source = fs.readFileSync(path.join(rootDir, 'scripts', 'selector-check', 'check.mjs'), 'utf8')

    /** トップレベルの関数1つ分（次の行頭 `}` まで）を切り出す */
    const functionBody = (name) => {
      const start = source.indexOf(`const ${name} = `)
      expect(start, name).toBeGreaterThan(0)
      const end = source.indexOf('\n}\n', start)
      expect(end, name).toBeGreaterThan(start)
      return source.slice(start, end)
    }

    // ファイル全体で許すクリックは TradingView の右クリック1箇所だけ (CON-10 の許容操作)
    expect(source.match(/\.click\(/g)).toHaveLength(1)
    expect(source).toContain('page.mouse.click(')
    expect(source).not.toContain('submit(')

    // リンク経由の到達に関わる2関数には、その1箇所も現れない
    for (const name of ['findPortalLinkAsync', 'followPortalLinkAsync']) {
      expect(functionBody(name), name).not.toContain('click')
      expect(functionBody(name), name).not.toContain('submit')
    }

    // 遷移するのは1関数・1箇所だけで、渡す URL は「資格審査を通した href」か「組み立て URL」
    const follow = functionBody('followPortalLinkAsync')
    expect(follow.match(/\.goto\(/g)).toHaveLength(1)
    expect(follow).toContain('const url = link.href ?? buildUrl(target, runner, entry)')
    expect(follow).toContain('await page.goto(url,')
    // 到達後のパス確認も Node 側の純関数を通す（ページ側に規則を持たせない）
    expect(follow).toContain('matchesTargetPath(await readPathnameAsync(')
    expect(functionBody('findPortalLinkAsync')).not.toContain('goto')
  })

  test('reach: link を持つサイトは link.origin を持ち、無ければハブを走査せず退避する', async () => {
    // `check.mjs` は特定サイトの定数を名指しで import せず、検証中のサイト定義から引く
    // (SPEC-SC-26「値は「検証中のサイト定義」から引く」)。突き合わせが無いと、
    // 他サイトに `reach: 'link'` を付けたとき**別サイトのオリジンでハブを走査して黙って 0 件**になる。
    // 0 件は `no-candidate` → 直打ち退避なので、例外も判定の変化も出ない (ADR-0011 の 9-6)。
    //
    // 1.18.0 で実データの `reach: 'link'` は 0 件になった（4対象を `goto` に戻した。ADR-0011 の 13）。
    // 検査の空振りを避けるため、対象にするのは「`link` を持ちうるサイト」
    // ＝ `site.link` を持つか、`reach: 'link'` の対象があるサイト。
    // `reach` の1語で往復できる状態を保つ、という SPEC-SC-26 の前提そのものを固定する
    const linkSites = sites.filter((site) =>
      site.link !== undefined || site.targets.some((target) => target.reach === 'link'))

    // 検査が空振りしていないこと（往復できるサイト定義が実在すること）
    expect(linkSites.length).toBeGreaterThan(0)

    for (const site of linkSites) {
      const origin = site.link?.origin
      expect(origin, site.label).toEqual(expect.any(String))
      expect(origin.startsWith('https://'), site.label).toBe(true)
      // パス・クエリを含まない単一のオリジンであること（ハブの判定に接頭辞として使う）
      expect(origin, site.label).toBe(new URL(origin).origin)
    }

    // `reach: 'link'` を持つサイトは必ず `link` を持つ（戻したときに黙って 0 件にならない）
    for (const site of sites.filter((site) => site.targets.some((target) => target.reach === 'link'))) {
      expect(site.link?.origin, site.label).toEqual(expect.any(String))
    }

    // 規則3: `link.origin` が無ければ走査そのものを行わず退避する。
    // 資格を満たすアンカーを置いても、他サイトのオリジンを流用して拾いに行かない
    const { target, entry } = resolveSite(rakutenSite()).find((item) => item.target.key === 'お気に入り')
    // 組み立て URL と区別できるように、ポータル側の href はセッションを変えておく
    const portalSession = ';BV_SessionID=PORTAL0123456789.0123456789NN'
    const href = `${ORIGIN}${targetPathOf(entry.url)}${portalSession}`
    const { gotos, result } = await runLinkTargetAsync({
      site: { ...rakutenSite(), link: undefined },
      anchors: [anchorOf(href)],
      pathname: `${targetPathOf(entry.url)}${portalSession}`,
      hits: {}
    })

    expect(result.notes).toContain(describeReach(LINK_NO_CANDIDATE))
    expect(gotos).toHaveLength(1)
    expect(gotos[0].url).toBe(target.url({ session: SESSION, entry }))
    expect(gotos[0].url).not.toBe(href)
  })

  test('資格を満たさなかった条件ごとの件数が、条件番号の順で1行になる', async () => {
    // 一語の `not-qualified` では次の一手が決まらない。クエリなら許す集合を広げうるが、
    // インラインハンドラなら到達方法そのものを諦める（分岐が正反対。ADR-0011 の 10）
    const context = { entryUrl: FAVORITE, origin: ORIGIN, openQuery: RAKUTEN_OPEN_QUERY }
    const link = (query) => qualified(`${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}${query}`)

    const picked = pickLink([
      link('?eventType=delete'),
      { ...link('?rowNo=1'), hasInlineHandler: true }, // 条件5 で落ちる（条件6 までは見ない）
      link('?rowNo=2'),
      { ...link(''), rawHref: '#' },
      link('?rowNo=3')
    ], context)

    // 候補ごとに数えるのは**最初に落ちた条件**1つだけ
    expect(picked.rejected).toEqual({ [REJECT_RAW_HREF]: 1, [REJECT_INLINE_HANDLER]: 1, [REJECT_QUERY]: 3 })

    // 件数の降順ではなく条件番号の順（実行間で並びが動くと差分が読めない）。0 件の条件は書かない
    expect(describeRejected(picked.rejected))
      .toBe(`資格を満たさなかった内訳: ${REJECT_RAW_HREF} 1 件 / ${REJECT_INLINE_HANDLER} 1 件 / ${REJECT_QUERY} 3 件`)
    expect(describeRejected({ [REJECT_QUERY]: 2, [REJECT_ORIGIN]: 1 }))
      .toBe(`資格を満たさなかった内訳: ${REJECT_ORIGIN} 1 件 / ${REJECT_QUERY} 2 件`)

    // 名前は固定の6語だけ（サイトの DOM にも URL にも依存しない。SPEC-SC-14）
    expect(REJECT_CONDITIONS).toEqual([
      REJECT_RAW_HREF, REJECT_SCHEME, REJECT_ORIGIN, REJECT_PATH, REJECT_INLINE_HANDLER, REJECT_QUERY
    ])
    expect(new Set(REJECT_CONDITIONS).size).toBe(6)
    // 備考は markdownlint に掛かる。山括弧を含めない (SPEC-SC-23 の 8〜13)
    expect(describeRejected(picked.rejected)).not.toMatch(/[<>]/)
    // 1件も無ければ行を作らない（たどれた場合・`no-candidate` では出さない。規則5）
    expect(describeRejected({})).toBeNull()
    expect(describeRejected(undefined)).toBeNull()

    // 配線: `not-qualified` で退避したとき、到達方法の1行に続いて備考に出る (SPEC-SC-23 の備考 11)
    const { result } = await runLinkTargetAsync({
      anchors: [anchorOf(`${ORIGIN}${targetPathOf(FAVORITE)}${SESSION}?rowNo=1`)],
      pathname: '/app/error.do',
      hits: {}
    })
    expect(result.notes).toContain(describeReach(LINK_NOT_QUALIFIED))
    expect(result.notes).toContain(`資格を満たさなかった内訳: ${REJECT_QUERY} 1 件`)
  })

  test('資格6 で落ちたクエリのキー名が、伏せ字と上限を通してバッククォート付きで出る', async () => {
    // 許す集合を広げてよいかは**キーの意味**で決まる。値は判断に要らないので出さない
    // (SPEC-SC-14 / ADR-0011 の 7 の 5)
    const context = { entryUrl: FAVORITE, origin: ORIGIN, openQuery: RAKUTEN_OPEN_QUERY }
    const link = (query) => qualified(`${ORIGIN}/app/info_jp_prc_reg_lst.do${SESSION}${query}`)

    // キー名だけを集める。同じキーが何度出ても1つ
    const picked = pickLink([link('?rowNo=1&eventType=init'), link('?rowNo=2')], context)
    expect(picked.queryKeys).toEqual(['rowNo', 'eventType', 'rowNo'])
    expect(describeQueryKeys(picked.queryKeys))
      .toBe('資格を満たさなかったクエリのキー: `eventType`, `rowNo`')

    // 値は1文字も出さない
    expect(describeQueryKeys(picked.queryKeys)).not.toContain('=')
    expect(describeQueryKeys(picked.queryKeys)).not.toContain('init')

    // アルファベット順（実行間で並びが動かないように）
    expect(describeQueryKeys(['zzz', 'aaa', 'mmm']))
      .toBe('資格を満たさなかったクエリのキー: `aaa`, `mmm`, `zzz`')

    // SPEC-SC-22 の不記録判定を通す。セッションらしいキー名は伏せる
    const withheld = describeQueryKeys(['BV_SessionID', 'eventType'])
    expect(isSuspiciousToken('BV_SessionID')).toBe(true)
    expect(withheld).toContain(`\`${TOKEN_WITHHELD}\``)
    expect(withheld).not.toContain('BV_SessionID')
    // 伏せ字は**必ずバッククォートの内側**。素で出ると MD033 で `npm run lint:md` が落ちる
    expect(withheld.replace(/`[^`]*`/g, '')).not.toMatch(/[<>]/)

    // 長いキー名は消毒（120文字）で切る。ハイフン・ドット区切りは
    // `isSuspiciousToken` の長い英数字列の規則に当たらないため、ここが唯一の上限になる
    const longKey = 'ab-'.repeat(60)
    expect(isSuspiciousToken(longKey)).toBe(false)
    const long = describeQueryKeys([longKey])
    expect(long).toContain(sanitize(longKey))
    expect(long).not.toContain(longKey)
    expect(sanitize(longKey).length).toBe(MAX_TEXT)

    // バッククォートを含むキーはコードスパンを壊すので伏せる
    expect(describeQueryKeys(['ro`wNo'])).toBe(`資格を満たさなかったクエリのキー: \`${TOKEN_WITHHELD}\``)
    // 伏せ字・消毒を通した後もバッククォートの対応が崩れない（コードスパンの数が偶数）
    for (const keys of [[longKey], ['ro`wNo'], ['BV_SessionID', 'eventType']]) {
      expect(describeQueryKeys(keys).match(/`/g).length % 2).toBe(0)
    }

    // 上限 10 個で切る
    const many = Array.from({ length: MAX_QUERY_KEYS + 5 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    expect(describeQueryKeys(many).match(/`/g)).toHaveLength(MAX_QUERY_KEYS * 2)
    expect(describeQueryKeys(many)).toContain('`k00`')
    expect(describeQueryKeys(many)).not.toContain('`k10`')

    // 条件6 で落ちた候補が無ければ行を作らない（規則5）
    expect(describeQueryKeys([])).toBeNull()
    expect(describeQueryKeys(undefined)).toBeNull()
    expect(pickLink([{ ...link(''), hasInlineHandler: true }], context).queryKeys).toEqual([])

    // 配線: 内訳の1行に続いて備考に出る (SPEC-SC-23 の備考 12)
    const { result } = await runLinkTargetAsync({
      anchors: [anchorOf(`${ORIGIN}${targetPathOf(FAVORITE)}${SESSION}?rowNo=1&eventType=init`)],
      pathname: '/app/error.do',
      hits: {}
    })
    expect(result.notes).toContain('資格を満たさなかったクエリのキー: `eventType`, `rowNo`')
    // キーの値・href・セッションは載せない (NFR-12)
    expect(JSON.stringify(result)).not.toContain('BV_SessionID')
  })

  test('no-candidate のときは走査の規模が1行になる', async () => {
    // 「リンクが無い」には3つの原因（ハブが無い／フレームを読めていない／本当に無い）があり、
    // 文言だけでは区別できない。出すのは件数だけで、URL もページ名も出さない (SPEC-SC-26)
    expect(describeScan({ frames: 2, links: 137, matched: 0 }))
      .toBe('ハブ 2 フレームを走査し、リンク 137 件のうちパス一致は 0 件')
    // ハブが1つも無かった場合（利用者がログイン後のタブを閉じた）と読み分けられる
    expect(describeScan({ frames: 0, links: 0, matched: 0 }))
      .toBe('ハブ 0 フレームを走査し、リンク 0 件のうちパス一致は 0 件')
    expect(describeScan(undefined)).toBe('ハブ 0 フレームを走査し、リンク 0 件のうちパス一致は 0 件')
    expect(describeScan({ frames: 1, links: 3, matched: 0 })).not.toMatch(/[<>]/)

    // 「フレームを読めていない」と「本当にリンクが 0 件」は、どちらも `links 0` になる。
    // 読めなかった数を別に出さないと3原因のうち2つが区別できない
    expect(describeScan({ frames: 2, links: 0, matched: 0, unreadable: 2 }))
      .toBe('ハブ 2 フレームを走査し、リンク 0 件のうちパス一致は 0 件（うち読めなかったフレーム 2 件）')
    // 0 件のときは1行の書式を変えない（読めているのにリンクが無い、が素直に読める）
    expect(describeScan({ frames: 2, links: 0, matched: 0, unreadable: 0 }))
      .toBe('ハブ 2 フレームを走査し、リンク 0 件のうちパス一致は 0 件')
    expect(describeScan({ frames: 1, links: 0, matched: 0, unreadable: 1 })).not.toMatch(/[<>]/)

    // 配線: パスを含まないリンクしか無いフレームを走査した場合 (SPEC-SC-23 の備考 13)
    const { result } = await runLinkTargetAsync({
      anchors: [
        anchorOf(`${ORIGIN}/app/home.do`),
        anchorOf(`${ORIGIN}/app/info_jp_prc_dtl.do${SESSION}`),
        anchorOf('https://www.rakuten-sec.co.jp/')
      ],
      pathname: '/app/error.do',
      hits: {}
    })

    expect(result.notes).toContain(describeReach(LINK_NO_CANDIDATE))
    expect(result.notes).toContain(describeScan({ frames: 1, links: 3, matched: 0 }))
    // `no-candidate` では資格審査そのものが起きないので、内訳・キーの行は出ない（互いに排他）
    expect(result.notes.some((note) => note.startsWith('資格を満たさなかった'))).toBe(false)

    // 配線: フレームを読めなかった場合。走査したフレーム数はそのままで、
    // 読めなかった数が別に出る（`links 0` を「本当にリンクが無い」と読み違えない）
    const unreadable = await runLinkTargetAsync({
      anchors: [anchorOf(`${ORIGIN}${targetPathOf(FAVORITE)}${SESSION}`)],
      pathname: '/app/error.do',
      hits: {},
      readable: false
    })

    expect(unreadable.result.notes).toContain(describeReach(LINK_NO_CANDIDATE))
    expect(unreadable.result.notes)
      .toContain(describeScan({ frames: 1, links: 0, matched: 0, unreadable: 1 }))
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

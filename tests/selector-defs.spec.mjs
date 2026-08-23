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

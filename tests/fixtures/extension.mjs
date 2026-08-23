import { test as base, chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const rootDir = path.dirname(testsDir)

// 既定は src/ をそのまま読み込む。
// EXTENSION_PATH を指定すると別ディレクトリ（例: npm run package で作った zip の展開先）を
// 対象にできる。配布物そのものを検証したいときに使う。
export const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(rootDir, 'src')

/** context から MV3 の Service Worker を取り出す（起動直後はまだ現れないことがある） */
const resolveServiceWorker = async (context) => {
  const [existing] = context.serviceWorkers()
  return existing ?? await context.waitForEvent('serviceworker')
}

/**
 * 拡張機能を読み込んだ永続コンテキストを提供する fixture。
 * Chrome 拡張はヘッドレスでも `channel: 'chromium'` (new headless) なら動作する。
 */
export const test = base.extend({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    })
    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    await use(await resolveServiceWorker(context))
  },

  extensionId: async ({ context }, use) => {
    const serviceWorker = await resolveServiceWorker(context)
    await use(new URL(serviceWorker.url()).host)
  },

  // 対象サイトのオリジンでフィクスチャ HTML を返す。
  // content_scripts の `matches` は実オリジンでしか発火しないため、
  // ローカルファイルではなくネットワーク差し替えで再現する。
  serveFixture: async ({ context }, use) => {
    await use(async (page, url, html) => {
      await context.route(url, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html
      }))
      await page.goto(url)
    })
  }
})

export { expect } from '@playwright/test'

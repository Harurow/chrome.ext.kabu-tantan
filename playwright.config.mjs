import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',

  // 拡張機能の読み込みには永続コンテキストが必要で、プロファイルを共有すると
  // chrome.storage.sync の状態がテスト間で干渉するため直列実行する
  fullyParallel: false,
  workers: 1,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',

  // テストごとに新しい一時プロファイルで拡張機能を読み込む（tests/fixtures/extension.mjs の
  // launchPersistentContext('')）ので、chrome.storage の状態はテスト間で干渉しない。
  // ファイルの中のテストも分けて4並列で流す。2026-10-16 にこの Mac（10 コア）で測り、全件 278 件が
  // 直列の 5.3〜5.5 分から 1.7〜1.9 分になった（4回とも全件成功）。6並列は速くならず、
  // 負荷の高いときに時間に敏感なテスト（tests/disconnected.spec.mjs）が1件落ちた
  fullyParallel: true,
  workers: 4,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
})

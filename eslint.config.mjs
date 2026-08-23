import neostandard from 'neostandard'

/**
 * 拡張機能はビルドを持たず、manifest.json の `js` 配列の読み込み順で
 * スクリプト間の値を共有する。そのため共有シンボルはグローバル宣言する。
 */
const sharedGlobals = {
  // urls.js が提供
  externalUrls: 'readonly',
  externalUrlsMap: 'readonly',
  getEnableLinkKeysAsync: 'readonly',
  makeUrl: 'readonly',
  exchanges: 'readonly',
  // linkMenu.js が提供
  createMenu: 'readonly',
  // third-party/jquery.min.js が提供
  $: 'readonly',
  jQuery: 'readonly'
}

export default [
  {
    ignores: [
      'node_modules/**',
      'src/third-party/**',
      'dist/**',
      'test-results/**',
      'playwright-report/**'
    ]
  },

  ...neostandard({ env: ['browser'] }),

  // Content Script / オプションページ
  {
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...sharedGlobals,
        chrome: 'readonly'
      }
    }
  },

  // Service Worker は window を持たない
  {
    files: ['src/service_worker.js'],
    languageOptions: {
      globals: {
        ...sharedGlobals,
        chrome: 'readonly',
        importScripts: 'readonly',
        self: 'readonly',
        window: 'off'
      }
    }
  },

  // 共有モジュールは他ファイルから参照されるため未使用扱いにしない
  {
    files: ['src/urls.js', 'src/linkMenu.js'],
    rules: {
      'no-unused-vars': 'off'
    }
  },

  // 遷移先 URL のテンプレートは意図的に `${code}` を含む文字列
  {
    files: ['src/urls.js'],
    rules: {
      'no-template-curly-in-string': 'off'
    }
  },

  // Node で動く開発用スクリプトとテスト
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly'
      }
    },
    rules: {
      // Playwright の fixture は `async ({}, use) => {}` の形を取る
      'no-empty-pattern': 'off'
    }
  },

  // テストからブラウザ/Service Worker 内で評価されるコード片は
  // 実行時にそちらのグローバルを参照する
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...sharedGlobals,
        chrome: 'readonly',
        document: 'readonly',
        getTickerCode: 'readonly',
        compareVersion: 'readonly'
      }
    },
    rules: {
      // 期待値として URL テンプレートの `${code}` をそのまま書く
      'no-template-curly-in-string': 'off'
    }
  }
]

/**
 * 結果ファイル `docs/SELECTOR-CHECK.md` の生成 (SPEC-SC-13, 14)。
 *
 * **出力するのはセレクタ文字列・件数・判定・例外メッセージだけ**（ホワイトリスト）。
 * URL・Cookie・ページ本文・`aria-label` の全文は組み立てない (NFR-12 / CON-03)。
 */
import { OK, BROKEN, UNREACHED, SKIPPED } from './check.mjs'

const SYMBOL = {
  [OK]: '✅',
  [BROKEN]: '❌',
  [UNREACHED]: '⚠️',
  [SKIPPED]: '—'
}

/** 表のセルに入れられる形にする（改行・パイプを潰す） */
const cell = (value) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .replace(/\|/g, '\\|')
  .trim()

const count = (results, status) => results.filter((result) => result.status === status).length

const num = (value) => (value === null || value === undefined ? '—' : String(value))

/** 表の1行を組み立てる（空セルは `| |`。markdownlint の MD060 compact に合わせる） */
const row = (...cells) => `|${cells.map((c) => (c === '' ? ' ' : ` ${c} `)).join('|')}|`

/** 実行日時を `YYYY-MM-DD HH:mm (JST)` 形式にする */
export const formatTimestamp = (date) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
  return `${parts} (JST)`
}

/**
 * @param { {
 *   generatedAt: Date,
 *   version: string,
 *   browserVersion: string,
 *   sites: object[],
 *   results: object[]
 * } } input
 */
export const renderReport = ({ generatedAt, version, browserVersion, sites, results }) => {
  const broken = count(results, BROKEN)
  const unreached = count(results, UNREACHED)
  const skipped = count(results, SKIPPED)
  const overallSymbol = broken > 0 ? '❌' : (unreached > 0 ? '⚠️' : '✅')

  const lines = [
    '# セレクタ検証結果',
    '',
    '> このファイルは `npm run check:selectors` が生成する。手で編集しない。',
    '> 実行のたびに全体を上書きする（履歴は git で追う）。',
    '',
    '| | |',
    '| --- | --- |',
    `| 実行日時 | ${formatTimestamp(generatedAt)} |`,
    `| 拡張機能バージョン | ${version} |`,
    `| Chromium | ${browserVersion} |`,
    `| 総合判定 | ${overallSymbol} 破損 ${broken} 件 / 未到達 ${unreached} 件 / 未実施 ${skipped} 件 |`,
    '',
    '## サマリ',
    '',
    '| サイト | 対象 | ✅ 正常 | ❌ 破損 | ⚠️ 未到達 | — 未実施 |',
    '| --- | --- | --- | --- | --- | --- |'
  ]

  for (const site of sites) {
    const rows = results.filter((result) => result.site === site.site)
    lines.push(`| ${cell(site.label)} | ${rows.length} | ${count(rows, OK)} | ${count(rows, BROKEN)} | ${count(rows, UNREACHED)} | ${count(rows, SKIPPED)} |`)
  }
  lines.push('')

  for (const site of sites) {
    const rows = results.filter((result) => result.site === site.site)
    if (rows.length === 0) continue

    lines.push(`## ${cell(site.label)}`, '')
    lines.push('| ページ | 判定 | 識別 | ヒット | 注入 | 備考 |', '| --- | --- | --- | --- | --- | --- |')
    for (const result of rows) {
      const notes = [result.status === SKIPPED ? result.reason : '', ...result.notes].filter(Boolean).map(cell).join('<br>')
      lines.push(row(cell(result.title), SYMBOL[result.status], num(result.pageHits), num(result.hits), num(result.injectedHits), notes))
    }
    lines.push('')

    for (const result of rows.filter((r) => r.extra.length > 0)) {
      lines.push(`### ${cell(result.title)}の追加検査`, '')
      lines.push('| 項目 | 結果 |', '| --- | --- |')
      for (const item of result.extra) {
        lines.push(`| ${cell(item.label)} | ${cell(item.value)} |`)
      }
      lines.push('')
    }

    lines.push(`### 検証したセレクタ（${cell(site.label)}）`, '')
    lines.push('| ページ | 検出用セレクタ |', '| --- | --- |')
    for (const result of rows) {
      lines.push(`| ${cell(result.title)} | \`${cell(result.selector)}\` |`)
    }
    lines.push('')
  }

  lines.push('## 未実施の対象', '')
  const skippedRows = results.filter((result) => result.status === SKIPPED)
  if (skippedRows.length === 0) {
    lines.push('なし。', '')
  } else {
    lines.push('| サイト | 対象 | 理由 |', '| --- | --- | --- |')
    for (const result of skippedRows) {
      lines.push(`| ${cell(result.siteLabel)} | ${cell(result.title)} | ${cell(result.reason)} |`)
    }
    lines.push('')
  }

  lines.push('## 判定の読み方', '')
  lines.push('| 記号 | 意味 |', '| --- | --- |')
  lines.push('| ✅ | ページ識別セレクタがヒットし、検出用セレクタも1件以上ヒットした |')
  lines.push('| ❌ | ページには到達したが検出用セレクタが 0 件。**サイト改修でセレクタが壊れた疑い** |')
  lines.push('| ⚠️ | ページ識別セレクタも検出用セレクタもヒットしない。ページを開けていない／ページ構造が変わった |')
  lines.push('| — | 未実施（`--only` で除外・ログインしていない・対象のタブが開かれていない） |')
  lines.push('')
  lines.push('「注入」は拡張機能が実際に挿入した要素の数（参考値。判定には使わない）。', '')

  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')
  return `${body}\n`
}

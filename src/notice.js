/**
 * 開けないときの小窓(SPEC-NT)
 * Service Workerがクエリで渡すのは reason / key / code だけで、選択文字列は受け取らない(SPEC-SW-10)。
 * クエリは利用者が書き換えられるので、文字列はすべてtextContentで入れる(HTMLとして解釈しない。SPEC-NT-02)
 */

/** どの条件にも当たらないときの文言(SPEC-NT-02) */
const noticeGenericMessage = 'ページを開けませんでした。'

/**
 * 遷移先の名前を引く(SPEC-NT-02)
 * 未知のkeyや `__proto__` 等のプロトタイプ由来の値を名前として扱わない
 * @param {string | null} key
 * @returns {string | null}
 */
const getNoticeSiteTitle = (key) =>
  Object.hasOwn(externalUrlsMap, key) ? externalUrlsMap[key].title : null

/**
 * 米国株のページがある有効な遷移先の名前を、設定の順に返す(SPEC-NT-02)
 * 基準はurl3の有無(TradingViewのメニューの絞り込みと同じ。SPEC-CS-18)
 * @returns {Promise<string[]>}
 */
const getUsAvailableTitlesAsync = async () => {
  const keys = await getEnableLinkKeysAsync()
  return keys
    // storageに残った未知のkeyは読み飛ばす(SPEC-ST-03)
    .filter((key) => Object.hasOwn(externalUrlsMap, key))
    .map((key) => externalUrlsMap[key])
    .filter((item) => item.url3)
    .map((item) => item.title)
}

/**
 * 表示内容を組み立てる(SPEC-NT-02)
 * #notice-messageは同期で入れ、#notice-detailは必要ならstorageを読んでから入れる
 */
const renderNoticeAsync = async () => {
  const params = new URLSearchParams(location.search)
  const reason = params.get('reason')
  const title = getNoticeSiteTitle(params.get('key'))
  const code = params.get('code')

  const message = document.getElementById('notice-message')
  const detail = document.getElementById('notice-detail')

  if (reason === 'us-unsupported' && title !== null && code) {
    message.textContent = `「${title}」には米国株のページがないため、${code} を開けません。`

    const titles = await getUsAvailableTitlesAsync()
    detail.textContent = titles.length > 0
      ? `米国株のページがある遷移先: ${titles.join('、')}`
      : '米国株のページがある遷移先は、いま有効な遷移先の中にありません。'
    return
  }

  if (reason === 'not-ticker') {
    // 選択文字列は表示しない(Service Workerも渡さない。FR-29 判定基準7)
    message.textContent = '選択した文字列を銘柄コードとして読み取れませんでした。'
    detail.textContent = '4桁の銘柄コード（例: 7203）か、米国株のティッカー（例: AAPL）を選択してください。'
    return
  }

  message.textContent = noticeGenericMessage
  detail.textContent = ''
  detail.hidden = true
}

// 閉じ方(SPEC-NT-03)。時間で自動的に閉じることはしない
document.getElementById('notice-close').addEventListener('click', () => {
  window.close()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.close()
  }
})

renderNoticeAsync()

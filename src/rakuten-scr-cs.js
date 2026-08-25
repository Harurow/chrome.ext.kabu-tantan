/** document.bodyの監視コールバックを束ねる時間(ミリ秒)(SPEC-CS-22) */
const observerDebounceMs = 200

$(() => {
  setTimeout(attachAsync, 500)
})

/**
 * ページを改変するエントリポイント
 */
const attachAsync = async () => {
  // 切断状態(拡張機能の更新・再読み込み後の古いタブ)では何もしない(SPEC-CS-19)
  if (!isExtensionAlive()) {
    return
  }

  // 利用するURLリスト
  // 門を通った後に拡張機能が更新される場合に備えて網(try)も張る
  let keys
  try {
    keys = await getEnableLinkKeysAsync()
  } catch {
    return
  }

  // 常設監視の設置を再試行する(document.bodyは必ず取れるので実質初回で成功。SPEC-CS-22)
  retrySetup(() => setupObserver(keys))
}

/**
 * ページ変更に追随するための常設監視を張り、初期パスを走らせる(SPEC-CS-08)
 * 監視対象は結果一覧の器ではなくdocument.bodyにする
 * 人が検索を実行するまでの時間に上限が無く(FR-15)、器の出現を再試行で待つと間に合わないため
 * 常設監視は打ち切らない。外すのは切断を検知したときだけ(SPEC-CS-19)
 * @param { string[] } keys
 * @returns { boolean } 監視を張れたか
 */
const setupObserver = (keys) => {
  const target = document.body
  if (!target) {
    return false
  }

  // 監視範囲が広いぶん発火回数が増えるのでデバウンスで束ねる
  let timerId = null
  const observer = new MutationObserver(() => {
    // 切断状態では注入を止め、監視も外す(復帰手段が無く、監視を続けても無駄に走るだけ。SPEC-CS-19)
    if (!isExtensionAlive()) {
      observer.disconnect()
      clearTimeout(timerId)
      timerId = null
      return
    }

    clearTimeout(timerId)
    timerId = setTimeout(() => {
      timerId = null

      // 束ねている間に切断された場合に備えて、DOMを変える直前にも門を置く
      if (!isExtensionAlive()) {
        observer.disconnect()
        return
      }

      // ページ変更対応
      mutationObserverCallback(keys)
    }, observerDebounceMs)
  })

  observer.observe(target, { childList: true, subtree: true })

  // 初期ページ対応
  mutationObserverCallback(keys)

  return true
}

/**
 * ページ変更に伴い再度リンクメニューをアタッチ
 * @param { string[] } keys
 */
const mutationObserverCallback = (keys) => {
  // 設定に従い一つづつ試す
  menuSelectors
    .forEach((menuSelector) => {
      $(menuSelector.selector)
        .each((_, element) => attachMenu(element, keys))
    })
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element
 * @param { string[] } keys
 */
const attachMenu = (element, keys) => {
  // 注入済みメニューの内側は対象にしない(二重注入の防止。SPEC-CS-22)
  // 注入したメニュー項目の<a>が検出用セレクタに再びヒットするため
  if ($(element).closest('span.x-kabu-root').length > 0) {
    return
  }

  const text = $(element).text()
  const match = text.trim().match(/[0-9][0-9ACDFGHJKLMNPRSTUWXY][0-9][0-9ACDFGHJKLMNPRSTUWXY]/g)

  if (!match) {
    return
  }

  const tickerCode = match[0]
  const childNodes = element.childNodes

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i]
    if (node.nodeName !== '#text' || node.nodeValue.indexOf(tickerCode) === -1) {
      continue
    }

    const menu = createMenu(keys, tickerCode, node.nodeValue, true)
    $('ul.x-kabu-body', menu).css({ marginTop: -3 })
    element.replaceChild(menu[0], node)
  }
}

/**
 * 改変情報
 * @type { { title: string, url: string, selector: string }[] }
 */
const menuSelectors = [
  {
    title: 'スーパースクリーナー',
    selector: 'div#resultpanel div.resulttablebox tr.datarow td:nth-of-type(1) a'
  },
]

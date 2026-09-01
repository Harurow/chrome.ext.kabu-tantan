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
        .each((_, element) => attachMenu(element, keys, menuSelector.us === true))
    })
}

/**
 * 要素にメニューをつける
 * @param { HTMLElement } element
 * @param { string[] } keys
 * @param { boolean } allowUs 米国株の抽出を許すか(menuSelectors の us。SPEC-CS-26)
 */
const attachMenu = (element, keys, allowUs) => {
  // 注入済みメニューの内側は対象にしない(二重注入の防止。SPEC-CS-22)
  // 注入したメニュー項目の<a>が検出用セレクタに再びヒットするため
  if ($(element).closest('span.x-kabu-root').length > 0) {
    return
  }

  // 注入済みの要素も対象にしない(1行1メニュー。FR-28 判定基準10)
  // 最初のテキストノードで打ち切るため、同じコードが2回現れるセルでは
  // 未置換のテキストノードが残る。再試行(SPEC-CS-22)やMutationObserverでパスは
  // 繰り返されるので、打ち切りだけでは次のパスが2つ目を置換してしまう
  if ($('span.x-kabu-root', element).length > 0) {
    return
  }

  // 国内株を先に見て、空振りしたときだけ米国株を試す(SPEC-TC-10)
  const ticker = matchInjectionTicker($(element).text(), allowUs)

  if (!ticker) {
    return
  }

  const childNodes = element.childNodes

  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes[i]
    if (node.nodeName !== '#text' || node.nodeValue.indexOf(ticker.code) === -1) {
      continue
    }

    // 遷移先が0件ならメニューを出さない(SPEC-CS-06 / FR-28 判定基準4)
    // 本サイトだけが戻り値へ追加でスタイルを当てるため、null を確かめてから触る
    const menu = createMenu(keys, ticker.code, node.nodeValue, true, ticker.type)
    if (menu) {
      $('ul.x-kabu-body', menu).css({ marginTop: -3 })
      element.replaceChild(menu[0], node)
    }

    // 1行につきメニューは1つ。最初のテキストノードで打ち切る(FR-28 判定基準10)
    break
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

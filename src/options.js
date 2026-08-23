const mainTag = $('main')

mainTag.on('scroll', () => {
  if (mainTag.scrollTop()) {
    $('header').addClass('with-scroll')
  } else {
    $('header').removeClass('with-scroll')
  }
})

/**
 * TradingView 自身へのリンクは TradingView 上のメニューには出ない
 * @param {string} key
 * @returns {boolean}
 */
const isShownOnTradingView = (key) => key.indexOf('tradingview.com') !== 0

$(async () => {
  const keys = await getEnableLinkKeysAsync()

  // Materialize 2.x の .row は CSS Grid のため、.sN は .row の直接の子である必要がある
  const createItem = (item, checked) => {
    const tvBadge = isShownOnTradingView(item.key)
      ? '<i class="material-icons tv-badge" title="TradingViewの「株Link」メニューにも表示されます">show_chart</i>'
      : ''
    return $(`
      <li class="collection-item row" id="${item.key}">
        <i class="s1 material-icons handle" title="ドラッグして並び替え">drag_handle</i>
        <span class="s7 item-title">${item.title}${tvBadge}</span>
        <a class="s2 item-link" href="${item.url0}" rel="noopener noreferrer" target="_blank" title="${item.title} を開く">
          <i class="material-icons">open_in_new</i>
        </a>
        <span class="s2 switch">
          <label>
            <input type="checkbox" class="link-list-item" value="${item.key}" ${checked}>
            <span class="lever"></span>
          </label>
        </span>
      </li>`)
  }

  // リストを構築する
  const linkList = $('#link-list')
  const keyObjects = {}

  // チェック済みを先に構築する
  keys.forEach((key) => {
    const item = externalUrlsMap[key]
    // サイトが廃止になるケースがあるので externalUrlsMap にあるか確認してから登録
    if (item) {
      keyObjects[key] = 'checked'
      const li = createItem(item, 'checked')
      linkList.append(li)
    }
  })

  externalUrls.forEach((item) => {
    if (!keyObjects[item.key]) {
      // 未作成のみ作る
      const li = createItem(item, '')
      linkList.append(li)
    }
  })

  linkList.sortable({
    axis: 'y',
    handle: '.handle',
    distance: 8,
    update: function (e, ui) {
      // 順序の変更があれば保存を有効にする
      $('#save').removeClass('scale-out')
        .addClass('scale-in')
    }
  })

  let lock = false

  $('#save')
    .on('click', async function () {
      if (lock) {
        return
      }

      // リストを保存する。順序も担保する
      try {
        lock = true

        const enableLinkKeys = {}

        // リストの順番を値として登録する
        let no = 0
        $('input.link-list-item')
          .each(function () {
            const self = $(this)
            if (self.prop('checked')) {
              enableLinkKeys[self.val()] = no++
            }
          })

        await chrome.storage.sync.set({ enableLinkKeys })

        // 保存アイコンを消す
        $(this).removeClass('scale-in')
          .addClass('scale-out')
      } finally {
        lock = false
      }
    })

  $('input.link-list-item')
    .on('change', function () {
      // 有効・無効の切り替えで保存を有効にする
      $('#save').removeClass('scale-out')
        .addClass('scale-in')
    })
})

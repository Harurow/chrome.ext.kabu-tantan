// M.AutoInit()

const mainTag = $('main')

mainTag.scroll(() => {
  if (mainTag.scrollTop()) {
    $('header').addClass('with-scroll')
  } else {
    $('header').removeClass('with-scroll')
  }
})

$(async () => {
  const keys = await getEnableLinkKeysAsync()

  const createItem = (item, checked, tv) => {
    const tvIcon = tv
      ? `<abbr title="TradingViewのスーパーチャートにボタンとして表示されます"><img src="https://static.tradingview.com/static/images/favicon.ico"/ class="trading-view"></abbr>`
      : ''
    return $(`
      <li class="collection-item row" id="${item.key}">
        <div>
          <label>
          <i class="col s1 material-icons handle">drag_handle</i>
          </label>
          <span class="col s8 item-title">
            ${item.title}${tvIcon}
          </span>
          <a class="col s1" href="${item.url0}" rel="noopener" target="_blank" >
            <i class="material-icons">open_in_new</i>
          </a>
          <span class="secondary-content switch">
            <label>
              <input type="checkbox" class="link-list-item" value="${item.key}" ${checked}>
              <span class="lever"></span>
            </label>
          </span>
        </div>
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
      const li = createItem(item, 'checked', true)
      linkList.append(li)
    }
  })
  
  externalUrls.forEach((item) => {
    if (!keyObjects[item.key]) {
      // 未作成のみ作る
      const li = createItem(item, '', true)
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
    .on('click', async function() {
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
          .each(function() {
            const self = $(this)
            if (self.prop('checked')) {
              enableLinkKeys[self.val()] = no++
            }
          })
  
        await chrome.storage.sync.set( {'enableLinkKeys': enableLinkKeys } )
  
        // 保存アイコンを消す
        $(this).removeClass('scale-in')
               .addClass('scale-out')  
      } finally {
        lock = false
      }
    })

  $('input.link-list-item')
    .on('change', function() {
      // 有効・無効の切り替えで保存を有効にする
      $('#save').removeClass('scale-out')
                .addClass('scale-in')
    })
})


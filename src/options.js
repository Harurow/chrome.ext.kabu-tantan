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
  const keyObjects = {}
  keys.forEach((key) => {
    keyObjects[key] = 'checked'
  })
  
  const linkList = $('#link-list')
  
  externalUrls.forEach((item) => {
    const checked = keyObjects[item.key] ?? ''
    const li = $(`
    <li class="collection-item row">
      <div class="switch">
        <label>
          <div class="col s10">
            <span class="switch-title">
              ${item.title}
            </span>
          </div>
          <div class="col s2">
            <input type="checkbox" class="link-list-item" value="${item.key}" ${checked}>
            <span class="lever"></span>
          </div>
        </label>
      </div>
    </li>
    `)
    linkList.append(li)
  })

  let lock = false

  $('#save')
    .on('click', async function() {
      if (lock) {
        return
      }

      try {
        lock = true

        const enableLinkKeys = {}

        let no = 0
        $('input.link-list-item')
          .each(function() {
            const self = $(this)
            if (self.prop('checked')) {
              enableLinkKeys[self.val()] = no++
            }
          })
  
        await chrome.storage.sync.set( {'enableLinkKeys': enableLinkKeys } )
  
        $(this).removeClass('scale-in')
               .addClass('scale-out')  
      } finally {
        lock = false
      }
    })

  $('input.link-list-item')
    .on('change', function() {
      $('#save').removeClass('scale-out')
                .addClass('scale-in')
    })
})


$(function () {
  if (location.href.indexOf('.rakuten-sec.co.jp/') === -1) {
    return
  }

  setTimeout(hooks, 100)

  /**
   * ページを改変するエントリポイント
   */
  function hooks () {
    // 設定に従い一つづつ試す
    hookSettings
      .forEach(hook)
  }

  /**
   * ページを改変する
   * @param {{ title: string, url: string, selector: string }} hookSetting
   */
  function hook (hookSetting) {
    if (location.href.indexOf(hookSetting.url) === -1) {
      return
    }

    console.log(`Hello, rakuten-sec.co.jp : ${hookSetting.title}`)

    $(hookSetting.selector)
      .each(function () {
        const elem = $(this)
        const text = elem.text().trim()

        const matches = text.match(/\d{4}/g)
        if (!matches) {
          return
        }

        const tickerCode = matches[matches.length - 1]

        build(elem, tickerCode)
      })
  }

  /**
   * 要素に対して外部リンクを紐づける
   * @param {JQuery<HTMLElement>} elem
   * @param {string} tickerCode
   */
  function build (elem, tickerCode) {
    const dropDownMenu = $('<ul class="x-kabu">')
      .css('padding', '3px 8px')
      .css('text-align', 'left')

    gotoLinks.forEach((linkSetting) => {
      const link = $('<a>')
        .text(linkSetting.title)
        .attr('title', linkSetting.title)
        .attr('target', '_blank')
        .attr('rel', 'noopener noreferrer')
        .attr('href', linkSetting.url.replace('{}', tickerCode))
      const list = $('<li class="x-kabu-menu-item">')
        .css('margin', '3px 6px')
        .append(link)
      dropDownMenu.append(list)
    })

    const mainMenu = $('<span class="x-kabu-root">')
      .text(elem.text())
      .css('display', 'inline-block')
      .append(dropDownMenu)
      .hover(
        function () {
          dropDownMenu.addClass('open')
        },
        function () {
          dropDownMenu.removeClass('open')
        }
      )

    elem.html(mainMenu)
  }

  /**
   * 改変情報
   * @type { title: string, url: string, selector: string }[]
   */
  const hookSettings = [
    {
      title: 'お気に入り',
      url: '/app/info_jp_prc_reg_lst.do;',
      selector: 'form#form table.tbl-data-01 td.align-C div.mbody nobr'
    },
    {
      title: '保有商品一覧・すべて',
      url: '/app/ass_all_possess_lst.do;',
      selector: 'div#table_possess_data table.tbl-bold-border tr > td:contains("国内株式") + td'
    },
    {
      title: '保有商品一覧・国内株式',
      url: '/app/ass_jp_stk_possess_lst.do;',
      selector: 'table#poss-tbl-sp tr td table tr td'
    },
    {
      title: '国内株式・個別銘柄',
      url: '/app/info_jp_prc_stock.do',
      selector: 'div#line1 h1.hdg-l1-01-title span:first'
    }
  ]
})

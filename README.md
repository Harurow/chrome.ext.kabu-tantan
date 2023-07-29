# Chrome拡張 株リンク

楽天証券、SBI証券のHPに外部の株式情報ページへのリンクを作ります。
銘柄コードにカーソルを合わせると「TradingView」、「株探」、「MINKABU」、「Yahooファイナンス」などへのリンクメニューが表示される

選択コンテキストメニューから「TradingView」、「株探」、「MINKABU」、「Yahooファイナンス」などへの検索を追加

## 対応サイト

### 楽天証券

楽天証券の以下のページの銘柄コード(数値4桁)にカーソルを合わせるとリンクメニューが出ます

* お気に入り
* 保有商品一覧・すべて
* 保有商品一覧・国内株式
* ランキング
* 株価検索
* スーパースクリーナー

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-1.png?raw=true "楽天証券・お気に入り銘柄")

#### 対応URL

```https://*.rakuten-sec.co.jp/*```

### SBI証券

SBI証券の以下のページの銘柄コード(数値4桁)にカーソルを合わせるとリンクメニューが出ます

* 国内株式
* ポートフォリオ
* 銘柄スクリーニング

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-3.png?raw=true "SBI証券・個別銘柄")

#### 対応URL

```https://*.sbisec.co.jp/ETGate/*```
```https://*.sbi.ifis.co.jp/*```

### TradingView

TradingViewの右クリックメニューに株探、MINKABU、Yahooファインスへのリンクを追加します  
※ 米国株(英字1〜5文字)は株探、MINKABUのみ

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-4.png?raw=true "TradingView・コンテキストメニュー")

#### 対応URL

```https://jp.tradingview.com/*```

### コンテキストメニュー

選択している場合のコンテキストメニューに「TradingView」、「株探」、「MINKABU」、「Yahoo!ファイナンス」などを追加  
なお、選択範囲に4桁の数値が見つかった場合のみ画面が開きます。

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-5.png?raw=true "コンテキストメニュー")


### 遷移先

バージョン1.0.9より遷移先のURLを増やしました。またオプションのページで使う使わないを選択できるようにしました。
デオフォルトでは全部使う設定になっていてメニューが長くなってしまいますので、利用するものを絞ってください。

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-6.png?raw=true "オプション")

* [TradingView/スーパーチャート](https://jp.tradingview.com/chart/?symbol=TSE%3A7203)
* [株探/基本情報](https://kabutan.jp/stock/?code=7203)
* [MINKABU/株価情報トップ](https://minkabu.jp/stock/7203)
* [Yahoo!ファイナンス/詳細情報](https://finance.yahoo.co.jp/quote/7203.T)
* [Yahoo!ファイナンス/掲示板](https://finance.yahoo.co.jp/quote/7203/bbs)
* [日本経済新聞](https://www.nikkei.com/nkd/company/?scode=7203)
* [四季報](https://shikiho.toyokeizai.net/stocks/7203)
* [バフェット・コード](https://www.buffett-code.com/company/7203/)
* [株予報](https://kabuyoho.ifis.co.jp/index.php?action=tp1&sa=report&bcode=7203)
* [目標株価まとめ](https://www.kabuka.jp.net/rating/7203.html)
* [株ライン](https://kabuline.com/search/tw/7203)
* [karauri.net](https://karauri.net/7203/)
* [iMarket](https://tyn-imarket.com/stocks/search?query=7203)
* [株マップ.com/銘柄基本情報](https://jp.kabumap.com/servlets/kabumap/Action?SRC=basic/top/base&codetext=7203)'
* [株Biz/理論株価Web](https://kabubiz.com/riron/2000/2702.php)
* [株Biz/月次Web](https://kabubiz.com/getuji/code/2702.php)
* [Ullet](https://www.ullet.com/7203.html)
* [シェアードリサーチ](https://sharedresearch.jp/ja/companies/6920)
* [logmi](https://finance.logmi.jp/companies?query=7203)
* [証券リサーチセンター](https://holistic-r.org/report/9348/)

## ソースは公開してます

https://github.com/Harurow/chrome.ext.kabu-tantan

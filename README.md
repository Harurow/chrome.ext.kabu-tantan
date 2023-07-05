# Chrome拡張 株リンク

楽天証券、SBI証券のHPに外部の株式情報ページへのリンクを作ります。
銘柄コードにカーソルを合わせると「TradingView」、「株探」、「Yahooファイナンス」へのリンクメニューが表示される

## 対応サイト

### 楽天証券

楽天証券の以下のページの銘柄コード(数値4桁)にカーソルを合わせるとリンクメニューが出ます

* お気に入り
* 保有商品一覧・すべて
* 保有商品一覧・国内株式
* ランキング
* 株価検索

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-1.png?raw=true "楽天証券・お気に入り銘柄")

#### 対応URL

```https://*.rakuten-sec.co.jp/*```

### SBI証券

SBI証券の以下のページの銘柄コード(数値4桁)にカーソルを合わせるとリンクメニューが出ます

* 国内株式
* ポートフォリオ

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-3.png?raw=true "SBI証券・個別銘柄")

#### 対応URL

```https://*.sbisec.co.jp/ETGate/*```
```https://*.sbi.ifis.co.jp/*```

### TradingView

TradingViewの右クリックメニューにYahooファインスと株探へのリンクを追加します

![](https://github.com/Harurow/chrome.ext.kabu-tantan/blob/main/etc/screen-4.png?raw=true "TradingView・コンテキストメニュー")

### 対応URL

```https://jp.tradingview.com/*```

## ソースは公開してます

https://github.com/Harurow/chrome.ext.kabu-tantan

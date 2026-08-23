/** @type {import('stylelint').Config} */
export default {
  extends: [
    'stylelint-config-standard',
    // プロパティの並び順。旧 .csscomb.json の役割を Stylelint に統合したもの
    'stylelint-config-recess-order'
  ],
  ignoreFiles: ['src/third-party/**'],
  rules: {
    // 拡張機能は対象サイトの既存 CSS を上書きするため詳細度の逆転を許容する
    'no-descending-specificity': null,
    // 対象サイト側のハッシュ付きクラス名（例: .button-hw_3o_pb）に合わせる
    'selector-class-pattern': null
  }
}

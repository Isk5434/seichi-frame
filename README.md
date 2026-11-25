# 巡礼フレーム

Google マイマップの167地点と368枚の参考写真を使い、自分の写真との比較や、スマホカメラでの構図合わせができる聖地巡礼Webアプリです。

## GitHub Pages版

GitHub Pagesの公開元は`gh-pages`ブランチのルートです。`main`の変更を公開するには、作業ツリーを確認してから`git subtree push --prefix=legacy origin gh-pages`を実行します。Pages版では、自分の写真と訪問記録をブラウザのIndexedDB / localStorageに保存します。写真はスポットごとに複数枚追加でき、青緑の枠と`MY PHOTO`バッジで参考写真から区別します。

GitHub Pagesは静的ホスティングのため、Pages版の写真は端末間で同期されません。スマホ・PC同期が必要な場合は、下記のCloudflare版を使用します。参考写真は`npm run prepare:pages`で軽量WebPとして`legacy/images/`へ保存済みです。

## 保存と同期

本番環境ではCloudflareを使います。

- D1: 訪問記録と写真の管理情報。
- R2: 自分で撮影・選択した写真と、端末から選んだ参考画像。
- Sites認証: `oai-authenticated-user-id`を所有者キーに使い、利用者ごとのデータを分離。
- IndexedDB / localStorage: オフライン時の端末内コピーと、クラウド移行前データの取り込み。

画像は必要に応じて長辺2048px・JPEG品質86%へ縮小します。1ファイル4MB、1ユーザー合計500MBをアプリ側の上限にしています。クラウド保存に失敗しても端末内コピーを残します。次回オンライン時、同じ写真を選び直すと同期されます。

データ構造は [db/schema.ts](db/schema.ts)、APIは [visits](app/api/visits/route.ts)、[media](app/api/media/route.ts)、[photos](app/api/photos/route.ts) にあります。マイグレーションは`drizzle/`にあります。

## 主な機能

- 地図・キーワード検索・レイヤー表示・現在地からの直線距離順。
- 横並び・半透明重ね合わせ・スライダーによる写真比較。
- 背面カメラ優先のプレビュー、参考写真の透明度・拡大・位置・傾き調整、三分割ガイド。
- 写真と訪問記録のスマホ・PC間同期。
- スポットごとの複数写真追加、`MY PHOTO`枠での識別・選択・削除。
- 外部埋め込みを拒否するGoogle マイマップ画像を、許可した配信元だけサーバー側で中継。
- タブ移動・地点変更・画面非表示でカメラを停止。

## 開発

```powershell
npm ci
npm run db:generate
npm run check
npm run build
```

ローカルD1へマイグレーションを適用します。

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_perpetual_jack_power.sql
npm start
```

通常のUIだけを素早く確認する場合は `node scripts/serve.mjs` で http://localhost:4173 を開きます。この簡易サーバーではクラウドAPIがないため端末内保存にフォールバックします。

## 地点データの更新

出典: https://www.google.com/maps/d/viewer?mid=1OwqKxXjbbbXAVZwbBNazhsavcs1ZWgpQ

```powershell
python scripts/import_map.py --refresh
```

`data/source.kml`を更新せず再変換する場合は `--refresh` を省略します。元データの説明HTMLは実行せず、テキストとHTTPS画像URLだけを抽出します。参考写真の元URLとGoogle マイマップへのリンクは画面に残します。

## 構成

- `legacy/`: 地図・写真比較・カメラUIの配信元ソース。
- `app/`: Vinextの画面入口とD1/R2 API。
- `db/`, `drizzle/`: D1スキーマと変更履歴。
- `scripts/prepare-legacy.mjs`: UIをVinextの公開アセットへコピー。
- `worker/`: Sites向けCloudflare Worker入口。
- `.openai/hosting.json`: 既存Site IDとD1/R2バインディング。

地図ライブラリはLeaflet 1.9.4、背景地図はOpenStreetMap contributorsです。帰属表示と同梱ライセンスは画面・`legacy/vendor/leaflet.LICENSE`にあります。

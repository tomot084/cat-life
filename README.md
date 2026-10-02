# ぷーたんとこころのお部屋

Babylon.jsで動く二匹の部屋。「のんびり過ごす」では、それぞれの猫が部屋を歩き、寝床でうとうとし、食事・水飲み・ボール遊び・タワーへのジャンプを順に楽しみます。ちゅーる・なでる・呼ぶなどの操作もできます。

## ローカル

Node.js 24を使用。

```sh
npm ci
npm run dev
```

http://localhost:5173/ を開きます。

## 操作

| 操作 | PC | スマートフォン |
|---|---|---|
| 猫を選ぶ | 猫をクリック | 猫をタップ |
| 猫を移動 | 猫を約0.4秒長押ししてドラッグ。タワーの中段にも置けます | 猫を長押ししてスワイプ。タワーの中段にも置けます |
| 視点を回す | 猫以外をドラッグ、または猫を短くドラッグ | 猫以外をスワイプ |
| 拡大・縮小 | ホイール | 2本指ピンチ |

猫を離すと床かタワー中段の足場に置けます。床を歩くときは家具ともう一匹を避けます。「ほかの遊び」の「タワーにのぼる」から選択中の猫を呼び寄せることもできます。選択中の猫にはちゅーる・なでるが使えます。呼ぶ、ボール、カメラの寄り、配置と視点のリセット、UI非表示も選べます。一時停止中は反応・エフェクトも止まります。

## GitHub Pages

公開先リポジトリ： https://github.com/tomot084/cat-life
公開URL： https://tomot084.github.io/cat-life/

Settings → Pages → SourceをGitHub Actionsに設定します。mainへのpushまたは手動workflow_dispatchでbuild・監査・distのdeployを実行します。

```sh
PAGES_BUILD=true npm run build
TEST_BASE=/cat-life/ npm run test:production
TEST_BASE=/cat-life/ npm run test:controls
TEST_BASE=/cat-life/ npm run test:ambient
```

baseはoriginまたはActionsのGITHUB_REPOSITORYから取得します。公開先の推測はしません。ブラウザ検証には `npx playwright install chromium` が必要です。

## 公開モデルとCredits

**Tuxedo Cat Animated 2.0** by **DreamNoms** を土台に、ぷーたん・こころ向けに体型・顔・色柄・眼と耳の位置を改変。

- 元モデル： https://sketchfab.com/3d-models/tuxedo-cat-animated-20-783fcb78b55b4394a212c2b6392e1113
- ライセンス： [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 本リポジトリの改変猫モデルもCC BY 4.0で提供。

色柄は頂点色と材質で表現し、写真textureを含みません。公開対象モデルのSHA-256は `config/production-models.json` に記録。`npm run build` はdistの許可リスト・モデルhash・private情報パターン監査を含みます。

## 部屋の外部素材

| 素材 | 作者・元URL | ライセンス |
|---|---|---|
| Cat Tree | [3D Assets (@3dassets)](https://3dassets.dev/assets/companion-animals-and-pet-home-cat-tree-e126b0aa) | CC0 1.0 |
| Cushion Bed | [3D Assets (@3dassets)](https://3dassets.dev/assets/companion-animals-and-pet-home-cushion-bed-27a23ea4) | CC0 1.0 |
| bookcaseOpenLow / books / pillow / plantSmall1 | [Kenney / Furniture Kit](https://kenney.nl/assets/furniture-kit) | CC0 1.0 |

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) は改変・再配布・商用利用可。3D Assetsの2点は配布元でAI生成と表示されています。ファイルはそのまま取り込み、実行時にサイズ・配置・材質を調整しています。画面下の「素材とつくり手 · Credits」から出典を確認できます。

追加6 GLBは合計198,156 bytes、3,734三角形、画像・外部bufferなし。許可リストとSHA-256は `config/production-room-assets.json`。部屋の木目・布・影・ハートはコードで生成します。実行時に外部CDNへアクセスしません。

`npm run build` は猫2点と小物6点をhash・形式・Creditsと照合し、未知のGLBやZIP、画像、source map、symlink、private情報を拒否します。`npm run test:production` はdistだけを配信して三モード・二匹のふれあい・キャンセル・連打・停止再開・視点・モバイル画面・通信を検証します。`npm run test:controls` はタップ、長押し移動、回転、ピンチ、追加アクションのPC/スマホ操作を検証します。

写真・制作途中素材・秘密情報は本リポジトリと公開サイトに含めません。監査の元ZIPとスクリーンショットもdistへコピーしません。

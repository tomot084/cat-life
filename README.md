# ぷーたんとこころのお部屋

Babylon.jsで動く二匹の部屋。のんびり・おさんぽ・おすわり、ドラッグ回転、ホイールズームに対応します。

## ローカル

Node.js 24を使用。

```sh
npm ci
npm run dev
```

http://localhost:5173/ を開きます。

## GitHub Pages

公開先リポジトリ： https://github.com/tomot084/cat-life
公開後の予定URL： https://tomot084.github.io/cat-life/

Settings → Pages → SourceをGitHub Actionsに設定します。mainへのpushまたは手動workflow_dispatchでbuild・監査・distのdeployを実行します。

```sh
PAGES_BUILD=true npm run build
TEST_BASE=/cat-life/ npm run test:production
```

baseはoriginまたはActionsのGITHUB_REPOSITORYから取得します。公開先の推測はしません。ブラウザ検証には `npx playwright install chromium` が必要です。

## 公開モデルとCredits

**Tuxedo Cat Animated 2.0** by **DreamNoms** を土台に、ぷーたん・こころ向けに体型・顔・色柄・眼と耳の位置を改変。

- 元モデル： https://sketchfab.com/3d-models/tuxedo-cat-animated-20-783fcb78b55b4394a212c2b6392e1113
- ライセンス： [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 本リポジトリの改変猫モデルもCC BY 4.0で提供。

色柄は頂点色と材質で表現し、写真textureを含みません。公開対象モデルのSHA-256は `config/production-models.json` に記録。`npm run build` はdistの許可リスト・モデルhash・private情報パターン監査を含みます。

写真・制作途中素材・秘密情報は本リポジトリと公開サイトに含めません。

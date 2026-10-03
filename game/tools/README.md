# Asset pipeline

`public/assets` の素材は Poly Haven (CC0) から取得し、Web 向けに軽量化したものです。

- 元データ: `https://api.polyhaven.com/files/<asset>` から 1k の glTF / テクスチャ / 2k HDRI を取得
- テクスチャ: ImageMagick で 1024px (樹皮は 512px) / JPEG q82 に縮小
- モデル: `optimize-models.mjs` で meshopt により 3〜5% 程度までポリゴン削減、テクスチャ 512px に縮小
  (`npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer sharp` が必要)

  例: `node optimize-models.mjs <srcDir> namaqualand_boulder_03 out.glb 0.05 512`

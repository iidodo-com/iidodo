// Poly Haven (CC0) の高ポリゴン glTF を Web 向けに軽量化する: node optimize-models.mjs <srcDir> <name> <outFile.glb> <ratio> <texSize>
// 依存: @gltf-transform/{core,functions,extensions}, meshoptimizer, sharp
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, textureCompress, prune, dedup, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, name, out, ratio, size] = process.argv.slice(2);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(`${src}/${name}/${name}.gltf`);
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: 0.02, lockBorder: false }),
  prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [Number(size), Number(size)], quality: 80 }),
);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
await io.write(out, doc);
console.log(name, '->', Math.round(tris), 'tris');

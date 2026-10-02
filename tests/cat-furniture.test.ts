import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { ImportMeshAsync, NullEngine, Ray, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TOWER_PERCH } from '../src/placement';

test('the upper bed supports the seated cats on its actual visible surface', async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const result = await ImportMeshAsync(new Uint8Array(await readFile('src/assets/room/cat-tree.glb')), scene, { pluginExtension: '.glb' });
    const root = new TransformNode('tower', scene);
    for (const node of [...result.meshes, ...result.transformNodes]) if (!node.parent) node.parent = root;
    const bounds = root.getHierarchyBoundingVectors(true), center = bounds.min.add(bounds.max).scale(.5);
    const scale = 2.7 / (bounds.max.y - bounds.min.y);
    root.scaling.set(scale * 1.4, scale, scale * 1.4);
    root.position.set(-3.05 - center.x * scale * 1.4, -bounds.min.y * scale, -2.25 - center.z * scale * 1.4);
    for (const mesh of result.meshes) mesh.computeWorldMatrix(true);
    // Largest cat's sitting paw spread plus margin, facing along the long bed axis.
    for (const dx of [-.36, 0, .36]) for (const dz of [-.29, 0, .29]) {
      const ray = new Ray(new Vector3(TOWER_PERCH.x + dx, 4, TOWER_PERCH.z + dz), new Vector3(0, -1, 0));
      const hit = scene.pickWithRay(ray, mesh => result.meshes.includes(mesh));
      assert(hit?.hit && hit.pickedPoint);
      assert(Math.abs(hit.pickedPoint.y - TOWER_PERCH.y) < .015, `Unsupported paw at ${dx}, ${dz}: ${hit.pickedPoint.y}`);
    }
  } finally { scene.dispose(); engine.dispose(); }
});

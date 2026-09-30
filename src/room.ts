import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
function material(scene: Scene, name: string, hex: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(.08,.08,.08);
  return mat;
}

export function createRoom(scene: Scene, shadows: ShadowGenerator): void {
  const wood = material(scene, 'oak', '#d9bb91');
  const wall = material(scene, 'plaster', '#ede5d5');
  const trim = material(scene, 'trim', '#b0bda9');
  const rug = material(scene, 'rug', '#a7b7a1');
  const cushion = material(scene, 'cushion', '#d8a995');
  const box = (name: string, size: number[], position: number[], mat = wood) => {
    const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.material = mat;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
    return mesh;
  };
  box('floor', [9, 0.18, 7], [0, -0.1, 0]);
  for (let x = -4; x <= 4; x += 0.5) box('floor-seam', [0.014, 0.002, 7], [x, -0.008, 0], trim);
  box('back-wall', [9, 2.8, 0.14], [0, 1.3, -3.5], wall);
  box('side-wall', [0.14, 2.8, 7], [-4.5, 1.3, 0], wall);
  box('skirting', [9, 0.13, 0.06], [0, 0.08, -3.4], trim);
  box('rug', [4.9, 0.018, 3.5], [0.3, 0.002, 0.3], rug);
  box('window-frame', [2.8, 1.55, 0.13], [0.2, 1.7, -3.37], wood);
  const sky = material(scene, 'sky', '#bcd6d4');
  sky.emissiveColor = new Color3(0.22, 0.29, 0.29);
  box('window', [2.58, 1.33, 0.04], [0.2, 1.7, -3.28], sky);
  box('window-bar', [0.06, 1.4, 0.06], [0.2, 1.7, -3.23], wood);
  box('window-bar', [2.65, 0.06, 0.06], [0.2, 1.7, -3.23], wood);
  // Furniture sits outside the navigation rectangle; no obstacle pathfinding in Phase 1.
  for (const x of [-2.7, 2.8]) {
    const bed = MeshBuilder.CreateCylinder('cat-bed', { diameter: 1.1, height: 0.14, tessellation: 40 }, scene);
    bed.position = new Vector3(x, 0.07, -2.95);
    bed.material = cushion;
    bed.receiveShadows = true;
    shadows.addShadowCaster(bed);
  }
}

// The map: "Dustline Yard", an original 44 x 36 m walled yard at dusk. Two bombsites
// (A west, B east), three lanes to them — A-long, mid, B-long — with crates, pillars and
// low walls for cover and sightlines worth playing. Every box is a collider for players
// and bots and a surface a bullet stops on. Plain geometry only, no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WAYPOINTS = [
  // id: x, z, neighbours — the graph bots route over (BFS in bots.js).
  { x: 0, z: 15, n: [1, 5, 9] }, // 0 T spawn
  { x: 0, z: 8, n: [0, 2, 13, 14] }, // 1 mid south
  { x: 0, z: 0, n: [1, 3, 13, 14] }, // 2 mid
  { x: 0, z: -8, n: [2, 4, 8, 12] }, // 3 mid north
  { x: 0, z: -15, n: [3, 8, 12] }, // 4 CT spawn
  { x: -11, z: 9, n: [0, 6, 13] }, // 5 A approach
  { x: -17, z: 2, n: [5, 7, 13] }, // 6 A long
  { x: -16, z: -12, n: [6, 8] }, // 7 site A
  { x: -8, z: -9, n: [3, 4, 7, 12] }, // 8 A connector
  { x: 11, z: 9, n: [0, 10, 14] }, // 9 B approach
  { x: 17, z: 2, n: [9, 11, 14] }, // 10 B long
  { x: 16, z: -12, n: [10, 12] }, // 11 site B
  { x: 8, z: -9, n: [3, 4, 8, 11] }, // 12 B connector
  { x: -10, z: 0, n: [1, 2, 5, 6] }, // 13 west mid
  { x: 10, z: 0, n: [1, 2, 9, 10] }, // 14 east mid
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = (hex, rough = 0.92, metal = 0.03) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
  const materials = {
    canvas: mat(PALETTE.canvas),
    surface: mat(PALETTE.surface),
    hairline: mat(PALETTE.hairline),
    accent: mat(PALETTE.accent, 0.6, 0.1),
    ally: mat(PALETTE.ally, 0.6, 0.1),
    enemy: mat(PALETTE.enemy, 0.6, 0.1),
    ink: mat(PALETTE.ink, 0.55, 0.05),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 44 x 36 m, 5 m walls, open sky so one sun reaches every lane.
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 36.4, -22.2, 2.5, 0, 'surface');
  box(0.4, 5, 36.4, 22.2, 2.5, 0, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, -18.2, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, 18.2, 'surface');

  // Site plates: flat markers the bomb is planted on (walk over them, not colliders).
  box(7, 0.06, 7, -16, 0.03, -12, 'accent', false);
  box(7, 0.06, 7, 16, 0.03, -12, 'ally', false);
  // Site letter blocks: big A / B pillars, readable from across the yard.
  box(0.5, 2.2, 2.6, -20.5, 1.1, -12, 'accent');
  box(0.5, 2.2, 2.6, 20.5, 1.1, -12, 'ally');

  // Mid: a broken wall with a gap, a pillar, and a low wall to crouch behind.
  box(1.0, 2.6, 5.0, -3.4, 1.3, 0, 'hairline');
  box(1.0, 2.6, 5.0, 3.4, 1.3, 0, 'hairline');
  box(1.4, 3.4, 1.4, 0, 1.7, -4.6, 'surface');
  box(3.4, 1.0, 0.9, -0.4, 0.5, 5.2, 'hairline');
  box(1.6, 0.8, 1.6, 6.8, 0.4, -3.4, 'hairline');
  box(1.6, 0.8, 1.6, -6.8, 0.4, -3.4, 'hairline');

  // A-long (west lane): staggered crates and a pillar forcing a crossfire.
  box(2.2, 1.1, 2.2, -17.5, 0.55, 6, 'hairline');
  box(2.2, 2.2, 2.2, -18.5, 1.1, -2, 'surface');
  box(1.2, 3.2, 1.2, -13.5, 1.6, -6.5, 'hairline');
  box(3.2, 1.0, 1.2, -10.5, 0.5, 11.5, 'hairline');
  box(1.6, 0.8, 1.6, -19, 0.4, -8.5, 'hairline');
  // A site cover: two crates and a low wall on the plate's edge.
  box(2.0, 1.1, 2.0, -13.2, 0.55, -13.5, 'hairline');
  box(1.2, 1.1, 3.4, -19.5, 0.55, -9, 'hairline');

  // B-long (east lane): mirrored cover, a sniper perch wall and a crate stack.
  box(2.2, 1.1, 2.2, 17.5, 0.55, 6, 'hairline');
  box(2.2, 2.2, 2.2, 18.5, 1.1, -2, 'surface');
  box(1.2, 3.2, 1.2, 13.5, 1.6, -6.5, 'hairline');
  box(3.2, 1.0, 1.2, 10.5, 0.5, 11.5, 'hairline');
  box(1.6, 0.8, 1.6, 19, 0.4, -8.5, 'hairline');
  box(2.0, 1.1, 2.0, 13.2, 0.55, -13.5, 'hairline');
  box(1.2, 1.1, 3.4, 19.5, 0.55, -9, 'hairline');

  // CT side: a raised platform and a pillar splitting the two site connectors.
  box(6.0, 0.5, 2.6, 0, 0.25, -15.6, 'surface');
  box(1.2, 3.0, 1.2, -5.5, 1.5, -13.5, 'hairline');
  box(1.2, 3.0, 1.2, 5.5, 1.5, -13.5, 'hairline');
  // T side: two spawn crates.
  box(2.4, 0.9, 1.2, -4, 0.45, 15.5, 'hairline');
  box(2.4, 0.9, 1.2, 4, 0.45, 15.5, 'hairline');

  // Light: a low amber sun from the west, a cool fill from the east, sky gradient.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 2.1));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 3.1);
  sun.position.set(-14, 16, 6);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.9);
  fill.position.set(10, 9, 12);
  scene.add(fill);

  return {
    colliders,
    shootables,
    group,
    waypoints: WAYPOINTS,
    sites: {
      A: { x: -16, z: -12, r: 3.6, node: 7, label: 'A' },
      B: { x: 16, z: -12, r: 3.6, node: 11, label: 'B' },
    },
    spawns: {
      attackers: [[-3, 15], [0, 16], [3, 15], [-6, 13]],
      defenders: [[-4, -15], [0, -16], [4, -15], [-8, -13]],
    },
    bounds: { x: 21.5, z: 17.5 },
  };
}

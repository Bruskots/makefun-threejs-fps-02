// Five weapons, one table. Each owns its damage, fire rate, magazine, spread and price,
// so the buy menu (main.js) and the view model here read the same numbers. It owns the
// numbers; main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', price: 0, dmg: 26, headMul: 4, gap: 0.22, auto: false, mag: 12, reserve: 48, reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, kick: 0.012, pellets: 1, zoom: 1, len: 0.3 },
  rifle: { id: 'rifle', name: 'VK-47 Rifle', price: 2700, dmg: 34, headMul: 3, gap: 0.1, auto: true, mag: 30, reserve: 90, reload: 2.0, spreadStill: 0.0025, spreadMove: 0.03, kick: 0.02, pellets: 1, zoom: 1, len: 0.62 },
  smg: { id: 'smg', name: 'Hornet-9 SMG', price: 1500, dmg: 22, headMul: 3, gap: 0.07, auto: true, mag: 32, reserve: 96, reload: 1.7, spreadStill: 0.006, spreadMove: 0.035, kick: 0.012, pellets: 1, zoom: 1, len: 0.48 },
  shotgun: { id: 'shotgun', name: 'Breacher-12', price: 1700, dmg: 11, headMul: 2.5, gap: 0.85, auto: false, mag: 6, reserve: 24, reload: 2.6, spreadStill: 0.05, spreadMove: 0.06, kick: 0.05, pellets: 8, zoom: 1, len: 0.58 },
  sniper: { id: 'sniper', name: 'Longbow .50', price: 4750, dmg: 95, headMul: 2.5, gap: 1.3, auto: false, mag: 5, reserve: 15, reload: 3.2, spreadStill: 0.0005, spreadMove: 0.04, kick: 0.06, pellets: 1, zoom: 4, len: 0.8 },
};
export const WEAPON_ORDER = ['pistol', 'rifle', 'smg', 'shotgun', 'sniper'];
const MOVE_REFERENCE = 5.2;
const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  let model = null;
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Per-weapon ammo persists across switches within a round.
  const ammo = {};
  let def = WEAPONS.pistol;
  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, scoped: false };

  function buildModel(d) {
    if (model) camera.remove(model);
    model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, d.len * 0.6), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, d.len * 0.6), grip);
    barrel.position.set(0, 0.025, -d.len * 0.55);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, d.len * 0.32);
    model.add(receiver, barrel, stock);
    if (d.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    if (d.id === 'shotgun') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.2), dark);
      pump.position.set(0, -0.03, -d.len * 0.4);
      model.add(pump);
    }
    if (d.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
      mag.position.set(0, -0.12, 0.02);
      model.add(mag);
    }
    model.position.set(0.25, -0.23, -0.52);
    model.scale.setScalar(0.85);
    camera.add(model);
  }
  buildModel(def);

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    if (model) {
      model.position.z = -0.52 + state.kick;
      model.rotation.x = state.kick * 2.2;
      model.visible = !state.scoped;
    }
    flash.visible = state.flash > 0 && !state.scoped;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (model) model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() { return def; },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.03 + def.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      const base = state.scoped ? def.spreadStill * 0.5 : def.spreadStill;
      return base + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMove;
    },
    equip(id) {
      if (def.id === id) return;
      ammo[def.id] = { mag: state.mag, reserve: state.reserve };
      def = WEAPONS[id];
      const saved = ammo[id];
      state.mag = saved ? saved.mag : def.mag;
      state.reserve = saved ? saved.reserve : def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
      buildModel(def);
    },
    refill(id) {
      // A fresh round: full magazine and reserve for the owned weapon.
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      if (def.id === id) {
        state.mag = WEAPONS[id].mag;
        state.reserve = WEAPONS[id].reserve;
        state.cooldown = 0;
        state.reloadLeft = 0;
      }
    },
    setScoped(on) { state.scoped = on && def.zoom > 1; },
  };
}

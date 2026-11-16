// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Dustline Yard: a round-based tactical FPS. Vanguard (you + 3 bots) attack two bombsites
// against 4 Jackal bots. Rounds end by elimination, by the bomb detonating, by a defuse,
// or by the clock. Money earned each round buys weapons, grenades and armour in the buy
// phase. First to 5 rounds takes the match.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, WEAPON_ORDER } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const FUSE_TIME = 35;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const WIN_ROUNDS = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#33291f'); // dusk sky above the yard walls
scene.fog = new THREE.Fog(new THREE.Color('#33291f'), 34, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud(world);
const audio = createAudio();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const _v = new THREE.Vector3();

const body = player.state;
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

// ---- Match state: one place, kept apart from rendering. ----
const match = {
  phase: 'buy', // buy | live | over
  round: 1,
  scoreA: 0,
  scoreD: 0,
  money: 800,
  kills: 0,
  deaths: 0,
  owned: new Set(['pistol']),
  grenades: 0,
  armor: 0,
  health: 100,
  playerAlive: true,
  timer: ROUND_TIME,
  site: 'A',
  matchOver: false,
  plantProgress: 0,
  defuseProgress: 0,
  suppressPause: false,
};
const bomb = { state: 'carried', site: null, x: 0, z: 0, fuse: 0, carrier: 'player' };
let lastNoise = { x: 0, z: 0, team: 'attackers', at: -99 };
const grenades = [];
const explosions = [];

// The planted / dropped charge, visible in the world.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.3 }),
);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.enemy), 0, 4);
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// ---- Entities the bots see: the player and one wrapper per bot. ----
const playerEnt = {
  kind: 'player', pos: body.position, y: 0,
  get eye() { return body.eye; },
  get alive() { return match.playerAlive; },
  get speed() { return player.groundSpeed(); },
  team: 'attackers', name: 'You',
};
let botEnts = [];
const bots = createBots(scene, world, {
  random,
  getEntities: () => [playerEnt, ...botEnts],
  damageEntity,
  bomb: () => bomb,
  lastNoise,
  hearShot(x, z, team) { lastNoise.x = x; lastNoise.z = z; lastNoise.team = team; lastNoise.at = elapsed; },
  onPlant(site, bot) { plantBomb(site, bot.pos.x, bot.pos.z, bot.name); },
  onDefuse(bot, dt) {
    match.defuseProgress += dt / DEFUSE_TIME;
    hud.setPlant(Math.min(1, match.defuseProgress), `${bot.name} is defusing — stop them!`);
  },
  onDefuseDone() { endRound('defenders', 'Bomb defused', 'The Jackals cut the wires in time.'); },
});
botEnts = bots.bots.map((bot) => ({
  kind: 'bot', bot, pos: bot.pos, y: 0, eye: 1.55,
  get alive() { return bot.alive; },
  get speed() { return bot.speed; },
  team: bot.team, name: bot.name,
}));
const shootables = world.shootables.concat(bots.hitMeshes);

function ownedList() { return [...match.owned]; }

function startMatch() {
  match.round = 1;
  match.scoreA = 0;
  match.scoreD = 0;
  match.money = 800;
  match.kills = 0;
  match.deaths = 0;
  match.owned = new Set(['pistol']);
  match.grenades = 0;
  match.armor = 0;
  match.matchOver = false;
  weapon.equip('pistol');
  startRound();
}

function startRound() {
  match.site = random() < 0.5 ? 'A' : 'B';
  match.phase = 'buy';
  match.timer = ROUND_TIME;
  match.health = 100;
  match.playerAlive = true;
  match.plantProgress = 0;
  match.defuseProgress = 0;
  match.suppressPause = false;
  bomb.state = 'carried';
  bomb.site = null;
  bomb.carrier = 'player';
  bomb.fuse = 0;
  bombMesh.visible = false;
  for (const id of match.owned) weapon.refill(id);
  weapon.equip(ownedList().includes('rifle') ? 'rifle' : 'pistol');
  if (!match.owned.has(weapon.def.id)) weapon.equip('pistol');
  const spawn = world.spawns.attackers[0];
  body.position.set(spawn[0], 0, spawn[1]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  bots.reset(world.spawns, match.site);
  hud.setHealth(match.health, match.armor);
  hud.setMoney(match.money);
  hud.setScore(match.scoreA, match.scoreD);
  hud.setRound(match.round, match.scoreA, match.scoreD);
  hud.setTimer(match.timer);
  hud.setBomb('Bomb with you — plant on A or B');
  hud.setWeapon(weapon.def.name, match.grenades);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setPlant(null);
  hud.showOverlay('buy', { round: match.round, money: match.money, owned: ownedList() });
  syncCamera();
}

function deploy() {
  if (match.phase === 'buy') {
    match.phase = 'live';
    hud.hideOverlay();
    hud.banner(`Round ${match.round}`, `Plant on ${match.site} — or wipe out the Jackals`, 2200);
    audio.unlock();
    input.requestLock();
  } else if (match.phase === 'over') {
    if (match.matchOver) startMatch();
    else { match.round += 1; startRound(); }
  }
}

hud.onPlay(deploy);
hud.onBuy((id) => buy(id));

function buy(id) {
  if (match.phase !== 'buy') return;
  const price = id === 'grenade' ? 300 : id === 'armor' ? 650 : WEAPONS[id].price;
  if (id === 'grenade' && match.grenades >= 2) { audio.denied(); return; }
  if (id === 'armor' && match.armor >= 100) { audio.denied(); return; }
  if (id !== 'grenade' && id !== 'armor' && match.owned.has(id)) { weapon.equip(id); hud.setWeapon(weapon.def.name, match.grenades); hud.setAmmo(weapon.state.mag, weapon.state.reserve); return; }
  if (match.money < price) { audio.denied(); return; }
  match.money -= price;
  if (id === 'grenade') match.grenades += 1;
  else if (id === 'armor') match.armor = 100;
  else { match.owned.add(id); weapon.equip(id); }
  audio.buy();
  hud.setMoney(match.money);
  hud.setHealth(match.health, match.armor);
  hud.setWeapon(weapon.def.name, match.grenades);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.renderBuy(match.money, ownedList());
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (match.phase === 'live') hud.hideOverlay();
  } else if (match.phase === 'live' && match.playerAlive && !match.suppressPause) {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function hearPlayerShot() { lastNoise.x = body.position.x; lastNoise.z = body.position.z; lastNoise.team = 'attackers'; lastNoise.at = elapsed; }

function damageEntity(ent, dmg, attacker, isHead) {
  if (!ent.alive) return false;
  if (ent.kind === 'bot') {
    const bot = ent.bot;
    let remaining = dmg;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.health -= remaining;
    bot.channel = 0; // damage interrupts a plant or a defuse
    if (ent.kind === 'bot' && bot.team === 'defenders') match.defuseProgress = 0;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0;
      hud.kill(`${attacker} ▸ ${bot.name}${isHead ? ' (headshot)' : ''}`);
      if (bot.hasBomb) {
        bot.hasBomb = false;
        bomb.state = 'dropped';
        bomb.x = bot.pos.x;
        bomb.z = bot.pos.z;
        bomb.carrier = null;
        hud.setBomb('Bomb dropped — pick it up');
      }
      if (attacker === 'You') {
        match.money += 300;
        match.kills += 1;
        hud.setMoney(match.money);
        audio.kill();
      }
      return true;
    }
    return false;
  }
  // The player.
  let remaining = dmg;
  if (match.armor > 0) {
    const absorbed = Math.min(match.armor, remaining * 0.5);
    match.armor -= absorbed;
    remaining -= absorbed;
  }
  match.health -= remaining;
  hud.setHealth(match.health, match.armor);
  hud.damageFlash();
  audio.hurt();
  if (match.health <= 0) {
    match.health = 0;
    match.playerAlive = false;
    match.deaths += 1;
    hud.kill(`${attacker} ▸ You${isHead ? ' (headshot)' : ''}`);
    hud.setHealth(0, match.armor);
    if (bomb.state === 'carried' && bomb.carrier === 'player') {
      bomb.state = 'dropped';
      bomb.x = body.position.x;
      bomb.z = body.position.z;
      bomb.carrier = null;
      hud.setBomb('Bomb dropped — a teammate will grab it');
    }
    match.suppressPause = true;
    hud.banner('You are down', 'Your team fights on — watch the minimap', 3000);
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { match.suppressPause = false; }, 500);
  }
  return match.health <= 0;
}

function plantBomb(site, x, z, byName) {
  bomb.state = 'planted';
  bomb.site = site;
  bomb.x = x;
  bomb.z = z;
  bomb.fuse = FUSE_TIME;
  bomb.carrier = null;
  match.money += 300;
  hud.setMoney(match.money);
  hud.setBomb(`Bomb planted on ${site} — ${FUSE_TIME}s to detonation`);
  hud.banner(`Charge planted on ${site}`, `${byName} set the charge — hold the site`, 2600);
  hud.kill(`${byName} planted the charge on ${site}`);
  audio.plant();
}

function endRound(winner, title, copy) {
  if (match.phase !== 'live') return;
  match.phase = 'over';
  if (winner === 'attackers') match.scoreA += 1;
  else match.scoreD += 1;
  match.money += winner === 'attackers' ? 3250 : 1900;
  if (winner === 'attackers') audio.roundWin();
  else audio.roundLose();
  hud.setScore(match.scoreA, match.scoreD);
  hud.setRound(match.round, match.scoreA, match.scoreD);
  hud.setPlant(null);
  const won = winner === 'attackers';
  match.matchOver = match.scoreA >= WIN_ROUNDS || match.scoreD >= WIN_ROUNDS;
  hud.banner(won ? 'Round won' : 'Round lost', `${title} — Vanguard ${match.scoreA} : ${match.scoreD} Jackals`, 3000);
  hud.showOverlay('roundEnd', {
    title: match.matchOver ? (match.scoreA >= WIN_ROUNDS ? 'Match won — Dustline is yours' : 'Match lost — the Jackals hold the yard') : (won ? `Round ${match.round} won` : `Round ${match.round} lost`),
    copy: `${title}. ${copy} Vanguard ${match.scoreA} — ${match.scoreD} Jackals. ${match.matchOver ? '' : 'Buy up and go again.'}`,
    matchOver: match.matchOver,
  });
  if (document.pointerLockElement) document.exitPointerLock();
}

function checkRoundEnd() {
  const attackersAlive = (match.playerAlive ? 1 : 0) + bots.botsAlive('attackers');
  const defendersAlive = bots.botsAlive('defenders');
  if (bomb.state === 'planted') {
    if (defendersAlive === 0) { endRound('attackers', 'Site secured', 'No Jackal is left to cut the wires.'); return; }
    return; // the fuse decides it
  }
  if (attackersAlive === 0) { endRound('defenders', 'Team wiped', 'Every Vanguard is down and the charge never went off.'); return; }
  if (defendersAlive === 0) { endRound('attackers', 'Team wiped', 'Every Jackal is down.'); return; }
  if (match.timer <= 0) { endRound('defenders', 'Time expired', 'The charge was never planted.'); }
}

function shoot(spread) {
  if (!weapon.takeRound()) { audio.dry(); return false; }
  const def = weapon.def;
  hearPlayerShot();
  audio.shot(def.id);
  let anyHit = false;
  let anyKill = false;
  for (let p = 0; p < def.pellets; p += 1) {
    camera.getWorldDirection(direction);
    const s = def.pellets > 1 ? spread * 1.6 : spread;
    direction.x += (random() * 2 - 1) * s;
    direction.y += (random() * 2 - 1) * s;
    direction.z += (random() * 2 - 1) * s;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : camera.position.clone().addScaledVector(direction, 60);
    bots.addTracer(camera.position, end, 0xe8a020);
    if (hit && hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      if (!bot.alive) continue;
      const dist = hit.distance;
      const isHead = hit.object.userData.part === 'head';
      let dmg = def.dmg * (isHead ? def.headMul : 1);
      dmg *= Math.max(0.6, 1 - dist * 0.005); // damage falls off with range
      const ent = botEnts.find((e) => e.bot === bot);
      const killed = damageEntity(ent, dmg, 'You', isHead);
      anyHit = true;
      if (killed) anyKill = true;
      hud.hitMarker(killed, shot ? 4000 : 90);
      if (!killed) audio.hit();
    }
  }
  weapon.pullTrigger();
  player.recoil(0.009 + def.kick * 0.4 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return anyHit || anyKill;
}

function throwGrenade() {
  if (match.grenades <= 0 || !match.playerAlive) return;
  match.grenades -= 1;
  hud.setWeapon(weapon.def.name, match.grenades);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.4, metalness: 0.5 }),
  );
  camera.getWorldDirection(direction);
  mesh.position.copy(camera.position);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: direction.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)).add(new THREE.Vector3(body.velocity.x, 0, body.velocity.z)),
    fuse: 1.8,
  });
  audio.shot('pistol');
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  const pos = g.mesh.position.clone();
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85 }),
  );
  flash.position.copy(pos);
  scene.add(flash);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 18);
  light.position.copy(pos);
  scene.add(light);
  explosions.push({ mesh: flash, light, life: 0.35 });
  audio.explode();
  hearPlayerShot();
  player.recoil(0.05, (random() * 2 - 1) * 0.03);
  for (const ent of [playerEnt, ...botEnts]) {
    if (!ent.alive) continue;
    const d = Math.hypot(ent.pos.x - pos.x, ent.pos.z - pos.z);
    if (d > 7) continue;
    const dmg = 20 + 110 * (1 - d / 7);
    if (ent.kind === 'player') damageEntity(ent, dmg, 'Frag grenade', false);
    else damageEntity(ent, dmg, 'You', false);
  }
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 13 * dt;
    const prev = g.mesh.position.clone();
    g.mesh.position.addScaledVector(g.vel, dt);
    const p = g.mesh.position;
    if (p.y < 0.1) { p.y = 0.1; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    let inside = null;
    for (const c of world.colliders) if (c.containsPoint(p)) { inside = c; break; }
    if (inside) {
      g.mesh.position.copy(prev);
      if (Math.abs(g.vel.x) >= Math.abs(g.vel.z)) g.vel.x *= -0.5;
      else g.vel.z *= -0.5;
    }
    if (g.fuse <= 0) { explodeGrenade(g); grenades.splice(i, 1); }
  }
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const e = explosions[i];
    e.life -= dt;
    const k = Math.max(0, e.life / 0.35);
    e.mesh.scale.setScalar(1 + (1 - k) * 5);
    e.mesh.material.opacity = k * 0.85;
    e.light.intensity = k * 60;
    if (e.life <= 0) {
      scene.remove(e.mesh, e.light);
      e.mesh.geometry.dispose();
      explosions.splice(i, 1);
    }
  }
}

function step(dt) {
  elapsed += dt;
  if (match.phase !== 'live') {
    weapon.step(dt);
    return;
  }
  match.timer -= dt;
  if (match.playerAlive) player.step(dt, input.state.keys);
  weapon.step(dt);
  bots.step(dt, elapsed);
  stepGrenades(dt);

  // Bomb: fuse, planting by the player, pickup of a dropped charge.
  if (bomb.state === 'planted') {
    bomb.fuse -= dt;
    bombLight.intensity = 4 + Math.sin(elapsed * 8) * 3;
    hud.setBomb(`Bomb planted on ${bomb.site} — ${Math.max(0, Math.ceil(bomb.fuse))}s`);
    if (Math.ceil(bomb.fuse) !== Math.ceil(bomb.fuse + dt)) audio.beep();
    if (bomb.fuse <= 0) {
      for (const ent of [playerEnt, ...botEnts]) {
        if (!ent.alive) continue;
        const d = Math.hypot(ent.pos.x - bomb.x, ent.pos.z - bomb.z);
        if (d < 9) damageEntity(ent, 200, 'The charge', false);
      }
      endRound('attackers', 'Bomb detonated', `The charge on site ${bomb.site} went off.`);
      return;
    }
  }
  if (bomb.state === 'carried' && bomb.carrier === 'player' && match.playerAlive) {
    const site = Object.values(world.sites).find((s) => Math.hypot(body.position.x - s.x, body.position.z - s.z) < s.r);
    if (site && input.state.keys.has('KeyE')) {
      match.plantProgress += dt / PLANT_TIME;
      hud.setPlant(Math.min(1, match.plantProgress), `Planting on ${site.label} — hold E`);
      if (match.plantProgress >= 1) {
        match.plantProgress = 0;
        hud.setPlant(null);
        plantBomb(site.label, site.x, site.z, 'You');
      }
    } else {
      if (match.plantProgress > 0) match.plantProgress = Math.max(0, match.plantProgress - dt / PLANT_TIME);
      if (match.plantProgress === 0) hud.setPlant(null);
      else hud.setPlant(match.plantProgress, 'Planting…');
    }
  }
  if (bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(bomb.x, 0.12, bomb.z);
    if (match.playerAlive && Math.hypot(body.position.x - bomb.x, body.position.z - bomb.z) < 1.6) {
      bomb.state = 'carried';
      bomb.carrier = 'player';
      bombMesh.visible = false;
      hud.setBomb('Bomb with you — plant on A or B');
      hud.kill('You picked up the charge');
    } else {
      for (const bot of bots.bots) {
        if (bot.alive && bot.team === 'attackers' && Math.hypot(bot.pos.x - bomb.x, bot.pos.z - bomb.z) < 1.6) {
          bot.hasBomb = true;
          bomb.state = 'carried';
          bomb.carrier = bot.name;
          bombMesh.visible = false;
          hud.setBomb(`${bot.name} carries the bomb`);
          hud.kill(`${bot.name} picked up the charge`);
          break;
        }
      }
    }
  }
  if (bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(bomb.x, 0.12, bomb.z);
  }
  hud.setTimer(match.timer);
  checkRoundEnd();
}

let prevFiring = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (match.playerAlive) player.look(look.x, look.y);
    // Edge-triggered keys.
    if (input.pressed('KeyR')) { weapon.reload(); audio.reload(); }
    if (input.pressed('KeyG')) throwGrenade();
    if (input.pressed('Enter') && (match.phase === 'buy' || match.phase === 'over')) deploy();
    if (match.phase === 'buy') {
      if (input.pressed('Digit1')) buy('rifle');
      if (input.pressed('Digit2')) buy('smg');
      if (input.pressed('Digit3')) buy('shotgun');
      if (input.pressed('Digit4')) buy('sniper');
      if (input.pressed('Digit5')) buy('grenade');
      if (input.pressed('Digit6')) buy('armor');
    } else if (match.phase === 'live') {
      for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
        if (input.pressed(`Digit${i + 1}`) && match.owned.has(WEAPON_ORDER[i])) {
          weapon.equip(WEAPON_ORDER[i]);
          hud.setWeapon(weapon.def.name, match.grenades);
          hud.setAmmo(weapon.state.mag, weapon.state.reserve);
        }
      }
    }
    // Firing: automatic weapons hold, semi-automatic fire once per press.
    const firing = input.state.firing && match.phase === 'live' && match.playerAlive;
    if (firing && weapon.ready() && (weapon.def.auto || !prevFiring)) {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    }
    prevFiring = input.state.firing;
    // Sniper scope on right mouse.
    weapon.setScoped(input.state.aiming && match.phase === 'live');
    const targetFov = weapon.state.scoped ? 74 / weapon.def.zoom : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    hud.setCrosshair(4 + weapon.spread(player.groundSpeed()) * 500);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setTimer(match.timer);
    hud.drawMinimap(body.position, body.yaw, bots.bots, bomb);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  if (name === 'start') {
    body.position.set(0, 0, 14);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.showOverlay('start');
    hud.setTimer(ROUND_TIME);
  } else if (name === 'play') {
    match.phase = 'live';
    match.timer = 85;
    body.position.set(0, 0, 8);
    // Put two Jackals in view down mid and A-long for the action shot.
    const e0 = bots.bots.find((b) => b.team === 'defenders');
    const e1 = bots.bots.filter((b) => b.team === 'defenders')[1];
    if (e0) { e0.pos.set(0, 0, 2); e0.goalNode = 2; e0.path = []; }
    if (e1) { e1.pos.set(-13, 0, -2); e1.goalNode = 6; e1.path = []; }
    settle(20);
    const target = e0 || bots.bots[0];
    aimAt(new THREE.Vector3(target.pos.x, 1.56, target.pos.z));
    shoot(0);
    settle(8);
    hud.setTimer(match.timer);
    hud.setBomb('Bomb with you — plant on A or B');
  } else {
    // 'end': a round just won at site A.
    match.phase = 'over';
    match.scoreA = 3;
    match.scoreD = 2;
    match.round = 6;
    match.money = 4050;
    body.position.set(-10, 0, -6);
    const e0 = bots.bots.find((b) => b.team === 'defenders');
    if (e0) { e0.pos.set(-16, 0, -10); e0.alive = false; e0.fall = 1; e0.group.rotation.x = -1.45; }
    settle(10);
    aimAt(new THREE.Vector3(-16, 1.2, -12));
    hud.setScore(3, 2);
    hud.setRound(6, 3, 2);
    hud.setMoney(4050);
    hud.setTimer(0);
    hud.setBomb('Bomb detonated on A');
    hud.banner('Round won', 'Bomb detonated — Vanguard 3 : 2 Jackals', 60000);
    hud.kill('You ▸ Vex (headshot)');
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setHealth(match.health, match.armor);
  hud.drawMinimap(body.position, body.yaw, bots.bots, bomb);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startMatch();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);

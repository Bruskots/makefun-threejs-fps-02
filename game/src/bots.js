// Bots: 3 allies and 4 enemies that play the round. Each bot routes over the map's
// waypoint graph (BFS), holds positions, reacts to gunfire it hears, and fights with
// burst fire when it has line of sight. Attackers push a site and plant; defenders hold
// the sites, rotate to noise, and defuse a planted bomb. One fixed-step update per bot,
// no allocations in the hot loop beyond a reused raycaster and temp vectors.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const WALK_SPEED = 3.4;
const RUSH_SPEED = 4.6;
const EYE = 1.55;
const HEALTH = 100;
const BOT_DMG = 24;
const NAMES_ALLY = ['Rook', 'Sable', 'Wren'];
const NAMES_ENEMY = ['Vex', 'Koda', 'Mara', 'Ilya'];

const _ray = new THREE.Raycaster();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Box3();

function bfsPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of waypoints[cur].n) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === to) {
        const path = [to];
        let c = to;
        while (c !== from) { c = prev[c]; path.unshift(c); }
        return path;
      }
      queue.push(n);
    }
  }
  return [to];
}

export function createBots(scene, world, ctx) {
  const waypoints = world.waypoints;
  const colliders = world.colliders;
  const shootables = world.shootables;
  const bots = [];
  const hitMeshes = [];
  const tracers = [];

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.6, metalness: 0.05 });
  const enemyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.6, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.18, 0.55, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);

  function makeBot(team, name, index) {
    const group = new THREE.Group();
    const mat = team === 'attackers' ? allyMat : enemyMat;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.02;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.56;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.13, 0.28, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.13, 0.28, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.2, 1.05, -0.35);
    group.add(torso, head, legL, legR, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(group);
    const bot = {
      group, torso, head, team, name, index,
      health: HEALTH, armor: 0, alive: true,
      pos: group.position, yaw: 0, speed: 0,
      path: [], pathIdx: 0, goalNode: -1, holdUntil: 0, thinkAt: 0,
      target: null, lastSeen: new THREE.Vector3(), lastSeenAt: -99,
      burstLeft: 0, shootTimer: 0, fall: 0, channel: 0, hasBomb: false,
      accuracy: 0.5 + ctx.random() * 0.15, site: 'A',
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  NAMES_ALLY.forEach((n, i) => makeBot('attackers', n, i));
  NAMES_ENEMY.forEach((n, i) => makeBot('defenders', n, i));

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const dx = waypoints[i].x - x;
      const dz = waypoints[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setGoal(bot, node, time) {
    if (bot.goalNode === node && bot.path.length) return;
    bot.goalNode = node;
    bot.path = bfsPath(waypoints, nearestNode(bot.pos.x, bot.pos.z), node);
    bot.pathIdx = 0;
    bot.holdUntil = 0;
  }

  function overlaps(x, z) {
    _probe.min.set(x - RADIUS, 0.02, z - RADIUS);
    _probe.max.set(x + RADIUS, HEIGHT - 0.02, z + RADIUS);
    for (const c of colliders) if (_probe.intersectsBox(c)) return true;
    return false;
  }

  function hasLOS(fromPos, toPos) {
    _from.set(fromPos.x, EYE, fromPos.z);
    _to.set(toPos.x, toPos.y, toPos.z);
    _dir.subVectors(_to, _from);
    const dist = _dir.length();
    if (dist < 0.01) return true;
    _dir.divideScalar(dist);
    _ray.set(_from, _dir);
    _ray.far = dist;
    const hit = _ray.intersectObjects(shootables, false)[0];
    return !hit || hit.distance > dist - 0.4;
  }

  function addTracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    scene.add(line);
    tracers.push({ line, life: 0.09 });
  }

  function visibleEnemy(bot, time) {
    const entities = ctx.getEntities();
    let best = null;
    let bestD = Infinity;
    for (const e of entities) {
      if (!e.alive || e.team === bot.team) continue;
      const dx = e.pos.x - bot.pos.x;
      const dz = e.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 42 || dist >= bestD) continue;
      _to.set(e.pos.x, e.pos.y + (e.eye || 1.4), e.pos.z);
      if (!hasLOS(bot.pos, _to)) continue;
      best = e;
      bestD = dist;
    }
    return best ? { entity: best, dist: bestD } : null;
  }

  function chooseGoal(bot, time) {
    const bomb = ctx.bomb();
    if (bot.team === 'defenders') {
      if (bomb.state === 'planted') { setGoal(bot, world.sites[bomb.site].node, time); return; }
      const noise = ctx.lastNoise;
      if (noise && noise.team === 'attackers' && time - noise.at < 6) {
        setGoal(bot, nearestNode(noise.x, noise.z), time);
        return;
      }
      // Hold a site or mid; rotate to a neighbouring hold now and then.
      if (bot.goalNode < 0 || time > bot.holdUntil) {
        const holds = bot.index % 2 === 0 ? [7, 8, 3] : [11, 12, 3];
        const node = holds[Math.floor(ctx.random() * holds.length)];
        setGoal(bot, node, time);
        bot.holdUntil = time + 6 + ctx.random() * 6;
      }
      return;
    }
    // Attackers.
    if (bomb.state === 'planted') {
      // Defend the planted bomb: hold near its site.
      setGoal(bot, world.sites[bomb.site].node, time);
      return;
    }
    if (bot.hasBomb) {
      setGoal(bot, world.sites[bot.site].node, time);
      return;
    }
    if (bomb.state === 'dropped') {
      setGoal(bot, nearestNode(bomb.x, bomb.z), time);
      return;
    }
    if (bot.goalNode < 0 || time > bot.holdUntil) {
      setGoal(bot, world.sites[bot.site].node, time);
      bot.holdUntil = time + 20;
    }
  }

  function stepBot(bot, dt, time) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
      }
      return;
    }
    // Think on a stagger so all bots never raycast on the same step.
    if (time >= bot.thinkAt) {
      bot.thinkAt = time + 0.22 + ctx.random() * 0.1;
      const seen = visibleEnemy(bot, time);
      if (seen) {
        bot.target = seen.entity;
        bot.lastSeen.set(seen.entity.pos.x, seen.entity.pos.y, seen.entity.pos.z);
        bot.lastSeenAt = time;
      } else if (time - bot.lastSeenAt > 2.5) bot.target = null;
      if (!bot.target) chooseGoal(bot, time);
    }

    const bomb = ctx.bomb();
    // Planting: the bomb carrier channels on the site plate.
    if (bot.hasBomb && bomb.state !== 'planted') {
      const site = world.sites[bot.site];
      const d = Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z);
      if (d < site.r) {
        bot.channel += dt;
        if (bot.channel >= 3) { bot.channel = 0; ctx.onPlant(bot.site, bot); }
        return; // stand still and plant
      }
      bot.channel = 0;
    }
    // Defusing: a defender channels on the planted bomb.
    if (bot.team === 'defenders' && bomb.state === 'planted') {
      const d = Math.hypot(bot.pos.x - bomb.x, bot.pos.z - bomb.z);
      if (d < 2.6) {
        bot.channel += dt;
        ctx.onDefuse(bot, dt);
        if (bot.channel >= 5) { bot.channel = 0; ctx.onDefuseDone(bot); }
        return;
      }
      bot.channel = 0;
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = WALK_SPEED;
    let facing = null;
    if (bot.target) {
      // Engage: stop, face the enemy, fire in bursts.
      const e = bot.target;
      const dx = e.pos.x - bot.pos.x;
      const dz = e.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      facing = Math.atan2(-dx, -dz);
      bot.yaw = facing;
      // Strafe a little so a duel is not two statues.
      const strafe = Math.sin(time * 1.3 + bot.index * 2.1) * 0.7;
      moveX = (-dz / dist) * strafe;
      moveZ = (dx / dist) * strafe;
      speed = 1.1;
      bot.shootTimer -= dt;
      if (bot.shootTimer <= 0) {
        if (bot.burstLeft <= 0) { bot.burstLeft = 3 + Math.floor(ctx.random() * 3); bot.shootTimer = 0.55 + ctx.random() * 0.5; }
        else {
          bot.burstLeft -= 1;
          bot.shootTimer = 0.11;
          fireAt(bot, e, dist, time);
        }
      }
    } else if (bot.pathIdx < bot.path.length) {
      const node = waypoints[bot.path[bot.pathIdx]];
      const dx = node.x - bot.pos.x;
      const dz = node.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.9) { bot.pathIdx += 1; }
      else {
        moveX = dx / dist;
        moveZ = dz / dist;
        speed = bot.hasBomb || bot.goalNode === 7 || bot.goalNode === 11 ? RUSH_SPEED : WALK_SPEED;
        facing = Math.atan2(-dx, -dz);
      }
    }
    if (facing !== null) bot.yaw = facing;
    bot.group.rotation.y = bot.yaw;
    bot.speed = Math.hypot(moveX, moveZ) * speed;
    if (bot.speed > 0.01) {
      const nx = bot.pos.x + moveX * speed * dt;
      if (!overlaps(nx, bot.pos.z)) bot.pos.x = nx;
      const nz = bot.pos.z + moveZ * speed * dt;
      if (!overlaps(bot.pos.x, nz)) bot.pos.z = nz;
      bot.pos.x = Math.max(-21.4, Math.min(21.4, bot.pos.x));
      bot.pos.z = Math.max(-17.4, Math.min(17.4, bot.pos.z));
      // Walk bob: legs swing while moving.
      const bob = Math.sin(time * 9 + bot.index) * 0.12;
      bot.group.children[2].rotation.x = bob;
      bot.group.children[3].rotation.x = -bob;
    }
  }

  function fireAt(bot, target, dist, time) {
    _from.set(bot.pos.x, EYE, bot.pos.z);
    _to.set(target.pos.x, target.pos.y + (target.eye || 1.4), target.pos.z);
    // Misses land near the target, never through walls: the tracer ends on the wall.
    _dir.subVectors(_to, _from).normalize();
    _ray.set(_from, _dir);
    _ray.far = 60;
    const wall = _ray.intersectObjects(shootables, false)[0];
    const wallDist = wall ? wall.distance : 60;
    const targetSpeed = target.speed || 0;
    const hitP = Math.max(0.08, Math.min(0.72, bot.accuracy - dist * 0.009 - targetSpeed * 0.03));
    const hit = ctx.random() < hitP && dist < wallDist;
    const end = hit ? _to.clone() : _from.clone().addScaledVector(_dir, Math.min(wallDist, dist + (ctx.random() * 2 - 1) * 1.2));
    if (!hit) { end.y += (ctx.random() * 2 - 1) * 0.8; end.x += (ctx.random() * 2 - 1) * 0.8; }
    addTracer(_from, end, bot.team === 'attackers' ? 0x4db6a6 : 0xc94f42);
    ctx.hearShot(bot.pos.x, bot.pos.z, bot.team);
    if (hit) {
      const head = ctx.random() < 0.09;
      ctx.damageEntity(target, head ? BOT_DMG * 3 : BOT_DMG, bot.name, head);
    }
  }

  return {
    bots,
    hitMeshes,
    nearestNode,
    addTracer,
    botsAlive(team) { return bots.filter((b) => b.alive && b.team === team).length; },
    reset(spawns, site) {
      for (const bot of bots) {
        const spawn = spawns[bot.team][bot.index % spawns[bot.team].length];
        bot.pos.set(spawn[0], 0, spawn[1]);
        bot.health = HEALTH;
        bot.armor = 0;
        bot.alive = true;
        bot.fall = 0;
        bot.group.rotation.set(0, 0, 0);
        bot.path = [];
        bot.pathIdx = 0;
        bot.goalNode = -1;
        bot.holdUntil = 0;
        bot.target = null;
        bot.lastSeenAt = -99;
        bot.burstLeft = 0;
        bot.shootTimer = 0.5 + ctx.random();
        bot.channel = 0;
        bot.hasBomb = false;
        bot.site = site;
        bot.yaw = bot.team === 'attackers' ? 0 : Math.PI;
        bot.group.rotation.y = bot.yaw;
      }
      for (const t of tracers) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
      tracers.length = 0;
    },
    step(dt, time) {
      for (const bot of bots) stepBot(bot, dt, time);
      for (let i = tracers.length - 1; i >= 0; i -= 1) {
        tracers[i].life -= dt;
        tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.09) * 0.9;
        if (tracers[i].life <= 0) {
          scene.remove(tracers[i].line);
          tracers[i].line.geometry.dispose();
          tracers[i].line.material.dispose();
          tracers.splice(i, 1);
        }
      }
    },
  };
}

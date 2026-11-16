// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, team score, killfeed,
// minimap, bomb status and the overlay panels (start / buy / paused / round / match).
// It never touches the simulation; main.js pushes numbers in and reads callbacks out.
import { PALETTE } from './palette.js';

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const buyPanel = $('buy-panel');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoEl = $('ammo');
  const scoreValue = $('score-value');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const roundEl = $('round-label');
  const weaponEl = $('weapon-name');
  const bombEl = $('bomb-status');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const damageEl = $('damage');
  const minimap = $('minimap');
  const mm = minimap ? minimap.getContext('2d') : null;
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  const COPY = {
    start: { title: 'Dustline Yard', copy: 'A round-based tactical FPS. Plant the charge on site A or B, or wipe out the Jackals. First to 5 rounds takes the match.', action: 'Buy & deploy' },
    paused: { title: 'Dustline Yard', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  };

  return {
    setAmmo(mag, reserve) { setText(ammoMag, 'mag', String(mag)); setText(ammoReserve, 'res', `/ ${reserve}`); ammoEl.classList.toggle('empty', mag === 0); },
    setScore(a, d) { setText(scoreValue, 'score', `${a} — ${d}`); },
    setHealth(hp, armor) {
      setText(healthNum, 'hp', `${Math.max(0, Math.ceil(hp))}${armor > 0 ? ` +${Math.ceil(armor)}` : ''}`);
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.style.background = hp > 50 ? PALETTE.ally : hp > 25 ? PALETTE.accent : PALETTE.enemy;
    },
    setMoney(m) { setText(moneyEl, 'money', `$${m}`); },
    setTimer(seconds, label) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerEl, 'timer', `${label ? `${label} ` : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerEl.classList.toggle('urgent', s <= 10 && s > 0);
    },
    setRound(round, a, d) { setText(roundEl, 'round', `Round ${round} · Vanguard ${a} — ${d} Jackals`); },
    setWeapon(name, grenades) { setText(weaponEl, 'wpn', `${name} · ${grenades} frag${grenades === 1 ? '' : 's'}`); },
    setBomb(text) { setText(bombEl, 'bomb', text); bombEl.classList.toggle('hot', /planted|plant/i.test(text)); },
    setCrosshair(gapPx) { crosshair.style.setProperty('--gap', `${gapPx}px`); },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageEl.classList.add('on');
      setTimeout(() => damageEl.classList.remove('on'), 180);
    },
    kill(text) {
      const div = document.createElement('div');
      div.textContent = text;
      killfeed.prepend(div);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() { banner.hidden = true; },
    setPlant(progress, label) {
      if (progress === null) { plantBar.hidden = true; return; }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    showOverlay(mode, data) {
      if (mode === 'buy') {
        title.textContent = `Round ${data.round} — Buy phase`;
        copy.textContent = `You have $${data.money}. Spend it before you deploy: 1 rifle, 2 SMG, 3 shotgun, 4 sniper, 5 frag grenade, 6 armour. Press Enter or Deploy when ready.`;
        play.textContent = 'Deploy';
        overlay.hidden = false;
        buyPanel.hidden = false;
        this.renderBuy(data.money, data.owned);
        play.focus();
        return;
      }
      if (mode === 'roundEnd') {
        title.textContent = data.title;
        copy.textContent = data.copy;
        play.textContent = data.matchOver ? 'Play again' : 'Next round';
        overlay.hidden = false;
        buyPanel.hidden = true;
        play.focus();
        return;
      }
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      buyPanel.hidden = true;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; buyPanel.hidden = true; },
    renderBuy(money, owned) {
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      const items = [
        { key: '1', id: 'rifle', name: 'VK-47 Rifle', price: 2700 },
        { key: '2', id: 'smg', name: 'Hornet-9 SMG', price: 1500 },
        { key: '3', id: 'shotgun', name: 'Breacher-12', price: 1700 },
        { key: '4', id: 'sniper', name: 'Longbow .50', price: 4750 },
        { key: '5', id: 'grenade', name: 'Frag grenade', price: 300 },
        { key: '6', id: 'armor', name: 'Kevlar armour', price: 650 },
      ];
      for (const item of items) {
        const li = document.createElement('li');
        const has = owned.includes(item.id);
        li.innerHTML = `<button type="button" data-buy="${item.id}" ${money < item.price && !has ? 'disabled' : ''}><kbd>${item.key}</kbd> ${item.name} <span>$${item.price}${has ? ' · owned' : ''}</span></button>`;
        buyList.appendChild(li);
      }
      buyList.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buyHandler && buyHandler(b.dataset.buy)));
    },
    onBuy(handler) { buyHandler = handler; },
    onPlay(handler) { play.addEventListener('click', handler); },
    drawMinimap(playerPos, yaw, bots, bomb) {
      if (!mm) return;
      const W = minimap.width;
      const H = minimap.height;
      const sx = (x) => ((x + 22.5) / 45) * W;
      const sz = (z) => ((z + 18.5) / 37) * H;
      mm.fillStyle = 'rgba(20,17,12,0.85)';
      mm.fillRect(0, 0, W, H);
      mm.fillStyle = '#453b2c';
      for (const c of world.colliders) {
        if (c.max.y < 0.5) continue;
        mm.fillRect(sx(c.min.x), sz(c.min.z), Math.max(1, sx(c.max.x) - sx(c.min.x)), Math.max(1, sz(c.max.z) - sz(c.min.z)));
      }
      for (const key of ['A', 'B']) {
        const s = world.sites[key];
        mm.fillStyle = key === 'A' ? PALETTE.accent : PALETTE.ally;
        mm.beginPath();
        mm.arc(sx(s.x), sz(s.z), 5, 0, Math.PI * 2);
        mm.fill();
      }
      if (bomb && bomb.state === 'planted') {
        mm.fillStyle = '#ff5a3c';
        mm.beginPath();
        mm.arc(sx(bomb.x), sz(bomb.z), 4, 0, Math.PI * 2);
        mm.fill();
      }
      for (const b of bots) {
        if (!b.alive) continue;
        mm.fillStyle = b.team === 'attackers' ? PALETTE.ally : PALETTE.enemy;
        mm.beginPath();
        mm.arc(sx(b.pos.x), sz(b.pos.z), 3, 0, Math.PI * 2);
        mm.fill();
      }
      // Player arrow.
      mm.save();
      mm.translate(sx(playerPos.x), sz(playerPos.z));
      mm.rotate(Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) + Math.PI / 2);
      mm.fillStyle = '#ece5d8';
      mm.beginPath();
      mm.moveTo(0, -6);
      mm.lineTo(4, 5);
      mm.lineTo(-4, 5);
      mm.closePath();
      mm.fill();
      mm.restore();
    },
  };
}

// Synthesised sound, no audio assets: every effect is an oscillator or a noise burst
// through the Web Audio API, created lazily on the first user gesture so browsers allow it.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }

  function noise(dur, freq, gain, type = 'lowpass') {
    const c = ensure();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(filter).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    const c = ensure();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') { noise(0.28, 900, 0.5); tone(140, 0.18, 0.3, 'sawtooth', 50); }
      else if (kind === 'shotgun') { noise(0.22, 700, 0.55); tone(110, 0.15, 0.35, 'sawtooth', 45); }
      else if (kind === 'pistol') { noise(0.12, 1800, 0.35); }
      else { noise(0.14, 1400, 0.4); tone(180, 0.08, 0.15, 'square', 90); }
    },
    distantShot() { noise(0.18, 500, 0.12); },
    dry() { tone(1200, 0.04, 0.12, 'square'); },
    reload() { tone(500, 0.05, 0.15, 'square'); setTimeout(() => tone(700, 0.05, 0.15, 'square'), 180); },
    hit() { tone(1900, 0.05, 0.18, 'sine'); },
    kill() { tone(880, 0.09, 0.2, 'sine'); setTimeout(() => tone(1320, 0.12, 0.2, 'sine'), 90); },
    hurt() { tone(220, 0.12, 0.25, 'sawtooth', 110); },
    plant() { tone(660, 0.08, 0.2, 'sine'); },
    beep() { tone(990, 0.06, 0.15, 'sine'); },
    explode() { noise(0.9, 300, 0.8); tone(70, 0.7, 0.5, 'sine', 30); },
    buy() { tone(1040, 0.07, 0.15, 'sine'); setTimeout(() => tone(1560, 0.09, 0.15, 'sine'), 70); },
    denied() { tone(220, 0.12, 0.18, 'square'); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.2, 'sine'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.2, 'sine'), i * 140)); },
  };
}

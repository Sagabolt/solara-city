// Solara City — procedural audio. Engine hum, police siren, punch thuds,
// pickup blips and a mission-complete jingle, all synthesized with the
// WebAudio API: no audio files are loaded and the game makes no network
// requests for sound. The context is created on the first user gesture
// (the start-screen click) and every method is a no-op when the
// AudioContext is unavailable, so the game never crashes for sound.

export function createAudio(opts = {}) {
  const onMuteChange = opts.onMuteChange || (() => {});
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let noiseBuffer = null;
  let enabled = false;
  let muted = !!opts.muted;
  // Smoothed engine pitch, so the hum slides instead of stepping.
  let engineFreq = 45;
  let sirenTimer = 0;
  let sirenHigh = false;

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise: a slow random walk, soft through the lowpass.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3;
    }
    return buffer;
  }

  const state = {
    get enabled() {
      return enabled;
    },

    get muted() {
      return muted;
    },

    // Build the graph. Call from a user gesture; safe to call twice.
    init() {
      if (enabled || typeof window === 'undefined') return false;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
        noiseBuffer = makeNoiseBuffer();

        // Engine: two detuned oscillators through a lowpass, silent until
        // the player drives. A second, lower oscillator gives it body.
        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 420;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = engineFreq;
        engineOsc2 = ctx.createOscillator();
        engineOsc2.type = 'square';
        engineOsc2.frequency.value = engineFreq / 2;
        const engineGain2 = ctx.createGain();
        engineGain2.gain.value = 0.5;
        engineOsc.connect(engineFilter);
        engineOsc2.connect(engineGain2);
        engineGain2.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        engineOsc2.start();

        // Siren: one triangle oscillator, two tones alternating in update.
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 720;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();

        // City ambience: looped noise through a lowpass, barely audible.
        const ambience = ctx.createBufferSource();
        ambience.buffer = noiseBuffer;
        ambience.loop = true;
        const ambFilter = ctx.createBiquadFilter();
        ambFilter.type = 'lowpass';
        ambFilter.frequency.value = 320;
        const ambGain = ctx.createGain();
        ambGain.gain.value = 0.035;
        ambience.connect(ambFilter);
        ambFilter.connect(ambGain);
        ambGain.connect(master);
        ambience.start();

        enabled = true;
        return true;
      } catch (err) {
        enabled = false;
        return false;
      }
    },

    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    suspend() {
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    },

    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 1;
      onMuteChange(muted);
    },

    // Per-frame: engine follows speed, siren follows the wanted level.
    update(dt, snap = {}) {
      if (!enabled) return;
      const driving = !!snap.driving;
      const speed01 = Math.max(0, Math.min(1, snap.speed01 || 0));
      const targetFreq = 45 + speed01 * 115;
      engineFreq += (targetFreq - engineFreq) * Math.min(1, 6 * dt);
      engineOsc.frequency.value = engineFreq;
      engineOsc2.frequency.value = engineFreq / 2;
      engineGain.gain.value = driving ? 0.03 + speed01 * 0.07 : 0;

      const wanted = snap.wanted || 0;
      if (wanted > 0) {
        sirenTimer -= dt;
        if (sirenTimer <= 0) {
          sirenTimer = 0.38;
          sirenHigh = !sirenHigh;
          sirenOsc.frequency.value = sirenHigh ? 920 : 660;
        }
        sirenGain.gain.value = Math.min(0.06, 0.02 + wanted * 0.01);
      } else {
        sirenGain.gain.value = 0;
      }
    },

    // One-shot effects. Each builds its own tiny node chain and stops it.
    blip(freq, dur, type = 'sine', vol = 0.12, delay = 0, slideTo = 0) {
      if (!enabled) return;
      try {
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      } catch (err) { /* a failed blip must never break the game */ }
    },

    noiseBurst(dur, vol, filterFreq = 800) {
      if (!enabled) return;
      try {
        const t0 = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
      } catch (err) { /* a failed burst must never break the game */ }
    },

    click() {
      state.blip(880, 0.06, 'square', 0.06);
    },

    punch() {
      state.blip(120, 0.13, 'sine', 0.25, 0, 50);
      state.noiseBurst(0.08, 0.15, 500);
    },

    pickup() {
      state.blip(660, 0.07, 'sine', 0.12);
      state.blip(990, 0.09, 'sine', 0.12, 0.08);
    },

    steal() {
      state.blip(220, 0.16, 'sawtooth', 0.09, 0, 170);
    },

    crash() {
      state.noiseBurst(0.25, 0.3, 800);
      state.blip(90, 0.2, 'sine', 0.2, 0, 40);
    },

    busted() {
      state.blip(330, 0.6, 'sawtooth', 0.1, 0, 110);
    },

    missionComplete() {
      // Little C-major arpeggio: C5 E5 G5 C6.
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => state.blip(freq, 0.14, 'sine', 0.13, i * 0.09));
    },
  };
  return state;
}

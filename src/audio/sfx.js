/**
 * เสียงเอฟเฟกต์ที่สังเคราะห์สดด้วย Web Audio API — ไม่มีไฟล์เสียงในโปรเจกต์เลย
 *
 * แนวคิด: เสียงของวัสดุแต่ละอย่างคือ "เสียงซ่า (noise) ที่ผ่านฟิลเตอร์ต่างกัน"
 * บวกกับเสียงโทนสั้นๆ สำหรับวัสดุแข็ง แล้วครอบด้วยซองเสียง (envelope) ที่ดังแล้วหายเร็ว
 */

/** ลักษณะเสียงของวัสดุแต่ละกลุ่ม */
const MATERIAL_VOICE = {
  grass: { type: 'lowpass', freq: 1100, q: 0.8, decay: 0.13, gain: 0.34, tone: 0 },
  stone: { type: 'bandpass', freq: 1700, q: 1.4, decay: 0.1, gain: 0.42, tone: 150 },
  wood: { type: 'bandpass', freq: 900, q: 2.2, decay: 0.13, gain: 0.4, tone: 220 },
  sand: { type: 'highpass', freq: 2200, q: 0.7, decay: 0.16, gain: 0.3, tone: 0 },
  gravel: { type: 'bandpass', freq: 1400, q: 1, decay: 0.15, gain: 0.36, tone: 0 },
  snow: { type: 'lowpass', freq: 700, q: 0.6, decay: 0.18, gain: 0.28, tone: 0 },
  wool: { type: 'lowpass', freq: 480, q: 0.7, decay: 0.16, gain: 0.3, tone: 0 },
  glass: { type: 'highpass', freq: 3200, q: 1.6, decay: 0.13, gain: 0.32, tone: 1400 },
  water: { type: 'bandpass', freq: 800, q: 0.9, decay: 0.28, gain: 0.34, tone: 0 },
};

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.volume = 0.75;
  }

  /** ต้องเรียกหลังผู้ใช้คลิกครั้งแรก ไม่งั้นเบราว์เซอร์จะบล็อกการเล่นเสียง */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // เสียงซ่าความยาว 1 วินาที ใช้เป็นวัตถุดิบของทุกเสียง
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  setEnabled(value) {
    this.enabled = value;
    if (this.master) this.master.gain.value = value ? this.volume : 0;
  }

  get ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  /**
   * เล่นเสียงหนึ่งครั้ง
   * @param {string} group กลุ่มวัสดุ
   * @param {object} opts { pitch, gain, decay }
   */
  play(group, opts = {}) {
    if (!this.ready) return;
    const voice = MATERIAL_VOICE[group] || MATERIAL_VOICE.stone;
    const now = this.ctx.currentTime;
    const pitch = opts.pitch ?? 1;
    const decay = (opts.decay ?? voice.decay) * (opts.decayScale ?? 1);
    const gain = (opts.gain ?? voice.gain) * (opts.gainScale ?? 1);

    // ---- ส่วนเสียงซ่า ----
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = pitch;
    // เริ่มอ่านจากตำแหน่งสุ่มในบัฟเฟอร์ เสียงแต่ละครั้งจึงไม่ซ้ำกันเป๊ะ
    const offset = Math.random() * 0.8;

    const filter = this.ctx.createBiquadFilter();
    filter.type = voice.type;
    filter.frequency.value = voice.freq * pitch;
    filter.Q.value = voice.q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(now, offset, decay + 0.05);
    src.stop(now + decay + 0.06);

    // ---- ส่วนโทน (วัสดุแข็งจะมีเสียง "ป๊อก" ปนอยู่) ----
    if (voice.tone) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(voice.tone * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(voice.tone * pitch * 0.6, now + decay);

      const toneEnv = this.ctx.createGain();
      toneEnv.gain.setValueAtTime(0.0001, now);
      toneEnv.gain.exponentialRampToValueAtTime(gain * 0.5, now + 0.004);
      toneEnv.gain.exponentialRampToValueAtTime(0.0001, now + decay * 0.8);

      osc.connect(toneEnv);
      toneEnv.connect(this.master);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }
  }

  footstep(group) {
    this.play(group || 'grass', {
      pitch: 0.86 + Math.random() * 0.3,
      gainScale: 0.5,
      decayScale: 0.75,
    });
  }

  breakBlock(group) {
    this.play(group || 'stone', { pitch: 0.72 + Math.random() * 0.18, gainScale: 1.15, decayScale: 1.5 });
  }

  placeBlock(group) {
    this.play(group || 'stone', { pitch: 1.05 + Math.random() * 0.2, gainScale: 0.9 });
  }

  splash() {
    this.play('water', { pitch: 0.9 + Math.random() * 0.3, gainScale: 1.1, decayScale: 1.4 });
  }

  /** เสียงตอนกระโดดลงพื้นแรงๆ */
  land(group, strength = 1) {
    this.play(group || 'grass', {
      pitch: 0.65,
      gainScale: Math.min(1.6, 0.7 + strength),
      decayScale: 1.4,
    });
  }
}

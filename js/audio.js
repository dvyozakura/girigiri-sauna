// 効果音（Web Audio APIで合成。音声ファイル不要）

const STORAGE_KEY = 'girigiri-sauna:muted';

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

try {
  muted = localStorage.getItem(STORAGE_KEY) === '1';
} catch (_) { /* storage不可でも続行 */ }

/** ユーザー操作中に呼ぶ（iOS Safariの自動再生制限対策） */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      // 2秒分のホワイトノイズを1回だけ生成
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) { ctx = null; }
}

export const isMuted = () => muted;

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (_) {}
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
}

const ready = () => ctx && !muted && ctx.state !== 'closed';

/** ジュワァァ：水量が多いほど大きく長い */
export function sizzle(ml) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const k = Math.min(1, ml / 100);
  const dur = 0.5 + k * 1.3;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35 + k * 0.45, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.1, dur + 0.05);

  // パチパチ音
  const pops = 4 + Math.round(k * 10);
  for (let i = 0; i < pops; i++) {
    const at = t + Math.random() * dur * 0.8;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 1800 + Math.random() * 2500;
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(0.05, at + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    o.connect(og).connect(master);
    o.start(at);
    o.stop(at + 0.04);
  }
}

function tone(freq, start, len, type = 'triangle', vol = 0.2) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + len);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + len + 0.02);
}

/** 柄杓に水が溜まる小さな音 */
export function blip(pitch = 1) {
  if (!ready()) return;
  tone(520 * pitch, ctx.currentTime, 0.06, 'sine', 0.05);
}

/** カウントダウン */
export function tick(last = false) {
  if (!ready()) return;
  tone(last ? 1320 : 880, ctx.currentTime, 0.12, 'square', 0.08);
}

/** ドラムロール風 */
export function roll(ms) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const n = Math.floor(ms / 45);
  for (let i = 0; i < n; i++) tone(110 + (i % 2) * 8, t + i * 0.045, 0.04, 'triangle', 0.06 + (i / n) * 0.08);
}

/** ランク別ジングル */
export function jingle(rankId) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  const seqs = {
    god:    [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [1319, 0.45], [1568, 0.6]],
    genius: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]],
    pro:    [[587, 0], [740, 0.14], [880, 0.28]],
    soso:   [[440, 0], [440, 0.18]],
    miss:   [[392, 0], [330, 0.2], [262, 0.4]],
    ban:    [[220, 0], [208, 0.25], [196, 0.5], [147, 0.75]],
  };
  const type = rankId === 'ban' || rankId === 'miss' ? 'sawtooth' : 'triangle';
  for (const [f, d] of seqs[rankId] || seqs.soso) tone(f, t + d, 0.3, type, 0.14);
}

export function click() {
  if (!ready()) return;
  tone(660, ctx.currentTime, 0.05, 'square', 0.04);
}

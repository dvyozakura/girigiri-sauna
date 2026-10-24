// ギリギリサウナ — 画面制御・演出
import * as L from './logic.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const CFG = window.GIRIGIRI_SAUNA_CONFIG || {};
const BEST_KEY = 'girigiri-sauna:best';

const screens = {
  title: $('screen-title'),
  howto: $('screen-howto'),
  game: $('screen-game'),
  result: $('screen-result'),
};

/** 現在の画面コントローラ（destroyで後片付け） */
let active = null;

function switchTo(name, factory) {
  if (active) {
    active.destroy();
    active = null;
  }
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  if (factory) active = factory();
  if (name === 'title') renderBest();
}

/** 画面ごとのイベント・タイマー・アニメーションをまとめて破棄するためのスコープ */
function createScope() {
  const ac = new AbortController();
  const timeouts = new Set();
  const anims = new Set();
  let raf = 0;
  return {
    on(el, type, fn, opts = {}) {
      el.addEventListener(type, fn, { ...opts, signal: ac.signal });
    },
    later(fn, ms) {
      const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
      timeouts.add(id);
      return id;
    },
    frame(fn) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fn);
    },
    stopFrame() { cancelAnimationFrame(raf); raf = 0; },
    animate(el, keyframes, options) {
      const a = el.animate(keyframes, options);
      anims.add(a);
      a.onfinish = a.oncancel = () => { anims.delete(a); el.remove(); };
      return a;
    },
    dispose() {
      ac.abort();
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const a of [...anims]) a.cancel();
      anims.clear();
      cancelAnimationFrame(raf);
    },
  };
}

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { return 0; }
}
function writeBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) {}
}
function renderBest() {
  const best = readBest();
  const el = $('best-score');
  el.hidden = best <= 0;
  el.textContent = best > 0 ? `本番ベスト：${best}点` : '';
}

const shareGameUrl = () => CFG.shareUrl || `${location.origin}${location.pathname}`;

const retrigger = (el, cls) => {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // reflowでアニメーションを再始動
  el.classList.add(cls);
};

const rand = (a, b) => a + Math.random() * (b - a);

/* =========================================================
   ゲーム画面
   ========================================================= */
function createGame(mode) {
  const isReal = mode === 'real';
  const S = createScope();

  // --- 状態（このクロージャの外からは参照できない） ---
  const round = L.createRound();
  let tempC = round.startC;
  let phase = isReal ? 'reveal' : 'play'; // reveal → play → judging
  let hold = null; // { id, start, lastMl }
  let pourCount = 0;

  // --- 要素 ---
  const stage = $('stage');
  const ojisan = $('ojisan');
  const sweat = $('sweat');
  const steam = $('steam');
  const drops = $('drops');
  const ladle = $('ladle');
  const ladleWater = $('ladle-water');
  const glow = $('stove-glow');
  const bubble = $('bubble');
  const slot = $('thermo-slot');
  const countdown = $('countdown');
  const toast = $('toast');
  const pop = $('pour-pop');
  const waterBtn = $('water-btn');
  const doneBtn = $('done-btn');
  const mlEl = $('water-ml');
  const gauge = $('gauge-fill');
  const log = $('pour-log');
  const modeEl = $('hud-mode');

  // --- 初期表示 ---
  for (const g of [sweat, steam, drops]) g.replaceChildren();
  slot.replaceChildren();
  ojisan.setAttribute('class', 'ojisan breathe');
  ladle.setAttribute('class', 'ladle');
  stage.classList.remove('shake');
  countdown.hidden = true;
  toast.classList.remove('show');
  pop.classList.remove('show');
  log.textContent = '';
  modeEl.textContent = isReal ? '本番' : '練習';
  modeEl.classList.toggle('is-real', isReal);
  $('hud-target').textContent = L.formatTarget(round.targetC);
  renderGauge(0);
  waterBtn.disabled = isReal;
  doneBtn.disabled = isReal;
  say(`今日は${L.formatTarget(round.targetC)}℃がいいな`);

  // --- 温度計 ---
  let thermo = null;
  function mountThermo() {
    const box = document.createElement('div');
    box.className = 'thermo';
    const value = document.createElement('div');
    value.className = 'thermo-value';
    const tube = document.createElement('div');
    tube.className = 'thermo-tube';
    const fill = document.createElement('div');
    fill.className = 'thermo-fill';
    const mark = document.createElement('div');
    mark.className = 'thermo-target';
    mark.style.bottom = `${thermoPct(round.targetC)}%`;
    tube.append(fill, mark);
    const bulb = document.createElement('div');
    bulb.className = 'thermo-bulb';
    const note = document.createElement('div');
    note.className = 'thermo-note';
    note.textContent = '白線＝希望';
    box.append(value, tube, bulb, note);
    box.setAttribute('role', 'img');
    slot.replaceChildren(box);
    thermo = { box, value, fill };
    updateThermo();
  }
  function thermoPct(c) {
    const lo = 6000, hi = L.RULES.MAX_TEMP * 100;
    return Math.max(0, Math.min(100, ((c - lo) / (hi - lo)) * 100));
  }
  function updateThermo() {
    if (!thermo) return;
    const t = L.formatThermo(tempC);
    thermo.value.innerHTML = `${t}<small>℃</small>`;
    thermo.fill.style.height = `${thermoPct(tempC)}%`;
    thermo.box.setAttribute('aria-label', `現在の温度 ${t}度`);
  }
  function unmountThermo() {
    if (!thermo) return;
    const { box } = thermo;
    thermo = null;
    // 中身を即座に消してから殻だけフェードアウト（数値が残らないように）
    box.replaceChildren();
    box.removeAttribute('aria-label');
    box.classList.add('leaving');
    S.later(() => box.remove(), 350);
  }

  mountThermo();

  // --- 本番：3秒だけ温度を見せる ---
  if (isReal) {
    const total = Math.round(L.RULES.REVEAL_MS / 1000);
    countdown.hidden = false;
    countdown.innerHTML = '<b></b><span>今の温度を覚えて！</span>';
    const num = countdown.querySelector('b');
    const showNum = (n) => { num.textContent = String(n); retrigger(num, 'tick'); sfx.tick(false); };
    showNum(total);
    for (let i = 1; i < total; i++) S.later(() => showNum(total - i), i * 1000);
    S.later(() => {
      unmountThermo();
      countdown.hidden = true;
      countdown.replaceChildren();
      sfx.tick(true);
      phase = 'play';
      waterBtn.disabled = false;
      doneBtn.disabled = false;
      say('じゃ、あとは任せたよ');
    }, L.RULES.REVEAL_MS);
  }

  // --- 吹き出し・トースト ---
  function say(text) {
    bubble.textContent = text;
    retrigger(bubble, 'pop');
  }
  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = S.later(() => toast.classList.remove('show'), 1400);
  }

  // --- 柄杓ゲージ ---
  function renderGauge(ml) {
    mlEl.textContent = String(ml);
    gauge.style.width = `${ml}%`;
    gauge.classList.toggle('full', ml >= L.RULES.MAX_WATER_ML);
    const k = ml / L.RULES.MAX_WATER_ML;
    ladleWater.setAttribute('rx', k > 0 ? String(5 + 12 * k) : '0');
    ladleWater.setAttribute('ry', k > 0 ? String(1.5 + 3.5 * k) : '0');
  }

  function startHold(id) {
    if (phase !== 'play' || hold) return;
    hold = { id, start: performance.now(), lastMl: 0 };
    waterBtn.classList.add('holding');
    ladle.classList.add('filling');
    const step = () => {
      if (!hold) return;
      const ml = L.waterFromHold(performance.now() - hold.start);
      if (Math.floor(ml / 10) > Math.floor(hold.lastMl / 10)) sfx.blip(1 + ml / 100);
      hold.lastMl = ml;
      renderGauge(ml);
      S.frame(step);
    };
    S.frame(step);
  }

  /** commit=true で水を掛ける、false でこぼす（キャンセル） */
  function endHold(commit) {
    if (!hold) return;
    const ml = L.waterFromHold(performance.now() - hold.start);
    hold = null;
    S.stopFrame();
    waterBtn.classList.remove('holding');
    ladle.classList.remove('filling');
    renderGauge(0);
    if (!commit) {
      if (ml > 0) showToast('水をこぼしちゃった…（温度は変わらない）');
      return;
    }
    if (ml <= 0) {
      showToast('水が入ってないよ。長押ししてね');
      return;
    }
    pour(ml);
  }

  // --- 水を掛ける ---
  function pour(ml) {
    const before = tempC;
    tempC = L.applyWater(tempC, ml); // 練習・本番で共通の計算
    pourCount++;
    sfx.sizzle(ml);
    animatePour(ml);

    if (isReal) {
      log.textContent = `さっき掛けた水：${ml}ml`;
      pop.textContent = `ジュワッ ${ml}ml`;
      say(ml >= 70 ? 'アチチチ…！' : ml >= 35 ? 'おぉ〜、効くねぇ' : 'ふぅ……');
    } else {
      const rise = L.formatPrecise(tempC - before);
      log.textContent = `さっき掛けた水：${ml}ml → +${rise}℃`;
      pop.textContent = `+${rise}℃`;
      updateThermo();
      say(practiceLine());
    }
    retrigger(pop, 'show');
  }

  function practiceLine() {
    const d = tempC - round.targetC;
    if (tempC >= L.RULES.MAX_TEMP * 100) return 'もう限界！（120℃が上限）';
    if (Math.abs(d) <= 50) return 'おっ、ちょうどいい感じ…？';
    if (d < -1000) return 'まだまだぬるいなぁ';
    if (d < -300) return 'もうちょい熱くてもいいね';
    if (d < 0) return 'あと少し…！';
    if (d <= 300) return 'ちょっと熱いかも…';
    return 'あっつ！やりすぎだって！';
  }

  function animatePour(ml) {
    const k = ml / L.RULES.MAX_WATER_ML;

    // 柄杓を傾ける
    ladle.classList.add('pour');
    S.later(() => ladle.classList.remove('pour'), 420);

    // 水滴
    const nDrops = 3 + Math.round(k * 6);
    for (let i = 0; i < nDrops; i++) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', String(rand(296, 312)));
      c.setAttribute('cy', '206');
      c.setAttribute('r', String(rand(1.8, 3.2)));
      c.setAttribute('class', 'water-drop');
      drops.appendChild(c);
      S.animate(c, [
        { transform: 'translate(0,0)', opacity: 1 },
        { transform: `translate(${rand(-14, 0)}px, ${rand(30, 44)}px)`, opacity: 0.9 },
      ], { duration: 260, delay: 60 + i * 28, easing: 'cubic-bezier(.5,0,1,1)', fill: 'both' });
    }

    // 蒸気（少し遅れて）
    S.later(() => {
      const nPuffs = 3 + Math.round(k * 12);
      for (let i = 0; i < nPuffs; i++) {
        const c = document.createElementNS(SVGNS, 'circle');
        const x = rand(268, 320);
        c.setAttribute('cx', String(x));
        c.setAttribute('cy', String(rand(236, 250)));
        c.setAttribute('r', String(rand(8, 14 + k * 8)));
        c.setAttribute('class', 'steam-puff');
        steam.appendChild(c);
        const rise = rand(150, 230 + k * 40);
        S.animate(c, [
          { transform: 'translate(0,0) scale(.6)', opacity: 0 },
          { opacity: 0.75, offset: 0.15 },
          { transform: `translate(${rand(-70, 20)}px, ${-rise}px) scale(${rand(2.4, 3.6)})`, opacity: 0 },
        ], { duration: rand(1300, 2100), delay: i * 45, easing: 'ease-out', fill: 'both' });
      }
      glow.classList.remove('flash');
      void glow.getBoundingClientRect();
      glow.classList.add('flash');

      // 画面の揺れ（水量に比例。温度情報は含まない）
      stage.style.setProperty('--amp', `${(1 + k * 4).toFixed(1)}px`);
      retrigger(stage, 'shake');

      // おじさんの反応と汗（水量ベース）
      ojisan.classList.remove('breathe');
      retrigger(ojisan, 'bob');
      if (ml >= 60) {
        ojisan.classList.add('wipe');
        S.later(() => ojisan.classList.remove('wipe'), 800);
      }
      S.later(() => { ojisan.classList.remove('bob'); ojisan.classList.add('breathe'); }, 600);
      const nSweat = 1 + Math.round(k * 4);
      for (let i = 0; i < nSweat; i++) {
        const d = document.createElementNS(SVGNS, 'path');
        const x = rand(92, 136);
        const y = rand(118, 146);
        d.setAttribute('d', `M${x} ${y} q-4 6 0 9 q4 -3 0 -9 z`);
        d.setAttribute('class', 'sweat-drop');
        sweat.appendChild(d);
        S.animate(d, [
          { transform: 'translate(0,0)', opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { transform: `translate(${x < 112 ? -6 : 6}px, 30px)`, opacity: 0 },
        ], { duration: 900, delay: 150 + i * 120, easing: 'ease-in', fill: 'both' });
      }
    }, 160);
  }

  // --- 入力（Pointer Events） ---
  S.on(waterBtn, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    sfx.unlock();
    if (phase !== 'play' || hold) return;
    try { waterBtn.setPointerCapture(e.pointerId); } catch (_) {}
    startHold(e.pointerId);
  });
  S.on(waterBtn, 'pointerup', (e) => {
    if (hold && hold.id === e.pointerId) endHold(true);
  });
  S.on(waterBtn, 'pointercancel', (e) => {
    if (hold && hold.id === e.pointerId) endHold(false);
  });
  S.on(waterBtn, 'lostpointercapture', (e) => {
    // pointerup の後にも発火するが、その時点で hold は null
    if (hold && hold.id === e.pointerId) endHold(false);
  });
  S.on(waterBtn, 'contextmenu', (e) => e.preventDefault());
  S.on(waterBtn, 'touchstart', (e) => e.preventDefault(), { passive: false }); // iOSの長押しメニュー・スクロール抑止
  // キーボード（Space / Enter 長押し）
  S.on(waterBtn, 'keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      sfx.unlock();
      startHold('key');
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
    }
  });
  S.on(waterBtn, 'keyup', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && hold && hold.id === 'key') {
      e.preventDefault();
      endHold(true);
    }
  });
  S.on(waterBtn, 'click', (e) => e.preventDefault());
  S.on(waterBtn, 'blur', () => { if (hold && hold.id === 'key') endHold(false); });
  S.on(window, 'blur', () => endHold(false));
  S.on(document, 'visibilitychange', () => { if (document.hidden) endHold(false); });

  S.on(doneBtn, 'click', () => {
    if (phase !== 'play' || hold) return;
    phase = 'judging';
    waterBtn.disabled = true;
    doneBtn.disabled = true;
    ojisan.setAttribute('class', 'ojisan wait');
    say(isReal ? 'どれどれ……' : 'さて、何度かな……');
    sfx.roll(1100);
    S.later(() => {
      const result = L.judge(round.targetC, tempC);
      switchTo('result', () => createResult(mode, result, pourCount));
    }, 1200);
  });

  S.on($('quit-btn'), 'click', () => switchTo('title'));

  return {
    destroy() {
      hold = null;
      S.dispose();
      waterBtn.classList.remove('holding');
      ladle.setAttribute('class', 'ladle');
      for (const g of [sweat, steam, drops]) g.replaceChildren();
      slot.replaceChildren();
      countdown.replaceChildren();
      countdown.hidden = true;
      thermo = null;
      log.textContent = '';
      bubble.textContent = '';
    },
  };
}

/* =========================================================
   リザルト画面
   ========================================================= */
const RESULT_LINES = {
  god: '……完璧だ。君こそ神だ。',
  genius: '最高にととのったよ！',
  pro: 'うん、いい腕してるね',
  soso: 'まあ、悪くはないかな',
  missCold: 'ちょっとぬるいなぁ…',
  missHot: 'あっつ！熱すぎるって！',
  banCold: '寒い！ 君、出禁ね。',
  banHot: '殺す気か！ 君、出禁ね。',
};

function createResult(mode, result, pourCount) {
  const isReal = mode === 'real';
  const S = createScope();
  const root = screens.result;
  const fx = $('result-fx');
  const hot = result.diffC > 0;

  root.className = `screen screen-result rank-${result.rankId}${hot ? ' is-hot' : ''}`;
  $('result-mode').textContent = isReal ? '本番モード 結果発表' : '練習モードの結果（記録されません）';
  $('result-rank').textContent = result.rankLabel;
  $('res-target').textContent = `${L.formatTarget(result.targetC)}℃`;
  $('res-final').textContent = `${L.formatPrecise(result.finalC)}℃`;
  const sign = result.diffC === 0 ? '' : hot ? '（熱い）' : '（ぬるい）';
  $('res-error').textContent = `${L.formatPrecise(result.errC)}℃${sign}`;

  let line = RESULT_LINES[result.rankId];
  if (result.rankId === 'miss') line = hot ? RESULT_LINES.missHot : RESULT_LINES.missCold;
  if (result.rankId === 'ban') line = hot ? RESULT_LINES.banHot : RESULT_LINES.banCold;
  if (pourCount === 0) line = '……水、掛けてないよね？';
  $('result-line').textContent = line;

  // スコアのカウントアップ
  const scoreEl = $('res-score');
  const t0 = performance.now();
  const dur = 900;
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    const v = Math.round(result.score * (1 - Math.pow(1 - p, 3)));
    scoreEl.textContent = `${v}点`;
    if (p < 1) S.frame(tick);
    else scoreEl.textContent = `${result.score}点`;
  };
  scoreEl.textContent = '0点';
  S.frame(tick);

  // ベストスコア（本番のみ）
  const bestEl = $('result-best');
  if (isReal) {
    const best = readBest();
    if (result.score > best) {
      writeBest(result.score);
      bestEl.textContent = best > 0 ? `自己ベスト更新！（前回 ${best}点）` : '初記録！';
    } else {
      bestEl.textContent = best > 0 ? `自己ベスト：${best}点` : '';
    }
    bestEl.hidden = bestEl.textContent === '';
  } else {
    bestEl.hidden = true;
  }

  // 共有
  const share = $('share-btn');
  share.hidden = !isReal;
  share.href = L.buildShareUrl(result, shareGameUrl(), CFG.hashtag || 'ギリギリサウナ');
  S.on(share, 'click', () => sfx.click());

  // ボタン
  S.on($('retry-btn'), 'click', () => switchTo('game', () => createGame(mode)));
  const sw = $('switch-btn');
  sw.textContent = isReal ? '練習する' : '本番に挑戦';
  S.on(sw, 'click', () => {
    const next = isReal ? 'practice' : 'real';
    switchTo('game', () => createGame(next));
  });

  // 演出
  sfx.jingle(result.rankId);
  fx.replaceChildren();
  const colors = ['#ffc93c', '#e8492b', '#3aa3e8', '#fbf1df', '#7ed957'];
  const spawn = (cls, n, styleFn, durMin, durMax) => {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.className = cls;
      styleFn(el, i);
      el.style.animationDuration = `${rand(durMin, durMax).toFixed(2)}s`;
      el.style.animationDelay = `${rand(0, 0.8).toFixed(2)}s`;
      fx.appendChild(el);
    }
  };
  if (result.rankId === 'god' || result.rankId === 'genius') {
    spawn('confetti', result.rankId === 'god' ? 80 : 36, (el) => {
      el.style.left = `${rand(0, 100)}%`;
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.setProperty('--dx', `${rand(-60, 60)}px`);
      el.style.setProperty('--rot', `${rand(360, 1080)}deg`);
    }, 1.8, 3.4);
  } else if ((result.rankId === 'miss' || result.rankId === 'ban') && hot) {
    spawn('fx-steam', 10, (el) => { el.style.left = `${rand(-10, 80)}%`; }, 2.2, 3.4);
  } else if (result.rankId === 'miss' || result.rankId === 'ban') {
    spawn('fx-snow', 24, (el) => {
      el.style.left = `${rand(0, 100)}%`;
      el.style.setProperty('--dx', `${rand(-30, 30)}px`);
    }, 2.5, 4.5);
  }

  return {
    destroy() {
      S.dispose();
      fx.replaceChildren();
      root.className = 'screen screen-result';
    },
  };
}

/* =========================================================
   常設のUI
   ========================================================= */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  sfx.unlock();
  sfx.click();
  const a = btn.dataset.action;
  if (a === 'practice' || a === 'real') switchTo('game', () => createGame(a));
  else if (a === 'howto') switchTo('howto');
  else if (a === 'title') switchTo('title');
});

const muteBtn = $('mute-btn');
function renderMute() {
  const m = sfx.isMuted();
  muteBtn.setAttribute('aria-pressed', String(m));
  muteBtn.setAttribute('aria-label', m ? '音を出す' : '音を消す');
  muteBtn.firstElementChild.textContent = m ? '🔇' : '🔊';
}
muteBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.setMuted(!sfx.isMuted());
  renderMute();
});
renderMute();

// iOS Safari：音声のアンロック、ピンチ・ダブルタップ拡大とページスクロールの抑止
document.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest('.screen-howto, .screen-result')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

switchTo('title');

// ギリギリサウナ — ゲームロジック（DOM非依存・練習／本番で完全共通）
//
// 温度は内部的に「センチ度（0.01℃）」の整数で保持する。
// 温度上昇 = 水量(ml) × 0.15℃ = 水量 × 15 センチ度 なので、
// 何回水を掛けても浮動小数点の誤差が一切たまらない。

export const RULES = Object.freeze({
  START_MIN: 65,        // 開始温度の下限（℃）
  START_MAX: 85,        // 開始温度の上限（℃）
  TARGET_MIN: 85,       // 希望温度の下限（℃）
  TARGET_MAX: 110,      // 希望温度の上限（℃）
  MAX_TEMP: 120,        // 温度上限（℃）
  RISE_PER_ML: 0.15,    // 1mlあたりの上昇量（℃）
  MAX_WATER_ML: 100,    // 柄杓の最大水量（ml）
  FILL_ML_PER_SEC: 50,  // 長押し1秒で溜まる水量（2秒で満タン）
  REVEAL_MS: 3000,      // 本番モードで温度計を見せる時間
});

const CENTI = 100;
const RISE_CENTI_PER_ML = 15; // = RULES.RISE_PER_ML * CENTI
const MAX_TEMP_C = RULES.MAX_TEMP * CENTI;

/** ℃ → 内部単位（センチ度・整数） */
export const toCenti = (deg) => Math.round(deg * CENTI);
/** 内部単位 → ℃ */
export const fromCenti = (c) => c / CENTI;

/** 長押し時間(ms)から柄杓の水量(整数ml, 0〜100)を求める */
export function waterFromHold(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const ml = Math.floor((ms * RULES.FILL_ML_PER_SEC) / 1000);
  return Math.min(RULES.MAX_WATER_ML, Math.max(0, ml));
}

/** 水量(ml)による温度上昇量（センチ度）。0mlなら0。 */
export function riseCentiFor(ml) {
  const w = Math.min(RULES.MAX_WATER_ML, Math.max(0, Math.floor(ml)));
  return w * RISE_CENTI_PER_ML;
}

/** 水量(ml)による温度上昇量（℃） */
export const riseFor = (ml) => fromCenti(riseCentiFor(ml));

/**
 * 温度計算の唯一の入口。練習・本番どちらもこの関数だけを使う。
 * @param {number} tempC 現在温度（センチ度）
 * @param {number} ml    掛けた水量
 * @returns {number} 新しい温度（センチ度, 上限120℃）
 */
export function applyWater(tempC, ml) {
  return Math.min(MAX_TEMP_C, tempC + riseCentiFor(ml));
}

/** 1プレイ分の初期温度と希望温度を決める（開始時に一度だけ） */
export function createRound(rng = Math.random) {
  // 開始温度：65.0〜85.0℃（0.1℃刻み）
  const tenthsMin = RULES.START_MIN * 10;
  const tenthsMax = RULES.START_MAX * 10;
  const startTenths = tenthsMin + Math.floor(rng() * (tenthsMax - tenthsMin + 1));
  // 希望温度：85〜110℃（整数）
  const target = RULES.TARGET_MIN + Math.floor(rng() * (RULES.TARGET_MAX - RULES.TARGET_MIN + 1));
  return Object.freeze({ startC: startTenths * 10, targetC: target * CENTI });
}

export const RANKS = Object.freeze([
  { id: 'god',    maxErrC: 50,       label: '神のロウリュ' },
  { id: 'genius', maxErrC: 100,      label: '天才熱波師' },
  { id: 'pro',    maxErrC: 300,      label: 'プロサウナー' },
  { id: 'soso',   maxErrC: 500,      label: 'まあまあ' },
  { id: 'miss',   maxErrC: 1000,     label: 'ぬるい／熱すぎ' },
  { id: 'ban',    maxErrC: Infinity, label: '出禁' },
]);

/** 誤差（センチ度）から評価ランクを返す。境界は「以下」で判定。 */
export function rankFor(errC, signC = 0) {
  const r = RANKS.find((x) => errC <= x.maxErrC);
  let label = r.label;
  if (r.id === 'miss') label = signC < 0 ? 'ぬるい' : '熱すぎ';
  return { id: r.id, label };
}

/**
 * score = max(0, round(10000 - 誤差 × 1000))
 * 誤差をセンチ度の整数で持つので 10000 - errC × 10 と完全に一致し、丸め誤差は起きない。
 */
export function scoreFor(errC) {
  return Math.max(0, 10000 - errC * 10);
}

/** 判定結果をまとめて返す */
export function judge(targetC, finalC) {
  const diffC = finalC - targetC;
  const errC = Math.abs(diffC);
  const rank = rankFor(errC, diffC);
  return {
    targetC,
    finalC,
    diffC,
    errC,
    score: scoreFor(errC),
    rankId: rank.id,
    rankLabel: rank.label,
  };
}

/** 温度表示（温度計用）：小数第1位まで */
export function formatThermo(c) {
  return (Math.round(c / 10) / 10).toFixed(1);
}

/** 結果表示用：基本は小数第1位、0.01℃の端数があるときだけ第2位まで */
export function formatPrecise(c) {
  return c % 10 === 0 ? (c / 100).toFixed(1) : (c / 100).toFixed(2);
}

/** 希望温度表示用（整数） */
export const formatTarget = (c) => String(Math.round(c / 100));

/** Xへ投稿する本文 */
export function buildShareText(result, hashtag = 'ギリギリサウナ') {
  return [
    'ギリギリサウナ♨️',
    '',
    `おじさんの希望：${formatTarget(result.targetC)}℃`,
    `実際の温度：${formatPrecise(result.finalC)}℃`,
    `誤差：${formatPrecise(result.errC)}℃`,
    '',
    `評価：${result.rankLabel}`,
    `スコア：${result.score}点`,
    '',
    `#${hashtag}`,
  ].join('\n');
}

/** X Web Intent のURL */
export function buildShareUrl(result, gameUrl, hashtag) {
  const params = new URLSearchParams();
  params.set('text', buildShareText(result, hashtag));
  if (gameUrl) params.set('url', gameUrl);
  return `https://x.com/intent/tweet?${params.toString()}`;
}

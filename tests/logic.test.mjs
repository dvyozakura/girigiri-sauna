import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

test('水量と温度上昇：仕様の例どおり', () => {
  assert.equal(L.riseFor(10), 1.5);
  assert.equal(L.riseFor(30), 4.5);
  assert.equal(L.riseFor(50), 7.5);
  assert.equal(L.riseFor(100), 15);
  for (let ml = 0; ml <= 100; ml++) {
    assert.equal(L.riseCentiFor(ml), Math.round(ml * 0.15 * 100), `ml=${ml}`);
  }
});

test('水量0mlでは温度が変わらない', () => {
  assert.equal(L.applyWater(7500, 0), 7500);
  assert.equal(L.applyWater(7500, -5), 7500);
});

test('温度上限は120℃', () => {
  assert.equal(L.applyWater(11900, 100), 12000);
  assert.equal(L.applyWater(12000, 50), 12000);
});

test('何杯掛けても誤差が蓄積しない', () => {
  let t = L.toCenti(70.3);
  for (let i = 0; i < 20; i++) t = L.applyWater(t, 1); // 0.15℃ × 20 = 3.0℃
  assert.equal(t, L.toCenti(73.3));
  assert.equal(L.formatPrecise(t), '73.3');
});

test('長押し時間→水量（50ml/秒、最大100ml）', () => {
  assert.equal(L.waterFromHold(0), 0);
  assert.equal(L.waterFromHold(19), 0);
  assert.equal(L.waterFromHold(20), 1);
  assert.equal(L.waterFromHold(1000), 50);
  assert.equal(L.waterFromHold(2000), 100);
  assert.equal(L.waterFromHold(9000), 100);
  assert.equal(L.waterFromHold(NaN), 0);
});

test('初期温度・希望温度の範囲', () => {
  assert.deepEqual(L.createRound(() => 0), { startC: 6500, targetC: 8500 });
  assert.deepEqual(L.createRound(() => 0.999999), { startC: 8500, targetC: 11000 });
  for (let i = 0; i < 5000; i++) {
    const r = L.createRound();
    assert.ok(r.startC >= 6500 && r.startC <= 8500 && r.startC % 10 === 0);
    assert.ok(r.targetC >= 8500 && r.targetC <= 11000 && r.targetC % 100 === 0);
  }
});

test('スコア式 max(0, round(10000 - 誤差×1000)) と一致', () => {
  for (let errC = 0; errC <= 1500; errC++) {
    const expected = Math.max(0, Math.round(10000 - (errC / 100) * 1000));
    assert.equal(L.scoreFor(errC), expected, `err=${errC / 100}`);
  }
  assert.equal(L.judge(9500, 9530).score, 9700);
  assert.equal(L.judge(9500, 9500).score, 10000);
  assert.equal(L.judge(8500, 12000).score, 0);
});

test('評価ランクの境界', () => {
  const r = (t, f) => L.judge(L.toCenti(t), L.toCenti(f)).rankLabel;
  assert.equal(r(95, 95), '神のロウリュ');
  assert.equal(r(95, 95.5), '神のロウリュ');
  assert.equal(r(95, 94.49), '天才熱波師');
  assert.equal(r(95, 96), '天才熱波師');
  assert.equal(r(95, 96.01), 'プロサウナー');
  assert.equal(r(95, 98), 'プロサウナー');
  assert.equal(r(95, 98.05), 'まあまあ');
  assert.equal(r(95, 100), 'まあまあ');
  assert.equal(r(95, 100.15), '熱すぎ');
  assert.equal(r(95, 87), 'ぬるい');
  assert.equal(r(95, 85), 'ぬるい');
  assert.equal(r(95, 84.9), '出禁');
  assert.equal(r(95, 105.3), '出禁');
});

test('浮動小数点で境界がずれない（0.15℃刻みの例）', () => {
  // 開始 90.0℃ に 10ml×4（+6.0℃）→ 96.0℃、希望 95℃ → 誤差ちょうど1.0℃
  let t = L.toCenti(90);
  for (let i = 0; i < 4; i++) t = L.applyWater(t, 10);
  const res = L.judge(L.toCenti(95), t);
  assert.equal(res.errC, 100);
  assert.equal(res.rankLabel, '天才熱波師');
  assert.equal(res.score, 9000);
});

test('表示フォーマット', () => {
  assert.equal(L.formatThermo(7845), '78.5');
  assert.equal(L.formatThermo(7840), '78.4');
  assert.equal(L.formatPrecise(9530), '95.3');
  assert.equal(L.formatPrecise(9535), '95.35');
  assert.equal(L.formatPrecise(9500), '95.0');
  assert.equal(L.formatTarget(9500), '95');
});

test('X共有テキストとURL', () => {
  const res = L.judge(9500, 9530);
  const text = L.buildShareText(res);
  assert.equal(text, [
    'ギリギリサウナ♨️', '',
    'おじさんの希望：95℃', '実際の温度：95.3℃', '誤差：0.3℃', '',
    '評価：神のロウリュ', 'スコア：9700点', '',
    '#ギリギリサウナ',
  ].join('\n'));
  const url = new URL(L.buildShareUrl(res, 'https://example.github.io/girigiri-sauna/', 'ギリギリサウナ'));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/tweet');
  assert.equal(url.searchParams.get('text'), text);
  assert.equal(url.searchParams.get('url'), 'https://example.github.io/girigiri-sauna/');
});

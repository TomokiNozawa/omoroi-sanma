// 点数計算ドリル — 500問の実地検証 (野沢さん依頼 2026-07-25)
//
// 「score.js の答えを score.js で検算する」と何も検証できないので、正解は2つの独立な出所から取る:
//   ① 点数 … 早見表 (画像) を そのまま書き写したルックアップ表。表に無い符 (80符〜) は定義式で算出
//   ② 符   … 早見表の「各メンツによる加符点 / 待ちの形による加符点」を データとして持ち、
//            score.js とは別に組み立てた第2実装
// 実際の出題フロー (drill.js の newQuestion) を回して、出た問題を上の2つと突き合わせる。
//
// 実行: node tests/test_500.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, summary } = require('./harness');
const SC = require('../score.js');

// ─── 早見表 (画像の数値をそのまま転記) ──────────────
// 1〜4翻。5翻以上は下の LIMIT 表を使う
const T_OYA_RON = {
  20: { 2: 2000, 3: 3900, 4: 7700 },
  25: { 2: 2400, 3: 4800, 4: 9600 },
  30: { 1: 1500, 2: 2900, 3: 5800, 4: 11600 },
  40: { 1: 2000, 2: 3900, 3: 7700, 4: 12000 },
  50: { 1: 2400, 2: 4800, 3: 9600, 4: 12000 },
  60: { 1: 2900, 2: 5800, 3: 11600, 4: 12000 },
  70: { 1: 3400, 2: 6800, 3: 12000, 4: 12000 },
};
const T_OYA_TSUMO = {   // 「◯◯点オール」= 子1人あたり
  20: { 2: 700, 3: 1300, 4: 2600 },
  25: { 2: 800, 3: 1600, 4: 3200 },
  30: { 1: 500, 2: 1000, 3: 2000, 4: 3900 },
  40: { 1: 700, 2: 1300, 3: 2600, 4: 4000 },
  50: { 1: 800, 2: 1600, 3: 3200, 4: 4000 },
  60: { 1: 1000, 2: 2000, 3: 3900, 4: 4000 },
  70: { 1: 1200, 2: 2300, 3: 4000, 4: 4000 },
};
const T_KO_RON = {
  20: { 2: 1300, 3: 2600, 4: 5200 },
  25: { 2: 1600, 3: 3200, 4: 6400 },
  30: { 1: 1000, 2: 2000, 3: 3900, 4: 7700 },
  40: { 1: 1300, 2: 2600, 3: 5200, 4: 8000 },
  50: { 1: 1600, 2: 3200, 3: 6400, 4: 8000 },
  60: { 1: 2000, 2: 3900, 3: 8000, 4: 8000 },   // 60符3翻は野沢さん指示で満貫 (表は7,700)
  70: { 1: 2300, 2: 4500, 3: 8000, 4: 8000 },
};
const T_KO_TSUMO = {    // [子から, 親から]
  20: { 2: [400, 700], 3: [700, 1300], 4: [1300, 2600] },
  25: { 2: [400, 800], 3: [800, 1600], 4: [1600, 3200] },
  30: { 1: [300, 500], 2: [500, 1000], 3: [1000, 2000], 4: [2000, 3900] },
  40: { 1: [400, 700], 2: [700, 1300], 3: [1300, 2600], 4: [2000, 4000] },
  50: { 1: [400, 800], 2: [800, 1600], 3: [1600, 3200], 4: [2000, 4000] },
  60: { 1: [500, 1000], 2: [1000, 2000], 3: [2000, 4000], 4: [2000, 4000] },  // 3翻=満貫扱い
  70: { 1: [600, 1200], 2: [1200, 2300], 3: [2000, 4000], 4: [2000, 4000] },
};
// 満貫以上 (符に依らない)
const LIMIT = [
  { min: 5, max: 5, oyaRon: 12000, oyaTsumo: 4000, koRon: 8000, koTsumo: [2000, 4000] },
  { min: 6, max: 7, oyaRon: 18000, oyaTsumo: 6000, koRon: 12000, koTsumo: [3000, 6000] },
  { min: 8, max: 10, oyaRon: 24000, oyaTsumo: 8000, koRon: 16000, koTsumo: [4000, 8000] },
  { min: 11, max: 12, oyaRon: 36000, oyaTsumo: 12000, koRon: 24000, koTsumo: [6000, 12000] },
  { min: 13, max: 99, oyaRon: 48000, oyaTsumo: 16000, koRon: 32000, koTsumo: [8000, 16000] },
];
const ceil100 = (n) => Math.ceil(n / 100) * 100;

// 表に無い符 (80符以上) 用の定義式。満貫の頭打ちも見る
function byFormula(fu, han, isOya, isTsumo) {
  let b = fu * Math.pow(2, 2 + han);
  if (b >= 2000) b = 2000;
  if (isTsumo) return isOya ? { each: ceil100(b * 2) } : { ko: ceil100(b), oya: ceil100(b * 2) };
  return { total: ceil100(b * (isOya ? 6 : 4)) };
}

// 期待値をテーブル (または定義式) から引く。合計は人数で組み立てる
function expected(fu, han, isOya, isTsumo, players) {
  const koN = players === 3 ? 2 : 3;
  const lim = LIMIT.find(l => han >= l.min && han <= l.max);
  if (lim) {
    if (!isTsumo) return { total: isOya ? lim.oyaRon : lim.koRon };
    if (isOya) return { each: lim.oyaTsumo, total: lim.oyaTsumo * koN };
    const [ko, oya] = lim.koTsumo;
    return { ko, oya, total: oya + ko * (koN - 1) };
  }
  const tbl = isTsumo ? (isOya ? T_OYA_TSUMO : T_KO_TSUMO) : (isOya ? T_OYA_RON : T_KO_RON);
  const row = tbl[fu];
  if (!row || row[han] === undefined) {
    // 表に無い符 (80符〜) は定義式で
    const f = byFormula(fu, han, isOya, isTsumo);
    if (!isTsumo) return { total: f.total };
    if (isOya) return { each: f.each, total: f.each * koN };
    return { ko: f.ko, oya: f.oya, total: f.oya + f.ko * (koN - 1) };
  }
  if (!isTsumo) return { total: row[han] };
  if (isOya) return { each: row[han], total: row[han] * koN };
  const [ko, oya] = row[han];
  return { ko, oya, total: oya + ko * (koN - 1) };
}

// ─── 符の第2実装 (早見表の加符点をデータで持つ) ──────────
const FU_MELD = {           // [中張牌, 幺九牌]
  minko: [2, 4], anko: [4, 8], minkan: [8, 16], ankan: [16, 32],
};
const FU_WAIT = { ryanmen: 0, shanpon: 0, penchan: 2, kanchan: 2, tanki: 2 };
const YAOCHU2 = new Set([0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26]);
const SANGEN2 = [24, 25, 26];
const WIND2 = { 東: 20, 南: 21, 西: 22, 北: 23 };

function fu2(h) {
  if (h.isChiitoi) return 25;                        // 七対子は一律25符
  if (h.isPinfu && h.isTsumo) return 20;             // 平和ツモは一律20符
  let f = 20;                                        // ① 基本符 (副底)
  for (const m of h.melds) {                         // ③ 各メンツ
    if (m.type === 'shuntsu') continue;
    const col = YAOCHU2.has(m.id) ? 1 : 0;
    if (m.type === 'koutsu') f += FU_MELD[m.open ? 'minko' : 'anko'][col];
    else f += FU_MELD[m.open ? 'minkan' : 'ankan'][col];
  }
  const p = h.pair;                                  // ④ アタマ (役牌なら+2符)
  if (SANGEN2.includes(p) || WIND2[h.seatWind] === p || WIND2[h.roundWind] === p) f += 2;
  f += FU_WAIT[h.wait] || 0;                         // ⑤ 待ちの形
  if (h.isTsumo) f += 2;                             // ② アガリ方
  else if (h.isMenzen) f += 10;
  if (!h.isMenzen && f === 20) return 30;            // 喰いピンフ形
  return Math.ceil(f / 10) * 10;                     // 1の位は切り上げ
}

// ─── drill.js を読み込む (実際の出題フローを回すため) ──────
function loadDrill() {
  const els = {};
  const mkEl = () => ({
    hidden: false, textContent: '', innerHTML: '', className: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
  });
  const doc = {
    getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelectorAll: () => [], createElement: () => mkEl(),
    addEventListener() {}, body: mkEl(),
  };
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Boolean, Set, Map, Date,
    document: doc, location: { href: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    ScoreCalc: SC,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'drill.js'), 'utf8');
  return vm.runInContext(src + `
;({ newQuestion, genTehai, scoreChoices, splitChoices, fuChoices, S })`, ctx, { filename: 'drill.js' });
}

(async () => {
  const D = loadDrill();
  D.S.stats = { total: 0, correct: 0, streak: 0, best: 0, byMode: {} };

  const N = { tehai: 300, table: 100, split: 100 };
  const bad = { fu: [], score: [], choice: [], split: [], combo: [] };
  let asked = 0;

  // ── 手牌モード 300問 ──
  D.S.mode = 'tehai';
  for (let i = 0; i < N.tehai; i++) {
    D.S.players = (i % 2 === 0) ? 3 : 4;
    D.newQuestion();
    const q = D.S.q; const c = q.calc;
    asked++;
    // ① 符: 第2実装と一致するか
    const f2 = fu2(q.hand);
    if (c.fu !== f2) bad.fu.push(`#${i} 符 ${c.fu}≠${f2} (${q.hand.wait}/${q.hand.isMenzen ? '門前' : '副露'}/${q.hand.isTsumo ? 'ツモ' : 'ロン'})`);
    // ② 点数: 早見表と一致するか
    const exp = expected(c.fu, c.han, c.isOya, c.isTsumo, c.players);
    const got = SC.calcScore(c);
    if (got.total !== exp.total) {
      bad.score.push(`#${i} ${c.fu}符${c.han}翻 ${c.isOya ? '親' : '子'}${c.isTsumo ? 'ツモ' : 'ロン'} ${c.players}人 → 期待${exp.total}≠${got.total}`);
    }
    if (c.isTsumo && exp.ko !== undefined
        && (got.detail.fromKo !== exp.ko || got.detail.fromOya !== exp.oya)) {
      bad.split.push(`#${i} ${c.fu}符${c.han}翻 子ツモ → 期待${exp.ko}/${exp.oya}≠${got.detail.fromKo}/${got.detail.fromOya}`);
    }
    if (c.isTsumo && exp.each !== undefined && got.detail.fromKo !== exp.each) {
      bad.split.push(`#${i} ${c.fu}符${c.han}翻 親ツモ → 期待${exp.each}オール≠${got.detail.fromKo}`);
    }
    // ③ 選択肢: 正解を含み4択か + その手であり得ない符を混ぜていないか
    const fch = D.fuChoices(c.fu, q.hand);
    if (!fch.includes(c.fu) || fch.length !== 4) bad.choice.push(`#${i} 符の選択肢`);
    if (!q.hand.isChiitoi && fch.includes(25)) bad.choice.push(`#${i} 面子手なのに25符(七対子)が選択肢に`);
    if (!(q.hand.isPinfu && q.hand.isTsumo) && fch.includes(20)) {
      bad.choice.push(`#${i} 平和ツモでないのに20符が選択肢に`);
    }
    const sch = D.scoreChoices(q, got.total);
    if (!sch.includes(got.total) || sch.length !== 4) bad.choice.push(`#${i} 点数の選択肢`);
    // ④ 成立しない組み合わせを出していないか
    if ((c.fu === 20 || c.fu === 25) && c.han < 2) bad.combo.push(`#${i} ${c.fu}符${c.han}翻`);
    if (c.fu === 20 && !(q.hand.isPinfu && q.hand.isTsumo)) bad.combo.push(`#${i} 20符なのに平和ツモでない`);
    // 手の形から確実につく役に対して翻数が足りていないか (三暗刻なのに1翻 等)
    {
      const ns = q.hand.melds.filter(m => m.type !== 'shuntsu');
      const cc = ns.filter(m => !m.open);
      const kc = q.hand.melds.filter(m => m.type === 'kantsu').length;
      let need = 1;
      if (ns.length === 4) need += 2;
      if (cc.length >= 3) need += 2;
      if (kc >= 3) need += 2;
      if (q.hand.isPinfu && q.hand.isTsumo) need = Math.max(need, 2);
      if (c.han < need) bad.combo.push(`#${i} ${c.han}翻だが形から最低${need}翻 (刻子${ns.length}/暗刻${cc.length}/槓${kc})`);
      if (cc.length >= 4) bad.combo.push(`#${i} 暗刻が4つ (四暗刻の形)`);
    }
  }

  // ── 符と翻から点数 100問 ──
  D.S.mode = 'table';
  for (let i = 0; i < N.table; i++) {
    D.S.players = (i % 2 === 0) ? 3 : 4;
    D.newQuestion();
    const c = D.S.q.calc; asked++;
    const exp = expected(c.fu, c.han, c.isOya, c.isTsumo, c.players);
    const got = SC.calcScore(c);
    if (got.total !== exp.total) {
      bad.score.push(`table#${i} ${c.fu}符${c.han}翻 ${c.isOya ? '親' : '子'}${c.isTsumo ? 'ツモ' : 'ロン'} ${c.players}人 → 期待${exp.total}≠${got.total}`);
    }
    const sch = D.scoreChoices(D.S.q, got.total);
    if (!sch.includes(got.total) || sch.length !== 4) bad.choice.push(`table#${i} 選択肢`);
    if ((c.fu === 20 || c.fu === 25) && c.han < 2) bad.combo.push(`table#${i} ${c.fu}符${c.han}翻`);
    if (c.fu === 20 && !c.isTsumo) bad.combo.push(`table#${i} 20符ロン`);
  }

  // ── ツモの支払い 100問 ──
  D.S.mode = 'split';
  for (let i = 0; i < N.split; i++) {
    D.S.players = (i % 2 === 0) ? 3 : 4;
    D.newQuestion();
    const c = D.S.q.calc; asked++;
    const exp = expected(c.fu, c.han, c.isOya, c.isTsumo, c.players);
    const got = SC.calcScore(c);
    if (got.total !== exp.total) {
      bad.score.push(`split#${i} ${c.fu}符${c.han}翻 ${c.isOya ? '親' : '子'} ${c.players}人 → 期待${exp.total}≠${got.total}`);
    }
    if (exp.ko !== undefined && (got.detail.fromKo !== exp.ko || got.detail.fromOya !== exp.oya)) {
      bad.split.push(`split#${i} ${c.fu}符${c.han}翻 子 → 期待${exp.ko}/${exp.oya}≠${got.detail.fromKo}/${got.detail.fromOya}`);
    }
    if (exp.each !== undefined && got.detail.fromKo !== exp.each) {
      bad.split.push(`split#${i} ${c.fu}符${c.han}翻 親 → 期待${exp.each}オール≠${got.detail.fromKo}`);
    }
    const spch = D.splitChoices(D.S.q, got);
    if (spch.filter(x => x.correct).length !== 1 || spch.length !== 4) bad.choice.push(`split#${i} 選択肢`);
    if ((c.fu === 20 || c.fu === 25) && c.han < 2) bad.combo.push(`split#${i} ${c.fu}符${c.han}翻`);
  }

  console.log(`\n── ${asked}問を実際に出題して検証 ──────────────`);
  const show = (a) => a.length ? a.slice(0, 6).join('\n      ') + (a.length > 6 ? `\n      …他${a.length - 6}件` : '') : '';
  check(`符が第2実装と一致 (手牌 ${N.tehai}問)`, bad.fu.length === 0, show(bad.fu));
  check(`点数が早見表と一致 (全 ${asked}問)`, bad.score.length === 0, show(bad.score));
  check('ツモの内訳が早見表と一致', bad.split.length === 0, show(bad.split));
  check('選択肢が常に4択で正解を含む', bad.choice.length === 0, show(bad.choice));
  check('成立しない符と翻の組み合わせを出していない', bad.combo.length === 0, show(bad.combo));

  // 出題の分布も見ておく (偏っていないか)
  console.log('\n── 出題の分布 ────────────────────────');
  {
    const fuDist = {}, hanDist = {};
    D.S.mode = 'tehai';
    for (let i = 0; i < 500; i++) {
      D.S.players = 3; D.newQuestion();
      const c = D.S.q.calc;
      fuDist[c.fu] = (fuDist[c.fu] || 0) + 1;
      hanDist[c.han] = (hanDist[c.han] || 0) + 1;
    }
    const fuKinds = Object.keys(fuDist).length;
    console.log(`  符の分布: ${Object.keys(fuDist).sort((a,b)=>a-b).map(k => `${k}符×${fuDist[k]}`).join(' / ')}`);
    console.log(`  翻の分布: ${Object.keys(hanDist).sort((a,b)=>a-b).map(k => `${k}翻×${hanDist[k]}`).join(' / ')}`);
    check('符が4種類以上ばらける', fuKinds >= 4, `${fuKinds}種`);
  }

  // ─── 網羅検証: ランダム500問では出ない組み合わせも潰す ───
  console.log('\n── 符の全組み合わせを網羅 ─────────────────');
  {
    // 面子タイプ (順子/明刻/暗刻/明槓/暗槓 × 中張/幺九) から4つ選ぶ重複組み合わせ
    //   × 待ち5種 × 雀頭(役牌/非役牌) × ツモ/ロン × 門前/副露
    const meldKinds = [
      { type: 'shuntsu', id: 3 },                    // 順子 (中張)
      { type: 'koutsu', id: 5, open: true },          // 明刻 中張
      { type: 'koutsu', id: 20, open: true },         // 明刻 幺九
      { type: 'koutsu', id: 5 },                      // 暗刻 中張
      { type: 'koutsu', id: 20 },                     // 暗刻 幺九
      { type: 'kantsu', id: 5, open: true },          // 明槓 中張
      { type: 'kantsu', id: 20, open: true },         // 明槓 幺九
      { type: 'kantsu', id: 5 },                      // 暗槓 中張
      { type: 'kantsu', id: 20 },                     // 暗槓 幺九
    ];
    const waits = ['ryanmen', 'shanpon', 'kanchan', 'penchan', 'tanki'];
    const pairs = [24 /* 白=役牌 */, 4 /* 三筒=非役牌 */, 20 /* 東 */];
    let cases = 0, ng = [];
    // 4面子の組み合わせ (重複あり・順序無視)
    for (let a = 0; a < meldKinds.length; a++)
    for (let b = a; b < meldKinds.length; b++)
    for (let c2 = b; c2 < meldKinds.length; c2++)
    for (let d = c2; d < meldKinds.length; d++) {
      const melds = [meldKinds[a], meldKinds[b], meldKinds[c2], meldKinds[d]]
        .map(m => ({ ...m, open: !!m.open }));
      for (const wait of waits) {
        for (const pair of pairs) {
          for (const isTsumo of [false, true]) {
            for (const isMenzen of [false, true]) {
              // 門前なら鳴いた面子は持てない
              if (isMenzen && melds.some(m => m.open)) continue;
              const hand = { melds, pair, wait, isTsumo, isMenzen,
                seatWind: '南', roundWind: '東', isChiitoi: false, isPinfu: false };
              cases++;
              const f1 = SC.calcFu(hand).fu;
              const f2v = fu2(hand);
              if (f1 !== f2v) ng.push(`${melds.map(m=>m.type[0]+(m.open?'o':'')).join('+')}/${wait}/雀頭${pair}/${isTsumo?'ツモ':'ロン'}/${isMenzen?'門前':'副露'} → ${f1}≠${f2v}`);
            }
          }
        }
      }
    }
    check(`符: ${cases.toLocaleString()}通りすべてで2実装が一致`, ng.length === 0,
      ng.length ? ng.slice(0, 5).join(' / ') : `${cases.toLocaleString()}通り 検証`);
  }

  console.log('\n── 点数の全組み合わせを網羅 ────────────────');
  {
    const fus = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
    let cases = 0, ng = [];
    for (const fu of fus) {
      for (let han = 1; han <= 13; han++) {
        for (const isOya of [false, true]) {
          for (const isTsumo of [false, true]) {
            for (const players of [3, 4]) {
              // 実在しない組み合わせは飛ばす (20符=平和ツモ / 25符=七対子は2翻から)
              if (fu === 20 && !isTsumo) continue;
              if ((fu === 20 || fu === 25) && han < 2) continue;
              cases++;
              const exp = expected(fu, han, isOya, isTsumo, players);
              const got = SC.calcScore({ fu, han, isOya, isTsumo, players });
              if (got.total !== exp.total) {
                ng.push(`${fu}符${han}翻${isOya?'親':'子'}${isTsumo?'ツモ':'ロン'}${players}人 期待${exp.total}≠${got.total}`);
              }
              if (isTsumo && exp.ko !== undefined
                  && (got.detail.fromKo !== exp.ko || got.detail.fromOya !== exp.oya)) {
                ng.push(`${fu}符${han}翻 子ツモ 内訳 期待${exp.ko}/${exp.oya}≠${got.detail.fromKo}/${got.detail.fromOya}`);
              }
              if (isTsumo && exp.each !== undefined && got.detail.fromKo !== exp.each) {
                ng.push(`${fu}符${han}翻 親ツモ 期待${exp.each}≠${got.detail.fromKo}`);
              }
            }
          }
        }
      }
    }
    check(`点数: ${cases.toLocaleString()}通りすべてで早見表と一致`, ng.length === 0,
      ng.length ? ng.slice(0, 5).join(' / ') : `${cases.toLocaleString()}通り 検証`);
  }

  const ok = summary(`${asked}問 実地検証 + 網羅検証`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

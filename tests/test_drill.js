// 点数計算ドリルの出題ロジック検証
// 出題が破綻すると「正解が選択肢に無い」「符が計算できない」など 全問不正解になるので、
// 大量に生成して不変条件を確かめる。
// 実行: node tests/test_drill.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, summary } = require('./harness');
const SC = require('../score.js');

// drill.js を DOM スタブ付きで読み込み、出題関数を取り出す
function loadDrill() {
  const els = {};
  const mkEl = () => ({
    hidden: false, textContent: '', innerHTML: '', className: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, focus() {}, querySelector: () => null,
    querySelectorAll: () => [],
  });
  const doc = {
    getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelectorAll: () => [],
    createElement: () => mkEl(),
    addEventListener() {},
    body: mkEl(),
  };
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Boolean, Set, Map, Date,
    document: doc,
    location: { href: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    ScoreCalc: SC,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'drill.js'), 'utf8');
  return vm.runInContext(src + `
;({ genTehai, handTiles, fuChoices, scoreChoices, splitChoices, S, TILE_IMG, SHUNTSU_STARTS })`,
    ctx, { filename: 'drill.js' });
}

const D = loadDrill();

(async () => {
  console.log('\n── 手牌の生成 (1000回) ────────────────');
  {
    let err = null, fuMin = 999, fuMax = 0, tiles14 = 0, badTile = null;
    const fuSeen = new Set();
    const waitSeen = new Set();
    for (let i = 0; i < 1000; i++) {
      try {
        const t = D.genTehai(i % 2 === 0 ? 3 : 4);
        const fu = SC.calcFu(t.hand).fu;
        fuSeen.add(fu);
        waitSeen.add(t.hand.wait);
        fuMin = Math.min(fuMin, fu); fuMax = Math.max(fuMax, fu);
        // 牌の枚数: 面子4つ(順子3/刻子3/槓子4) + 雀頭2
        const tl = D.handTiles(t.hand);
        const kanCount = t.hand.melds.filter(m => m.type === 'kantsu').length;
        if (tl.length !== 14 + kanCount) tiles14++;
        // 牌 id が全て画像を持っているか
        for (const id of tl) if (!D.TILE_IMG[id]) badTile = id;
      } catch (e) { err = e.message; break; }
    }
    check('1000回の生成で例外が出ない', err === null, err || '');
    check('符が常識的な範囲に収まる (20〜110符)', fuMin >= 20 && fuMax <= 110, `${fuMin}〜${fuMax}符`);
    check('牌の枚数が常に正しい', tiles14 === 0, `不正=${tiles14}件`);
    check('存在しない牌が混ざらない', badTile === null, badTile === null ? '' : `id=${badTile}`);
    check('符が1種類に偏っていない', fuSeen.size >= 4, `${[...fuSeen].sort((a,b)=>a-b).join('/')}符`);
    check('待ちの形がばらけている', waitSeen.size >= 3, [...waitSeen].join('/'));
  }

  console.log('\n── 順子の生成が色をまたがない ──────────────');
  {
    // 萬子は 1m/9m しかないので順子を作れない。 筒子(2-10)/索子(11-19) の中で閉じているか
    let bad = null;
    for (const st of D.SHUNTSU_STARTS) {
      const ids = [st, st + 1, st + 2];
      const isPin = ids.every(i => i >= 2 && i <= 10);
      const isSou = ids.every(i => i >= 11 && i <= 19);
      if (!isPin && !isSou) { bad = ids; break; }
    }
    check('順子が色をまたがない (萬子と筒子の境目など)', bad === null,
      bad ? `不正=${bad}` : `${D.SHUNTSU_STARTS.length}種の起点すべて OK`);

    // 実際の生成でも確認
    let mixed = 0;
    for (let i = 0; i < 300; i++) {
      for (const m of D.genTehai(3).melds || []) { /* noop */ }
      const t = D.genTehai(3);
      for (const m of t.hand.melds) {
        if (m.type !== 'shuntsu') continue;
        const ids = [m.id, m.id + 1, m.id + 2];
        const isPin = ids.every(x => x >= 2 && x <= 10);
        const isSou = ids.every(x => x >= 11 && x <= 19);
        if (!isPin && !isSou) mixed++;
      }
    }
    check('生成された順子も色をまたがない', mixed === 0, `不正=${mixed}件`);
  }

  console.log('\n── 選択肢に正解が必ず含まれる ───────────────');
  {
    // 符の選択肢
    let missFu = 0;
    for (const fu of [20, 25, 30, 40, 50, 60, 70, 80]) {
      const ch = D.fuChoices(fu);
      if (!ch.includes(fu)) missFu++;
      if (ch.length !== 4) missFu++;
      if (new Set(ch).size !== ch.length) missFu++;  // 重複なし
    }
    check('符の選択肢は 正解を含む4択で重複なし', missFu === 0, `不正=${missFu}件`);

    // 点数の選択肢
    let missScore = 0, dupScore = 0;
    for (let i = 0; i < 400; i++) {
      const calc = {
        fu: [20, 25, 30, 40, 50, 60][i % 6],
        han: (i % 5) + 1,
        isOya: i % 2 === 0,
        isTsumo: i % 3 === 0,
        players: i % 2 === 0 ? 3 : 4,
      };
      if (calc.fu === 20 && !calc.isTsumo) calc.isTsumo = true;  // 20符はツモのみ
      const correct = SC.calcScore(calc).total;
      const ch = D.scoreChoices({ calc }, correct);
      if (!ch.includes(correct)) missScore++;
      if (new Set(ch).size !== ch.length) dupScore++;
    }
    check('点数の選択肢は 常に正解を含む', missScore === 0, `欠落=${missScore}件`);
    check('点数の選択肢に重複がない', dupScore === 0, `重複=${dupScore}件`);

    // 満貫以上は符が効かず候補が重複しやすい。2択に痩せていないか
    let thin = 0, thinCase = null;
    for (let i = 0; i < 500; i++) {
      const calc = {
        fu: [20, 25, 30, 40, 50, 60, 70][i % 7],
        han: (i % 8) + 1,                       // 満貫〜役満まで含める
        isOya: i % 2 === 0, isTsumo: i % 3 === 0, players: i % 2 === 0 ? 3 : 4,
      };
      if (calc.fu === 20 && !calc.isTsumo) calc.isTsumo = true;
      const ch = D.scoreChoices({ calc }, SC.calcScore(calc).total);
      if (ch.length !== 4) { thin++; if (!thinCase) thinCase = `${calc.fu}符${calc.han}翻→${ch.length}択`; }
    }
    check('満貫以上でも必ず4択になる', thin === 0, thin ? `${thin}件 (例: ${thinCase})` : '500通り すべて4択');

    // 支払い内訳の選択肢
    let missSplit = 0, dupSplit = 0;
    for (let i = 0; i < 300; i++) {
      const calc = {
        fu: [25, 30, 40, 50][i % 4], han: (i % 4) + 1,
        isOya: i % 3 === 0, isTsumo: true, players: i % 2 === 0 ? 3 : 4,
      };
      const correct = SC.calcScore(calc);
      const ch = D.splitChoices({ calc }, correct);
      const rights = ch.filter(c => c.correct);
      if (rights.length !== 1) missSplit++;
      const keys = ch.map(c => c.key);
      if (new Set(keys).size !== keys.length) dupSplit++;
    }
    check('支払いの選択肢は 正解がちょうど1つ', missSplit === 0, `不正=${missSplit}件`);
    check('支払いの選択肢に重複がない', dupSplit === 0, `重複=${dupSplit}件`);

    let thinSplit = 0, thinSplitCase = null;
    for (let i = 0; i < 400; i++) {
      const calc = {
        fu: [20, 25, 30, 40, 50, 60, 70][i % 7], han: (i % 8) + 1,
        isOya: i % 3 === 0, isTsumo: true, players: i % 2 === 0 ? 3 : 4,
      };
      if (calc.fu === 20 && calc.han > 4) calc.han = 2;
      const ch = D.splitChoices({ calc }, SC.calcScore(calc));
      if (ch.length !== 4) {
        thinSplit++;
        if (!thinSplitCase) thinSplitCase = `${calc.fu}符${calc.han}翻${calc.isOya ? '親' : '子'}→${ch.length}択`;
      }
    }
    check('支払いも必ず4択になる', thinSplit === 0,
      thinSplit ? `${thinSplit}件 (例: ${thinSplitCase})` : '400通り すべて4択');
  }

  console.log('\n── ピンフ判定 ────────────────────────');
  {
    // 生成されたピンフ手が 実際にピンフの条件を満たしているか
    let bad = 0, pinfuCount = 0;
    for (let i = 0; i < 800; i++) {
      const t = D.genTehai(3);
      if (!t.hand.isPinfu) continue;
      pinfuCount++;
      const h = t.hand;
      const allShuntsu = h.melds.every(m => m.type === 'shuntsu');
      const pairYakuhai = SC.SANGEN.includes(h.pair)
        || SC.WINDS[h.seatWind] === h.pair || SC.WINDS[h.roundWind] === h.pair;
      if (!allShuntsu || h.wait !== 'ryanmen' || pairYakuhai || !h.isMenzen) bad++;
    }
    check('ピンフ手は 全順子+両面+役牌でない雀頭+門前', bad === 0, `不正=${bad}件 / 出現${pinfuCount}回`);
    check('ピンフ手が実際に出現する', pinfuCount > 0, `${pinfuCount}回`);
  }

  console.log('\n── 存在しない符と翻の組み合わせを出さない ─────────');
  {
    // 20符 = ピンフツモ (ピンフ1翻 + ツモ1翻)、 25符 = 七対子 (2翻)。 どちらも1翻はあり得ない
    let bad = 0, badCase = null;
    for (let i = 0; i < 800; i++) {
      const t = D.genTehai(3);
      const fu = SC.calcFu(t.hand).fu;
      if ((fu === 20 || fu === 25) && t.han < 2) {
        bad++; if (!badCase) badCase = `${fu}符${t.han}翻`;
      }
      // 20符が出るのはピンフツモの時だけ
      if (fu === 20 && !(t.hand.isPinfu && t.hand.isTsumo)) {
        bad++; if (!badCase) badCase = '20符なのにピンフツモでない';
      }
    }
    check('手牌出題に 20符/25符の1翻が出ない', bad === 0, badCase || '800回すべて OK');
  }

  console.log('\n── 三麻にチーは無い / 鳴きの種別 ──────────────');
  {
    let chiIn3 = 0, chiIn4 = 0;
    for (let i = 0; i < 600; i++) {
      const t3 = D.genTehai(3);
      if (t3.hand.melds.some(m => m.type === 'shuntsu' && m.open)) chiIn3++;
      const t4 = D.genTehai(4);
      if (t4.hand.melds.some(m => m.type === 'shuntsu' && m.open)) chiIn4++;
    }
    check('三麻では順子を鳴いた形 (チー) を出さない', chiIn3 === 0, `三麻で${chiIn3}件`);
    check('四麻ではチーが出る', chiIn4 > 0, `四麻で${chiIn4}件`);
  }

  console.log('\n── ロンで完成した刻子の指定 ──────────────');
  {
    let bad = 0, shanponRon = 0, wrongKind = 0;
    for (let i = 0; i < 800; i++) {
      const t = D.genTehai(i % 2 ? 3 : 4);
      const h = t.hand;
      if (h.wait === 'shanpon' && !h.isTsumo) {
        shanponRon++;
        if (h.ronMeldIdx < 0) {
          // 暗刻が1つも無ければ指定されなくてよい
          if (h.melds.some(m => m.type === 'koutsu' && !m.open)) bad++;
        } else {
          const m = h.melds[h.ronMeldIdx];
          if (!m || m.type !== 'koutsu' || m.open) wrongKind++;
        }
      } else if (h.ronMeldIdx >= 0) {
        bad++;   // シャンポンロン以外で指定されていたらおかしい
      }
    }
    check('シャンポン待ちのロンだけ ronMeldIdx が入る', bad === 0, `不正=${bad}件`);
    check('指定先は必ず「鳴いていない刻子」', wrongKind === 0, `不正=${wrongKind}件`);
    check('シャンポンロンが実際に出題される', shanponRon > 0, `${shanponRon}回`);
  }

  console.log('\n── 副露と暗刻の整合 ───────────────────');
  {
    // 門前 (isMenzen) の手に 明刻・明槓が混ざっていないか
    let bad = 0;
    for (let i = 0; i < 800; i++) {
      const t = D.genTehai(4);
      if (!t.hand.isMenzen) continue;
      if (t.hand.melds.some(m => m.open)) bad++;
    }
    check('門前の手に鳴いた面子が混ざらない', bad === 0, `不正=${bad}件`);
  }

  const ok = summary('点数計算ドリル 出題ロジック');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

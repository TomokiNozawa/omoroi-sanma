// 点数計算ドリルの出題ロジック検証
// 出題が破綻すると「正解が選択肢に無い」「符が計算できない」など 全問不正解になるので、
// 大量に生成して不変条件を確かめる。
// 実行: node tests/test_drill.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, summary, makeGame } = require('./harness');
const SC = require('../score.js');

// 翻数は対局側の calcYaku で判定するので、ドリルにもそれを渡す (本番と同じ経路で検証する)
const ENGINE = makeGame();

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
    calcYaku: ENGINE.calcYaku,
    TILE_IMG: ENGINE.TILE_IMG,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'drill.js'), 'utf8');
  return vm.runInContext(src + `
;({ genTehai, handTiles, scoreChoices, splitChoices, judgeHand, toYakuInput,
    S, TILE_IMG, SHUNTSU_STARTS })`,
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
      // 画面に出る表記 (label) で重複を見る。合計が違っても表記が同じだと選べない
      const labels = ch.map(c => c.label);
      if (new Set(labels).size !== labels.length) dupSplit++;
    }
    check('支払いの選択肢は 正解がちょうど1つ', missSplit === 0, `不正=${missSplit}件`);
    check('支払いの選択肢は表記が重複しない (700・1300 が2つ並ばない)', dupSplit === 0,
      `重複=${dupSplit}件`);

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

  console.log('\n── 翻数が手牌から確定する (翻数を画面に出さないため) ─────');
  {
    // 出題では翻数も符も伏せる。 手牌+状況から翻が一意に決まらないと解けない問題になる。
    let noYaku = 0, yakuman = 0, outOfRange = 0, mismatch = 0, pinfuConflict = 0;
    let riichiWhenOpen = 0, doraTooMany = 0, hanSumBad = 0;
    let sawRiichi = 0, sawDora = 0, hanSeen = new Set();
    for (let i = 0; i < 800; i++) {
      const t = D.genTehai(i % 2 ? 3 : 4);
      hanSeen.add(t.han);
      // 役が1つも無い手は あがれないので出題してはいけない
      if (!t.yakuList || !t.yakuList.length) noYaku++;
      // 役満・満貫超えは符が効かないので出さない (符を数える練習にならない)
      if (t.yakuList && t.yakuList.some(y => y.han >= 13)) yakuman++;
      if (t.han < 1 || t.han > 5) outOfRange++;
      // 手役 + リーチ + ドラ の合計が han と一致するか
      const sum = t.yakuList.reduce((n, y) => n + y.han, 0);
      if (sum !== t.han) hanSumBad++;
      // 副露手にリーチは付かない
      if (t.isRiichi && !t.hand.isMenzen) riichiWhenOpen++;
      if (t.doraCount < 0 || t.doraCount > 2) doraTooMany++;
      if (t.isRiichi) sawRiichi++;
      if (t.doraCount > 0) sawDora++;

      // 手役だけを判定し直して、リーチ+ドラを引いた分と一致するか (= 手牌から読み取れる翻)
      const bare = Object.assign({}, t.hand, { isRiichi: false });
      const j = D.judgeHand(bare);
      if (!j) { mismatch++; continue; }
      const expect = j.han + (t.isRiichi ? 1 : 0) + t.doraCount;
      if (expect !== t.han) mismatch++;
      // 符計算(score.js)と役判定(calcYaku)でピンフの解釈が割れた手は出さない
      if (j.isPinfu !== t.hand.isPinfu) pinfuConflict++;
    }
    check('役なしの手を出題しない', noYaku === 0, `${noYaku}件`);
    check('役満を出題しない', yakuman === 0, `${yakuman}件`);
    check('翻数が 1〜5翻に収まる (符が効く範囲)', outOfRange === 0,
      `範囲外=${outOfRange}件 / 出た翻=${[...hanSeen].sort((a, b) => a - b).join('/')}`);
    check('役の内訳の合計が翻数と一致する', hanSumBad === 0, `不一致=${hanSumBad}件`);
    check('手牌から読み取れる翻数と出題の翻数が一致する', mismatch === 0, `不一致=${mismatch}件`);
    check('ピンフの解釈が符計算と役判定で食い違わない', pinfuConflict === 0, `食い違い=${pinfuConflict}件`);
    check('副露手にリーチが付かない', riichiWhenOpen === 0, `${riichiWhenOpen}件`);
    check('ドラは0〜2枚', doraTooMany === 0, `範囲外=${doraTooMany}件`);
    check('リーチもドラも実際に出題される', sawRiichi > 0 && sawDora > 0,
      `リーチ${sawRiichi}回 / ドラ${sawDora}回`);
  }

  console.log('\n── 鳴いた面子の渡し方 (四麻のチー) ──────────────');
  {
    // calcYaku の openMeldIds は「1面子 = 1 id」(対局側 openMeldIds() は
    // ポン/明槓/加槓を .map(m => m.id) で返す)。 三暗刻は
    // 「暗刻の数 - openMeldIds.length」で数えるので、
    // チーで id を3つ渡すと 暗刻が3つ余計に引かれて 三暗刻が消える。
    const hand = {
      melds: [
        { type: 'koutsu', id: 3, open: false },    // 2p 暗刻
        { type: 'koutsu', id: 6, open: false },    // 5p 暗刻
        { type: 'koutsu', id: 12, open: false },   // 2s 暗刻
        { type: 'shuntsu', id: 15, open: true },   // 5s6s7s チー
      ],
      pair: 20, wait: 'tanki', isTsumo: true, isMenzen: false,
      seatWind: '南', roundWind: '東', isChiitoi: false, isPinfu: false, ronMeldIdx: -1,
    };
    const inp = D.toYakuInput(hand);
    check('チーは openMeldIds に 1面子=1件で入る', inp.context.openMeldIds.length === 1,
      `${inp.context.openMeldIds.length}件: [${inp.context.openMeldIds}]`);
    const res = ENGINE.calcYaku(inp.tiles, inp.context);
    const names = (res.yakuList || []).map(y => y.name);
    check('暗刻3つ + チー1つ で 三暗刻が付く', names.includes('三暗刻'), names.join('/'));
    check('チーがあるので門前役は付かない',
      !names.includes('門前清自摸和'), names.join('/'));

    // ポン (刻子の鳴き) は従来どおり 暗刻から除かれる
    const hand2 = JSON.parse(JSON.stringify(hand));
    hand2.melds[0].open = true;                    // 2p をポンに
    const res2 = ENGINE.calcYaku(D.toYakuInput(hand2).tiles, D.toYakuInput(hand2).context);
    const names2 = (res2.yakuList || []).map(y => y.name);
    check('ポンした刻子は暗刻に数えない (暗刻2つでは三暗刻なし)',
      !names2.includes('三暗刻'), names2.join('/'));
  }

  console.log('\n── script.js と同じスコープで読める (識別子の衝突なし) ─────');
  {
    // drill.html は script.js と drill.js を同じグローバルスコープで読む。
    // 同名の const/let/class があると「重複宣言」で drill.js が丸ごと動かなくなる
    // (実際に TILE_IMG の重複で全機能が死んだ)。 機械的に検出しておく。
    const tops = (file) => {
      const set = new Set();
      const re = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
      for (const line of fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n')) {
        const m = re.exec(line);
        if (m) set.add(m[1]);
      }
      return set;
    };
    const d = tops('drill.js');
    const dup = [...tops('script.js')].filter(n => d.has(n));
    check('drill.js と script.js でトップレベル識別子が衝突しない', dup.length === 0,
      dup.length ? `衝突: ${dup.join(', ')}` : `drill.js の宣言 ${d.size}件 すべて衝突なし`);

    // drill.html が両方を読んでいること (読み忘れると翻数を判定できず出題が壊れる)
    const html = fs.readFileSync(path.join(__dirname, '..', 'drill.html'), 'utf8');
    check('drill.html が score.js / script.js / drill.js を読んでいる',
      /score\.js/.test(html) && /script\.js/.test(html) && /drill\.js/.test(html));
  }

  console.log('\n── 役判定エンジンが対局と共通 ──────────────');
  {
    // calcYaku が無い環境 (script.js 未読込) では出題が破綻するので、
    // 変換 (toYakuInput) が calcYaku の期待する形になっているか直接確かめる
    const t = D.genTehai(3);
    const inp = D.toYakuInput(t.hand);
    const kanCount = t.hand.melds.filter(m => m.type === 'kantsu').length;
    check('変換後の手牌は常に14枚 (槓は3枚等価)', inp.tiles.length === 14, `${inp.tiles.length}枚`);
    check('槓の4枚目が extraTiles に入る', inp.context.extraTiles.length === kanCount,
      `槓${kanCount}個 / extra${inp.context.extraTiles.length}枚`);
    check('あがり牌が context に入る', inp.context.winTile && inp.context.winTile.id != null);
    check('場風が calcYaku の形式 (東/南) で渡る', /^[東南]/.test(inp.context.round), inp.context.round);
    const res = ENGINE.calcYaku(inp.tiles, inp.context);
    check('対局の calcYaku があがり形と認識する', !res.error, res.error || 'OK');
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

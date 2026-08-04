// 対局の点数計算 (符 × 翻) — 本体が実ルールの点数を払っているか
//
// v0.9.16 で 翻数のみの固定表 (30符固定・4翻=無条件で満貫) を廃止し、
// 点数計算ドリルと同じ ScoreCalc に一本化した。
// 「ドリルで練習した点数」と「対局で実際に動く点数」が一致することを担保する。
// 実行: node tests/test_win_score.js
'use strict';

const { makeGame, check, summary, T, Tn, Tseq } = require('./harness');
const SC = require('../score.js');

const g = makeGame();
const { G, calcYaku, calcFuForWin, applyWinScore, waitCandidatesOf } = g;

const ctx = (o = {}) => Object.assign({
  isTsumo: false, isRiichi: false, isOya: false, seatWind: '南', round: '東1',
  kitas: 0, doraIndicator: null, kanDora: [], extraTiles: [], openMeldIds: [],
}, o);

// 対局状態を最小限セットする (符計算は G.melds から鳴きの種別を見る)
function setSeat(seat, melds = []) {
  G.oya = 'bottom';
  G.emptySeat = 'top';
  G.honba = 0;
  G.kyotaku = 0;
  G.scores = { bottom: 35000, right: 35000, left: 35000, top: 35000 };
  G.melds = { bottom: [], right: [], left: [], top: [] };
  G.melds[seat] = melds;
}

(async () => {
  console.log('\n── 符が点数に効く (旧: 翻数のみの固定表) ──────────');
  {
    // 40符3翻 子ロン = 5200。 旧実装は「3翻」の行を引いて 3900 だった
    setSeat('right');
    // 2p2p2p (暗刻/中張2符ではなく 幺九でない刻子=4符) + 789p + 234s + 567s + 東東
    // → 副底20 + 暗刻4 + 門前ロン10 = 34 → 40符
    const hand = [...Tn(3, 3), ...Tseq(8), ...Tseq(12), ...Tseq(15), ...Tn(20, 2)];
    const c = ctx({ winTile: T(8), seatWind: '南', round: '東1' });
    const fu = calcFuForWin(hand, c, 'right', { yakuList: [], han: 3, isYakuman: false });
    check('暗刻1つの門前ロンは 40符', fu === 40, `${fu}符`);
    const sc = SC.calcScore({ fu, han: 3, isOya: false, isTsumo: false, players: 3 });
    check('40符3翻 子ロン = 5200 (旧実装は 3900)', sc.total === 5200, `${sc.total}点`);
  }

  {
    // 30符4翻 子ロン = 7700。 旧実装は「4-5翻(満貫)」の行を引いて 8000 だった
    const sc = SC.calcScore({ fu: 30, han: 4, isOya: false, isTsumo: false, players: 3 });
    check('30符4翻 子ロン = 7700 (旧実装は 8000)', sc.total === 7700, `${sc.total}点`);
  }

  console.log('\n── 符の判定 (待ち・鳴き・ピンフ・七対子) ─────────────');
  {
    setSeat('right');
    // ピンフ形 (全順子 + 数牌雀頭 + 両面) のツモ = 20符固定
    const pinfu = [...Tseq(3), ...Tseq(6), ...Tseq(12), ...Tseq(15), ...Tn(9, 2)];
    const cT = ctx({ winTile: T(3), isTsumo: true });
    const rT = calcYaku(pinfu, cT);
    const fuT = calcFuForWin(pinfu, cT, 'right', rT);
    check('ピンフツモは 20符固定', fuT === 20, `${fuT}符 (${rT.yakuList.map(y => y.name).join('/')})`);

    // 同じ形のロン = 20 + 門前ロン10 = 30符
    const cR = ctx({ winTile: T(3), isTsumo: false });
    const rR = calcYaku(pinfu, cR);
    const fuR = calcFuForWin(pinfu, cR, 'right', rR);
    check('ピンフの門前ロンは 30符', fuR === 30, `${fuR}符`);
  }

  {
    // 七対子は 25符固定
    setSeat('right');
    const chiitoi = [...Tn(2, 2), ...Tn(4, 2), ...Tn(6, 2), ...Tn(11, 2),
      ...Tn(13, 2), ...Tn(20, 2), ...Tn(24, 2)];
    const c = ctx({ winTile: T(24, 1), isTsumo: false });
    const r = calcYaku(chiitoi, c);
    const fu = calcFuForWin(chiitoi, c, 'right', r);
    check('七対子は 25符固定', fu === 25, `${fu}符 (${r.yakuList.map(y => y.name).join('/')})`);
  }

  {
    // 暗槓は 32符 (幺九牌) と大きい。 G.melds の種別を見ているか
    setSeat('right', [{ type: 'ankan', id: 20, from: null, tiles: Tn(20, 4) }]);
    const hand = [...Tn(20, 3), ...Tseq(3), ...Tseq(12), ...Tseq(15), ...Tn(9, 2)];
    const c = ctx({ winTile: T(3), isTsumo: true, extraTiles: [T(20, 3)] });
    const fu = calcFuForWin(hand, c, 'right', { yakuList: [], han: 2, isYakuman: false });
    // 副底20 + 東の暗槓32 + ツモ2 = 54 → 60符
    check('字牌の暗槓は 32符 (合計60符)', fu === 60, `${fu}符`);

    // 同じ形でも ポン (明刻) なら 2符
    setSeat('right', [{ type: 'pon', id: 20, from: 'left', tiles: Tn(20, 3) }]);
    const c2 = ctx({ winTile: T(3), isTsumo: true, openMeldIds: [20] });
    const fu2 = calcFuForWin(hand, c2, 'right', { yakuList: [], han: 1, isYakuman: false });
    // 副底20 + 明刻4 (幺九) + ツモ2 = 26 → 30符
    check('同じ牌でも ポンなら 明刻4符 (合計30符)', fu2 === 30, `${fu2}符`);
  }

  console.log('\n── 待ちの形の取り方 (高点法) ───────────────────');
  {
    // 456p の 6 であがり: 45の両面(0符) とも 56の両面 とも取れる → どちらも0符
    const d = { pair: 9, melds: [{ type: 'shuntsu', id: 5 }] };   // 4p5p6p
    const cands = waitCandidatesOf(d, 7).map(c => c.wait);        // 6p であがり
    check('順子の端であがれば両面', cands.includes('ryanmen'), cands.join('/'));
    const kan = waitCandidatesOf(d, 6).map(c => c.wait);          // 5p (真ん中)
    check('順子の真ん中は嵌張', kan.includes('kanchan'), kan.join('/'));
    // 123p の 3 = 辺張 (12 待ちは3のみ)
    const d2 = { pair: 9, melds: [{ type: 'shuntsu', id: 2 }] };
    check('123 の 3 は辺張', waitCandidatesOf(d2, 4).map(c => c.wait).includes('penchan'));
    // 789p の 7 = 辺張
    const d3 = { pair: 9, melds: [{ type: 'shuntsu', id: 8 }] };
    check('789 の 7 は辺張', waitCandidatesOf(d3, 8).map(c => c.wait).includes('penchan'));
    // 雀頭であがれば単騎
    check('雀頭であがれば単騎', waitCandidatesOf(d, 9).map(c => c.wait).includes('tanki'));
  }

  console.log('\n── 実際の点数移動 (applyWinScore) ─────────────────');
  {
    // 三麻 子のロン 40符3翻 = 5200 を放銃者から受け取る
    setSeat('right');
    const delta = applyWinScore('right', { isTsumo: false, fromSeat: 'left' },
      { han: 3, isYakuman: false, yakuList: [] }, 40);
    check('子ロン40符3翻: 放銃者が -5200', delta.left === -5200, `${delta.left}`);
    check('子ロン40符3翻: あがり者が +5200', delta.right === 5200, `${delta.right}`);
    check('三麻なのでもう1人は動かない', delta.bottom === 0, `${delta.bottom}`);

    // 子のツモ 30符2翻 = 親1000 / 子500 (三麻は子が1人)
    setSeat('right');
    const dT = applyWinScore('right', { isTsumo: true },
      { han: 2, isYakuman: false, yakuList: [] }, 30);
    check('子ツモ30符2翻: 親が -1000', dT.bottom === -1000, `${dT.bottom}`);
    check('子ツモ30符2翻: 子が -500', dT.left === -500, `${dT.left}`);
    check('子ツモ30符2翻: あがり者が +1500', dT.right === 1500, `${dT.right}`);

    // 役満は符に依らない (子ロン 32000)
    setSeat('right');
    const dY = applyWinScore('right', { isTsumo: false, fromSeat: 'left' },
      { han: 13, isYakuman: true, yakuList: [] }, 110);
    check('役満は符に依らず 子ロン32000', dY.right === 32000, `${dY.right}`);

    // ダブル役満 (26翻) は2倍
    setSeat('right');
    const dY2 = applyWinScore('right', { isTsumo: false, fromSeat: 'left' },
      { han: 26, isYakuman: true, yakuList: [] }, 30);
    check('ダブル役満は 子ロン64000', dY2.right === 64000, `${dY2.right}`);

    // 本場が乗る (ロンは1本場300点)
    setSeat('right');
    G.honba = 2;
    const dH = applyWinScore('right', { isTsumo: false, fromSeat: 'left' },
      { han: 3, isYakuman: false, yakuList: [] }, 40);
    check('2本場のロンは +600', dH.right === 5200 + 600, `${dH.right}`);
    G.honba = 0;

    // 供託 (リーチ棒) を回収する
    setSeat('right');
    G.kyotaku = 2000;
    const dK = applyWinScore('right', { isTsumo: false, fromSeat: 'left' },
      { han: 1, isYakuman: false, yakuList: [] }, 30);
    check('供託を回収する', dK.right === 1000 + 2000, `${dK.right}`);
    check('回収後は供託0', G.kyotaku === 0, `${G.kyotaku}`);
  }

  console.log('\n── ドリルと対局で同じ点数になる ──────────────────');
  {
    // 同じ (符, 翻, 親子, ツモロン) なら 必ず一致する = 練習と本番がズレない
    let bad = 0, sample = null;
    for (const fu of [20, 25, 30, 40, 50, 60, 70]) {
      for (let han = 1; han <= 6; han++) {
        for (const isOya of [true, false]) {
          for (const isTsumo of [true, false]) {
            if (fu === 20 && !isTsumo) continue;      // 20符はピンフツモのみ
            setSeat('right');
            const seat = isOya ? 'bottom' : 'right';
            G.oya = 'bottom';
            const d = applyWinScore(seat, isTsumo ? { isTsumo: true } : { isTsumo: false, fromSeat: 'left' },
              { han, isYakuman: false, yakuList: [] }, fu);
            const drill = SC.calcScore({ fu, han, isOya, isTsumo, players: 3 });
            if (d[seat] !== drill.total) {
              bad++;
              if (!sample) sample = `${fu}符${han}翻 ${isOya ? '親' : '子'}${isTsumo ? 'ツモ' : 'ロン'}: 対局${d[seat]} ≠ ドリル${drill.total}`;
            }
          }
        }
      }
    }
    check('全ての符×翻×親子×ツモロンで ドリルと対局の点数が一致', bad === 0,
      bad ? `${bad}件 (例: ${sample})` : '168通り 一致');
  }

  const ok = summary('対局の点数計算 (符 × 翻)');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

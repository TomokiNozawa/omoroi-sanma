// v0.9.8 ルール精度 — 三槓子 / 九種九牌 の検証
// 実行: node tests/test_rules_v098.js
'use strict';

const { makeGame, check, summary, T, Tn, Tseq } = require('./harness');

const g = makeGame();
const { G, calcYaku, countYaochuKinds, canKyuushu } = g;

// 役判定の共通 context (指定分だけ上書きする)
const ctx = (o = {}) => Object.assign({
  isTsumo: true, isRiichi: false, isOya: false, seatWind: '南', round: '東1',
  kitas: 0, doraIndicator: null, kanDora: [], extraTiles: [], openMeldIds: [],
}, o);
const names = (r) => r.yakuList.map(y => y.name);

(async () => {
  console.log('\n── 三槓子 ──────────────────────────');
  {
    // 暗槓3つ (1p/2p/3p) + 456s + 東東。 面子評価は槓を3枚等価で渡し、4枚目は extraTiles
    const hand = [...Tn(2,3), ...Tn(3,3), ...Tn(4,3), ...Tseq(14), ...Tn(20,2)];
    const r3 = calcYaku(hand, ctx({ extraTiles: [T(2,3), T(3,3), T(4,3)] }));
    check('カン3つで 三槓子 が付く', names(r3).includes('三槓子'), names(r3).join('/'));
    check('三槓子は 2翻', (r3.yakuList.find(y => y.name === '三槓子') || {}).han === 2);

    // 同じ手でカンが2つ (3つ目は普通の暗刻) → 付かない
    const r2 = calcYaku(hand, ctx({ extraTiles: [T(2,3), T(3,3)] }));
    check('カン2つでは 三槓子 が付かない', !names(r2).includes('三槓子'), names(r2).join('/'));

    // 三暗刻とは別物として両方立つ (暗刻3つでもある)
    check('三暗刻と複合する', names(r3).includes('三暗刻'), names(r3).join('/'));

    // 明槓 (鳴き) でも三槓子は下がらない
    const rOpen = calcYaku(hand, ctx({ extraTiles: [T(2,3), T(3,3), T(4,3)], openMeldIds: [2, 3] }));
    check('鳴いた槓でも 三槓子 は付く (食い下がりなし)', names(rOpen).includes('三槓子'),
      names(rOpen).join('/'));
    check('鳴くと三暗刻は落ちる (明槓は暗刻でない)', !names(rOpen).includes('三暗刻'));

    // カンが無い手には当然付かない
    const plain = [...Tseq(2), ...Tseq(5), ...Tseq(8), ...Tseq(11), ...Tn(20,2)];
    check('カン無しの手には付かない', !names(calcYaku(plain, ctx())).includes('三槓子'));
  }

  console.log('\n── 九種九牌: 種類の数え方 ──────────────');
  {
    // 1m 9m 1p 9p 1s 9s 東 南 西 = 9種
    const nine = [T(0,0), T(1,0), T(2,0), T(10,0), T(11,0), T(19,0), T(20,0), T(21,0), T(22,0)];
    check('9種類を正しく数える', countYaochuKinds(nine) === 9, `${countYaochuKinds(nine)}種`);
    // 同じ幺九牌が重なっても 種類は増えない
    const dup = [...nine, T(0,1), T(0,2), T(20,1)];
    check('同じ牌が重なっても種類は増えない', countYaochuKinds(dup) === 9, `${countYaochuKinds(dup)}種`);
    // 中張牌は数えない
    const mixed = [T(0,0), T(1,0), T(5,0), T(6,0), T(14,0)];
    check('中張牌は数に入らない', countYaochuKinds(mixed) === 2, `${countYaochuKinds(mixed)}種`);
    check('幺九牌ゼロなら 0', countYaochuKinds([T(5,0), T(6,0)]) === 0);
  }

  console.log('\n── 九種九牌: 宣言できる条件 ─────────────');
  {
    const reset = (handTiles) => {
      G.roundOver = false;
      G.rules = { naki: true, tobi: true, kyuushu: true };
      G.emptySeat = 'right';
      G.oya = 'bottom';
      G.melds = { bottom: [], right: [], top: [], left: [] };
      G.rivers = { bottom: [], right: [], top: [], left: [] };
      G.kitas = { bottom: 0, right: 0, top: 0, left: 0 };
      G.hands = { bottom: [], right: [], top: [], left: [] };
      G.hands.bottom = handTiles;
    };
    // 幺九牌 9種 + 中張牌5枚 = 14枚 (ツモ後)
    const nineHand = () => [
      T(0,0), T(1,0), T(2,0), T(10,0), T(11,0), T(19,0), T(20,0), T(21,0), T(22,0),
      T(5,0), T(6,0), T(7,0), T(14,0), T(15,0),
    ];
    reset(nineHand());
    check('9種あって第一ツモ番なら宣言できる', canKyuushu('bottom') === true);

    // 8種では足りない
    reset([
      T(0,0), T(1,0), T(2,0), T(10,0), T(11,0), T(19,0), T(20,0), T(21,0),
      T(5,0), T(6,0), T(7,0), T(14,0), T(15,0), T(16,0),
    ]);
    check('8種では宣言できない', canKyuushu('bottom') === false);

    // 既に1枚捨てている = 第一ツモ番ではない
    reset(nineHand());
    G.rivers.bottom = [T(26,0)];
    check('すでに打牌していたら宣言できない', canKyuushu('bottom') === false);

    // 北を抜いている = 第一ツモ番ではない
    reset(nineHand());
    G.kitas.bottom = 1;
    check('北を抜いていたら宣言できない', canKyuushu('bottom') === false);

    // 誰かが鳴いている = 第一巡が途切れている
    reset(nineHand());
    G.melds.top = [{ type: 'pon', id: 20, tiles: [T(20,0), T(20,1), T(20,2)] }];
    check('誰かが鳴いていたら宣言できない', canKyuushu('bottom') === false);

    // ツモ前 (13枚) では宣言できない
    reset(nineHand().slice(0, 13));
    check('ツモ前 (13枚) では宣言できない', canKyuushu('bottom') === false);

    // 局が終わっていたら不可
    reset(nineHand());
    G.roundOver = true;
    check('局の終了後は宣言できない', canKyuushu('bottom') === false);

    // ルールオプションで無効化できる
    reset(nineHand());
    G.rules.kyuushu = false;
    check('ルールで無効にできる', canKyuushu('bottom') === false);

    // 空席は対象外
    reset(nineHand());
    G.hands.right = nineHand();
    check('空席は宣言できない', canKyuushu('right') === false);
  }

  console.log('\n── 流し満貫 ─────────────────────────');
  {
    const { isNagashiMangan } = g;
    const setup = (river, melds = { bottom: [], right: [], top: [], left: [] }) => {
      G.rivers = { bottom: [], right: [], top: [], left: [] };
      G.rivers.bottom = river;
      G.melds = melds;
    };
    // 幺九牌だけの河 = 成立
    setup([T(0,0), T(1,0), T(20,0), T(26,0), T(10,0)]);
    check('河が全て幺九牌なら成立', isNagashiMangan('bottom') === true);

    // 中張牌が1枚でも混じれば不成立
    setup([T(0,0), T(1,0), T(5,0), T(26,0)]);
    check('中張牌が混じると不成立', isNagashiMangan('bottom') === false);

    // 河が空 (一度も捨てていない) は不成立
    setup([]);
    check('河が空なら不成立', isNagashiMangan('bottom') === false);

    // 自分の捨て牌が鳴かれていたら不成立
    setup([T(0,0), T(1,0), T(20,0)], {
      bottom: [], right: [], left: [],
      top: [{ type: 'pon', id: 20, from: 'bottom', tiles: [T(20,0), T(20,1), T(20,2)] }],
    });
    check('自分の捨て牌が鳴かれたら不成立', isNagashiMangan('bottom') === false);

    // 他人どうしの鳴きは影響しない
    setup([T(0,0), T(1,0), T(20,0)], {
      bottom: [], right: [], left: [],
      top: [{ type: 'pon', id: 21, from: 'left', tiles: [T(21,0), T(21,1), T(21,2)] }],
    });
    check('他人どうしの鳴きは影響しない', isNagashiMangan('bottom') === true);

    // 満貫の点数が引ける (支払い計算に使う行)
    const row = g.SCORE_TABLE.find(r => /満貫/.test(r.label) && !/跳|倍/.test(r.label));
    check('満貫の行を正しく引ける', !!row && row.koTsumoKo === 2000 && row.oyaTsumo === 4000,
      row ? row.label : '(見つからず)');
  }

  const ok = summary('v0.9.8 ルール精度 (三槓子 / 九種九牌 / 流し満貫)');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

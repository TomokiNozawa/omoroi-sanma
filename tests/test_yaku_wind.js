// 風牌の役牌判定 — ピンフの雀頭 と 刻子の役牌 で基準が揃っているか
//
// 役牌 = 三元牌 + 場風牌 + 自風牌。 このアプリは 東3局 + 南3局 なので 場風は東と南、
// 自風は 東 / 南 / 西 の3種 (三麻は席が3つ)。
// 雀頭側の判定 (isYakuhaiPairId) が自風を見落としていると、
// 自風が南/西の子が その風牌を雀頭にした時に ピンフが誤って成立する。
// 実行: node tests/test_yaku_wind.js
'use strict';

const { makeGame, check, summary, T, Tn, Tseq } = require('./harness');

const g = makeGame();
const { calcYaku } = g;

const ctx = (o = {}) => Object.assign({
  isTsumo: false, isRiichi: false, isOya: false, seatWind: '南', round: '東1',
  kitas: 0, doraIndicator: null, kanDora: [], extraTiles: [], openMeldIds: [],
}, o);
const names = (r) => r.yakuList.map(y => y.name);
const hasPinfu = (r) => names(r).includes('ピンフ');

// 全順子 + 指定の雀頭 + 両面待ち (2p3p4p / 5p6p7p / 2s3s4s / 5s6s7s + 雀頭)。
// あがり牌は 2p (234p の両面部分) にして ピンフの条件を満たす形にする
const pinfuHand = (pairId) => [...Tseq(3), ...Tseq(6), ...Tseq(12), ...Tseq(15), ...Tn(pairId, 2)];
const pinfuCtx = (o) => ctx(Object.assign({ winTile: T(3) }, o));

// 風牌の刻子 + 順子3つ + 数牌雀頭 (刻子側の役牌判定を見る)
const koutsuHand = (windId) => [...Tn(windId, 3), ...Tseq(3), ...Tseq(12), ...Tseq(15), ...Tn(9, 2)];
const koutsuCtx = (o) => ctx(Object.assign({ winTile: T(3) }, o));

(async () => {
  console.log('\n── 雀頭が自風牌ならピンフは付かない ──────────────');
  {
    // 修正前はここが誤っていた: 自風 南/西 を見ておらず ピンフが成立していた
    const r1 = calcYaku(pinfuHand(21), pinfuCtx({ seatWind: '南', round: '東1' }));
    check('東場・自風南の子が 南を雀頭 → ピンフなし (自風は役牌)', !hasPinfu(r1), names(r1).join('/'));

    const r2 = calcYaku(pinfuHand(22), pinfuCtx({ seatWind: '西', round: '東1' }));
    check('東場・自風西の子が 西を雀頭 → ピンフなし (自風は役牌)', !hasPinfu(r2), names(r2).join('/'));

    const r3 = calcYaku(pinfuHand(20), pinfuCtx({ seatWind: '東', round: '東1', isOya: true }));
    check('東場・親が 東を雀頭 → ピンフなし (場風かつ自風)', !hasPinfu(r3), names(r3).join('/'));
  }

  console.log('\n── 場風でも自風でもない風牌は雀頭にできる ─────────');
  {
    const r1 = calcYaku(pinfuHand(22), pinfuCtx({ seatWind: '南', round: '東1' }));
    check('東場・自風南の子が 西を雀頭 → ピンフ成立', hasPinfu(r1), names(r1).join('/'));

    // 修正前はここも誤っていた: 東を無条件に役牌としていたため 南場でもピンフが消えていた
    const r2 = calcYaku(pinfuHand(20), pinfuCtx({ seatWind: '西', round: '南1' }));
    check('南場・自風西の子が 東を雀頭 → ピンフ成立 (東は場風でも自風でもない)',
      hasPinfu(r2), names(r2).join('/'));

    const r3 = calcYaku(pinfuHand(23), pinfuCtx({ seatWind: '南', round: '東1' }));
    check('北を雀頭 → ピンフ成立 (三麻の北は自風にならない)', hasPinfu(r3), names(r3).join('/'));

    const r4 = calcYaku(pinfuHand(9), pinfuCtx({ seatWind: '南', round: '東1' }));
    check('数牌を雀頭 → ピンフ成立', hasPinfu(r4), names(r4).join('/'));
  }

  console.log('\n── 三元牌と場風は 従来どおり ──────────────────');
  {
    for (const [id, nm] of [[24, '白'], [25, '發'], [26, '中']]) {
      const r = calcYaku(pinfuHand(id), pinfuCtx({ seatWind: '南', round: '東1' }));
      check(`${nm}を雀頭 → ピンフなし`, !hasPinfu(r), names(r).join('/'));
    }
    const r1 = calcYaku(pinfuHand(20), pinfuCtx({ seatWind: '南', round: '東1' }));
    check('東場・自風南の子が 東を雀頭 → ピンフなし (東は場風)', !hasPinfu(r1), names(r1).join('/'));

    const r2 = calcYaku(pinfuHand(21), pinfuCtx({ seatWind: '西', round: '南1' }));
    check('南場・自風西の子が 南を雀頭 → ピンフなし (南は場風)', !hasPinfu(r2), names(r2).join('/'));
  }

  console.log('\n── 雀頭の判定と 刻子の役牌判定が揃っている ───────────');
  {
    // 同じ「役牌か」を 雀頭側 (isYakuhaiPairId) と 刻子側 (countYakuhai) が別基準で見ていると、
    // 「刻子なら役が付くのに 雀頭ではピンフが消えない」ような矛盾が起きる
    const cases = [
      { wind: '南', round: '東1', id: 21, yakuhai: true, label: '東場・自風南 の 南' },
      { wind: '西', round: '東1', id: 22, yakuhai: true, label: '東場・自風西 の 西' },
      { wind: '南', round: '東1', id: 20, yakuhai: true, label: '東場・自風南 の 東 (場風)' },
      { wind: '西', round: '南1', id: 21, yakuhai: true, label: '南場・自風西 の 南 (場風)' },
      { wind: '南', round: '東1', id: 22, yakuhai: false, label: '東場・自風南 の 西' },
      { wind: '西', round: '南1', id: 20, yakuhai: false, label: '南場・自風西 の 東' },
    ];
    let bad = 0, detail = [];
    for (const c of cases) {
      // 刻子側: 役牌なら 役名が1つ付く
      const rk = calcYaku(koutsuHand(c.id), koutsuCtx({ seatWind: c.wind, round: c.round }));
      const koutsuIsYakuhai = names(rk).some(n => /^(場風|自風|白|發|中)/.test(n));
      // 雀頭側: 役牌なら ピンフが消える
      const rp = calcYaku(pinfuHand(c.id), pinfuCtx({ seatWind: c.wind, round: c.round }));
      const pairIsYakuhai = !hasPinfu(rp);
      if (koutsuIsYakuhai !== c.yakuhai || pairIsYakuhai !== c.yakuhai) {
        bad++;
        detail.push(`${c.label}: 期待${c.yakuhai} / 刻子${koutsuIsYakuhai} / 雀頭${pairIsYakuhai}`);
      }
    }
    check('刻子の役牌判定と 雀頭の役牌判定が全ケースで一致', bad === 0,
      bad ? detail.join(' | ') : `${cases.length}ケース 一致`);
  }

  summary('風牌の役牌判定 (ピンフの雀頭 / 刻子)');
})();

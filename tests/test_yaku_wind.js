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

  console.log('\n── 四麻の北家 (ドリル用。三麻に北家は無い) ──────────');
  {
    // 北が自風なら 北の刻子は役牌1翻 / 北の雀頭ならピンフ不成立
    const koutsu = calcYaku(koutsuHand(23), koutsuCtx({ seatWind: '北', round: '東1' }));
    check('自風北の 北刻子 → 自風 北 が付く', names(koutsu).includes('自風 北'), names(koutsu).join('/'));

    const pair = calcYaku(pinfuHand(23), pinfuCtx({ seatWind: '北', round: '東1' }));
    check('自風北が 北を雀頭 → ピンフなし', !hasPinfu(pair), names(pair).join('/'));

    // 三麻 (自風は東/南/西) では北は役牌にならない
    const sanma = calcYaku(koutsuHand(23), koutsuCtx({ seatWind: '西', round: '東1' }));
    check('自風西のとき 北刻子は役牌にならない',
      !names(sanma).some(n => n.startsWith('自風') || n.startsWith('場風')), names(sanma).join('/'));
  }

  console.log('\n── ダブル役満 (十三面 / 純正九蓮) ────────────────');
  {
    // 国士十三面: 13種すべて1枚ずつ + あがり牌。 あがり牌を抜くと13種1枚ずつになる
    const kokushi13 = [0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26].map(id => T(id));
    const r13 = calcYaku([...kokushi13, T(26, 1)], ctx({ winTile: T(26, 1), isTsumo: true }));
    check('国士十三面待ち → ダブル役満 (26翻)', names(r13).includes('国士無双十三面'),
      names(r13).join('/') + ' / ' + r13.han + '翻');
    check('国士十三面は 26翻', r13.han === 26, `${r13.han}翻`);

    // 13面でない国士: 白を2枚持って 中の1種だけを待っていた形。
    // あがり牌 (中) を抜くと 白が2枚残る = 13種1枚ずつ にならない
    const waitChun = [0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25].map(id => T(id));
    const rk = calcYaku([...waitChun, T(24, 1), T(26)], ctx({ winTile: T(26), isTsumo: true }));
    check('単騎待ちの国士は 13翻のまま', names(rk).includes('国士無双') && rk.han === 13,
      names(rk).join('/') + ' / ' + rk.han + '翻');

    // 純正九蓮 (筒子 1112345678999 + 任意の1枚)。 5p を足すと九面待ちの形
    const chuuren = [...Tn(2, 3), T(3), T(4), T(5), T(6), T(7), T(8), T(9), ...Tn(10, 3)];
    const rj = calcYaku([...chuuren, T(6, 1)], ctx({ winTile: T(6, 1), isTsumo: true }));
    check('純正九蓮宝燈 → ダブル役満 (26翻)', names(rj).includes('純正九蓮宝燈'),
      names(rj).join('/') + ' / ' + rj.han + '翻');
    check('純正九蓮は 26翻', rj.han === 26, `${rj.han}翻`);

    // 非純正の九蓮 (1112245678999 の形で 3p 待ち → あがると 111234567 8999)
    const notJunsei = [...Tn(2, 3), T(3), T(3), T(5), T(6), T(7), T(8), T(9), ...Tn(10, 3)];
    const rn = calcYaku([...notJunsei, T(4)], ctx({ winTile: T(4), isTsumo: true }));
    check('純正でない九蓮は 13翻のまま',
      names(rn).includes('九蓮宝燈') && rn.han === 13, names(rn).join('/') + ' / ' + rn.han + '翻');
  }

  console.log('\n── 場風・自風の判定が1箇所に集約されている ──────────');
  {
    // 同じ判断が複数箇所に散ると必ずズレる (雀頭側だけ自風を見落としていた実例あり)。
    // 場風/自風の判定は roundWindId / seatWindIdOf を通すこと。
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    // ヘルパー自身の定義以外に、風牌 id を直書きしたテーブルが残っていないか
    // (風の種類が増減しても効くよう '東': 20 の出現回数で見る)
    const hits = (src.match(/'東':\s*20/g) || []).length;
    check('自風の id テーブルは seatWindIdOf の中だけ', hits === 1,
      `${hits}箇所 (1箇所=ヘルパー定義のみ)`);

    // 「東を場風と決め打つ」書き方が残っていないか
    const eastHardcode = /startsWith\('東'\)/g;
    check('場風を東と決め打つ判定が残っていない', (src.match(eastHardcode) || []).length === 0,
      `${(src.match(eastHardcode) || []).length}箇所`);

    const roundHits = (src.match(/startsWith\('南'\)/g) || []).length;
    check('場風の判定は roundWindId の中だけ', roundHits === 1, `${roundHits}箇所`);

    check('ヘルパーが両方定義されている',
      /function roundWindId/.test(src) && /function seatWindIdOf/.test(src));
  }

  summary('風牌の役牌判定 (ピンフの雀頭 / 刻子)');
})();

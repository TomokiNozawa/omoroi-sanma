// 符計算 / 点数計算エンジンの検証
// 期待値は麻雀の公知の点数表そのもの。エンジンが表を再現できるかで正しさを見る。
// 実行: node tests/test_score.js
'use strict';

const { check, summary } = require('./harness');
const SC = require('../score.js');

// 面子の組み立てヘルパー
const shuntsu = (id) => ({ type: 'shuntsu', id });
const koutsu = (id, open = false) => ({ type: 'koutsu', id, open });
const kantsu = (id, open = false) => ({ type: 'kantsu', id, open });
const base = (o = {}) => Object.assign({
  melds: [shuntsu(2), shuntsu(5), shuntsu(11), shuntsu(14)],
  pair: 3, wait: 'ryanmen', isTsumo: false, isMenzen: true,
  seatWind: '南', roundWind: '東', isChiitoi: false, isPinfu: false,
}, o);

(async () => {
  console.log('\n── 符の計算 ─────────────────────────');
  {
    // 全部順子 + 数牌雀頭 + 両面 + 門前ロン = 20 + 10 = 30符 (ピンフのロン)
    check('ピンフ 門前ロン = 30符', SC.calcFu(base({ isPinfu: true })).fu === 30,
      `${SC.calcFu(base({ isPinfu: true })).fu}符`);

    // ピンフツモは 20符固定 (ツモの +2符を付けない)
    check('ピンフ ツモ = 20符固定',
      SC.calcFu(base({ isPinfu: true, isTsumo: true })).fu === 20);

    // 七対子は 25符固定
    check('七対子 = 25符固定', SC.calcFu(base({ isChiitoi: true })).fu === 25);

    // 中張の暗刻1つ + 門前ロン: 20 + 4 + 10 = 34 → 40符
    const anko = base({ melds: [koutsu(5), shuntsu(2), shuntsu(11), shuntsu(14)] });
    check('中張の暗刻 + 門前ロン = 40符 (34の切り上げ)', SC.calcFu(anko).fu === 40,
      `${SC.calcFu(anko).fu}符`);

    // 幺九の暗刻 + ツモ: 20 + 8 + 2 = 30符
    const yaoAnko = base({ melds: [koutsu(20), shuntsu(2), shuntsu(11), shuntsu(14)], isTsumo: true });
    check('字牌の暗刻 + ツモ = 30符', SC.calcFu(yaoAnko).fu === 30, `${SC.calcFu(yaoAnko).fu}符`);

    // 幺九の明刻 + 門前ロン: 20 + 4 + 10 = 34 → 40符
    const yaoMinko = base({ melds: [koutsu(20, true), shuntsu(2), shuntsu(11), shuntsu(14)] });
    check('字牌の明刻 + 門前ロン = 40符', SC.calcFu(yaoMinko).fu === 40);

    // 中張の暗槓 + 門前ロン: 20 + 16 + 10 = 46 → 50符
    const ankan = base({ melds: [kantsu(5), shuntsu(2), shuntsu(11), shuntsu(14)] });
    check('中張の暗槓 + 門前ロン = 50符', SC.calcFu(ankan).fu === 50, `${SC.calcFu(ankan).fu}符`);

    // 字牌の暗槓 + ツモ: 20 + 32 + 2 = 54 → 60符
    const yaoAnkan = base({ melds: [kantsu(24), shuntsu(2), shuntsu(11), shuntsu(14)], isTsumo: true });
    check('字牌の暗槓 + ツモ = 60符', SC.calcFu(yaoAnkan).fu === 60, `${SC.calcFu(yaoAnkan).fu}符`);

    // 待ちの符: 嵌張 + 門前ロン = 20 + 2 + 10 = 32 → 40符
    check('嵌張待ち + 門前ロン = 40符', SC.calcFu(base({ wait: 'kanchan' })).fu === 40);
    check('辺張待ちも 2符', SC.calcFu(base({ wait: 'penchan' })).fu === 40);
    check('単騎待ちも 2符', SC.calcFu(base({ wait: 'tanki' })).fu === 40);
    check('シャンポン待ちは 0符 (30符のまま)', SC.calcFu(base({ wait: 'shanpon' })).fu === 30);

    // 雀頭の符
    check('三元牌の雀頭 = 2符 (32 → 40符)', SC.calcFu(base({ pair: 24 })).fu === 40);
    check('自風の雀頭 = 2符', SC.calcFu(base({ pair: 21, seatWind: '南' })).fu === 40);
    check('場風の雀頭 = 2符', SC.calcFu(base({ pair: 20, roundWind: '東', seatWind: '南' })).fu === 40);
    // 早見表は「雀頭が役牌なら +2符」だけ。連風牌を 4符とする流派は採らない
    check('連風牌の雀頭も 2符 (早見表準拠)',
      SC.calcFu(base({ pair: 20, roundWind: '東', seatWind: '東' })).breakdown
        .some(b => b.label.includes('連風牌') && b.fu === 2));
    check('役牌でない雀頭は 0符', SC.calcFu(base({ pair: 22, seatWind: '南', roundWind: '東' })).fu === 30);

    // 喰いピンフ形 (副露で符が付かない) は 30符
    const kuipin = base({ isMenzen: false, melds: [shuntsu(2), shuntsu(5), shuntsu(11), shuntsu(14)] });
    check('喰いピンフ形 = 30符', SC.calcFu(kuipin).fu === 30, `${SC.calcFu(kuipin).fu}符`);

    // 内訳が解説用に出ている
    const bdd = SC.calcFu(anko).breakdown;
    check('符の内訳が返る (解説表示用)', bdd.length >= 3 && bdd[0].label.includes('副底'),
      bdd.map(b => `${b.label}${b.fu}`).join(' + '));
  }

  console.log('\n── ロンで完成した刻子は明刻 (シャンポン待ち) ────────');
  {
    // 実ルール: ロンあがりの牌で完成した刻子は明刻として数える。
    // 門前・中張の暗刻3つ + 両面ロン = 20 + 4*3 + 10 = 42 → 50符
    const three = [koutsu(5), koutsu(8), koutsu(13), shuntsu(2)];
    const tsumo = SC.calcFu(base({ melds: three, wait: 'shanpon', isTsumo: true }));
    check('シャンポン ツモ は3つとも暗刻 (20+4*3+2=34 → 40符)', tsumo.fu === 40, `${tsumo.fu}符`);

    const ronPlain = SC.calcFu(base({ melds: three, wait: 'shanpon', isTsumo: false }));
    check('ロンでも ronMeldIdx 未指定なら従来どおり (20+4*3+10=42 → 50符)',
      ronPlain.fu === 50, `${ronPlain.fu}符`);

    // ronMeldIdx=0 の刻子が明刻(2符)になる → 20 + 2 + 4 + 4 + 10 = 40符
    const ron = SC.calcFu(base({ melds: three, wait: 'shanpon', isTsumo: false, ronMeldIdx: 0 }));
    check('ロンで完成した刻子は明刻になり 40符に下がる', ron.fu === 40, `${ron.fu}符`);
    check('内訳に「ロンで完成」が出る',
      ron.breakdown.some(b => b.label.includes('ロンで完成')),
      ron.breakdown.map(b => b.label).join(' / '));

    // 幺九の刻子なら 8符 → 4符
    const yao = [koutsu(20), koutsu(8), shuntsu(2), shuntsu(11)];
    const yaoTsumo = SC.calcFu(base({ melds: yao, wait: 'shanpon', isTsumo: true }));
    const yaoRon = SC.calcFu(base({ melds: yao, wait: 'shanpon', isTsumo: false, ronMeldIdx: 0 }));
    check('字牌の刻子もロンで完成なら 8符→4符',
      yaoTsumo.fu === 40 && yaoRon.fu === 40, `ツモ${yaoTsumo.fu}符 / ロン${yaoRon.fu}符`);

    // ツモなら ronMeldIdx があっても無視される
    const ignored = SC.calcFu(base({ melds: three, wait: 'shanpon', isTsumo: true, ronMeldIdx: 0 }));
    check('ツモなら ronMeldIdx は無視される', ignored.fu === 40, `${ignored.fu}符`);

    // 槓子はロンで完成しない (カンは自分の手番のみ)
    const kan = SC.calcFu(base({ melds: [kantsu(5), shuntsu(2), shuntsu(11), shuntsu(14)],
      wait: 'shanpon', isTsumo: false, ronMeldIdx: 0 }));
    check('槓子は ronMeldIdx の影響を受けない (暗槓16符のまま)', kan.fu === 50, `${kan.fu}符`);
  }

  console.log('\n── 点数: 子 (公知の点数表と照合) ──────────');
  {
    const ko = (fu, han, isTsumo = false, players = 4) =>
      SC.calcScore({ fu, han, isOya: false, isTsumo, players });
    check('子 30符1翻 ロン = 1000', ko(30, 1).total === 1000, `${ko(30,1).total}`);
    check('子 30符2翻 ロン = 2000', ko(30, 2).total === 2000, `${ko(30,2).total}`);
    check('子 30符3翻 ロン = 3900', ko(30, 3).total === 3900, `${ko(30,3).total}`);
    check('子 30符4翻 ロン = 7700', ko(30, 4).total === 7700, `${ko(30,4).total}`);
    check('子 40符3翻 ロン = 5200', ko(40, 3).total === 5200, `${ko(40,3).total}`);
    check('子 40符4翻 ロン = 満貫 8000', ko(40, 4).total === 8000, `${ko(40,4).total}`);
    check('子 20符2翻 ロン = 1300', ko(20, 2).total === 1300, `${ko(20,2).total}`);
    check('子 25符2翻 ロン = 1600 (七対子)', ko(25, 2).total === 1600, `${ko(25,2).total}`);
    check('子 25符3翻 ロン = 3200 (七対子)', ko(25, 3).total === 3200, `${ko(25,3).total}`);
    check('子 満貫 ロン = 8000', ko(30, 5).total === 8000);
    check('子 跳満 ロン = 12000', ko(30, 6).total === 12000);
    check('子 倍満 ロン = 16000', ko(30, 8).total === 16000);
    check('子 三倍満 ロン = 24000', ko(30, 11).total === 24000);
    check('子 役満 ロン = 32000', ko(30, 13).total === 32000);
  }

  console.log('\n── 点数: 親 ────────────────────────');
  {
    const oya = (fu, han, isTsumo = false, players = 4) =>
      SC.calcScore({ fu, han, isOya: true, isTsumo, players });
    check('親 30符1翻 ロン = 1500', oya(30, 1).total === 1500, `${oya(30,1).total}`);
    check('親 30符3翻 ロン = 5800', oya(30, 3).total === 5800, `${oya(30,3).total}`);
    check('親 30符4翻 ロン = 11600', oya(30, 4).total === 11600, `${oya(30,4).total}`);
    check('親 40符3翻 ロン = 7700', oya(40, 3).total === 7700, `${oya(40,3).total}`);
    check('親 満貫 ロン = 12000', oya(30, 5).total === 12000);
    check('親 跳満 ロン = 18000', oya(30, 6).total === 18000);
    check('親 役満 ロン = 48000', oya(30, 13).total === 48000);
  }

  console.log('\n── ツモの分配: 四麻 ────────────────────');
  {
    const t = (fu, han, isOya) => SC.calcScore({ fu, han, isOya, isTsumo: true, players: 4 });
    const a = t(30, 3, false);
    check('子 30符3翻 ツモ = 親2000 / 子1000',
      a.detail.fromOya === 2000 && a.detail.fromKo === 1000, a.text);
    check('子 30符3翻 ツモ の合計 = 4000 (四麻)', a.total === 4000, `${a.total}`);
    const b = t(20, 2, false);
    check('子 20符2翻 ツモ (ピンフツモ) = 親700 / 子400',
      b.detail.fromOya === 700 && b.detail.fromKo === 400, b.text);
    const c = t(30, 3, true);
    check('親 30符3翻 ツモ = 2000オール', c.detail.fromKo === 2000, c.text);
    check('親 30符3翻 ツモ の合計 = 6000 (四麻)', c.total === 6000, `${c.total}`);
    const d = t(30, 5, false);
    check('子 満貫ツモ = 親4000 / 子2000 (計8000)',
      d.detail.fromOya === 4000 && d.detail.fromKo === 2000 && d.total === 8000, d.text);
  }

  console.log('\n── ツモの分配: 三麻 (子が2人) ──────────────');
  {
    const t3 = (fu, han, isOya) => SC.calcScore({ fu, han, isOya, isTsumo: true, players: 3 });
    const a = t3(30, 3, false);
    check('子 30符3翻 ツモ の1人あたりは四麻と同じ',
      a.detail.fromOya === 2000 && a.detail.fromKo === 1000, a.text);
    check('子 30符3翻 ツモ の合計 = 3000 (三麻は子が1人少ない)', a.total === 3000, `${a.total}`);
    check('子ツモで払う子の人数は 1人', a.detail.koCount === 1, `${a.detail.koCount}人`);
    const c = t3(30, 3, true);
    check('親 30符3翻 ツモ = 2000オール (合計4000)',
      c.detail.fromKo === 2000 && c.total === 4000, c.text);
    check('親ツモで払う子の人数は 2人', c.detail.koCount === 2, `${c.detail.koCount}人`);
    const m = t3(30, 5, false);
    check('子 満貫ツモ 三麻 = 計6000 (四麻は8000)', m.total === 6000, m.text);
    // ロンは人数に関係なく同じ
    check('ロンは三麻でも四麻と同額',
      SC.calcScore({ fu: 30, han: 3, isOya: false, isTsumo: false, players: 3 }).total === 3900);
  }

  console.log('\n── 満貫の境目 ───────────────────────');
  {
    // 4翻30符 は 7700 (満貫ではない)。 4翻40符 は 8000 (切り上げ満貫ではなく計算上そうなる)
    check('子 30符4翻 は満貫ではない (7700)',
      SC.calcScore({ fu: 30, han: 4, isOya: false, isTsumo: false, players: 4 }).limit === null);
    check('子 40符4翻 は満貫 (8000)',
      SC.calcScore({ fu: 40, han: 4, isOya: false, isTsumo: false, players: 4 }).limit === '満貫');
    check('5翻は符に関係なく満貫',
      SC.calcScore({ fu: 20, han: 5, isOya: false, isTsumo: true, players: 4 }).limit === '満貫');
    check('6翻は跳満', SC.basePoints(30, 6).limit === '跳満');
    check('8翻は倍満', SC.basePoints(30, 8).limit === '倍満');
    check('11翻は三倍満', SC.basePoints(30, 11).limit === '三倍満');
    check('13翻は役満', SC.basePoints(30, 13).limit === '役満');
  }

  console.log('\n── 早見表との全セル照合 (野沢さん提供の表) ────────');
  {
    // 表の値をそのまま書き写して 1セルずつ突き合わせる。
    // ※ 子60符3翻 だけは 野沢さん指示で満貫扱い (表の 7,700 ではなく 8,000)
    const oyaRon = {
      20: { 2: 2000, 3: 3900, 4: 7700 },
      25: { 2: 2400, 3: 4800, 4: 9600 },
      30: { 1: 1500, 2: 2900, 3: 5800, 4: 11600 },
      40: { 1: 2000, 2: 3900, 3: 7700, 4: 12000 },
      50: { 1: 2400, 2: 4800, 3: 9600, 4: 12000 },
      60: { 1: 2900, 2: 5800, 3: 11600, 4: 12000 },
      70: { 1: 3400, 2: 6800, 3: 12000, 4: 12000 },
    };
    const oyaTsumoAll = {   // 親のツモは「◯◯点オール」= 子1人あたりの額
      20: { 2: 700, 3: 1300, 4: 2600 },
      25: { 2: 800, 3: 1600, 4: 3200 },
      30: { 1: 500, 2: 1000, 3: 2000, 4: 3900 },
      40: { 1: 700, 2: 1300, 3: 2600, 4: 4000 },
      50: { 1: 800, 2: 1600, 3: 3200, 4: 4000 },
      60: { 1: 1000, 2: 2000, 3: 3900, 4: 4000 },
      70: { 1: 1200, 2: 2300, 3: 4000, 4: 4000 },
    };
    const koRon = {
      20: { 2: 1300, 3: 2600, 4: 5200 },
      25: { 2: 1600, 3: 3200, 4: 6400 },
      30: { 1: 1000, 2: 2000, 3: 3900, 4: 7700 },
      40: { 1: 1300, 2: 2600, 3: 5200, 4: 8000 },
      50: { 1: 1600, 2: 3200, 3: 6400, 4: 8000 },
      60: { 1: 2000, 2: 3900, 3: 8000 /* 指示で満貫 (表は7,700) */, 4: 8000 },
      70: { 1: 2300, 2: 4500, 3: 8000, 4: 8000 },
    };
    const koTsumo = {       // [子から, 親から]
      20: { 2: [400, 700], 3: [700, 1300], 4: [1300, 2600] },
      25: { 2: [400, 800], 3: [800, 1600], 4: [1600, 3200] },
      30: { 1: [300, 500], 2: [500, 1000], 3: [1000, 2000], 4: [2000, 3900] },
      40: { 1: [400, 700], 2: [700, 1300], 3: [1300, 2600], 4: [2000, 4000] },
      50: { 1: [400, 800], 2: [800, 1600], 3: [1600, 3200], 4: [2000, 4000] },
      60: { 1: [500, 1000], 2: [1000, 2000], 3: [2000, 4000] /* 指示で満貫 */, 4: [2000, 4000] },
      70: { 1: [600, 1200], 2: [1200, 2300], 3: [2000, 4000], 4: [2000, 4000] },
    };

    let ngOyaRon = [], ngOyaTsumo = [], ngKoRon = [], ngKoTsumo = [];
    for (const fu of Object.keys(oyaRon)) {
      for (const han of Object.keys(oyaRon[fu])) {
        const exp = oyaRon[fu][han];
        const got = SC.calcScore({ fu: +fu, han: +han, isOya: true, isTsumo: false, players: 4 }).total;
        if (got !== exp) ngOyaRon.push(`${fu}符${han}翻 期待${exp}≠${got}`);
      }
    }
    for (const fu of Object.keys(oyaTsumoAll)) {
      for (const han of Object.keys(oyaTsumoAll[fu])) {
        const exp = oyaTsumoAll[fu][han];
        const got = SC.calcScore({ fu: +fu, han: +han, isOya: true, isTsumo: true, players: 4 }).detail.fromKo;
        if (got !== exp) ngOyaTsumo.push(`${fu}符${han}翻 期待${exp}≠${got}`);
      }
    }
    for (const fu of Object.keys(koRon)) {
      for (const han of Object.keys(koRon[fu])) {
        const exp = koRon[fu][han];
        const got = SC.calcScore({ fu: +fu, han: +han, isOya: false, isTsumo: false, players: 4 }).total;
        if (got !== exp) ngKoRon.push(`${fu}符${han}翻 期待${exp}≠${got}`);
      }
    }
    for (const fu of Object.keys(koTsumo)) {
      for (const han of Object.keys(koTsumo[fu])) {
        const [eKo, eOya] = koTsumo[fu][han];
        const d = SC.calcScore({ fu: +fu, han: +han, isOya: false, isTsumo: true, players: 4 }).detail;
        if (d.fromKo !== eKo || d.fromOya !== eOya) {
          ngKoTsumo.push(`${fu}符${han}翻 期待${eKo}/${eOya}≠${d.fromKo}/${d.fromOya}`);
        }
      }
    }
    check('親のロン 全22セルが表と一致', ngOyaRon.length === 0, ngOyaRon.join(' , '));
    check('親のツモ 全22セルが表と一致', ngOyaTsumo.length === 0, ngOyaTsumo.join(' , '));
    check('子のロン 全22セルが表と一致', ngKoRon.length === 0, ngKoRon.join(' , '));
    check('子のツモ 全22セルが表と一致', ngKoTsumo.length === 0, ngKoTsumo.join(' , '));
  }

  console.log('\n── 子60符3翻の満貫扱い (野沢さん指示) ──────────');
  {
    const ko = SC.calcScore({ fu: 60, han: 3, isOya: false, isTsumo: false, players: 4 });
    check('子 60符3翻 ロン = 8000 (満貫)', ko.total === 8000 && ko.limit === '満貫', `${ko.total}/${ko.limit}`);
    const koT = SC.calcScore({ fu: 60, han: 3, isOya: false, isTsumo: true, players: 4 });
    check('子 60符3翻 ツモ = 2000/4000', koT.detail.fromKo === 2000 && koT.detail.fromOya === 4000, koT.text);
    const koT3 = SC.calcScore({ fu: 60, han: 3, isOya: false, isTsumo: true, players: 3 });
    check('三麻でも同じ扱い (合計6000)', koT3.total === 6000, koT3.text);
    // 親は表どおり据え置き
    const oya = SC.calcScore({ fu: 60, han: 3, isOya: true, isTsumo: false, players: 4 });
    check('親 60符3翻 は表どおり 11600 のまま', oya.total === 11600 && oya.limit === null, `${oya.total}`);
    // 他の符・翻に波及していない
    check('子 60符2翻 は 3900 のまま',
      SC.calcScore({ fu: 60, han: 2, isOya: false, isTsumo: false, players: 4 }).total === 3900);
    check('子 60符4翻 は満貫 8000 (元から)',
      SC.calcScore({ fu: 60, han: 4, isOya: false, isTsumo: false, players: 4 }).total === 8000);
    check('子 30符4翻 は 7700 のまま (切り上げ満貫にはしない)',
      SC.calcScore({ fu: 30, han: 4, isOya: false, isTsumo: false, players: 4 }).total === 7700);
  }

  const ok = summary('符計算 / 点数計算エンジン');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

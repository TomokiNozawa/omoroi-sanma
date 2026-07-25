// おもろい三麻 — 符計算 / 点数計算エンジン
//
// 本体ゲームは「翻数のみ (30符固定)」の簡易表を使うが、こちらは実ルールどおりに符を数える。
// 点数計算ドリル用に切り出した純粋関数群 (DOM にも G にも触らない = そのままテストできる)。
//
// 採用ルール (野沢さん提供の「点数計算早見表」に準拠):
//   - 雀頭は 役牌なら +2符 (連風牌も 2符。 4符とする流派もあるが 早見表は 2符)
//   - 七対子は 25符固定、 ピンフツモは 20符固定
//   - 喰いピンフ形 (副露で符が付かない形) は 30符
//   - 符は 10符単位に切り上げ (例: 42符 → 50符)
//   - 子の 60符3翻 は満貫扱い (野沢さん指示 2026-07-25。 素の計算では 7,700)
'use strict';

(function (root) {
  // ─── 牌 id の体系 (script.js と共通) ──────────
  //   0=1m 1=9m / 2..10=1p..9p / 11..19=1s..9s / 20=東 21=南 22=西 23=北 24=白 25=發 26=中
  const HONOR_MIN = 20;
  const YAOCHU = new Set([0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26]);
  const SANGEN = [24, 25, 26];
  const WINDS = { 東: 20, 南: 21, 西: 22, 北: 23 };

  const isHonor = (id) => id >= HONOR_MIN;
  const isYaochu = (id) => YAOCHU.has(id);

  // ─── 符の計算 ───────────────────────────
  // hand: {
  //   melds: [{type:'shuntsu'|'koutsu'|'kantsu', id, open:bool}]  ← 面子4つ (雀頭は別)
  //   pair: id,
  //   wait: 'ryanmen'|'shanpon'|'kanchan'|'penchan'|'tanki',
  //   isTsumo: bool, isMenzen: bool,
  //   seatWind: '東'|'南'|'西', roundWind: '東'|'南',
  //   isChiitoi: bool, isPinfu: bool,
  // }
  // 戻り: { fu, breakdown: [{label, fu}] }  ← breakdown は解説表示に使う
  function calcFu(hand) {
    const bd = [];
    if (hand.isChiitoi) {
      return { fu: 25, breakdown: [{ label: '七対子は 25符固定', fu: 25 }] };
    }
    // ピンフツモは 20符固定 (副底のみ。 ツモの+2符は付けない)
    if (hand.isPinfu && hand.isTsumo) {
      return { fu: 20, breakdown: [{ label: 'ピンフツモは 20符固定', fu: 20 }] };
    }
    let fu = 20;
    bd.push({ label: '副底 (基本符)', fu: 20 });

    // 面子
    for (const m of (hand.melds || [])) {
      if (m.type === 'shuntsu') continue;  // 順子は 0符
      const yao = isYaochu(m.id);
      let v = 0, name = '';
      if (m.type === 'koutsu') {
        v = m.open ? (yao ? 4 : 2) : (yao ? 8 : 4);
        name = `${m.open ? '明刻' : '暗刻'} (${yao ? '幺九牌' : '中張牌'})`;
      } else if (m.type === 'kantsu') {
        v = m.open ? (yao ? 16 : 8) : (yao ? 32 : 16);
        name = `${m.open ? '明槓' : '暗槓'} (${yao ? '幺九牌' : '中張牌'})`;
      }
      if (v) { fu += v; bd.push({ label: name, fu: v }); }
    }

    // 雀頭: 役牌なら +2符 (早見表準拠。 連風牌を 4符とする流派もあるがここでは 2符)
    const pair = hand.pair;
    if (pair != null) {
      const isSangen = SANGEN.includes(pair);
      const isSeat = WINDS[hand.seatWind] === pair;
      const isRound = WINDS[hand.roundWind] === pair;
      if (isSangen || isSeat || isRound) {
        const nm = (isSeat && isRound) ? '雀頭 (連風牌)' : '雀頭 (役牌)';
        fu += 2; bd.push({ label: nm, fu: 2 });
      }
    }

    // 待ちの形
    const waitFu = { kanchan: 2, penchan: 2, tanki: 2, ryanmen: 0, shanpon: 0 };
    const wf = waitFu[hand.wait] || 0;
    if (wf) {
      const wname = { kanchan: '嵌張待ち', penchan: '辺張待ち', tanki: '単騎待ち' }[hand.wait];
      fu += wf; bd.push({ label: wname, fu: wf });
    }

    // あがり方
    if (hand.isTsumo) { fu += 2; bd.push({ label: 'ツモ', fu: 2 }); }
    else if (hand.isMenzen) { fu += 10; bd.push({ label: '門前ロン', fu: 10 }); }

    // 喰いピンフ形 (副露していて 符が副底のみ) は 30符
    if (!hand.isMenzen && fu === 20) {
      return { fu: 30, breakdown: [{ label: '喰いピンフ形は 30符', fu: 30 }] };
    }
    const rounded = Math.ceil(fu / 10) * 10;
    if (rounded !== fu) bd.push({ label: `切り上げ (${fu}符 → ${rounded}符)`, fu: rounded - fu });
    return { fu: rounded, breakdown: bd };
  }

  // ─── 基本点 ────────────────────────────
  // 基本点 = 符 × 2^(2+翻)。 満貫以上は頭打ちの固定値。
  function basePoints(fu, han, isOya = false) {
    if (han >= 13) return { base: 8000, limit: '役満' };
    if (han >= 11) return { base: 6000, limit: '三倍満' };
    if (han >= 8) return { base: 4000, limit: '倍満' };
    if (han >= 6) return { base: 3000, limit: '跳満' };
    // 子の 60符3翻 は満貫扱い (野沢さん指示)。 素の計算では 1,920 → 子ロン 7,700
    if (!isOya && fu === 60 && han === 3) return { base: 2000, limit: '満貫' };
    const raw = fu * Math.pow(2, 2 + han);
    if (han === 5 || raw >= 2000) return { base: 2000, limit: '満貫' };
    return { base: raw, limit: null };
  }

  const ceil100 = (n) => Math.ceil(n / 100) * 100;

  // ─── 点数 (支払いの内訳つき) ──────────────────
  // opts: { fu, han, isOya, isTsumo, players: 3|4 }
  // 戻り: { total, limit, base, detail, text }
  //   detail = ロン: {fromLoser}
  //            ツモ: {fromOya, fromKo, koCount}  ※親のツモは fromKo のみ (子が全員同額)
  function calcScore({ fu, han, isOya, isTsumo, players = 4 }) {
    const { base, limit } = basePoints(fu, han, isOya);
    const koCount = (players === 3 ? 2 : 3) - (isOya ? 0 : 1);  // 自分以外の子の人数
    if (!isTsumo) {
      const total = ceil100(base * (isOya ? 6 : 4));
      return { total, limit, base, detail: { fromLoser: total },
        text: `${total.toLocaleString()}点` };
    }
    if (isOya) {
      const each = ceil100(base * 2);
      const total = each * (players === 3 ? 2 : 3);
      return { total, limit, base, detail: { fromKo: each, koCount: (players === 3 ? 2 : 3) },
        text: `${each.toLocaleString()}点オール (計 ${total.toLocaleString()}点)` };
    }
    const fromOya = ceil100(base * 2);
    const fromKo = ceil100(base);
    const total = fromOya + fromKo * koCount;
    return { total, limit, base, detail: { fromOya, fromKo, koCount },
      text: `親 ${fromOya.toLocaleString()} / 子 ${fromKo.toLocaleString()}${koCount > 1 ? ` ×${koCount}` : ''} (計 ${total.toLocaleString()}点)` };
  }

  // ─── 符 × 翻 の一覧 (ドリルの選択肢生成・答え合わせ用) ──
  const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  // その符・翻の組み合わせが実在しうるか (20符ロンや 25符以外の七対子などを弾く)
  function isRealisticCombo(fu, han, isTsumo, isMenzen) {
    if (fu === 20) return isTsumo;          // 20符 = ピンフツモのみ
    if (fu === 25) return true;             // 七対子 (ツモ/ロンどちらも)
    return true;
  }

  const api = { calcFu, calcScore, basePoints, FU_LIST, isRealisticCombo,
    isHonor, isYaochu, YAOCHU, SANGEN, WINDS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScoreCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

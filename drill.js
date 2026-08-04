// 点数計算ドリル
//
// 出題は3形式:
//   tehai … あがり手牌を見せて 符 → 点数 の2段階で答えさせる (実戦に一番近い)
//   table … 「30符3翻 子のロン」→ 点数 (点数表を反射で引く練習)
//   split … ツモの支払いを 親/子 に分ける (三麻と四麻の差が一番出る形式)
//
// 計算はすべて score.js (ScoreCalc) に委ねる。ここは出題と採点だけ。
'use strict';

/* global ScoreCalc */

// ─── 牌の定義 ───
//   0=1m 1=9m / 2..10=1p..9p / 11..19=1s..9s / 20=東 21=南 22=西 23=北 24=白 25=發 26=中
// 牌画像のマップ (TILE_IMG) は script.js のものをそのまま使う。
// ⚠️ ここで再定義すると同名 const の重複宣言で drill.js 全体が動かなくなる
//    (script.js と同じグローバルスコープで読まれるため)。
const TILE_NAME = {
  0: '一萬', 1: '九萬', 2: '一筒', 3: '二筒', 4: '三筒', 5: '四筒', 6: '五筒',
  7: '六筒', 8: '七筒', 9: '八筒', 10: '九筒', 11: '一索', 12: '二索', 13: '三索',
  14: '四索', 15: '五索', 16: '六索', 17: '七索', 18: '八索', 19: '九索',
  20: '東', 21: '南', 22: '西', 23: '北', 24: '白', 25: '發', 26: '中',
};
// 順子を作れる牌 (その id から id+2 まで同じ色が続くもの)。
// ※ このアプリの牌は三麻仕様で萬子が 1m/9m しかないため、順子は筒子・索子のみ
const SHUNTSU_STARTS = [2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17];
const ALL_TILE_IDS = Object.keys(TILE_IMG).map(Number);

const $ = (id) => document.getElementById(id);
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);

// ─── 状態 ─────────────────────────────
const S = {
  players: 3,
  mode: null,
  q: null,        // 現在の問題
  step: 'score',
  revealed: true, // 選択肢を出しているか (手牌形式は 自分のタイミングで開く)
  stats: null,
  lastKey: '',    // 直前の出題条件 (同じ問題の連続を避ける)
};

const STATS_KEY = 'omoroi-drill-v1';
const emptyStats = () => ({ total: 0, correct: 0, streak: 0, best: 0, byMode: {} });
function loadStats() {
  try { return Object.assign(emptyStats(), JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); }
  catch (e) { return emptyStats(); }
}
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(S.stats)); } catch (e) { /* 保存できなくても続行 */ }
}

// ─── 手牌の生成 ───────────────────────────
// 符が偏らないよう 刻子・槓子・待ちの形をばらけさせる。
function genTehaiRaw(players) {
  const isMenzen = Math.random() < 0.72;          // 門前を多めに (符の変化が出やすい)
  const isTsumo = Math.random() < 0.5;
  const isOya = Math.random() < 0.35;
  // 四麻は席が4つなので北家が出る (三麻は東/南/西のみ。 北は自風にならず北抜きで数える)
  const seatWind = isOya ? '東' : pick(players === 4 ? ['南', '西', '北'] : ['南', '西']);
  const roundWind = '東';

  // 面子4つ: 順子と刻子を混ぜる (全部順子だとピンフ形ばかりになる)
  const used = new Set();
  const melds = [];
  // 刻子+槓子は最大3つまで (4つ揃うと四暗刻/四槓子の形になり、符計算の練習にそぐわない)
  const kantsuCount = Math.random() < 0.18 ? 1 : 0;
  const koutsuCount = Math.min(pick([0, 1, 1, 2, 2, 3]), 3 - kantsuCount);
  for (let i = 0; i < 4; i++) {
    const wantKan = (i < kantsuCount);
    const wantKou = !wantKan && (i < kantsuCount + koutsuCount);
    if (wantKan || wantKou) {
      let id;
      do { id = pick(ALL_TILE_IDS); } while (used.has(id));
      used.add(id);
      // 副露していない手に明刻は出ない
      const open = !isMenzen && Math.random() < 0.6;
      melds.push({ type: wantKan ? 'kantsu' : 'koutsu', id, open });
    } else {
      let st;
      do { st = pick(SHUNTSU_STARTS); } while (used.has(st));
      used.add(st); used.add(st + 1); used.add(st + 2);
      // ⚠️ 三麻にチーは無いので 順子を鳴いた形にはしない (四麻のみ)
      const canChi = (players === 4);
      melds.push({ type: 'shuntsu', id: st, open: canChi && !isMenzen && Math.random() < 0.5 });
    }
  }
  // 門前なら全ての面子は暗 (暗槓は門前を崩さない)
  if (isMenzen) melds.forEach(m => { m.open = false; });

  let pairId;
  do { pairId = pick(ALL_TILE_IDS); } while (used.has(pairId));

  // 待ちの形。 順子が無ければ両面/嵌張/辺張は作れないのでシャンポンか単騎にする
  const hasShuntsu = melds.some(m => m.type === 'shuntsu');
  const hasKoutsu = melds.some(m => m.type === 'koutsu');
  const waitPool = [];
  if (hasShuntsu) waitPool.push('ryanmen', 'kanchan', 'penchan');
  if (hasKoutsu) waitPool.push('shanpon');
  waitPool.push('tanki');
  const wait = pick(waitPool);

  // シャンポン待ちのロンは「あがり牌で完成した刻子」が明刻になるので、どの刻子かを決めておく。
  // 単騎(雀頭)・両面/嵌張/辺張(順子)は符に影響しないので指定しない
  let ronMeldIdx = -1;
  if (wait === 'shanpon' && !isTsumo) {
    const cand = melds.map((m, i) => (m.type === 'koutsu' && !m.open) ? i : -1).filter(i => i >= 0);
    if (cand.length) ronMeldIdx = pick(cand);
  }
  const hand = { melds, pair: pairId, wait, isTsumo, isMenzen, seatWind, roundWind,
    isChiitoi: false, isPinfu: false, ronMeldIdx };
  // ピンフ判定 (全部順子 + 両面 + 役牌でない雀頭 + 門前)
  const pairIsYakuhai = ScoreCalc.SANGEN.includes(pairId)
    || ScoreCalc.WINDS[seatWind] === pairId || ScoreCalc.WINDS[roundWind] === pairId;
  hand.isPinfu = isMenzen && melds.every(m => m.type === 'shuntsu') && wait === 'ryanmen' && !pairIsYakuhai;

  return { hand, isOya, players };
}

// 出題用の手牌。 翻数は手の中身から判定するので、出題に使えない手は引き直す。
//   ・役なし     … あがれない手なので問題にならない
//   ・役満       … 符も翻も関係なく固定点なので 点数計算の練習にならない
//   ・5翻以上    … 満貫で頭打ちになり符が効かない (符を数える意味が無くなる)
//   ・ピンフ判定の食い違い … 符計算(score.js)と役判定(calcYaku)で解釈が割れる手は
//                            符と翻が矛盾するので出さない
function genTehai(players) {
  let fallback = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const t = genTehaiRaw(players);
    const base = judgeHand(t.hand);
    if (!base) continue;
    if (base.isYakuman) continue;
    if (base.isPinfu !== t.hand.isPinfu) continue;
    if (base.han < 1 || base.han > 4) continue;

    // リーチ (門前のみ) と ドラ を 合計5翻以内で足す。
    // 状況文に「リーチ / ドラN」を出すので、手役と合わせて翻数が確定する
    let han = base.han;
    const yakuList = base.yakuList.slice();
    let isRiichi = false;
    if (t.hand.isMenzen && han < 4 && Math.random() < 0.45) {
      isRiichi = true;
      han += 1;
      yakuList.push({ name: 'リーチ', han: 1 });
    }
    const doraRoom = Math.max(0, 5 - han);
    const doraCand = [0, 0, 1, 1, 2].filter(v => v <= doraRoom);
    const doraCount = doraCand.length ? pick(doraCand) : 0;
    if (doraCount > 0) {
      han += doraCount;
      yakuList.push({ name: `ドラ${doraCount}`, han: doraCount });
    }
    t.hand.isRiichi = isRiichi;
    const out = { hand: t.hand, han, yakuList, isOya: t.isOya, players, isRiichi, doraCount };
    if (!fallback) fallback = out;
    return out;
  }
  // 引き直しが尽きた場合の保険 (必ず役が付く形: 全順子+数牌雀頭+両面 = ピンフ)
  return fallback || {
    hand: {
      melds: [{ type: 'shuntsu', id: 2 }, { type: 'shuntsu', id: 5 },
        { type: 'shuntsu', id: 11 }, { type: 'shuntsu', id: 14 }],
      pair: 8, wait: 'ryanmen', isTsumo: false, isMenzen: true,
      seatWind: '南', roundWind: '東', isChiitoi: false, isPinfu: true,
      ronMeldIdx: -1, isRiichi: false,
    },
    han: 1, yakuList: [{ name: 'ピンフ', han: 1 }],
    isOya: false, players, isRiichi: false, doraCount: 0,
  };
}

// ─── 役の判定 (対局と同じ calcYaku を使う) ──────────────
// 翻数を画面に出さず「状況と手牌だけ見て点数を出す」形式にするには、
// 手の中身から翻数が一意に決まらないといけない。
// 役判定は対局側 (script.js) の calcYaku に委ねる — 面子分解を全列挙して
// 高点法で最も高い解釈を選ぶので、牌姿から人が読み取れる翻数と一致する。
// ⚠️ ここで自前実装すると対局と二重管理になり、翻数がズレる (= 教材として害)。

// 面子構造 → calcYaku の入力 { tiles(14枚), context }
// 槓は 3枚等価 + 4枚目を extraTiles に入れる (calcYaku がその枚数でカン数を数える)
function toYakuInput(hand) {
  const tiles = [];
  const extraTiles = [];
  const openMeldIds = [];
  for (const m of hand.melds) {
    if (m.type === 'shuntsu') {
      tiles.push({ id: m.id }, { id: m.id + 1 }, { id: m.id + 2 });
      // ⚠️ openMeldIds は「1面子 = 1 id」。対局側の openMeldIds() が
      //    ポン/明槓/加槓を .map(m => m.id) で返す形に合わせる。
      //    3枚分入れると calcYaku の三暗刻 (暗刻数 - openMeldIds.length) が
      //    余計に引かれて 三暗刻が消える
      if (m.open) openMeldIds.push(m.id);
    } else {
      tiles.push({ id: m.id }, { id: m.id }, { id: m.id });
      if (m.type === 'kantsu') extraTiles.push({ id: m.id });
      if (m.open) openMeldIds.push(m.id);
    }
  }
  tiles.push({ id: hand.pair }, { id: hand.pair });
  // あがり牌 (シャンポンの明刻化・ピンフの両面判定に使う)
  const wp = winTilePos(hand);
  const groups = handGroups(hand);
  const winId = wp ? groups[wp.g].ids[wp.t] : hand.pair;
  return {
    tiles,
    context: {
      isTsumo: hand.isTsumo,
      isRiichi: !!hand.isRiichi,
      winTile: { id: winId },
      extraTiles, openMeldIds,
      seatWind: hand.seatWind,
      round: hand.roundWind,   // calcYaku は startsWith('東'/'南') で場風を見る
      kitas: 0,
    },
  };
}

// 手牌から役・翻数を求める。出題に使えない手 (あがり形でない/役なし) は null。
function judgeHand(hand) {
  if (typeof calcYaku !== 'function') return null;   // script.js 未読込
  const inp = toYakuInput(hand);
  let res;
  try { res = calcYaku(inp.tiles, inp.context); } catch (e) { return null; }
  if (!res || res.error || !res.yakuList || !res.yakuList.length) return null;
  return {
    yakuList: res.yakuList, han: res.han, isYakuman: !!res.isYakuman,
    isPinfu: res.yakuList.some(y => y.name === 'ピンフ'),
  };
}

// 手牌の牌並び (表示用)
function handTiles(hand) {
  return handGroups(hand).flatMap(g => g.ids);
}
// 面子ごとに区切った並び。
// 鳴いたか (open) / ロンで完成したか (ron) を持たせて 見た目で区別できるようにする。
// 明刻2符と暗刻4符は倍違うので、鳴きが判らないと符が計算できない
function handGroups(hand) {
  const groups = [];
  for (let i = 0; i < hand.melds.length; i++) {
    const m = hand.melds[i];
    let ids;
    if (m.type === 'shuntsu') ids = [m.id, m.id + 1, m.id + 2];
    else if (m.type === 'koutsu') ids = [m.id, m.id, m.id];
    else ids = [m.id, m.id, m.id, m.id];
    // 暗槓(32符)と明槓(16符)、ポン(明刻)は符が大きく変わるので 種別まで書く
    let label = '';
    if (m.type === 'kantsu') label = m.open ? '明槓' : '暗槓';
    else if (m.open) label = (m.type === 'koutsu') ? 'ポン' : 'チー';
    groups.push({ ids, open: !!m.open, ron: hand.ronMeldIdx === i, type: m.type, label });
  }
  groups.push({ ids: [hand.pair, hand.pair], pair: true, label: '雀頭' });   // 雀頭は最後
  return groups;
}
// あがり牌の位置 {g: グループ番号, t: グループ内の位置}。 待ちの形から1枚を特定する
function winTilePos(hand) {
  if (hand.wait === 'shanpon') {
    const i = hand.ronMeldIdx >= 0 ? hand.ronMeldIdx
      : hand.melds.findIndex(m => m.type === 'koutsu');
    return i >= 0 ? { g: i, t: 2 } : null;
  }
  if (hand.wait === 'tanki') return { g: hand.melds.length, t: 1 };  // 雀頭の2枚目
  const si = hand.melds.findIndex(m => m.type === 'shuntsu');
  if (si < 0) return null;
  // 嵌張=真ん中 / 辺張=端 / 両面=端
  const t = hand.wait === 'kanchan' ? 1 : (hand.wait === 'penchan' ? 2 : 0);
  return { g: si, t };
}

function tileImgHtml(id, cls = '') {
  return `<img src="assets/${TILE_IMG[id]}" alt="${TILE_NAME[id]}" class="${cls}">`;
}

// ─── 選択肢 ────────────────────────────
// 誤答は「ありがちな間違い」を混ぜる (符の取り違え・親子の取り違え・ツモロンの取り違え)
function scoreChoices(q, correctTotal) {
  const { fu, han, isOya, isTsumo, players } = q.calc;
  const cand = new Set([correctTotal]);
  const add = (o) => {
    try { const v = ScoreCalc.calcScore(o).total; if (v > 0) cand.add(v); } catch (e) { /* skip */ }
  };
  add({ fu, han, isOya: !isOya, isTsumo, players });            // 親子を取り違えた
  add({ fu, han, isOya, isTsumo: !isTsumo, players });          // ツモ/ロンを取り違えた
  add({ fu: fu === 30 ? 40 : 30, han, isOya, isTsumo, players });// 符を取り違えた
  add({ fu, han: han + 1, isOya, isTsumo, players });           // 翻を数え違えた
  add({ fu, han: Math.max(1, han - 1), isOya, isTsumo, players });
  add({ fu, han: han + 2, isOya, isTsumo, players });
  add({ fu, han: Math.max(1, han - 2), isOya, isTsumo, players });
  let others = shuffle([...cand].filter(v => v !== correctTotal));
  // 満貫以上は符が効かないので候補が重複しがち。 足りない分は近い金額で埋めて必ず4択にする
  const fillers = [correctTotal * 2, Math.round(correctTotal / 2 / 100) * 100,
    correctTotal + 2000, Math.max(1000, correctTotal - 2000), correctTotal + 4000];
  for (const f of fillers) {
    if (others.length >= 3) break;
    if (f > 0 && f !== correctTotal && !others.includes(f)) others.push(f);
  }
  return shuffle([correctTotal, ...others.slice(0, 3)]);
}

// ─── 出題 ─────────────────────────────
// 直前と同じ条件が続くと「同じ問題ばかり」に感じるので、少し引き直す
function pickDistinct(gen) {
  let c = gen();
  for (let i = 0; i < 8; i++) {
    const key = `${c.fu}/${c.han}/${c.isOya}/${c.isTsumo}`;
    if (key !== S.lastKey) { S.lastKey = key; return c; }
    c = gen();
  }
  S.lastKey = `${c.fu}/${c.han}/${c.isOya}/${c.isTsumo}`;
  return c;
}

function newQuestion() {
  S.step = 'score';
  S.revealed = (S.mode !== 'tehai');   // 手牌形式だけ 選択肢を隠して考える時間を作る
  if (S.mode === 'tehai') {
    const t = genTehai(S.players);
    const fuRes = ScoreCalc.calcFu(t.hand);
    S.q = {
      kind: 'tehai', hand: t.hand, fuRes, yakuList: t.yakuList,
      isRiichi: t.isRiichi, doraCount: t.doraCount,
      calc: { fu: fuRes.fu, han: t.han, isOya: t.isOya, isTsumo: t.hand.isTsumo, players: S.players },
    };
  } else if (S.mode === 'table') {
    // 5翻以上は符が関係なくなる (符計算の練習にならない) ので 1〜4翻を中心に出す
    const c = pickDistinct(() => {
      const fu = pick([20, 25, 30, 30, 30, 40, 40, 50, 60, 70]);
      let han = pick([1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5]);
      // 20符=ピンフツモ (ピンフ+ツモで最低2翻) / 25符=七対子 (2翻) は 1翻では成立しない
      if ((fu === 20 || fu === 25) && han < 2) han = 2;
      const isTsumo = fu === 20 ? true : Math.random() < 0.45;   // 20符はピンフツモのみ
      return { fu, han, isOya: Math.random() < 0.35, isTsumo, players: S.players };
    });
    S.q = { kind: 'table', calc: c };
    S.step = 'score';
  } else {
    const c = pickDistinct(() => {
      const fu = pick([20, 25, 30, 30, 40, 40, 50, 60]);
      let han = pick([1, 2, 2, 3, 3, 4]);
      if ((fu === 20 || fu === 25) && han < 2) han = 2;   // 上と同じ理由
      return { fu, han, isOya: Math.random() < 0.4, isTsumo: true, players: S.players };
    });
    S.q = { kind: 'split', calc: c };
    S.step = 'score';
  }
  renderQuestion();
}

function condText(q) {
  const c = q.calc;
  const who = c.isOya ? '<b>親</b>' : '<b>子</b>';
  const how = c.isTsumo ? '<b>ツモ</b>' : '<b>ロン</b>';
  const rule = `${c.players === 3 ? '三麻' : '四麻'}`;
  if (q.kind === 'tehai') {
    const h = q.hand;
    const menzen = h.isMenzen ? '門前' : '副露あり';
    const waitName = { ryanmen: '両面待ち', shanpon: 'シャンポン待ち', kanchan: '嵌張待ち',
      penchan: '辺張待ち', tanki: '単騎待ち' }[h.wait];
    // 翻数と符は出さない (手牌と状況だけを見て点数まで出す形式)。
    // 場風・自風は 役牌と符の判定に必要 / リーチとドラは翻数に効くので必ず出す
    const riichi = q.isRiichi ? ' / <b>リーチ</b>' : '';
    const dora = q.doraCount > 0 ? ` / <b>ドラ ${q.doraCount}</b>` : ' / ドラなし';
    return `${rule} / <b>${h.roundWind}場</b>・自風<b>${h.seatWind}</b> / ${who} / ${how}<br>`
      + `${menzen} / ${waitName}${riichi}${dora}`;
  }
  return `${rule} / ${who} の ${how}<br><b>${c.fu}符 ${c.han}翻</b>`;
}

function renderQuestion() {
  const q = S.q;
  $('drill-q-mode').textContent =
    { tehai: '🀇 手牌から点数', table: '📖 符と翻から点数', split: '💰 ツモの支払い' }[S.mode];
  const st = S.stats;
  $('drill-q-streak').textContent = st.streak > 0 ? `${st.streak}問連続正解` : '';
  $('drill-score').textContent = st.total > 0
    ? `正答 ${st.correct}/${st.total} (${Math.round(st.correct / st.total * 100)}%)` : '';

  // 手牌
  const handEl = $('drill-hand');
  const legendEl = $('drill-legend');
  if (q.kind === 'tehai') {
    const wp = winTilePos(q.hand);
    const groups = handGroups(q.hand);
    // 面子ごとに包む (CSS 側で1行に収める。 枚数が増えると牌が自動で縮む)
    handEl.innerHTML = groups.map((g, gi) => {
      const cls = 'drill-hand__grp'
        + (g.open ? ' drill-hand__grp--open' : '')
        + (g.pair ? ' drill-hand__grp--pair' : '');
      const tiles = g.ids.map((id, ti) =>
        tileImgHtml(id, (wp && wp.g === gi && wp.t === ti) ? 'drill-hand__win' : '')).join('');
      return `<span class="${cls}" data-label="${g.label || ''}">${tiles}</span>`;
    }).join('');
    // 凡例 (何を見て符を数えるかが判るように)
    const parts = ['<span class="drill-lg drill-lg--win">□</span> あがり牌'];
    if (groups.some(g => g.open)) parts.push('<span class="drill-lg drill-lg--open">□</span> 鳴いた面子 (明刻/明槓)');
    if (q.hand.wait === 'shanpon' && !q.hand.isTsumo) {
      parts.push('<span class="drill-note-inline">※ロンで完成した刻子は明刻</span>');
    }
    legendEl.innerHTML = parts.join('　');
    legendEl.hidden = false;
  } else {
    handEl.innerHTML = '';
    if (legendEl) { legendEl.innerHTML = ''; legendEl.hidden = true; }
  }

  $('drill-cond').innerHTML = condText(q);

  const ansEl = $('drill-answers');
  ansEl.innerHTML = '';
  const revealEl = $('drill-reveal');

  // ツモは合計点ではなく「2600オール」「1300・2600」の形で答える (実戦で言う形)
  const asSplit = (S.mode === 'split') || (q.kind === 'tehai' && q.calc.isTsumo);
  $('drill-ask').textContent = asSplit ? 'ツモの支払いはどれ?' : '点数は?';

  if (!S.revealed) {
    // 選択肢を出さずに考える時間を作る (自分のタイミングで開く)
    if (revealEl) revealEl.hidden = false;
    return;
  }
  if (revealEl) revealEl.hidden = true;

  const correct = ScoreCalc.calcScore(q.calc);
  if (asSplit) {
    for (const c of splitChoices(q, correct)) {
      ansEl.appendChild(mkAnswer(c.label, (btn) => answerSplit(c, correct, btn), c.sub, c.correct));
    }
  } else {
    for (const v of scoreChoices(q, correct.total)) {
      ansEl.appendChild(mkAnswer(`${v.toLocaleString()}点`, (btn) => answerScore(v, correct, btn),
        null, v === correct.total));
    }
  }
  // 最初の選択肢にフォーカス (キーボードでも回せるように)
  const first = ansEl.querySelector('.drill-ans');
  if (first) first.focus();
}

// 考え終わったら選択肢を開く
function revealAnswers() {
  if (S.revealed) return;
  S.revealed = true;
  renderQuestion();
}

function mkAnswer(label, onClick, sub, isCorrect) {
  const b = document.createElement('button');
  b.className = 'drill-ans';
  b.dataset.correct = isCorrect ? '1' : '0';
  b.innerHTML = sub ? `${label}<small>${sub}</small>` : label;
  b.addEventListener('click', (e) => onClick(e.currentTarget));
  return b;
}

// 支払い内訳の選択肢: 三麻/四麻の取り違え・親子の取り違えを混ぜる
function splitChoices(q, correct) {
  const c = q.calc;
  // 実戦の言い方に合わせる: 親ツモ=「2600オール」 / 子ツモ=「1300・2600」(子から・親からの順)
  const fmt = (r) => {
    if (r.detail.fromKo != null && r.detail.fromOya == null) {
      return { label: `${r.detail.fromKo.toLocaleString()}点オール`,
        sub: `計 ${r.total.toLocaleString()}点` };
    }
    return { label: `${r.detail.fromKo.toLocaleString()}・${r.detail.fromOya.toLocaleString()}`,
      sub: `子${r.detail.fromKo.toLocaleString()} / 親${r.detail.fromOya.toLocaleString()} — 計 ${r.total.toLocaleString()}点` };
  };
  const seen = new Set();
  const out = [];
  const push = (r) => {
    const f = fmt(r);
    // ⚠️ 重複判定は label だけで見る。 合計 (sub) が違っても表示が同じ選択肢
    //    (例: 三麻と四麻の「700・1,300」) が並ぶと、見た目で区別できず選べない
    const key = f.label;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...f, total: r.total, key });
  };
  push(correct);
  const correctKey = out[0].key;
  push(ScoreCalc.calcScore({ ...c, players: c.players === 3 ? 4 : 3 }));  // 人数を取り違えた
  push(ScoreCalc.calcScore({ ...c, isOya: !c.isOya }));                   // 親子を取り違えた
  push(ScoreCalc.calcScore({ ...c, han: c.han + 1 }));
  push(ScoreCalc.calcScore({ ...c, fu: c.fu === 30 ? 40 : 30 }));
  // 満貫以上は符・翻の小さな違いが効かず候補が重複するので、翻を大きく振って埋める
  for (const d of [2, -1, -2, -3, 3]) {
    if (out.length >= 4) break;
    push(ScoreCalc.calcScore({ ...c, han: Math.max(1, c.han + d) }));
  }
  const others = shuffle(out.filter(o => o.key !== correctKey)).slice(0, 3);
  return shuffle([out.find(o => o.key === correctKey), ...others])
    .map(o => ({ ...o, correct: o.key === correctKey }));
}

// ─── 採点 ─────────────────────────────
// 正解に緑・選んだ誤答に赤を付けて全ボタンを止める (連打での二重回答も防ぐ)。
// 判定は data 属性で行う (文言一致だと 300点 と 3000点 のような取り違えが起きる)
function markAnswered(clicked) {
  for (const b of document.querySelectorAll('.drill-ans')) {
    b.disabled = true;
    if (b.dataset.correct === '1') b.classList.add('drill-ans--right');
    else if (b === clicked) b.classList.add('drill-ans--wrong');
  }
}
function record(ok) {
  const st = S.stats;
  st.total++;
  if (ok) { st.correct++; st.streak++; st.best = Math.max(st.best, st.streak); }
  else st.streak = 0;
  const m = st.byMode[S.mode] || (st.byMode[S.mode] = { total: 0, correct: 0 });
  m.total++; if (ok) m.correct++;
  saveStats();
}

function answerScore(v, correct, btn) {
  const ok = (v === correct.total);
  markAnswered(btn);
  record(ok);
  showExplain(ok, scoreExplainHtml(correct), newQuestion);
}
function answerSplit(choice, correct, btn) {
  const ok = !!choice.correct;
  markAnswered(btn);
  record(ok);
  // 手牌形式のツモは「役→符→点数」を解説する (split モードは三麻/四麻の差が主題)
  const html = (S.q.kind === 'tehai') ? scoreExplainHtml(correct) : splitExplainHtml(correct);
  showExplain(ok, html, newQuestion);
}

// ─── 解説 ─────────────────────────────
// 出題では翻数を伏せているので、答え合わせで「どの役で何翻だったか」を必ず見せる
function yakuExplainHtml() {
  const q = S.q;
  if (!q.yakuList || !q.yakuList.length) return '';
  const rows = q.yakuList.map(y => `<tr><td>${y.name}</td><td>${y.han}翻</td></tr>`).join('');
  return `<p>役の内訳:</p>
    <table class="drill-fu-table">${rows}
      <tr><td>合計</td><td>${q.calc.han}翻</td></tr></table>`;
}
function fuExplainHtml() {
  const q = S.q;
  const rows = q.fuRes.breakdown.map(b => `<tr><td>${b.label}</td><td>${b.fu >= 0 ? '+' : ''}${b.fu}符</td></tr>`).join('');
  return `<p>符の内訳:</p>
    <table class="drill-fu-table">${rows}
      <tr><td>合計</td><td>${q.fuRes.fu}符</td></tr></table>
    <p class="drill-formula">符は 1の位を切り上げて 10符単位にします
      (七対子は 25符固定、 ピンフツモは 20符固定)。</p>`;
}
function scoreExplainHtml(correct) {
  const c = S.q.calc;
  const b = ScoreCalc.basePoints(c.fu, c.han, c.isOya);
  const mul = c.isTsumo ? '' : (c.isOya ? ' × 6' : ' × 4');
  let html = `<p><b>${c.fu}符 ${c.han}翻</b> / ${c.isOya ? '親' : '子'} の ${c.isTsumo ? 'ツモ' : 'ロン'}
    → <b>${correct.total.toLocaleString()}点</b></p>`;
  html += '<div class="drill-formula">';
  if (b.limit) {
    if (!c.isOya && c.fu === 60 && c.han === 3) {
      html += '子の <b>60符3翻</b> は <b>満貫</b> として扱います'
        + ' (符どおりに計算すると 7,700点ですが、このアプリでは切り上げます)。基本点 2,000点。';
    } else if (c.han >= 5) {
      html += `${c.han}翻は <b>${b.limit}</b>。基本点は ${b.base.toLocaleString()}点 で頭打ちです。`;
    } else {
      html += `基本点が 2,000点を超えるので <b>${b.limit}</b> になります`
        + ` (${c.fu} × 2<sup>${2 + c.han}</sup> = ${(c.fu * Math.pow(2, 2 + c.han)).toLocaleString()} → 2,000)。`;
    }
  } else {
    html += `基本点 = 符 × 2<sup>(2+翻)</sup> = ${c.fu} × 2<sup>${2 + c.han}</sup> = <b>${b.base.toLocaleString()}</b>`;
  }
  if (!c.isTsumo) html += `<br>ロンは 基本点${mul} = ${correct.total.toLocaleString()}点 (100点単位に切り上げ)`;
  else html += `<br>${correct.text}`;
  html += '</div>';
  if (S.q.kind === 'tehai') html += yakuExplainHtml() + fuExplainHtml();
  return html;
}
function splitExplainHtml(correct) {
  const c = S.q.calc;
  const b = ScoreCalc.basePoints(c.fu, c.han, c.isOya);
  const other = ScoreCalc.calcScore({ ...c, players: c.players === 3 ? 4 : 3 });
  return `<p><b>${c.fu}符 ${c.han}翻</b> / ${c.isOya ? '親' : '子'} のツモ → <b>${correct.text}</b></p>
    <div class="drill-formula">
      基本点 ${b.base.toLocaleString()}点。
      ${c.isOya ? '親のツモは 子が全員 基本点×2 を払います。'
        : '子のツモは 親が 基本点×2、 子が 基本点×1 を払います。'}
    </div>
    <p>${c.players === 3 ? '三麻' : '四麻'}は子が ${c.players === 3 ? 2 : 3}人なので、
      1人あたりの額は同じでも <b>合計は ${correct.total.toLocaleString()}点</b>。<br>
      同じ手を ${c.players === 3 ? '四麻' : '三麻'} で和了ると 合計 ${other.total.toLocaleString()}点 です。</p>`;
}

let _nextAction = null;
function showExplain(ok, html, next, okLabelOverride) {
  _nextAction = next;
  $('drill-verdict').textContent = ok ? '⭕ 正解' : '❌ 不正解';
  $('drill-verdict').className = 'drill-verdict ' + (ok ? 'drill-verdict--ok' : 'drill-verdict--ng');
  $('drill-explain-body').innerHTML = html;
  $('drill-next').textContent = okLabelOverride || '次の問題 →';
  // 選択肢の正誤 (緑/赤) が目に入ってから解説を出す。すぐ被せるとどれが正解か見えない
  setTimeout(() => {
    $('drill-explain').hidden = false;
    $('drill-next').focus();
  }, 420);
}
function closeExplain() {
  $('drill-explain').hidden = true;
  const fn = _nextAction; _nextAction = null;
  if (fn) fn();
}

// ─── 画面遷移 ───────────────────────────
function showMenu() {
  S.mode = null; S.q = null;
  $('drill-menu').hidden = false;
  $('drill-quiz').hidden = true;
  $('drill-explain').hidden = true;
  renderStats();
}
function startMode(mode) {
  S.mode = mode;
  $('drill-menu').hidden = true;
  $('drill-quiz').hidden = false;
  newQuestion();
}
function renderStats() {
  const st = S.stats;
  const rate = st.total > 0 ? Math.round(st.correct / st.total * 100) : 0;
  const modeName = { tehai: '手牌', table: '符と翻', split: '支払い' };
  let html = `
    <div class="drill-stat"><span class="drill-stat__label">解いた問題</span><span class="drill-stat__value">${st.total}</span></div>
    <div class="drill-stat"><span class="drill-stat__label">正答率</span><span class="drill-stat__value">${rate}%</span></div>
    <div class="drill-stat"><span class="drill-stat__label">最高連続正解</span><span class="drill-stat__value">${st.best}</span></div>`;
  for (const k of Object.keys(st.byMode)) {
    const m = st.byMode[k];
    html += `<div class="drill-stat"><span class="drill-stat__label">${modeName[k] || k}</span>
      <span class="drill-stat__value">${m.total ? Math.round(m.correct / m.total * 100) : 0}%</span></div>`;
  }
  $('drill-stats').innerHTML = html;
  $('drill-score').textContent = st.total > 0 ? `正答 ${st.correct}/${st.total} (${rate}%)` : '';
}

// ─── 起動 ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  S.stats = loadStats();
  const savedPlayers = Number(localStorage.getItem('omoroi-drill-players'));
  if (savedPlayers === 3 || savedPlayers === 4) S.players = savedPlayers;

  for (const b of document.querySelectorAll('.drill-opt')) {
    b.classList.toggle('drill-opt--on', Number(b.dataset.players) === S.players);
    b.addEventListener('click', () => {
      S.players = Number(b.dataset.players);
      localStorage.setItem('omoroi-drill-players', String(S.players));
      document.querySelectorAll('.drill-opt').forEach(o =>
        o.classList.toggle('drill-opt--on', o === b));
    });
  }
  document.querySelectorAll('.drill-mode').forEach(b =>
    b.addEventListener('click', () => startMode(b.dataset.mode)));
  $('drill-quit').addEventListener('click', showMenu);
  $('drill-next').addEventListener('click', closeExplain);
  $('drill-reveal-btn').addEventListener('click', revealAnswers);
  $('drill-reset').addEventListener('click', () => {
    if (!confirm('これまでの成績を消します。よろしいですか?')) return;
    S.stats = emptyStats(); saveStats(); renderStats();
  });

  // キーボード操作: Esc = 解説を閉じる / 出題中はメニューへ / メニューではロビーへ
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('drill-explain').hidden) { e.preventDefault(); closeExplain(); }
      else if (!$('drill-quiz').hidden) { e.preventDefault(); showMenu(); }
      else location.href = 'index.html';
    } else if (e.key === 'Enter' && !$('drill-explain').hidden) {
      e.preventDefault(); closeExplain();
    } else if (!$('drill-quiz').hidden && $('drill-explain').hidden && !S.revealed
               && (e.key === 'Enter' || e.key === ' ')) {
      // 選択肢を隠している間は Enter / Space で開く
      e.preventDefault(); revealAnswers();
    } else if (!$('drill-quiz').hidden && $('drill-explain').hidden && /^[1-4]$/.test(e.key)) {
      // 1〜4 キーで選択肢を選べる
      const btns = document.querySelectorAll('.drill-ans');
      const b = btns[Number(e.key) - 1];
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });

  showMenu();
});

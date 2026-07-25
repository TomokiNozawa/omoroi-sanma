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

// ─── 牌の定義 (script.js と同じ id 体系。 変更時は両方直すこと) ───
//   0=1m 1=9m / 2..10=1p..9p / 11..19=1s..9s / 20=東 21=南 22=西 23=北 24=白 25=發 26=中
const TILE_IMG = {
  0: '1m.png', 1: '9m.png',
  2: '1p.png', 3: '2p.png', 4: '3p.png', 5: '4p.png', 6: '5p.png',
  7: '6p.png', 8: '7p.png', 9: '8p.png', 10: '9p.png',
  11: '1s.png', 12: '2s.png', 13: '3s.png', 14: '4s.png', 15: '5s.png',
  16: '6s.png', 17: '7s.png', 18: '8s.png', 19: '9s.png',
  20: '東.png', 21: '南.png', 22: '西.png', 23: '北.png',
  24: '白.png', 25: '発.png', 26: '中.png',
};
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
const WIND_NAMES = ['東', '南', '西'];

const $ = (id) => document.getElementById(id);
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);

// ─── 状態 ─────────────────────────────
const S = {
  players: 3,
  mode: null,
  q: null,        // 現在の問題
  step: 'fu',     // tehai モードの段階: 'fu' → 'score'
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
function genTehai(players) {
  const isMenzen = Math.random() < 0.72;          // 門前を多めに (符の変化が出やすい)
  const isTsumo = Math.random() < 0.5;
  const isOya = Math.random() < 0.35;
  const seatWind = isOya ? '東' : pick(['南', '西']);
  const roundWind = '東';

  // 面子4つ: 順子と刻子を混ぜる (全部順子だとピンフ形ばかりになる)
  const used = new Set();
  const melds = [];
  const koutsuCount = pick([0, 1, 1, 2, 2, 3]);
  const kantsuCount = Math.random() < 0.18 ? 1 : 0;
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
      melds.push({ type: 'shuntsu', id: st, open: !isMenzen && Math.random() < 0.5 });
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

  const hand = { melds, pair: pairId, wait, isTsumo, isMenzen, seatWind, roundWind,
    isChiitoi: false, isPinfu: false };
  // ピンフ判定 (全部順子 + 両面 + 役牌でない雀頭 + 門前)
  const pairIsYakuhai = ScoreCalc.SANGEN.includes(pairId)
    || ScoreCalc.WINDS[seatWind] === pairId || ScoreCalc.WINDS[roundWind] === pairId;
  hand.isPinfu = isMenzen && melds.every(m => m.type === 'shuntsu') && wait === 'ryanmen' && !pairIsYakuhai;

  let han = pick([1, 1, 2, 2, 2, 3, 3, 4]);
  // ピンフツモは ピンフ1翻 + 門前清自摸和1翻 で 必ず2翻以上になる
  if (hand.isPinfu && hand.isTsumo && han < 2) han = 2;
  return { hand, han, isOya, players };
}

// 手牌の牌並び (表示用)。 あがり牌は末尾に分離して見せる
function handTiles(hand) {
  const out = [];
  for (const m of hand.melds) {
    if (m.type === 'shuntsu') out.push(m.id, m.id + 1, m.id + 2);
    else if (m.type === 'koutsu') out.push(m.id, m.id, m.id);
    else out.push(m.id, m.id, m.id, m.id);
  }
  out.push(hand.pair, hand.pair);
  return out;
}

function tileImgHtml(id, cls = '') {
  return `<img src="assets/${TILE_IMG[id]}" alt="${TILE_NAME[id]}" class="${cls}">`;
}

// ─── 選択肢 ────────────────────────────
// 誤答は「ありがちな間違い」を混ぜる (符の取り違え・親子の取り違え・ツモロンの取り違え)
function fuChoices(correct) {
  const pool = [20, 25, 30, 40, 50, 60, 70, 80].filter(v => v !== correct);
  const near = pool.sort((a, b) => Math.abs(a - correct) - Math.abs(b - correct)).slice(0, 5);
  return shuffle([correct, ...shuffle(near).slice(0, 3)]);
}
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
  S.step = 'fu';
  if (S.mode === 'tehai') {
    const t = genTehai(S.players);
    const fuRes = ScoreCalc.calcFu(t.hand);
    S.q = {
      kind: 'tehai', hand: t.hand, fuRes,
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
    return `${rule} / ${who}・自風${h.seatWind} / ${how} / ${menzen} / ${waitName}<br>`
      + `役は合わせて <b>${c.han}翻</b> でした`;
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
  if (q.kind === 'tehai') {
    const tiles = handTiles(q.hand);
    handEl.innerHTML = tiles.map(id => tileImgHtml(id)).join('');
  } else {
    handEl.innerHTML = '';
  }

  $('drill-cond').innerHTML = condText(q);

  const ansEl = $('drill-answers');
  ansEl.innerHTML = '';
  if (S.step === 'fu') {
    $('drill-ask').textContent = 'この手は何符?';
    for (const v of fuChoices(q.calc.fu)) {
      ansEl.appendChild(mkAnswer(`${v}符`, (btn) => answerFu(v, btn), null, v === q.calc.fu));
    }
  } else if (S.mode === 'split') {
    $('drill-ask').textContent = 'ツモの支払いはどれ?';
    const correct = ScoreCalc.calcScore(q.calc);
    for (const c of splitChoices(q, correct)) {
      ansEl.appendChild(mkAnswer(c.label, (btn) => answerSplit(c, correct, btn), c.sub, c.correct));
    }
  } else {
    $('drill-ask').textContent = '点数は?';
    const correct = ScoreCalc.calcScore(q.calc);
    for (const v of scoreChoices(q, correct.total)) {
      ansEl.appendChild(mkAnswer(`${v.toLocaleString()}点`, (btn) => answerScore(v, correct, btn),
        null, v === correct.total));
    }
  }
  // 最初の選択肢にフォーカス (キーボードでも回せるように)
  const first = ansEl.querySelector('.drill-ans');
  if (first) first.focus();
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
  const fmt = (r) => {
    if (r.detail.fromKo != null && r.detail.fromOya == null) {
      return { label: `${r.detail.fromKo.toLocaleString()}点オール`,
        sub: `計 ${r.total.toLocaleString()}点` };
    }
    return { label: `親 ${r.detail.fromOya.toLocaleString()} / 子 ${r.detail.fromKo.toLocaleString()}`,
      sub: `計 ${r.total.toLocaleString()}点` };
  };
  const seen = new Set();
  const out = [];
  const push = (r) => {
    const f = fmt(r);
    const key = f.label + '|' + f.sub;
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

function answerFu(v, btn) {
  const ok = (v === S.q.calc.fu);
  markAnswered(btn);
  record(ok);
  showExplain(ok, fuExplainHtml(), () => { S.step = 'score'; renderQuestion(); },
    ok ? '正解! 次は点数です' : '次は点数です');
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
  showExplain(ok, splitExplainHtml(correct), newQuestion);
}

// ─── 解説 ─────────────────────────────
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
  if (S.q.kind === 'tehai') html += fuExplainHtml();
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
    } else if (!$('drill-quiz').hidden && $('drill-explain').hidden && /^[1-4]$/.test(e.key)) {
      // 1〜4 キーで選択肢を選べる
      const btns = document.querySelectorAll('.drill-ans');
      const b = btns[Number(e.key) - 1];
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });

  showMenu();
});

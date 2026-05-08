// おもろい三麻 — Phase 1 MVP v0.2.0
// 配牌 + 山視覚化 + ツモ + 打牌 + CPU + 局進行 + 流局判定

// ─── 牌定義 ─────────────────────────────────────
const TILE_NAMES = [
  '一萬', '九萬',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一索', '二索', '三索', '四索', '五索', '六索', '七索', '八索', '九索',
  '東', '南', '西', '北', '白', '發', '中'
];
const TILE_UNICODE = [
  '🀇', '🀏',
  '🀙', '🀚', '🀛', '🀜', '🀝', '🀞', '🀟', '🀠', '🀡',
  '🀐', '🀑', '🀒', '🀓', '🀔', '🀕', '🀖', '🀗', '🀘',
  '🀀', '🀁', '🀂', '🀃', '🀆', '🀅', '🀄'
];
const RED_DORA_IDS = new Set([6, 15]); // 5p, 5s 全枚 (計8枚)
const KITA_ID = 23; // 北
const SEATS = ['p0', 'p1', 'p2'];
const SEAT_LABELS = { p0: 'あなた', p1: 'CPU上家', p2: 'CPU下家' };
const HAND_DOM_ID = { p0: 'hand-bottom', p1: 'hand-top', p2: 'hand-right' };
const RIVER_DOM_ID = { p0: 'river-bottom', p1: 'river-top', p2: 'river-right' };
const WALL_DOM_ID = { p0: 'wall-bottom', p1: 'wall-top', p2: 'wall-right' };

// ─── ゲーム状態 ──────────────────────────────────
const G = {
  mode: 'cpu',
  type: 'hanchan',
  round: '東1',
  honba: 0,
  oya: 'p0',
  wall: [],         // 全108牌
  drawWall: [],     // 自摸山 (王牌除く)
  kingWall: [],     // 王牌14牌
  doraIndicator: null,
  hands: { p0: [], p1: [], p2: [] },
  rivers: { p0: [], p1: [], p2: [] },
  kitas: { p0: 0, p1: 0, p2: 0 }, // 北抜き枚数
  turn: 'p0',
  selected: null,   // 選択中の牌 index (p0 のみ)
  justDrawn: null,  // ツモった牌 index (打牌の主候補)
  busy: false,      // 連打防止
};

// ─── 牌山生成 (Fisher-Yates) ────────────────────
function buildWall() {
  const wall = [];
  for (let id = 0; id < 27; id++) {
    for (let copy = 0; copy < 4; copy++) {
      wall.push({ id, copy, isRed: RED_DORA_IDS.has(id) });
    }
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// ─── 配牌 ────────────────────────────────────────
function deal(wall) {
  const hands = { p0: [], p1: [], p2: [] };
  let idx = 0;
  // 4-4-4-1 で 各家13牌
  for (let round = 0; round < 4; round++) {
    for (const p of SEATS) {
      const n = round < 3 ? 4 : 1;
      for (let k = 0; k < n; k++) hands[p].push(wall[idx++]);
    }
  }
  // 王牌: 山の末尾14牌
  const kingStart = wall.length - 14;
  const kingWall = wall.slice(kingStart);
  // 自摸山 = 配牌後 〜 王牌前
  const drawWall = wall.slice(idx, kingStart);
  const doraIndicator = kingWall[10]; // 慣例上の位置

  return { hands, drawWall, kingWall, doraIndicator };
}

// ─── ソート ─────────────────────────────────────
function sortHand(hand) {
  return [...hand].sort((a, b) => (a.id !== b.id) ? a.id - b.id : a.copy - b.copy);
}

// ─── DOM 生成 ───────────────────────────────────
function createTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.className = 'tile';
  if (opts.small) el.classList.add('tile--small');
  if (opts.mini)  el.classList.add('tile--mini');
  if (opts.river) el.classList.add('tile--river');
  if (opts.mine)  el.classList.add('tile--mine');
  if (opts.justDrawn) el.classList.add('tile--just-drawn');
  if (opts.back) {
    el.classList.add('tile--back');
    el.textContent = '';
  } else {
    el.textContent = TILE_UNICODE[tile.id];
    el.title = TILE_NAMES[tile.id] + (tile.isRed ? ' (赤ドラ)' : '');
    if (tile.isRed) el.classList.add('tile--red');
  }
  if (tile) {
    el.dataset.tileId = tile.id;
    el.dataset.tileCopy = tile.copy;
  }
  return el;
}

// ─── 描画: 手牌 ─────────────────────────────────
function renderHand(p) {
  const container = document.getElementById(HAND_DOM_ID[p]);
  if (!container) return;
  container.innerHTML = '';
  if (p === 'p0') {
    // 自分: 表向き、ソート済 + 末尾にツモ牌 (just-drawn 印)
    const sorted = sortHand(G.hands.p0.filter((_, i) => i !== G.justDrawn));
    const drawnTile = (G.justDrawn != null) ? G.hands.p0[G.justDrawn] : null;
    sorted.forEach((tile, i) => {
      const el = createTileEl(tile, { mine: true });
      // クリックで選択
      el.addEventListener('click', () => onMyHandClick(tile, false, i));
      if (G.selected === tile) el.classList.add('tile--selected');
      container.appendChild(el);
    });
    if (drawnTile) {
      // 末尾に少し離してツモ牌
      const sep = document.createElement('span');
      sep.style.cssText = 'width:6px;display:inline-block;';
      container.appendChild(sep);
      const el = createTileEl(drawnTile, { mine: true, justDrawn: true });
      el.addEventListener('click', () => onMyHandClick(drawnTile, true));
      if (G.selected === drawnTile) el.classList.add('tile--selected');
      container.appendChild(el);
    }
  } else {
    // CPU: 伏せ
    G.hands[p].forEach(() => {
      container.appendChild(createTileEl(null, { back: true, small: true }));
    });
  }
}

// ─── 描画: 河 ───────────────────────────────────
function renderRiver(p) {
  const container = document.getElementById(RIVER_DOM_ID[p]);
  if (!container) return;
  container.innerHTML = '';
  G.rivers[p].forEach(tile => {
    container.appendChild(createTileEl(tile, { river: true }));
  });
}

// ─── 描画: 山 (各家前に 2段積み + 次ツモ位置矢印) ──
function renderWall() {
  const remain = G.drawWall.length;
  const perSeat = Math.ceil(remain / 3);

  ['p0', 'p1', 'p2'].forEach((p, i) => {
    const container = document.getElementById(WALL_DOM_ID[p]);
    if (!container) return;
    // 古いラベルを 全て削除してから 描画 (累積バグ対策)
    const wrap = container.parentElement;
    if (wrap) wrap.querySelectorAll('.seat__wall-label').forEach(el => el.remove());
    container.innerHTML = '';

    const start = i * perSeat;
    const end = Math.min(start + perSeat, remain);
    for (let k = start; k < end; k++) {
      const t = document.createElement('div');
      t.className = 'wall-tile';
      if (k === 0) {
        t.classList.add('wall-tile--next');
        t.title = '次にここからツモります';
      }
      container.appendChild(t);
    }
    // 自分の山に「↓ 次のツモ」 ラベル を 1個だけ
    if (p === 'p0' && remain > 0 && wrap) {
      const label = document.createElement('div');
      label.className = 'seat__wall-label seat__wall-label--top';
      label.textContent = '↓ 次のツモ';
      wrap.insertBefore(label, container);
    }
  });
}

// ─── 描画: 王牌 ────────────────────────────────
function renderKingWall() {
  const tilesEl = document.getElementById('king-tiles');
  if (!tilesEl) return;
  tilesEl.innerHTML = '';
  G.kingWall.forEach((tile) => {
    const isDora = (tile === G.doraIndicator);
    tilesEl.appendChild(createTileEl(tile, { mini: true, back: !isDora }));
  });
}

// ─── 描画: ヘッダ情報 ──────────────────────────
function renderHeader() {
  document.getElementById('game-round').textContent = `${G.round}局 ${G.honba}本場`;
  document.getElementById('center-round').textContent = G.round;
  document.getElementById('game-remain').textContent = `山残: ${G.drawWall.length}`;
  document.getElementById('game-turn').textContent = G.turn === 'p0' ? 'あなたの番' : `${SEAT_LABELS[G.turn]} の番`;
}

// ─── 全描画 ─────────────────────────────────────
function renderAll() {
  renderHeader();
  ['p0', 'p1', 'p2'].forEach(p => { renderHand(p); renderRiver(p); });
  renderWall();
  renderKingWall();
  updateActionButtons();
  updateHint();
}

// ─── ヒントバー更新 ────────────────────────────
function updateHint() {
  const hint = document.getElementById('game-hint');
  if (!hint) return;
  hint.classList.remove('game__hint--cpu', 'game__hint--idle');

  if (G.busy && G.turn !== 'p0') {
    hint.textContent = `🤖 ${SEAT_LABELS[G.turn]} が考え中…`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  if (G.turn !== 'p0') {
    hint.textContent = `🤖 ${SEAT_LABELS[G.turn]} の番`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  // 自分の番
  if (G.hands.p0.length === 14) {
    const hasKita = G.hands.p0.some(t => t.id === KITA_ID);
    if (G.selected) {
      hint.textContent = `🎯 ${TILE_NAMES[G.selected.id]}${G.selected.isRed ? ' (赤ドラ!)' : ''} を選択中 — 「打牌」 で捨てる`;
    } else if (hasKita) {
      hint.textContent = '👆 牌をタップして選択 → 「打牌」 / 北 (🀃) があるので「北抜き」 もOK';
    } else {
      hint.textContent = '👆 手牌から捨てる牌をタップしてください (橙色枠=今ツモった牌)';
    }
  } else if (G.hands.p0.length === 13) {
    hint.textContent = '⏳ ツモ待ち…';
    hint.classList.add('game__hint--idle');
  } else {
    hint.textContent = '配牌中…';
    hint.classList.add('game__hint--idle');
  }
}

// ─── アクションボタン制御 ──────────────────────
function updateActionButtons() {
  const myTurn = (G.turn === 'p0' && !G.busy);
  // 自分の番で 14牌持っている時のみ 打牌可能
  const has14 = (G.hands.p0.length === 14);
  document.getElementById('btn-discard').disabled = !(myTurn && has14 && G.selected);
  // 北抜き: 14牌中 北 (id=23) を持っているか
  const hasKita = G.hands.p0.some(t => t.id === KITA_ID);
  document.getElementById('btn-kita').disabled = !(myTurn && has14 && hasKita);
  // ツモ: Phase 1 では「あがりツモ」 はまだ判定なし
  document.getElementById('btn-tsumo').disabled = true; // 役判定実装まで disabled
  document.getElementById('btn-riichi').disabled = true; // Phase 3
}

// ─── 自分の手牌タップ ─────────────────────────
function onMyHandClick(tile, isJustDrawn, idx) {
  if (G.turn !== 'p0' || G.busy) return;
  if (G.hands.p0.length !== 14) return;
  G.selected = (G.selected === tile) ? null : tile;
  renderHand('p0');
  updateActionButtons();
}

// ─── ツモ動作 ───────────────────────────────────
function drawTile(p) {
  if (G.drawWall.length === 0) return null;
  const tile = G.drawWall.shift();
  G.hands[p].push(tile);
  if (p === 'p0') G.justDrawn = G.hands.p0.length - 1;
  return tile;
}

// ─── 打牌動作 ──────────────────────────────────
function discardTile(p, tile) {
  const idx = G.hands[p].indexOf(tile);
  if (idx < 0) return false;
  G.hands[p].splice(idx, 1);
  G.rivers[p].push(tile);
  if (p === 'p0') {
    G.selected = null;
    G.justDrawn = null;
  }
  return true;
}

// ─── 北抜き動作 ────────────────────────────────
function kitaNuki(p) {
  const idx = G.hands[p].findIndex(t => t.id === KITA_ID);
  if (idx < 0) return false;
  const tile = G.hands[p].splice(idx, 1)[0];
  G.kitas[p]++;
  // 嶺上から補充自摸 (王牌の末尾から)
  if (G.kingWall.length > 0) {
    const replacement = G.kingWall.pop();
    G.hands[p].push(replacement);
    if (p === 'p0') G.justDrawn = G.hands[p].length - 1;
  }
  toast(`${SEAT_LABELS[p]} 北抜き (+1翻) / 抜き合計 ${G.kitas[p]}`);
  return true;
}

// ─── ターン進行 ────────────────────────────────
function nextTurn() {
  const i = SEATS.indexOf(G.turn);
  G.turn = SEATS[(i + 1) % 3];
}

function startTurn() {
  if (G.drawWall.length === 0) return endRound('流局');
  if (G.turn === 'p0') {
    // 自分のツモ
    drawTile('p0');
    renderAll();
  } else {
    // CPU 思考 (簡易)
    G.busy = true;
    renderAll();
    setTimeout(() => cpuPlay(G.turn), 600);
  }
}

// ─── CPU AI (Phase 1: シンプル) ────────────────
function cpuPlay(p) {
  // ツモ
  drawTile(p);
  renderHand(p);
  // 北を持ってたら北抜き → 再自摸
  const kitaIdx = G.hands[p].findIndex(t => t.id === KITA_ID);
  if (kitaIdx >= 0 && Math.random() > 0.1) { // 確率で 即抜く
    setTimeout(() => {
      kitaNuki(p);
      renderAll();
      setTimeout(() => cpuDiscard(p), 400);
    }, 400);
  } else {
    setTimeout(() => cpuDiscard(p), 600);
  }
}

function cpuDiscard(p) {
  // シンプル戦略: 字牌の単独 → 端牌 → ランダム
  const counts = {};
  G.hands[p].forEach(t => { counts[t.id] = (counts[t.id] || 0) + 1; });
  // 単独字牌 (id 20-26、 北は除く=23 のみ抜き候補なので 字牌その他)
  let target = null;
  for (let id = 20; id <= 26; id++) {
    if (id === KITA_ID) continue;
    if (counts[id] === 1) {
      target = G.hands[p].find(t => t.id === id);
      break;
    }
  }
  // 端牌 1m/9m/1p/9p/1s/9s 単独
  if (!target) {
    const ends = [0, 1, 2, 10, 11, 19];
    for (const id of ends) {
      if (counts[id] === 1) {
        target = G.hands[p].find(t => t.id === id);
        break;
      }
    }
  }
  // それでもなければ ツモ牌をそのまま打牌
  if (!target) target = G.hands[p][G.hands[p].length - 1];

  discardTile(p, target);
  toast(`${SEAT_LABELS[p]} が ${TILE_NAMES[target.id]} を打牌`);
  renderAll();
  G.busy = false;
  setTimeout(() => {
    nextTurn();
    startTurn();
  }, 400);
}

// ─── 局終了 ────────────────────────────────────
function endRound(reason) {
  document.getElementById('end-title').textContent = reason;
  document.getElementById('end-text').textContent =
    reason === '流局'
      ? `山が尽きました (${G.round}局 終了)。 Phase 1 では あがり判定 未実装のため、 通常は 流局 で 局終了します。`
      : `${G.round}局 終了。`;
  document.getElementById('end-overlay').hidden = false;
}

// ─── 次の局へ ──────────────────────────────────
// 三麻 半荘 = 東3局 + 南3局 = 6局 (野沢さん指示 2026-05-08)
const ROUND_ORDER = ['東1', '東2', '東3', '南1', '南2', '南3'];
function nextRound() {
  if (G.type === 'single') {
    location.href = 'index.html';
    return;
  }
  const idx = ROUND_ORDER.indexOf(G.round);
  if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
    // 半荘終了
    document.getElementById('end-title').textContent = '半荘終了';
    document.getElementById('end-text').textContent = '東3局〜南3局まで完走しました。';
    return;
  }
  G.round = ROUND_ORDER[idx + 1];
  G.honba = 0;
  document.getElementById('end-overlay').hidden = true;
  startNewRound();
}

// ─── 局開始 ────────────────────────────────────
function startNewRound() {
  G.wall = buildWall();
  const dealResult = deal(G.wall);
  G.hands = dealResult.hands;
  G.drawWall = dealResult.drawWall;
  G.kingWall = dealResult.kingWall;
  G.doraIndicator = dealResult.doraIndicator;
  G.rivers = { p0: [], p1: [], p2: [] };
  G.kitas = { p0: 0, p1: 0, p2: 0 };
  G.turn = G.oya; // 親から
  G.selected = null;
  G.justDrawn = null;
  G.busy = false;
  renderAll();
  // ガイド終了済みなら即ターン開始 (親の14牌目 ツモ)、 未済みは ガイド終了後に開始
  if (localStorage.getItem('omoroi-guide-done')) {
    setTimeout(() => startTurn(), 400);
  }
}

// ─── トースト ──────────────────────────────────
let toastTimer = null;
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ─── オンボーディング ──────────────────────────
const GUIDE_STEPS = [
  { title: '配牌完了!', text: '手牌13牌+ツモ1牌が配られました (親なので)。 画面下が「あなた」、 上=「CPU上家」、 右=「CPU下家」 です。' },
  { title: '🟡 山と次のツモ位置', text: '各家の前に山が積まれています。 黄色く光る牌が「次にツモる位置」 です。 ツモは山の左から順に取られます。' },
  { title: '🀫 王牌とドラ表示', text: '中央の点線枠が王牌14枚。 1枚だけ表向きの牌が「ドラ表示」 で、 その次の牌が「ドラ」 (1翻 加算)。' },
  { title: '🀃 北抜き', text: '北 (🀃) を引いたら 「北抜き」 ボタンで抜けます。 抜くたび 1翻、 嶺上 (王牌の末尾) から補充自摸 (関西ルール)。' },
  { title: '✨ 全部赤ドラ', text: '5筒×4枚 + 5索×4枚 = 計8枚 全部赤ドラ。 引いただけで 1翻ずつ加算 = 高翻数で気持ちよく勝てる仕様。' },
  { title: 'はじめよう!', text: '牌をタップ → 「打牌」 ボタンで捨てます。 次は CPU上家 → CPU下家 → あなた の順。 3・3・3・3・2 を作るのが目的!' }
];
let guideIdx = 0;

function showGuide() {
  guideIdx = 0;
  document.getElementById('guide-overlay').hidden = false;
  renderGuideStep();
}
function renderGuideStep() {
  const step = GUIDE_STEPS[guideIdx];
  if (!step) return finishGuide();
  document.getElementById('guide-title').textContent = step.title;
  document.getElementById('guide-text').textContent = step.text;
  document.getElementById('guide-step').textContent = `${guideIdx + 1} / ${GUIDE_STEPS.length}`;
  const nextBtn = document.getElementById('guide-next');
  nextBtn.textContent = (guideIdx === GUIDE_STEPS.length - 1) ? 'はじめる' : '次へ →';
}
function finishGuide() {
  document.getElementById('guide-overlay').hidden = true;
  localStorage.setItem('omoroi-guide-done', '1');
  // ガイド終了直後で 配牌済+ターン未開始 なら ターン開始
  if (G.hands.p0 && G.hands.p0.length === 13 && G.turn === G.oya && !G.busy) {
    setTimeout(() => startTurn(), 400);
  }
}

// ─── ゲーム初期化 ────────────────────────────────
function initGame() {
  const params = new URLSearchParams(location.search);
  G.mode = params.get('mode') || 'cpu';
  G.type = params.get('type') || 'hanchan';
  G.round = '東1';
  G.honba = 0;
  G.oya = 'p0';

  startNewRound();

  // オンボーディング (初回のみ)
  if (!localStorage.getItem('omoroi-guide-done')) {
    setTimeout(showGuide, 500);
  }
}

// ─── ロビーのバージョン表示 (version.json から動的読込) ──
async function loadLobbyVersion() {
  const verEl = document.getElementById('app-version');
  const phaseEl = document.getElementById('app-phase');
  if (!verEl) return;
  try {
    const res = await fetch('version.json?_=' + Date.now());
    if (!res.ok) return;
    const j = await res.json();
    if (j.data?.version) verEl.textContent = j.data.version;
    if (j.data?.phase) phaseEl.textContent = `(Phase ${j.data.phase} MVP)`;
  } catch (e) {
    console.warn('version.json 読込失敗', e);
  }
}
if (document.getElementById('app-version')) {
  document.addEventListener('DOMContentLoaded', loadLobbyVersion);
}

// ─── イベント結線 ───────────────────────────────
if (document.getElementById('table')) {
  document.addEventListener('DOMContentLoaded', () => {
    initGame();

    // ガイド
    document.getElementById('guide-next')?.addEventListener('click', () => {
      guideIdx++;
      if (guideIdx >= GUIDE_STEPS.length) finishGuide();
      else renderGuideStep();
    });
    document.getElementById('guide-skip')?.addEventListener('click', finishGuide);
    document.getElementById('guide-btn')?.addEventListener('click', showGuide);

    // 打牌ボタン
    document.getElementById('btn-discard').addEventListener('click', () => {
      if (G.turn !== 'p0' || G.busy || !G.selected) return;
      const tile = G.selected;
      discardTile('p0', tile);
      toast(`あなたが ${TILE_NAMES[tile.id]} を打牌`);
      renderAll();
      setTimeout(() => {
        nextTurn();
        startTurn();
      }, 400);
    });

    // 北抜き
    document.getElementById('btn-kita').addEventListener('click', () => {
      if (G.turn !== 'p0' || G.busy) return;
      kitaNuki('p0');
      renderAll();
    });

    // 局終了モーダル
    document.getElementById('end-next')?.addEventListener('click', nextRound);
  });
}

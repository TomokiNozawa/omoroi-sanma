// おもろい三麻 — Phase 1 v0.5.0
// 雀卓 4家構造 / 4面均等山 (27牌×4) / サイコロでカット位置正確化 / 三麻 CPU 2人ランダム配置

// ─── 牌定義 ─────────────────────────────────────
const TILE_NAMES = [
  '一萬', '九萬',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一索', '二索', '三索', '四索', '五索', '六索', '七索', '八索', '九索',
  '東', '南', '西', '北', '白', '發', '中'
];
const RED_DORA_IDS = new Set([6, 15]);
const KITA_ID = 23;

const TILE_IMG = {
   0: '1m.png',
   1: '9m.png',
   2: '1p.png', 3: '2p.png', 4: '3p.png', 5: '4p.png', 6: '5p.png',
   7: '6p.png', 8: '7p.png', 9: '8p.png', 10: '9p.png',
  11: '1s.png', 12: '2s.png', 13: '3s.png', 14: '4s.png', 15: '5s.png',
  16: '6s.png', 17: '7s.png', 18: '8s.png', 19: '9s.png',
  20: '東.png', 21: '南.png', 22: '西.png', 23: '北.png',
  24: '白.png', 25: '発.png', 26: '中.png',
};
const TILE_BACK_IMG = '背面_緑.png';

// ─── 4家配置 ──────────────────────────────────
// 卓は4方向: bottom (自家固定) / right (下家) / top (対面) / left (上家)
// 三麻なので「他家2人 (ランダム)」 + 「空席1家 (山あり、 配牌なし、 操作なし)」
const ALL_SEATS = ['bottom', 'right', 'top', 'left'];
const SEAT_LABEL_BASE = { bottom: 'あなた (親)', right: '下家', top: '対面', left: '上家' };

// 反時計回り順 (麻雀の標準: 自家→下家→対面→上家→自家)
function ccwFrom(seat) {
  const idx = ALL_SEATS.indexOf(seat);
  return [...ALL_SEATS.slice(idx), ...ALL_SEATS.slice(0, idx)];
}

// ─── ゲーム状態 ──────────────────────────────────
const G = {
  mode: 'cpu',
  type: 'hanchan',
  round: '東1',
  honba: 0,
  oya: 'bottom',
  cpuSeats: [],   // 例: ['left', 'right'] (2人)
  emptySeat: null, // 例: 'top' (1人空席)
  walls: { bottom: [], right: [], top: [], left: [] }, // 各家27牌 (固定、 表示用)
  drawTiles: [],  // 自摸山 (反時計回り、 配牌+ツモで先頭から取る)
  kingTiles: [],  // 王牌 14牌
  doraIndicator: null,
  startSeat: null, // サイコロで決まった起点家
  cutPosInStart: 0,// 起点家山の中でのカット位置 (= startWall.length - diceTotal)
  diceTotal: 0,
  hands: { bottom: [], right: [], top: [], left: [] },
  rivers: { bottom: [], right: [], top: [], left: [] },
  kitas: { bottom: 0, right: 0, top: 0, left: 0 },
  turn: 'bottom',
  selected: null,
  justDrawn: null,
  busy: false,
};

// ─── 牌生成 + シャッフル ───────────────────────
function buildAllTiles() {
  const all = [];
  for (let id = 0; id < 27; id++) {
    for (let copy = 0; copy < 4; copy++) {
      all.push({ id, copy, isRed: RED_DORA_IDS.has(id) });
    }
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

// ─── 4面均等で 27牌ずつ 配置 ────────────────────
function buildWalls(allTiles) {
  return {
    bottom: allTiles.slice(0, 27),
    right:  allTiles.slice(27, 54),
    top:    allTiles.slice(54, 81),
    left:   allTiles.slice(81, 108),
  };
}

// ─── サイコロを振って カット位置 + 王牌 + 自摸山を決定 ──
function applyDice(walls, diceTotal) {
  // 起点家 = (diceTotal - 1) % 4
  // bottom=1,5,9 / right=2,6,10 / top=3,7,11 / left=4,8,12
  const startSeat = ALL_SEATS[(diceTotal - 1) % 4];
  const ccw = ccwFrom(startSeat);
  const startWall = walls[startSeat];
  // カット位置 = 起点家山の右端から diceTotal 牌引いた位置 (= 27 - diceTotal)
  const cutPosInStart = startWall.length - diceTotal;

  // 王牌 14牌 (起点家山の カット位置以降、 隣にまたがる場合あり)
  let kingTiles, drawTiles;
  if (diceTotal >= 14) {
    // 起点家山に 14牌入りきる
    kingTiles = startWall.slice(cutPosInStart, cutPosInStart + 14);
    // 自摸山: 起点家のカット位置左 + 起点家の王牌後 + 反時計回り次の3家全部
    drawTiles = [
      ...startWall.slice(0, cutPosInStart),
      ...startWall.slice(cutPosInStart + 14),
      ...walls[ccw[1]], ...walls[ccw[2]], ...walls[ccw[3]],
    ];
  } else {
    // 王牌が 起点家山に入りきらない、 隣の家の山先頭から 補充
    const overflow = 14 - diceTotal;
    kingTiles = [
      ...startWall.slice(cutPosInStart),
      ...walls[ccw[1]].slice(0, overflow),
    ];
    drawTiles = [
      ...startWall.slice(0, cutPosInStart),
      ...walls[ccw[1]].slice(overflow),
      ...walls[ccw[2]], ...walls[ccw[3]],
    ];
  }

  // ドラ表示 = 王牌の 右から3枚目
  const doraIndicator = kingTiles[kingTiles.length - 3];

  return { startSeat, cutPosInStart, kingTiles, drawTiles, doraIndicator };
}

// ─── 配牌 (反時計回り 4-4-4-1) ────────────────
function dealHands(drawTiles, oyaSeat, cpuSeats, emptySeat) {
  // 配牌は 親から 反時計回りに 4-4-4-1 で 3人分のみ (空席家は配らない)
  const ccw = ccwFrom(oyaSeat);
  const playingSeats = ccw.filter(s => s !== emptySeat);  // 自家+CPU2人

  const hands = { bottom: [], right: [], top: [], left: [] };
  let idx = 0;
  for (let round = 0; round < 4; round++) {
    for (const p of playingSeats) {
      const n = round < 3 ? 4 : 1;
      for (let k = 0; k < n; k++) {
        hands[p].push(drawTiles[idx++]);
      }
    }
  }
  return { hands, drawTilesRemain: drawTiles.slice(idx) };
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
    el.style.backgroundImage = `url('assets/${encodeURIComponent(TILE_BACK_IMG)}')`;
    el.title = '伏せ牌';
  } else {
    const fn = TILE_IMG[tile.id];
    if (fn) el.style.backgroundImage = `url('assets/${encodeURIComponent(fn)}')`;
    el.title = TILE_NAMES[tile.id] + (tile.isRed ? ' (赤ドラ)' : '');
  }
  if (tile) {
    el.dataset.tileId = tile.id;
    el.dataset.tileCopy = tile.copy;
  }
  return el;
}

// ─── ソート ──────────────────────────────────
function sortHand(hand) {
  return [...hand].sort((a, b) => (a.id !== b.id) ? a.id - b.id : a.copy - b.copy);
}

// ─── 描画: 手牌 ────────────────────────────────
function renderHand(seat) {
  const container = document.getElementById(`hand-${seat}`);
  if (!container) return;
  container.innerHTML = '';
  if (seat === G.emptySeat) return;

  if (seat === 'bottom') {
    // 自家: 表向き、 ソート + 末尾にツモ牌
    const sorted = sortHand(G.hands.bottom.filter((_, i) => i !== G.justDrawn));
    const drawnTile = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
    sorted.forEach(tile => {
      const el = createTileEl(tile, { mine: true });
      el.addEventListener('click', () => onMyHandClick(tile));
      if (G.selected === tile) el.classList.add('tile--selected');
      container.appendChild(el);
    });
    if (drawnTile) {
      const sep = document.createElement('span');
      sep.style.cssText = 'width:6px;display:inline-block;';
      container.appendChild(sep);
      const el = createTileEl(drawnTile, { mine: true, justDrawn: true });
      el.addEventListener('click', () => onMyHandClick(drawnTile));
      if (G.selected === drawnTile) el.classList.add('tile--selected');
      container.appendChild(el);
    }
  } else {
    // CPU: 伏せ
    G.hands[seat].forEach(() => {
      container.appendChild(createTileEl(null, { back: true, small: true }));
    });
  }
}

// ─── 描画: 河 (top/left は DOM逆順で 新しい牌が中央寄りに) ──
function renderRiver(seat) {
  const container = document.getElementById(`river-${seat}`);
  if (!container) return;
  container.innerHTML = '';
  // top と left は 「中央寄り = 新しい牌」 になるよう 逆順で
  let arr = G.rivers[seat];
  if (seat === 'top' || seat === 'left') {
    arr = [...arr].reverse();
  }
  arr.forEach(tile => {
    container.appendChild(createTileEl(tile, { river: true }));
  });
}

// ─── 描画: 山 (通常麻雀通り — 起点家のカット位置左から反時計回り 順次消費) ──
function renderWalls() {
  const totalRemain = G.drawTiles.length;
  // 自摸山+配牌の合計消費数 = 108 - 14 (王牌) - totalRemain
  const consumedTotal = totalRemain > 0 ? (108 - 14 - totalRemain) : 0;

  // 各家の山残量 (反時計回り順、 起点家のカット位置左から 順次消費)
  const ccw = G.startSeat ? ccwFrom(G.startSeat) : ALL_SEATS;
  // 起点家の自摸山対象 = カット位置左 cutPosInStart 牌
  // 反時計回り次家以降 = 各 27牌 全部 (但し 王牌が隣家にまたがる場合は 調整必要、 簡略化省略)

  let remaining = consumedTotal;
  const consumed = { bottom: 0, right: 0, top: 0, left: 0 };
  // ccw[0] = 起点家: カット位置左の cutPosInStart 牌だけ自摸山対象
  const startMax = G.cutPosInStart || 0;
  consumed[ccw[0]] = Math.min(remaining, startMax);
  remaining -= consumed[ccw[0]];
  // ccw[1], ccw[2], ccw[3]: 全 27牌が 自摸山対象
  for (let i = 1; i < 4 && remaining > 0; i++) {
    const max = 27;
    consumed[ccw[i]] = Math.min(remaining, max);
    remaining -= consumed[ccw[i]];
  }

  // ドラ表示位置 (起点家山にあるか 隣家にあるか)
  const doraIdxInStart = (G.diceTotal >= 14) ? G.cutPosInStart + 11 : -1;
  const doraIdxInNext = (G.diceTotal < 14 && G.diceTotal > 0) ? (11 - G.diceTotal) : -1;

  ALL_SEATS.forEach(seat => {
    const container = document.getElementById(`wall-${seat}`);
    if (!container) return;
    container.innerHTML = '';
    const baseCount = G.walls[seat].length;  // 27
    const consumedHere = consumed[seat];

    // 表示する牌位置 = consumedHere から baseCount まで (左側を 消費済とする)
    // 自摸山は 山の左端から消費されるので、 表示は 左端の `consumedHere` 牌を 抜いた残りを左から並べる
    // 視覚的に 「起点家のカット位置左から 順に減る」 ように:
    // - 起点家: 左から consumedHere 牌だけ 抜けてる、 表示は 27-consumedHere 牌
    // - 他家: 同様

    for (let visIdx = 0; visIdx < baseCount; visIdx++) {
      const t = document.createElement('div');
      t.className = 'wall-tile';
      // visIdx は 山の物理位置 0..26 (0=左端=次のツモ位置)
      // 消費済 = visIdx < consumedHere は 表示しない (空セル)
      if (visIdx < consumedHere) {
        // 消費済 = 空セル (透明 or 詰めない)
        t.style.visibility = 'hidden';
      }
      // ドラ表示
      let isDora = false;
      if (seat === G.startSeat && visIdx === doraIdxInStart && G.doraIndicator) {
        isDora = true;
      } else if (G.diceTotal < 14 && seat === ccw[1] && visIdx === doraIdxInNext && G.doraIndicator) {
        isDora = true;
      }
      if (isDora) {
        t.classList.add('wall-tile--dora');
        const fn = TILE_IMG[G.doraIndicator.id];
        if (fn) t.style.backgroundImage = `url('assets/${encodeURIComponent(fn)}')`;
        t.title = 'ドラ表示: ' + TILE_NAMES[G.doraIndicator.id];
        t.style.visibility = 'visible';  // ドラ表示は 消費されない
      } else if (seat === G.startSeat && visIdx >= G.cutPosInStart) {
        // 王牌部分 (カット位置以降)
        t.classList.add('wall-tile--king');
        if (visIdx === G.cutPosInStart) t.classList.add('wall-tile--cut-line');
        t.style.visibility = 'visible';
      } else if (visIdx === consumedHere && seat === ccw[(consumedTotal === 0 ? 0 : 0)]) {
        // 次のツモ位置 = 起点家の カット位置左 から 反時計回りに 消費中の 先頭
        // 簡略: 起点家でカット位置左の最先頭 (consumed_in_start) を ハイライト、 起点家自摸山が空になったら 次家へ
        if (visIdx >= consumedHere) {  // 消費済でない 先頭
          t.classList.add('wall-tile--next');
        }
      }
      container.appendChild(t);
    }
  });
}

// ─── 描画: ヘッダ + 中央 ───────────────────────
function renderHeader() {
  document.getElementById('game-round').textContent = `${G.round}局 ${G.honba}本場`;
  document.getElementById('center-round').textContent = G.round;
  const remain = G.drawTiles.length;
  document.getElementById('game-remain').textContent = `山残: ${remain}`;
  const cr = document.getElementById('center-remain');
  if (cr) cr.textContent = remain;
  const turnLabel = (G.turn === 'bottom') ? 'あなたの番' : `${SEAT_LABEL_BASE[G.turn]} の番`;
  document.getElementById('game-turn').textContent = turnLabel;
}

// ─── 描画: ラベル + 空席表示 ────────────────────
function renderSeats() {
  ALL_SEATS.forEach(seat => {
    const seatEl = document.getElementById(`seat-${seat}`);
    const labelEl = document.getElementById(`label-${seat}`);
    if (!seatEl) return;
    if (seat === G.emptySeat) {
      seatEl.classList.add('seat--empty');
      if (labelEl) labelEl.textContent = `${SEAT_LABEL_BASE[seat]} (空席)`;
    } else if (seat === 'bottom') {
      seatEl.classList.remove('seat--empty');
      if (labelEl) labelEl.textContent = SEAT_LABEL_BASE[seat] + ' — 東家';
    } else {
      seatEl.classList.remove('seat--empty');
      if (labelEl) labelEl.textContent = `${SEAT_LABEL_BASE[seat]} (CPU)`;
    }
  });
}

// ─── 全描画 ─────────────────────────────────
function renderAll() {
  renderHeader();
  renderSeats();
  ALL_SEATS.forEach(s => { renderHand(s); renderRiver(s); });
  renderWalls();
  updateActionButtons();
  updateHint();
}

// ─── ヒントバー ────────────────────────────────
function updateHint() {
  const hint = document.getElementById('game-hint');
  if (!hint) return;
  hint.classList.remove('game__hint--cpu', 'game__hint--idle');
  if (G.busy && G.turn !== 'bottom') {
    hint.textContent = `🤖 ${SEAT_LABEL_BASE[G.turn]} が考え中…`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  if (G.turn !== 'bottom') {
    hint.textContent = `🤖 ${SEAT_LABEL_BASE[G.turn]} の番`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  if (G.hands.bottom.length === 14) {
    const hasKita = G.hands.bottom.some(t => t.id === KITA_ID);
    if (G.selected) {
      hint.textContent = `🎯 ${TILE_NAMES[G.selected.id]}${G.selected.isRed ? ' (赤)' : ''} 選択中 — 「打牌」 で捨てる`;
    } else if (hasKita) {
      hint.textContent = '👆 牌タップ → 「打牌」 / 北 (🀃) は 「北抜き」 もOK';
    } else {
      hint.textContent = '👆 手牌から捨てる牌をタップ → 「打牌」';
    }
  } else if (G.hands.bottom.length === 13) {
    hint.textContent = '⏳ ツモ待ち…';
    hint.classList.add('game__hint--idle');
  } else {
    hint.textContent = '配牌中…';
    hint.classList.add('game__hint--idle');
  }
}

// ─── アクションボタン ─────────────────────────
function updateActionButtons() {
  const myTurn = (G.turn === 'bottom' && !G.busy);
  const has14 = (G.hands.bottom.length === 14);
  document.getElementById('btn-discard').disabled = !(myTurn && has14 && G.selected);
  const hasKita = G.hands.bottom.some(t => t.id === KITA_ID);
  document.getElementById('btn-kita').disabled = !(myTurn && has14 && hasKita);
  document.getElementById('btn-tsumo').disabled = true;  // 役判定実装まで
  document.getElementById('btn-riichi').disabled = true;
}

function onMyHandClick(tile) {
  if (G.turn !== 'bottom' || G.busy) return;
  if (G.hands.bottom.length !== 14) return;
  G.selected = (G.selected === tile) ? null : tile;
  renderHand('bottom');
  updateActionButtons();
  updateHint();
}

// ─── ツモ動作 ──────────────────────────────────
function drawTile(seat) {
  if (G.drawTiles.length === 0) return null;
  const tile = G.drawTiles.shift();
  G.hands[seat].push(tile);
  if (seat === 'bottom') G.justDrawn = G.hands.bottom.length - 1;
  return tile;
}

function discardTile(seat, tile) {
  const idx = G.hands[seat].indexOf(tile);
  if (idx < 0) return false;
  G.hands[seat].splice(idx, 1);
  G.rivers[seat].push(tile);
  if (seat === 'bottom') {
    G.selected = null;
    G.justDrawn = null;
  }
  return true;
}

function kitaNuki(seat) {
  const idx = G.hands[seat].findIndex(t => t.id === KITA_ID);
  if (idx < 0) return false;
  const tile = G.hands[seat].splice(idx, 1)[0];
  G.kitas[seat]++;
  // 嶺上 (王牌の末尾、 配列の最後) から補充
  if (G.kingTiles.length > 0) {
    const replacement = G.kingTiles.pop();
    G.hands[seat].push(replacement);
    if (seat === 'bottom') G.justDrawn = G.hands[seat].length - 1;
  }
  toast(`${SEAT_LABEL_BASE[seat]} 北抜き (+1翻) / 抜き合計 ${G.kitas[seat]}`);
  return true;
}

// ─── ターン進行 (反時計回り、 空席をスキップ) ──
function nextTurn() {
  const ccw = ccwFrom(G.turn);
  // ccw[0]=現在、 ccw[1] が 次。 但し 空席は スキップ
  for (let i = 1; i < 4; i++) {
    if (ccw[i] !== G.emptySeat) {
      G.turn = ccw[i];
      return;
    }
  }
}

function startTurn() {
  if (G.drawTiles.length === 0) return endRound('流局');
  if (G.turn === 'bottom') {
    drawTile('bottom');
    renderAll();
  } else {
    G.busy = true;
    renderAll();
    setTimeout(() => cpuPlay(G.turn), 500);
  }
}

function cpuPlay(seat) {
  drawTile(seat);
  renderHand(seat);
  const kitaIdx = G.hands[seat].findIndex(t => t.id === KITA_ID);
  if (kitaIdx >= 0 && Math.random() > 0.1) {
    setTimeout(() => {
      kitaNuki(seat);
      renderAll();
      setTimeout(() => cpuDiscard(seat), 350);
    }, 350);
  } else {
    setTimeout(() => cpuDiscard(seat), 500);
  }
}

function cpuDiscard(seat) {
  const counts = {};
  G.hands[seat].forEach(t => { counts[t.id] = (counts[t.id] || 0) + 1; });
  let target = null;
  for (let id = 20; id <= 26; id++) {
    if (id === KITA_ID) continue;
    if (counts[id] === 1) { target = G.hands[seat].find(t => t.id === id); break; }
  }
  if (!target) {
    const ends = [0, 1, 2, 10, 11, 19];
    for (const id of ends) {
      if (counts[id] === 1) { target = G.hands[seat].find(t => t.id === id); break; }
    }
  }
  if (!target) target = G.hands[seat][G.hands[seat].length - 1];
  discardTile(seat, target);
  toast(`${SEAT_LABEL_BASE[seat]} が ${TILE_NAMES[target.id]} を打牌`);
  renderAll();
  G.busy = false;
  setTimeout(() => { nextTurn(); startTurn(); }, 350);
}

function endRound(reason) {
  document.getElementById('end-title').textContent = reason;
  document.getElementById('end-text').textContent =
    reason === '流局'
      ? `山が尽きました (${G.round}局 終了)。 Phase 1 ではあがり判定 未実装。`
      : `${G.round}局 終了。`;
  document.getElementById('end-overlay').hidden = false;
}

// 三麻 半荘 = 東3+南3 = 6局
const ROUND_ORDER = ['東1', '東2', '東3', '南1', '南2', '南3'];
function nextRound() {
  if (G.type === 'single') { location.href = 'index.html'; return; }
  const idx = ROUND_ORDER.indexOf(G.round);
  if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
    document.getElementById('end-title').textContent = '半荘終了';
    document.getElementById('end-text').textContent = '東3局〜南3局まで完走しました。';
    return;
  }
  G.round = ROUND_ORDER[idx + 1];
  G.honba = 0;
  document.getElementById('end-overlay').hidden = true;
  startNewRound();
}

// ─── 三麻 CPU 配置をランダムに決める ──────────
function pickCpuPlacement() {
  const candidates = ['left', 'top', 'right'];  // 自家=bottom 以外の3席
  // ランダムに 2席選択 → 残り1席が空席
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return {
    cpuSeats: [shuffled[0], shuffled[1]].sort(),
    emptySeat: shuffled[2],
  };
}

// ─── 局開始 ────────────────────────────────
function startNewRound() {
  // CPU 配置を半荘ごとに変えるなら 半荘開始時のみ。 各局は同じ配置で続ける。
  if (!G.cpuSeats || G.cpuSeats.length === 0) {
    const placement = pickCpuPlacement();
    G.cpuSeats = placement.cpuSeats;
    G.emptySeat = placement.emptySeat;
  }

  const allTiles = buildAllTiles();
  G.walls = buildWalls(allTiles);
  G.rivers = { bottom: [], right: [], top: [], left: [] };
  G.kitas = { bottom: 0, right: 0, top: 0, left: 0 };
  G.hands = { bottom: [], right: [], top: [], left: [] };
  G.turn = G.oya;
  G.selected = null;
  G.justDrawn = null;
  G.busy = false;
  G.startSeat = null;
  G.diceTotal = 0;
  G.cutPosInStart = 0;
  G.kingTiles = [];
  G.drawTiles = [];
  G.doraIndicator = null;
  renderAll();

  if (localStorage.getItem('omoroi-guide-done')) {
    setTimeout(showDiceCeremony, 400);
  }
}

// ─── サイコロ セレモニー ─────────────────────
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const SEAT_NAME_FOR_DICE = { bottom: 'あなた (自家)', right: '下家', top: '対面', left: '上家' };

async function showDiceCeremony() {
  const overlay = document.getElementById('dice-overlay');
  const d1El = document.getElementById('dice-1');
  const d2El = document.getElementById('dice-2');
  const totalEl = document.getElementById('dice-total');
  const explainEl = document.getElementById('dice-explain');
  const counterEl = document.getElementById('dice-counter');
  const counterNumEl = document.getElementById('dice-counter-num');
  const mnemonicEl = document.getElementById('dice-mnemonic');
  const okBtn = document.getElementById('dice-ok');
  const titleEl = document.getElementById('dice-title');
  if (!overlay) return;

  overlay.hidden = false;
  okBtn.hidden = true;
  counterEl.hidden = true;
  if (mnemonicEl) mnemonicEl.hidden = true;
  totalEl.textContent = '?';
  d1El.classList.add('dice--rolling');
  d2El.classList.add('dice--rolling');
  titleEl.textContent = '🎲 サイコロを振ります';
  explainEl.textContent = 'サイコロが転がっています…';

  const rollInterval = setInterval(() => {
    d1El.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
    d2El.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
  }, 80);
  await sleep(1200);
  clearInterval(rollInterval);

  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2;
  d1El.textContent = DICE_FACES[d1 - 1];
  d2El.textContent = DICE_FACES[d2 - 1];
  d1El.classList.remove('dice--rolling');
  d2El.classList.remove('dice--rolling');
  totalEl.textContent = total;
  G.diceTotal = total;

  // サイコロ結果を 山に適用
  const r = applyDice(G.walls, total);
  G.startSeat = r.startSeat;
  G.cutPosInStart = r.cutPosInStart;
  G.kingTiles = r.kingTiles;
  G.drawTiles = r.drawTiles;
  G.doraIndicator = r.doraIndicator;

  await sleep(400);
  titleEl.textContent = `合計 ${total}!`;
  explainEl.textContent = `親 (あなた) から反時計回りに ${total} 番目 = 「${SEAT_NAME_FOR_DICE[r.startSeat]}」 の山から決めます`;
  if (mnemonicEl) mnemonicEl.hidden = false;
  await sleep(2200);

  counterEl.hidden = false;
  titleEl.textContent = '👉 起点家の山の右端から数えます';
  explainEl.textContent = `右端から ${total} 牌 数えた位置で カット → 右側 14牌が「王牌」、 王牌の右から3枚目が「ドラ表示」`;

  const wallEl = document.getElementById(`wall-${r.startSeat}`);
  const tiles = wallEl ? Array.from(wallEl.querySelectorAll('.wall-tile')) : [];
  const startIdx = tiles.length - 1;
  for (let n = 1; n <= total && n <= tiles.length; n++) {
    counterNumEl.textContent = n;
    const t = tiles[startIdx - n + 1];
    if (t) {
      t.classList.add('wall-tile--counting');
      setTimeout(() => {
        t.classList.remove('wall-tile--counting');
        if (n === total) t.classList.add('wall-tile--cut-line');
        else t.classList.add('wall-tile--king');
      }, 350);
    }
    await sleep(380);
  }
  await sleep(500);
  titleEl.textContent = '✨ 王牌+ドラ表示 決定!';
  explainEl.textContent = `カット位置 (赤) より右が王牌14牌。 ドラ表示は 中央 に表示されています。`;
  counterEl.hidden = true;
  okBtn.hidden = false;
}

function closeDiceCeremony() {
  document.getElementById('dice-overlay').hidden = true;
  // 配牌実施
  const dealt = dealHands(G.drawTiles, G.oya, G.cpuSeats, G.emptySeat);
  G.hands = dealt.hands;
  G.drawTiles = dealt.drawTilesRemain;
  renderAll();
  setTimeout(() => startTurn(), 200);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── トースト ──────────────────────────────
let toastTimer = null;
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ─── オンボーディング ───────────────────────
const GUIDE_STEPS = [
  { title: '配牌完了!', text: '画面下=「あなた (親、 東家)」、 左=上家、 上=対面、 右=下家。 三麻なので 他家は2人で、 残り1家は空席ですが 山だけあります。' },
  { title: '🎲 サイコロで起点家+カット位置', text: '親がサイコロ2個を振り、 出目で 起点家を決定 + 起点家の山の右端から出目数ズラした位置で カット → 右側14牌が王牌、 右から3枚目がドラ表示。' },
  { title: '🟡 卓全体で1つの山', text: '4家それぞれ前に27牌の山。 ツモは 起点家のカット位置から反時計回りに進みます。' },
  { title: '🀃 北抜き', text: '北 (🀃) を引いたら「北抜き」 で抜き、 王牌末尾 (嶺上) から補充自摸。 抜くたび1翻 (関西ルール)。' },
  { title: '✨ 全部赤ドラ', text: '5筒×4枚 + 5索×4枚 = 計8枚 全赤ドラ。 引いただけで 1翻ずつ加算。' },
  { title: 'はじめよう!', text: '牌タップ→「打牌」 で捨てる。 ターンは 反時計回り (あなた→下家→対面→上家)、 空席はスキップ。 3・3・3・3・2 を作るのが目的!' }
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
  if (G.hands.bottom && G.hands.bottom.length === 0 && !G.busy) {
    setTimeout(showDiceCeremony, 300);
  }
}

// ─── ロビー版本 ────────────────────────────
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
  } catch (e) { console.warn(e); }
}
if (document.getElementById('app-version')) {
  document.addEventListener('DOMContentLoaded', loadLobbyVersion);
}

// ─── ゲーム初期化 ─────────────────────────
function initGame() {
  const params = new URLSearchParams(location.search);
  G.mode = params.get('mode') || 'cpu';
  G.type = params.get('type') || 'hanchan';
  G.round = '東1';
  G.honba = 0;
  G.oya = 'bottom';
  G.cpuSeats = [];
  G.emptySeat = null;

  startNewRound();

  if (!localStorage.getItem('omoroi-guide-done')) {
    setTimeout(showGuide, 500);
  }
}

if (document.getElementById('table')) {
  document.addEventListener('DOMContentLoaded', () => {
    initGame();
    document.getElementById('guide-next')?.addEventListener('click', () => {
      guideIdx++;
      if (guideIdx >= GUIDE_STEPS.length) finishGuide();
      else renderGuideStep();
    });
    document.getElementById('guide-skip')?.addEventListener('click', finishGuide);
    document.getElementById('guide-btn')?.addEventListener('click', showGuide);
    document.getElementById('btn-discard').addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy || !G.selected) return;
      const tile = G.selected;
      discardTile('bottom', tile);
      toast(`あなたが ${TILE_NAMES[tile.id]} を打牌`);
      renderAll();
      setTimeout(() => { nextTurn(); startTurn(); }, 350);
    });
    document.getElementById('btn-kita').addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy) return;
      kitaNuki('bottom');
      renderAll();
    });
    document.getElementById('end-next')?.addEventListener('click', nextRound);
    document.getElementById('dice-ok')?.addEventListener('click', closeDiceCeremony);
  });
}

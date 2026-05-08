// おもろい三麻 — Phase 1 MVP (v0.1.0)
// ロビー + 配牌 + 円卓レイアウト 描画 まで

// ─── 牌定義 ─────────────────────────────────────
// 牌ID 0-26 (種類別)、 各 4枚 = 全 108牌 (Sanma)
// 0: 1m, 1: 9m  (萬子は1/9のみ、 三麻ルール)
// 2-10: 1p-9p   (筒子)
// 11-19: 1s-9s  (索子)
// 20-26: 東/南/西/北/白/發/中
const TILE_NAMES = [
  '一萬', '九萬',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '一索', '二索', '三索', '四索', '五索', '六索', '七索', '八索', '九索',
  '東', '南', '西', '北', '白', '發', '中'
];
// Unicode Mahjong Tiles (U+1F000-U+1F02B) — 簡易表示
const TILE_UNICODE = [
  '🀇', '🀏',                                  // 1m, 9m
  '🀙', '🀚', '🀛', '🀜', '🀝', '🀞', '🀟', '🀠', '🀡',  // 1p-9p
  '🀐', '🀑', '🀒', '🀓', '🀔', '🀕', '🀖', '🀗', '🀘',  // 1s-9s
  '🀀', '🀁', '🀂', '🀃', '🀆', '🀅', '🀄'           // 東南西北白發中
];
// 赤ドラ判定: 5筒 (id=6) と 5索 (id=15) の 全4枚 = 計8枚 (野沢さん指定 2026-05-08)
const RED_DORA_IDS = new Set([6, 15]);

// ─── 牌山生成 (Fisher-Yates) ────────────────────
function buildWall() {
  // 各種4枚で 計108牌
  const wall = [];
  for (let id = 0; id < 27; id++) {
    for (let copy = 0; copy < 4; copy++) {
      wall.push({ id, copy, isRed: RED_DORA_IDS.has(id) });
    }
  }
  // Fisher-Yates シャッフル
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// ─── 配牌 ────────────────────────────────────────
function deal(wall) {
  // 三麻: 各家 13牌、 親 (自分=p0) は 14牌目を即自摸
  // 残りは 王牌 14牌 (ドラ表示+嶺上) + 自摸山
  const hands = { p0: [], p1: [], p2: [] };
  let idx = 0;
  for (let round = 0; round < 4; round++) {
    for (const p of ['p0', 'p1', 'p2']) {
      const n = round < 3 ? 4 : 1;  // 4-4-4-1 配牌 (合計13)
      for (let k = 0; k < n; k++) hands[p].push(wall[idx++]);
    }
  }
  // 親 自摸 1牌 追加 → 14牌
  hands.p0.push(wall[idx++]);

  // 王牌: 山の末尾14牌
  const kingWall = wall.slice(wall.length - 14);
  const drawWall = wall.slice(idx, wall.length - 14);
  // ドラ表示牌 = 王牌の上段右から3枚目 (kingWall[10]) 慣例
  const doraIndicator = kingWall[10];

  return { hands, drawWall, kingWall, doraIndicator };
}

// ─── 牌ソート ───────────────────────────────────
function sortHand(hand) {
  return [...hand].sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id;
    return a.copy - b.copy;
  });
}

// ─── 牌 → DOM Element ──────────────────────────
function createTileEl(tile, options = {}) {
  const el = document.createElement('div');
  el.className = 'tile';
  if (options.small) el.classList.add('tile--small');
  if (options.mini)  el.classList.add('tile--mini');
  if (options.mine)  el.classList.add('tile--mine');
  if (options.back) {
    el.classList.add('tile--back');
    el.textContent = '🀫';
  } else {
    el.textContent = TILE_UNICODE[tile.id];
    el.title = TILE_NAMES[tile.id] + (tile.isRed ? ' (赤ドラ)' : '');
    if (tile.isRed) el.classList.add('tile--red');
  }
  el.dataset.tileId = tile.id;
  el.dataset.tileCopy = tile.copy;
  return el;
}

// ─── 描画 ───────────────────────────────────────
function renderHand(containerId, hand, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const sorted = options.back ? hand : sortHand(hand);
  for (const tile of sorted) {
    container.appendChild(createTileEl(tile, options));
  }
}

function renderKingWall(king, doraIndicator) {
  const tilesEl = document.getElementById('king-tiles');
  if (!tilesEl) return;
  tilesEl.innerHTML = '';
  // 簡易表示: 王牌14牌のうち ドラ表示1牌だけ表向き、 残りは伏せ (mini サイズ)
  for (let i = 0; i < king.length; i++) {
    const isDora = (king[i] === doraIndicator);
    tilesEl.appendChild(createTileEl(king[i], { mini: true, back: !isDora }));
  }
}

function updateRemain(remain) {
  document.getElementById('wall-count').textContent = remain;
  document.getElementById('game-remain').textContent = `山残: ${remain}`;
}

// ─── ゲーム初期化 ────────────────────────────────
function initGame() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'cpu';      // cpu | online
  const type = params.get('type') || 'hanchan';  // hanchan | single

  const wall = buildWall();
  const { hands, drawWall, kingWall, doraIndicator } = deal(wall);

  // 描画
  renderHand('hand-bottom', hands.p0, { mine: true });
  renderHand('hand-top', hands.p1, { back: true, small: true });
  renderHand('hand-right', hands.p2, { back: true, small: true });
  renderKingWall(kingWall, doraIndicator);
  updateRemain(drawWall.length);

  // 状態は global に置いておく (Phase 1 はシンプルに)
  window.__game = { mode, type, wall, drawWall, kingWall, doraIndicator, hands, turn: 'p0' };

  console.log('[omoroi-sanma] 配牌完了', window.__game);

  // オンボーディング (初回のみ)
  if (!localStorage.getItem('omoroi-guide-done')) {
    showGuide();
  }
}

// ─── オンボーディング ───────────────────────────
const GUIDE_STEPS = [
  { title: '配牌完了!', text: '手牌13牌+ツモ1牌が配られました。 画面下が「あなた」、 上が「CPU上家」、 右が「CPU下家」 です。' },
  { title: '🀙 中央=山', text: '画面中央の「山」 から、 ツモる順に牌を引きます。 山残り枚数が右上に表示されます。' },
  { title: '🀫 王牌とドラ表示', text: '中央の点線枠が「王牌 (王様の牌)」 14枚。 1枚だけ表向きの牌が「ドラ表示」 で、 その次の牌が「ドラ」 (1翻 加算) になります。' },
  { title: '🀃 北抜き', text: '北 (西家の風) を引いたら 「北抜き」 ボタンで抜けます。 抜くたび 1翻、 嶺上 (王牌の右) から補充自摸。 関西ルール。' },
  { title: '✨ 全部赤ドラ', text: '5筒×4枚 + 5索×4枚 の 計8枚は 全部赤ドラ。 引いただけで 1翻ずつ 加算 = 高翻数で気持ちよく勝てる仕様。' },
  { title: 'はじめよう!', text: '3・3・3・3・2 の ペア (4面子+1雀頭) を作るのが目的。 役を覚えなくても、 揃えれば あがれます。 ガイドはいつでも 右上の📚 から再表示できます。' }
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
}

// ─── イベント結線 (game.html only) ─────────────────
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
  });
}

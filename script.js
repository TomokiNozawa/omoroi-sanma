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
  cpuSeats: [],
  emptySeat: null,
  walls: { bottom: [], right: [], top: [], left: [] },
  drawTiles: [],
  kingTiles: [],
  doraIndicator: null,
  startSeat: null,
  cutPosInStart: 0,  // = サイコロ目X (= カット位置 = 該当家山の右端からX幢目)
  diceTotal: 0,
  doraSeat: null,
  doraDouIdx: -1,
  kingDouInStart: 0,  // 起点家側の王牌幢数 (1〜7)
  kingDouInNext: 0,   // 隣家側の王牌幢数 (0〜6、 サイコロ目<8 の場合)
  hands: { bottom: [], right: [], top: [], left: [] },
  rivers: { bottom: [], right: [], top: [], left: [] },
  kitas: { bottom: 0, right: 0, top: 0, left: 0 },
  turn: 'bottom',
  selected: null,
  justDrawn: null,
  busy: false,
  // リーチ状態
  isRiichi: { bottom: false, right: false, top: false, left: false },
  riichiTurnsLeft: { bottom: 0, right: 0, top: 0, left: 0 }, // 一発カウント
  // 点数 (簡易: 各家 35000スタート、 三麻=3人 + 空席は0)
  scores: { bottom: 35000, right: 35000, top: 35000, left: 35000 },
  // ロン保留 (他家打牌直後に 自家があがれる場合 設定)
  pendingRon: null,  // { fromSeat, tile } or null
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

// ─── 4面均等で 27牌ずつ 「幢」 ベースに 配置 ─────────
// 各家 = 14幢 (= 上段14 + 下段13、 14幢目 (左端) のみ単独上段、 1〜13幢目は 上下2牌セット)
// walls[seat] は 27要素の配列、 index = 「右端から左へ、 各幢 上→下」 順
//   index 0 = 1幢目(右端)上段、 index 1 = 1幢目下段、 index 2 = 2幢目上段、 ...
//   index 24 = 13幢目上段、 index 25 = 13幢目下段、 index 26 = 14幢目(左端)上段単独
// ヘルパー: ある幢index (0-13) と 段 (top/bot) から 配列 index を求める / 逆
function douToArrIdx(douIdx, dan) {
  if (douIdx === 13) return 26;  // 14幢目 (左端) は 上段単独
  return douIdx * 2 + (dan === 'top' ? 0 : 1);
}
function buildWallSlice(allTiles, start) {
  return allTiles.slice(start, start + 27);
}
function buildWalls(allTiles) {
  return {
    bottom: buildWallSlice(allTiles, 0),
    right:  buildWallSlice(allTiles, 27),
    top:    buildWallSlice(allTiles, 54),
    left:   buildWallSlice(allTiles, 81),
  };
}

// ─── サイコロを振って カット位置 + 王牌 + 自摸山を決定 ──
// 三麻4面均等 (各家27牌) の 14幢構造:
//   各家 = 1〜13幢ペア (= 26牌) + 14単独上段 (1牌、 山左端の 嶺上枠扱いで 王牌外)
//   ※ 14単独 は 王牌・ドラ計算から 完全隔離 → 常に「自摸山」 として消費される
// ルール:
//   1) サイコロ目X → 起点家 = 親から反時計回りにX番目
//   2) カット位置 = 起点家山の 右端から X幢目と X+1幢目の境界
//   3) ドラ表示牌 = 山の **右端から (X-3) 幢目の上段** (1-based)
//      X=8→5幢目 (野沢さん図と一致)、 X=12→9幢目、 X<4→隣家にまたがる
//   4) 王牌 = ドラを中心に 7幢ペア (= 14牌、 必ず1〜13幢の中で 完結)
function applyDice(walls, diceTotal, oyaSeat = 'bottom') {
  const oyaCcw = ccwFrom(oyaSeat);
  const startSeat = oyaCcw[(diceTotal - 1) % 4];
  const ccw = ccwFrom(startSeat);
  const X = diceTotal;

  // 起点家視点の 通し番号 (1-based、 1〜13 = 起点家、 0以下 = 隣家にまたがる)
  // 隣家へまたがる時、 g=0 → 隣家13幢目、 g=-1 → 隣家12幢目、 ...
  // ※ 14単独 (douIdx0=13) は **常にスキップ**、 13幢目から 反時計回り次家へ 連続
  function gToPos(g) {
    if (g >= 1 && g <= 13) return { seat: startSeat, douIdx0: g - 1 };
    if (g <= 0) return { seat: ccw[1], douIdx0: 13 + g - 1 };  // g=0→12 (=隣家13幢目)
    if (g >= 14) return { seat: ccw[3], douIdx0: g - 14 - 1 };  // g=14→-1 (= 範囲外)、 通常は起こらない
    return null;
  }

  // ドラ位置 (1-based 通し番号 = X-3)
  const doraGlobal = X - 3;
  const dorPos = gToPos(doraGlobal);
  const doraSeat = dorPos.seat;
  const doraDouIdx = dorPos.douIdx0;
  const doraIndicator = walls[doraSeat][douToArrIdx(doraDouIdx, 'top')];

  // 王牌 = ドラ中心 7幢ペア (= 14牌、 全部 1〜13幢の中で取れる)
  // 王牌幢の通し番号: doraGlobal-4 〜 doraGlobal+2 (各幢ペア=2牌)
  const kingPosList = [];
  const kingTiles = [];
  for (let g = doraGlobal - 4; g <= doraGlobal + 2; g++) {
    const pos = gToPos(g);
    if (!pos) continue;
    kingPosList.push(pos);
    kingTiles.push(walls[pos.seat][douToArrIdx(pos.douIdx0, 'top')]);
    kingTiles.push(walls[pos.seat][douToArrIdx(pos.douIdx0, 'bot')]);
  }
  // 検証: kingTiles 必ず 14牌 (= 7幢×2)

  // 自摸山 = 全108牌 - 王牌14牌 = 94牌
  // ツモ順: カット位置の左隣 (= 起点家のX+1幢目 = 0-based X) から 反時計回り、 各幢 上→下
  const kingSet = new Set(kingPosList.map(p => `${p.seat}#${p.douIdx0}`));
  const drawTiles = [];
  function addAllExceptKing(seat, douIdx0) {
    if (kingSet.has(`${seat}#${douIdx0}`)) return;
    drawTiles.push(walls[seat][douToArrIdx(douIdx0, 'top')]);
    if (douIdx0 !== 13) drawTiles.push(walls[seat][douToArrIdx(douIdx0, 'bot')]);
  }
  // (1) 起点家: (X+1)幢目 〜 13幢目 + 14単独
  for (let d = X; d <= 13; d++) addAllExceptKing(startSeat, d);
  // (2) ccw[1] (隣家): 1幢目 〜 14単独
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[1], d);
  // (3) ccw[2]: 同
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[2], d);
  // (4) ccw[3]: 同
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[3], d);
  // (5) 起点家: 1幢目 〜 X幢目 (王牌外の残り)
  for (let d = 0; d <= X - 1; d++) addAllExceptKing(startSeat, d);

  return { startSeat, cutPosInStart: X, kingTiles, drawTiles, doraIndicator,
           doraSeat, doraDouIdx, kingPosList };
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

// ============================================================
// 役判定 + あがり判定 モジュール
// ============================================================

// 牌IDから 種別判定
const isYaochuId = (id) => id === 0 || id === 1 || id === 2 || id === 10 || id === 11 || id === 19 || (id >= 20 && id <= 26);
const isJihaiId = (id) => id >= 20 && id <= 26;
const isPinId = (id) => id >= 2 && id <= 10;
const isSouId = (id) => id >= 11 && id <= 19;
const isManId = (id) => id === 0 || id === 1;

// 牌の数字 (1-9) を取得 (筒索のみ、 萬子は1or9、 字牌はnull)
function tileNum(id) {
  if (id === 0) return 1;
  if (id === 1) return 9;
  if (isPinId(id)) return id - 1;  // 2..10 → 1..9
  if (isSouId(id)) return id - 10;  // 11..19 → 1..9
  return null;  // 字牌
}

// hand → counts (id → count)
function countTiles(hand) {
  const c = {};
  for (const t of hand) c[t.id] = (c[t.id] || 0) + 1;
  return c;
}

// 順子(連続3枚)が可能な id (連続2枚先まで取れる位置)
const SHUNTSU_HEAD_IDS = [
  // 筒子: 1-7p (id 2-8 が頭、 8-9 を経由可)
  2, 3, 4, 5, 6, 7, 8,
  // 索子: 1-7s (id 11-17)
  11, 12, 13, 14, 15, 16, 17,
];

// 残り牌をN面子に分解できるか (再帰)
function canMakeMelds(counts, n) {
  if (n === 0) {
    for (const k in counts) if (counts[k] > 0) return false;
    return true;
  }
  // 最小ID の牌を処理対象
  const ids = Object.keys(counts).filter(k => counts[k] > 0).map(Number).sort((a, b) => a - b);
  if (ids.length === 0) return n === 0;
  const id = ids[0];
  // 刻子
  if (counts[id] >= 3) {
    counts[id] -= 3;
    if (canMakeMelds(counts, n - 1)) { counts[id] += 3; return true; }
    counts[id] += 3;
  }
  // 順子 (筒/索のみ、 連続3枚)
  if (SHUNTSU_HEAD_IDS.includes(id) && counts[id + 1] > 0 && counts[id + 2] > 0) {
    counts[id]--; counts[id + 1]--; counts[id + 2]--;
    if (canMakeMelds(counts, n - 1)) { counts[id]++; counts[id + 1]++; counts[id + 2]++; return true; }
    counts[id]++; counts[id + 1]++; counts[id + 2]++;
  }
  return false;
}

// 標準形 (4面子+1雀頭) で あがり形か
function isStandardWin(hand) {
  const counts = countTiles(hand);
  for (const idStr of Object.keys(counts)) {
    const id = Number(idStr);
    if (counts[id] >= 2) {
      counts[id] -= 2;
      if (canMakeMelds({ ...counts }, 4)) { counts[id] += 2; return true; }
      counts[id] += 2;
    }
  }
  return false;
}

// 七対子 (7種ペア)
function isChiitoitsu(hand) {
  if (hand.length !== 14) return false;
  const counts = countTiles(hand);
  let pairs = 0;
  for (const id in counts) {
    if (counts[id] === 2) pairs++;
    else return false;
  }
  return pairs === 7;
}

// 国士無双 (1m9m1p9p1s9s + 字7種、 ペア1組)
const KOKUSHI_IDS = [0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26];
function isKokushi(hand) {
  if (hand.length !== 14) return false;
  const counts = countTiles(hand);
  let hasPair = false;
  for (const id of KOKUSHI_IDS) {
    if (!counts[id]) return false;
    if (counts[id] === 2) hasPair = true;
    else if (counts[id] > 2) return false;
  }
  return hasPair;
}

// あがり形か
function isWinning(hand) {
  if (hand.length !== 14) return false;
  if (isKokushi(hand)) return true;
  if (isChiitoitsu(hand)) return true;
  return isStandardWin(hand);
}

// タンヤオ (2-8 のみ、 1/9/字牌なし)
function isTanyao(hand) {
  return hand.every(t => !isYaochuId(t.id));
}

// 混一色 (1色+字牌)、 純の字牌のみ・1色のみは除外
function isHonitsu(hand) {
  let hasMan = false, hasPin = false, hasSou = false, hasJi = false;
  for (const t of hand) {
    if (isManId(t.id)) hasMan = true;
    else if (isPinId(t.id)) hasPin = true;
    else if (isSouId(t.id)) hasSou = true;
    else if (isJihaiId(t.id)) hasJi = true;
  }
  const colorCount = (hasMan ? 1 : 0) + (hasPin ? 1 : 0) + (hasSou ? 1 : 0);
  return colorCount === 1 && hasJi;
}

// 清一色 (1色のみ、 字牌なし)
function isChinitsu(hand) {
  let hasMan = false, hasPin = false, hasSou = false, hasJi = false;
  for (const t of hand) {
    if (isManId(t.id)) hasMan = true;
    else if (isPinId(t.id)) hasPin = true;
    else if (isSouId(t.id)) hasSou = true;
    else if (isJihaiId(t.id)) hasJi = true;
  }
  if (hasJi) return false;
  const colorCount = (hasMan ? 1 : 0) + (hasPin ? 1 : 0) + (hasSou ? 1 : 0);
  return colorCount === 1;
}

// 対々和 (4刻子+1雀頭、 順子なし) — 標準形あがり前提
function isToitoi(hand) {
  const counts = countTiles(hand);
  let kotsu = 0, pair = 0;
  for (const id in counts) {
    if (counts[id] === 3) kotsu++;
    else if (counts[id] === 2) pair++;
    else return false;
  }
  return kotsu === 4 && pair === 1;
}

// 三暗刻 (3つの暗刻、 自摸限定で簡略化)
function countAnkoCount(hand) {
  const counts = countTiles(hand);
  let n = 0;
  for (const id in counts) if (counts[id] === 3 || counts[id] === 4) n++;
  return n;
}

// 役牌 (三元牌、 場風東、 自風東 — 親なら自風東で 重複なら2翻)
const SAN_GEN_IDS = [24, 25, 26]; // 白發中
function countYakuhai(hand, context) {
  const counts = countTiles(hand);
  const yakus = [];
  for (const id of SAN_GEN_IDS) {
    if ((counts[id] || 0) >= 3) {
      yakus.push({ name: TILE_NAMES[id], han: 1 });
    }
  }
  // 場風 = 東 (id=20) を簡略 (東場のみ実装、 南場は省略)
  // 自風 = 親=東 (id=20) — 三麻だが 簡略
  if ((counts[20] || 0) >= 3) {
    if (context.round && context.round.startsWith('東')) {
      yakus.push({ name: '場風 東', han: 1 });
    }
    // 親なら自風東
    if (context.isOya) {
      yakus.push({ name: '自風 東', han: 1 });
    }
  }
  return yakus;
}

// 役満系 (簡易): 四暗刻、 字一色、 緑一色、 清老頭、 大三元、 国士無双
function checkYakuman(hand, context) {
  const ymList = [];
  if (isKokushi(hand)) ymList.push({ name: '国士無双', han: 13 });
  // 四暗刻 (4暗刻+雀頭、 ツモ限定で簡略)
  if (context.isTsumo) {
    const counts = countTiles(hand);
    let ankoCount = 0, pair = 0;
    let valid = true;
    for (const id in counts) {
      if (counts[id] === 3) ankoCount++;
      else if (counts[id] === 2) pair++;
      else { valid = false; break; }
    }
    if (valid && ankoCount === 4 && pair === 1) {
      ymList.push({ name: '四暗刻', han: 13 });
    }
  }
  // 字一色 (全部字牌)
  if (hand.every(t => isJihaiId(t.id))) ymList.push({ name: '字一色', han: 13 });
  // 清老頭 (1m/9m/1p/9p/1s/9s のみ)
  const RYOUTOU_IDS = new Set([0, 1, 2, 10, 11, 19]);
  if (hand.every(t => RYOUTOU_IDS.has(t.id))) ymList.push({ name: '清老頭', han: 13 });
  // 緑一色 (索子 2,3,4,6,8 + 發 のみ)
  const RYUUIISO_IDS = new Set([12, 13, 14, 16, 18, 25]);
  if (hand.every(t => RYUUIISO_IDS.has(t.id))) ymList.push({ name: '緑一色', han: 13 });
  // 大三元 (白發中 全部刻子)
  const counts = countTiles(hand);
  if ((counts[24] || 0) >= 3 && (counts[25] || 0) >= 3 && (counts[26] || 0) >= 3) {
    ymList.push({ name: '大三元', han: 13 });
  }
  return ymList;
}

// ドラ計算 (表示牌の次が ドラ)
function nextTileId(id) {
  if (id === 0) return 1;  // 1m → 9m? 三麻流派、 簡略: 1m→9m
  if (id === 1) return 0;  // 9m → 1m
  if (isPinId(id)) return id === 10 ? 2 : id + 1;  // 9p → 1p
  if (isSouId(id)) return id === 19 ? 11 : id + 1;
  // 字牌: 東南西北 / 白發中
  if (id === 20) return 21; // 東→南
  if (id === 21) return 22; // 南→西
  if (id === 22) return 23; // 西→北
  if (id === 23) return 20; // 北→東
  if (id === 24) return 25; // 白→發
  if (id === 25) return 26; // 發→中
  if (id === 26) return 24; // 中→白
  return null;
}

function countDora(hand, doraIndicator) {
  if (!doraIndicator) return 0;
  const doraId = nextTileId(doraIndicator.id);
  return hand.filter(t => t.id === doraId).length;
}

// ─── 役判定 メイン ─────────────────────────
function calcYaku(hand, context) {
  // context: { isTsumo, isRiichi, isOya, doraIndicator, kitas, round }
  const yakuList = [];
  let han = 0;
  let isYakuman = false;

  if (!isWinning(hand)) {
    return { yakuList: [], han: 0, isYakuman: false, error: 'あがり形ではありません' };
  }

  // 役満チェック (優先)
  const yms = checkYakuman(hand, context);
  if (yms.length > 0) {
    for (const ym of yms) yakuList.push(ym);
    return { yakuList, han: 13 * yms.length, isYakuman: true };
  }

  // 七対子チェック
  if (isChiitoitsu(hand)) {
    yakuList.push({ name: '七対子', han: 2 });
    han += 2;
  } else {
    // 標準形の役
    if (isToitoi(hand)) { yakuList.push({ name: '対々和', han: 2 }); han += 2; }
    const ankoCount = countAnkoCount(hand);
    if (ankoCount >= 3 && context.isTsumo) { yakuList.push({ name: '三暗刻', han: 2 }); han += 2; }
    // 役牌
    const yakuhai = countYakuhai(hand, context);
    for (const y of yakuhai) { yakuList.push(y); han += y.han; }
  }

  // タンヤオ・混一色・清一色 (両形共通)
  if (isTanyao(hand)) { yakuList.push({ name: 'タンヤオ', han: 1 }); han += 1; }
  if (isHonitsu(hand)) { yakuList.push({ name: '混一色', han: 3 }); han += 3; }
  if (isChinitsu(hand)) { yakuList.push({ name: '清一色', han: 6 }); han += 6; }

  // 立直・一発・門前清自摸
  if (context.isRiichi) { yakuList.push({ name: '立直', han: 1 }); han += 1; }
  if (context.isIppatsu) { yakuList.push({ name: '一発', han: 1 }); han += 1; }
  if (context.isTsumo) { yakuList.push({ name: '門前清自摸和', han: 1 }); han += 1; }

  // ドラ計算 (表ドラ + 赤ドラ + 北ドラ)
  const doraCount = countDora(hand, context.doraIndicator);
  if (doraCount > 0) { yakuList.push({ name: 'ドラ', han: doraCount }); han += doraCount; }
  const akaCount = hand.filter(t => t.isRed).length;
  if (akaCount > 0) { yakuList.push({ name: '赤ドラ', han: akaCount }); han += akaCount; }
  if (context.kitas > 0) { yakuList.push({ name: `北抜き×${context.kitas}`, han: context.kitas }); han += context.kitas; }

  // 役なし? (役牌・タンヤオ等 1翻役以上が必要、 ドラ・北だけでは役なし)
  // ただし簡略化: 1翻以上あれば OK とする
  const yakuOnly = yakuList.filter(y => !y.name.startsWith('ドラ') && !y.name.startsWith('赤ドラ') && !y.name.startsWith('北抜き'));
  if (yakuOnly.length === 0) {
    return { yakuList, han, isYakuman: false, error: '役なし (ドラ・北抜きだけではあがれません)' };
  }

  return { yakuList, han, isYakuman: false };
}

// ─── 翻数 → 名前 ─────────────────────────
function hanToTier(han, isYakuman) {
  if (isYakuman) return '役満';
  if (han >= 13) return '数え役満';
  if (han >= 11) return '三倍満';
  if (han >= 8) return '倍満';
  if (han >= 6) return '跳満';
  if (han >= 5) return '満貫';
  return `${han}翻`;
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

// ─── 描画: 山 (麻雀正規ルール — 各家14幢 = 上段14+下段13、 右端=1幢目から消費) ─
// レイアウト: 各家 14列×2行の grid (14幢目=左端のみ上段単独)
// 消費順: ① 起点家の 自摸山部分 (幢 X-1..13) を 「同一幢の上→下 → 次幢の上→下 → ...」 で取る
//         ② 隣家 (ccw[1]): 王牌で使った幢 (0..kingDouInNext-1) を除く 残幢 (kingDouInNext..13) を取る
//         ③ ccw[2], ccw[3]: 全 14幢 を 取る
function renderWalls() {
  const totalRemain = G.drawTiles.length;
  // 配牌+ツモで消費した牌の数 = (108 - 14王牌) - 残自摸山
  const consumedTotal = totalRemain > 0 ? (94 - totalRemain) : 0;

  const ccw = G.startSeat ? ccwFrom(G.startSeat) : ALL_SEATS;
  const X = G.cutPosInStart || 0;  // サイコロ目
  const kingDouInStart = G.kingDouInStart || 0;
  const kingDouInNext = G.kingDouInNext || 0;
  const doraSeat = G.doraSeat;
  const doraDouIdx = (typeof G.doraDouIdx === 'number') ? G.doraDouIdx : -1;

  // 各家の 「自摸山として 取る順」 リスト = [{douIdx, dan}, ...] (取られる順、 0番目が次にツモられる)
  const drawOrderPerSeat = { bottom: [], right: [], top: [], left: [] };
  if (X > 0) {
    // (a) 起点家
    for (let d = X - 1; d <= 13; d++) {
      drawOrderPerSeat[ccw[0]].push({ douIdx: d, dan: 'top' });
      if (d !== 13) drawOrderPerSeat[ccw[0]].push({ douIdx: d, dan: 'bot' });
    }
    // (b) 隣家
    for (let d = kingDouInNext; d <= 13; d++) {
      drawOrderPerSeat[ccw[1]].push({ douIdx: d, dan: 'top' });
      if (d !== 13) drawOrderPerSeat[ccw[1]].push({ douIdx: d, dan: 'bot' });
    }
    // (c) ccw[2], ccw[3]
    for (let i = 2; i <= 3; i++) {
      for (let d = 0; d <= 13; d++) {
        drawOrderPerSeat[ccw[i]].push({ douIdx: d, dan: 'top' });
        if (d !== 13) drawOrderPerSeat[ccw[i]].push({ douIdx: d, dan: 'bot' });
      }
    }
  }

  // 各家ごと、 何牌消費されたか
  let remaining = consumedTotal;
  const consumedPerSeat = { bottom: 0, right: 0, top: 0, left: 0 };
  for (let i = 0; i < 4; i++) {
    const seat = ccw[i] || ALL_SEATS[i];
    const max = drawOrderPerSeat[seat].length;
    const used = Math.min(remaining, max);
    consumedPerSeat[seat] = used;
    remaining -= used;
  }

  // 王牌の判定: 起点家の 0..kingDouInStart-1 幢 (上下両方) + 隣家の 0..kingDouInNext-1 幢 (上下両方)
  function isKing(seat, douIdx, dan) {
    if (seat === ccw[0] && douIdx >= 0 && douIdx < kingDouInStart) return true;
    if (seat === ccw[1] && douIdx >= 0 && douIdx < kingDouInNext) return true;
    return false;
  }

  ALL_SEATS.forEach(seat => {
    const container = document.getElementById(`wall-${seat}`);
    if (!container) return;
    container.innerHTML = '';

    // 「消費済」 set を 構築 (この家の draw order の 先頭 consumedPerSeat[seat] 個)
    const drawOrder = drawOrderPerSeat[seat];
    const consumedHere = consumedPerSeat[seat];
    const consumedSet = new Set();
    for (let i = 0; i < consumedHere && i < drawOrder.length; i++) {
      consumedSet.add(`${drawOrder[i].douIdx}-${drawOrder[i].dan}`);
    }
    // 「次にツモる位置」 = drawTiles[0] が この家の山にあれば その位置
    let nextDraw = null;
    if (G.drawTiles && G.drawTiles.length > 0) {
      const nextTile = G.drawTiles[0];
      const idx = G.walls[seat].indexOf(nextTile);
      if (idx >= 0) {
        if (idx === 26) nextDraw = { douIdx: 13, dan: 'top' };
        else nextDraw = { douIdx: Math.floor(idx / 2), dan: (idx % 2 === 0) ? 'top' : 'bot' };
      }
    }

    // 14幢 × 2段 を grid に 配置 (各家で 視覚配置が違う)
    for (let douIdx = 0; douIdx <= 13; douIdx++) {
      for (const dan of ['top', 'bot']) {
        if (douIdx === 13 && dan === 'bot') continue;  // 14幢目は 上段単独
        const t = document.createElement('div');
        t.className = 'wall-tile';
        t.dataset.dou = douIdx;
        t.dataset.dan = dan;
        // 各家ごとの grid 配置:
        //   bottom: 右端=column14、 top→row1
        //   top:    右端 (=対面視点) = column1 (画面左)、 top→row2 (画面下=卓中央側)
        //   left:   右端 (=上家視点) = row14 (画面下)、 top→column2 (画面右=卓中央側)
        //   right:  右端 (=下家視点) = row1 (画面上)、 top→column1 (画面左=卓中央側)
        if (seat === 'bottom') {
          t.style.gridColumn = 14 - douIdx;
          t.style.gridRow = (dan === 'top' ? 1 : 2);
        } else if (seat === 'top') {
          t.style.gridColumn = 1 + douIdx;
          t.style.gridRow = (dan === 'top' ? 2 : 1);
        } else if (seat === 'left') {
          t.style.gridRow = 14 - douIdx;
          t.style.gridColumn = (dan === 'top' ? 2 : 1);
        } else if (seat === 'right') {
          t.style.gridRow = 1 + douIdx;
          t.style.gridColumn = (dan === 'top' ? 1 : 2);
        }

        const isK = isKing(seat, douIdx, dan);
        const isDora = (seat === doraSeat && douIdx === doraDouIdx && dan === 'top');

        if (isDora) {
          t.classList.add('wall-tile--dora');
          if (G.doraIndicator) {
            const fn = TILE_IMG[G.doraIndicator.id];
            if (fn) t.style.backgroundImage = `url('assets/${encodeURIComponent(fn)}')`;
            t.title = 'ドラ表示: ' + TILE_NAMES[G.doraIndicator.id];
          }
        } else if (isK) {
          t.classList.add('wall-tile--king');
        } else {
          // 自摸山: 消費済 or 残存 or 次ツモ
          const key = `${douIdx}-${dan}`;
          if (consumedSet.has(key)) {
            t.style.visibility = 'hidden';
          } else if (nextDraw && nextDraw.douIdx === douIdx && nextDraw.dan === dan) {
            t.classList.add('wall-tile--next');
          }
        }
        container.appendChild(t);
      }
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
  const has13 = (G.hands.bottom.length === 13);
  document.getElementById('btn-discard').disabled = !(myTurn && has14 && G.selected);
  const hasKita = G.hands.bottom.some(t => t.id === KITA_ID);
  document.getElementById('btn-kita').disabled = !(myTurn && has14 && hasKita);
  // ツモ判定: 14牌でかつ あがり形 + 役あり
  let canTsumo = false;
  if (myTurn && has14) {
    if (isWinning(G.hands.bottom)) {
      const result = calcYaku(G.hands.bottom, {
        isTsumo: true, isRiichi: G.isRiichi.bottom, isOya: G.turn === G.oya,
        doraIndicator: G.doraIndicator, kitas: G.kitas.bottom, round: G.round,
      });
      canTsumo = result.han > 0 || result.isYakuman;
    }
  }
  document.getElementById('btn-tsumo').disabled = !canTsumo;
  // ロン判定: pendingRon あれば active
  const ronBtn = document.getElementById('btn-ron');
  if (ronBtn) ronBtn.disabled = !G.pendingRon;
  // リーチ判定: 自分の番、 14牌、 リーチしてない、 1000点以上、 テンパイ (= 1枚捨てたらテンパイ形)
  let canRiichi = false;
  if (myTurn && has14 && !G.isRiichi.bottom && G.scores.bottom >= 1000) {
    canRiichi = canDeclareRiichi(G.hands.bottom);
  }
  document.getElementById('btn-riichi').disabled = !canRiichi;
}

// ─── テンパイ判定 (1枚捨てたら 13牌が 聴牌か) ─────
function isTenpai13(hand13) {
  // 13牌で 1枚加えたら あがり形になる id があるか
  for (let id = 0; id < 27; id++) {
    const test = [...hand13, { id, copy: 0, isRed: false }];
    if (isWinning(test)) return true;
  }
  return false;
}
function canDeclareRiichi(hand14) {
  // 14牌から 1枚捨てて 13牌が聴牌になるか (どれを捨てても良い、 1枚でもあれば true)
  for (let i = 0; i < hand14.length; i++) {
    const tmp = hand14.slice(0, i).concat(hand14.slice(i + 1));
    if (isTenpai13(tmp)) return true;
  }
  return false;
}

// ─── ロン判定 (任意の家、 fromSeat の打牌に対して) ──
function checkRonForSeat(seat, fromSeat, tile) {
  if (seat === G.emptySeat || seat === fromSeat) return null;
  if (G.hands[seat].length !== 13) return null;
  const test = [...G.hands[seat], tile];
  if (!isWinning(test)) return null;
  const ctx = {
    isTsumo: false, isRiichi: G.isRiichi[seat], isOya: G.oya === seat,
    doraIndicator: G.doraIndicator, kitas: G.kitas[seat], round: G.round,
    isIppatsu: G.riichiTurnsLeft[seat] > 0,
  };
  const result = calcYaku(test, ctx);
  if (result.han === 0 && !result.isYakuman) return null;
  return { result, ctx };
}
function checkRonForBottom(fromSeat, tile) {
  return checkRonForSeat('bottom', fromSeat, tile) !== null;
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
  // 一発カウント減 (打牌した家のリーチ後 1巡経過)
  for (const p of ALL_SEATS) {
    if (G.riichiTurnsLeft[p] > 0) G.riichiTurnsLeft[p]--;
  }
  // 全家のロン判定 (反時計回り順で 一番先の家が優先、 簡略は順次見て 最初に見つかった家)
  const ccw = ccwFrom(seat);
  for (let i = 1; i < 4; i++) {
    const checkSeat = ccw[i];
    if (checkSeat === G.emptySeat) continue;
    const ronCheck = checkRonForSeat(checkSeat, seat, tile);
    if (ronCheck) {
      if (checkSeat === 'bottom') {
        // 自家ロン: ボタン待ち
        G.pendingRon = { fromSeat: seat, tile };
        G.busy = true;
        toast(`ロン可! 「ロン」 ボタンで あがれます`);
      } else {
        // CPU ロン: 自動宣言
        const test = [...G.hands[checkSeat], tile];
        toast(`${SEAT_LABEL_BASE[checkSeat]} ロン! (${TILE_NAMES[tile.id]})`);
        G.busy = true;
        setTimeout(() => showWinModal(checkSeat, test, ronCheck.ctx, ronCheck.result), 600);
      }
      return true;
    }
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
  // CPU リーチ判定 (14牌時、 未リーチ、 1000点以上、 テンパイ、 70%確率)
  if (G.hands[seat].length === 14 && !G.isRiichi[seat]
      && G.scores[seat] >= 1000 && canDeclareRiichi(G.hands[seat])) {
    if (Math.random() > 0.3) {
      G.isRiichi[seat] = true;
      G.riichiTurnsLeft[seat] = 4;
      G.scores[seat] -= 1000;
      toast(`${SEAT_LABEL_BASE[seat]} リーチ! (-1000点)`);
    }
  }
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
  // CPU が ツモあがり 可能か (簡略: 役あり前提)
  if (G.hands[seat].length === 14 && isWinning(G.hands[seat])) {
    const ctx = {
      isTsumo: true, isRiichi: G.isRiichi[seat], isOya: G.oya === seat,
      doraIndicator: G.doraIndicator, kitas: G.kitas[seat], round: G.round,
      isIppatsu: G.riichiTurnsLeft[seat] > 0,
    };
    const result = calcYaku(G.hands[seat], ctx);
    if (result.han > 0 || result.isYakuman) {
      toast(`${SEAT_LABEL_BASE[seat]} ツモ!`);
      showWinModal(seat, G.hands[seat], ctx, result);
      G.busy = false;
      return;
    }
  }
  // 通常打牌
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
  // ロン保留中なら ターン進行を停止
  if (G.pendingRon) return;
  G.busy = false;
  setTimeout(() => { nextTurn(); startTurn(); }, 350);
}

function endRound(reason) {
  document.getElementById('end-title').textContent = reason;
  if (reason === '流局') {
    // テンパイ判定 (各プレイヤー、 13牌時のみ判定)
    const tenpaiSeats = [];
    for (const seat of ALL_SEATS) {
      if (seat === G.emptySeat) continue;
      const h = G.hands[seat];
      if (h.length === 13 && isTenpai13(h)) tenpaiSeats.push(seat);
      else if (h.length === 14) {
        // 自家14牌 → 1枚捨てた 13牌で テンパイ判定
        const tmp13s = [];
        for (let i = 0; i < 14; i++) tmp13s.push(h.slice(0, i).concat(h.slice(i + 1)));
        if (tmp13s.some(t => isTenpai13(t))) tenpaiSeats.push(seat);
      }
    }
    // 点棒移動 (テンパイ料: 計3000点 = ノーテン家 → テンパイ家)
    const playingSeats = ALL_SEATS.filter(s => s !== G.emptySeat);
    const notenSeats = playingSeats.filter(s => !tenpaiSeats.includes(s));
    if (tenpaiSeats.length > 0 && notenSeats.length > 0) {
      const totalPay = 3000;
      const payPer = Math.floor(totalPay / notenSeats.length);
      const recvPer = Math.floor(totalPay / tenpaiSeats.length);
      for (const s of notenSeats) G.scores[s] -= payPer;
      for (const s of tenpaiSeats) G.scores[s] += recvPer;
    }
    let txt = `山が尽きました。<br>テンパイ: ${tenpaiSeats.map(s => SEAT_LABEL_BASE[s]).join(', ') || 'なし'}<br>`;
    txt += `点棒移動: ${notenSeats.length > 0 && tenpaiSeats.length > 0 ? '3000点 ノーテン→テンパイ' : 'なし'}<br>`;
    txt += `現スコア: ${playingSeats.map(s => `${SEAT_LABEL_BASE[s]}=${G.scores[s]}`).join(' / ')}`;
    document.getElementById('end-text').innerHTML = txt;
    // 親流れ判定: 親がテンパイなら 連荘 (本場+1)、 ノーテンなら 流れる
    if (tenpaiSeats.includes(G.oya)) {
      G.honba++;
      G.lastResult = 'tenpaiOya';
    } else {
      G.honba = 0;
      G.lastResult = 'notenOya';  // 親流れ
    }
  } else {
    document.getElementById('end-text').textContent = `${G.round}局 終了。`;
  }
  document.getElementById('end-overlay').hidden = false;
}

// ─── あがりモーダル (翻数表示) ─────────────────
function showWinModal(seat, hand, context, result) {
  const overlay = document.getElementById('end-overlay');
  const titleEl = document.getElementById('end-title');
  const textEl = document.getElementById('end-text');
  if (!overlay || !titleEl || !textEl) return;

  const whoLabel = (seat === 'bottom') ? 'あなた' : SEAT_LABEL_BASE[seat];
  const winType = context.isTsumo ? 'ツモ' : 'ロン';
  const tier = hanToTier(result.han, result.isYakuman);
  titleEl.textContent = `🎉 ${whoLabel}の${winType}あがり! ${tier}`;

  // 翻数別 役一覧 + 今回の hit ハイライト
  const allYaku = [
    { name: '立直', han: 1, hint: 'リーチ宣言' },
    { name: '門前清自摸和', han: 1, hint: '門前ツモ' },
    { name: 'タンヤオ', han: 1, hint: '2-8のみ' },
    { name: '役牌', han: 1, hint: '三元/場風/自風' },
    { name: '北抜き', han: 1, hint: '抜くたび1翻' },
    { name: '赤ドラ', han: 1, hint: '5p/5s 全枚' },
    { name: 'ドラ', han: 1, hint: '表示牌の次' },
    { name: '七対子', han: 2, hint: '7組ペア' },
    { name: '対々和', han: 2, hint: '4刻子+雀頭' },
    { name: '三暗刻', han: 2, hint: '暗刻3つ' },
    { name: '混一色', han: 3, hint: '1色+字牌' },
    { name: '清一色', han: 6, hint: '1色のみ' },
    { name: '国士無双', han: 13, hint: '役満' },
    { name: '四暗刻', han: 13, hint: '役満' },
    { name: '大三元', han: 13, hint: '役満' },
    { name: '字一色', han: 13, hint: '役満' },
    { name: '緑一色', han: 13, hint: '役満' },
    { name: '清老頭', han: 13, hint: '役満' },
  ];
  const hitNames = new Set(result.yakuList.map(y => y.name.replace(/×\d+$/, '').replace(/^北抜き.*/, '北抜き')));

  const tierGroups = {};
  for (const y of allYaku) {
    const key = y.han >= 13 ? '役満' : `${y.han}翻`;
    if (!tierGroups[key]) tierGroups[key] = [];
    tierGroups[key].push(y);
  }
  let html = '<div style="text-align:left; font-size:11px; max-height:50vh; overflow-y:auto;">';
  for (const tierName of Object.keys(tierGroups)) {
    html += `<div style="margin:4px 0;"><b style="color:#ffeb3b;">${tierName}</b>: `;
    html += tierGroups[tierName].map(y => {
      const isHit = hitNames.has(y.name) || result.yakuList.some(r => r.name.includes(y.name));
      return `<span style="margin:0 4px; ${isHit ? 'background:#ffeb3b; color:#000; padding:1px 4px; border-radius:3px; font-weight:bold;' : 'opacity:0.5;'}">${y.name}</span>`;
    }).join(' ');
    html += '</div>';
  }
  html += '</div>';
  html += '<div style="margin-top:10px; padding:8px; background:rgba(255,235,59,0.15); border-radius:6px; text-align:left;">';
  html += '<b style="color:#ffeb3b;">今回の役 (合計' + (result.isYakuman ? '役満' : `${result.han}翻 = ${tier}`) + '):</b><br>';
  html += result.yakuList.map(y => `・${y.name} ${y.han}翻`).join('<br>');
  html += '</div>';
  textEl.innerHTML = html;
  overlay.hidden = false;
}

// 三麻 半荘 = 東3+南3 = 6局
const ROUND_ORDER = ['東1', '東2', '東3', '南1', '南2', '南3'];
function nextRound() {
  if (G.type === 'single') { location.href = 'index.html'; return; }
  // 親連荘判定: G.honba > 0 = 連荘 (前局終了時 親テンパイ or あがった親)
  // 連荘なら 局を進めず、 honba 維持
  // 親流れなら 局進行 + 親を反時計回り次家に
  const continuingDealer = (G.honba > 0 && G.lastResult === 'tenpaiOya');
  if (!continuingDealer) {
    const idx = ROUND_ORDER.indexOf(G.round);
    if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
      document.getElementById('end-title').textContent = '半荘終了';
      const playingSeats = ALL_SEATS.filter(s => s !== G.emptySeat);
      document.getElementById('end-text').innerHTML
        = `東3局〜南3局まで完走しました。<br>最終スコア: ${playingSeats.map(s => `${SEAT_LABEL_BASE[s]}=${G.scores[s]}`).join(' / ')}`;
      return;
    }
    G.round = ROUND_ORDER[idx + 1];
    G.honba = 0;
    // 親を反時計回り次家に (空席をスキップ)
    const ccw = ccwFrom(G.oya);
    for (let i = 1; i < 4; i++) {
      if (ccw[i] !== G.emptySeat) { G.oya = ccw[i]; break; }
    }
  }
  G.lastResult = null;
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
  if (!G.cpuSeats || G.cpuSeats.length === 0) {
    const placement = pickCpuPlacement();
    G.cpuSeats = placement.cpuSeats;
    G.emptySeat = placement.emptySeat;
  }
  // 親が空席なら 反時計回り次家に スキップ
  while (G.oya === G.emptySeat) {
    const ccw = ccwFrom(G.oya);
    G.oya = ccw[1];
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
  G.doraSeat = null;
  G.doraDouIdx = -1;
  G.kingDouInStart = 0;
  G.kingDouInNext = 0;
  G.isRiichi = { bottom: false, right: false, top: false, left: false };
  G.riichiTurnsLeft = { bottom: 0, right: 0, top: 0, left: 0 };
  G.pendingRon = null;
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

  // サイコロ結果を 山に適用 (親 G.oya から 反時計回りに数える)
  const r = applyDice(G.walls, total, G.oya);
  G.startSeat = r.startSeat;
  G.cutPosInStart = r.cutPosInStart;  // = サイコロ目X (= カット位置 = 右端からX幢目)
  G.kingTiles = r.kingTiles;
  G.drawTiles = r.drawTiles;
  G.doraSeat = r.doraSeat;
  G.doraDouIdx = r.doraDouIdx;
  G.kingDouInStart = r.kingDouInStart;
  G.kingDouInNext = r.kingDouInNext;
  G.doraIndicator = r.doraIndicator;

  await sleep(400);
  titleEl.textContent = `合計 ${total}!`;
  explainEl.textContent = `親 (あなた) から反時計回りに ${total} 番目 = 「${SEAT_NAME_FOR_DICE[r.startSeat]}」 の山から決めます`;
  if (mnemonicEl) mnemonicEl.hidden = false;
  await sleep(2200);

  counterEl.hidden = false;
  titleEl.textContent = '👉 起点家の山の右端から数えます';
  explainEl.textContent = `右端から ${total} 牌 数えた位置で カット → 右側 14牌が「王牌」、 王牌の右から3枚目が「ドラ表示」`;

  // カウントアニメ: 起点家の山の 「右端から N幢目」 を 順に ハイライト (視覚的に)
  // DOM 順 (= append 順) は dou0_top, dou0_bot, ..., dou12_top, dou12_bot, dou13_top
  // 視覚的に「右端 = dou0」 なので 1幢目 = dou0、 2幢目 = dou1、 ... 同一幢は 上段+下段 両方ハイライト
  const wallEl = document.getElementById(`wall-${r.startSeat}`);
  const tilesByDou = {};  // douIdx → [topEl, botEl]
  if (wallEl) {
    Array.from(wallEl.querySelectorAll('.wall-tile')).forEach(el => {
      const d = Number(el.dataset.dou);
      const dn = el.dataset.dan;
      if (!tilesByDou[d]) tilesByDou[d] = {};
      tilesByDou[d][dn] = el;
    });
  }
  for (let n = 1; n <= total && n <= 13; n++) {
    counterNumEl.textContent = n;
    const douIdx = n - 1;
    const pair = tilesByDou[douIdx];
    if (pair) {
      [pair.top, pair.bot].forEach(el => {
        if (!el) return;
        el.classList.add('wall-tile--counting');
        setTimeout(() => {
          el.classList.remove('wall-tile--counting');
          if (n === total) el.classList.add('wall-tile--cut-line');
        }, 350);
      });
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
    document.getElementById('btn-discard')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy || !G.selected) return;
      const tile = G.selected;
      discardTile('bottom', tile);
      toast(`あなたが ${TILE_NAMES[tile.id]} を打牌`);
      renderAll();
      setTimeout(() => { nextTurn(); startTurn(); }, 350);
    });
    document.getElementById('btn-kita')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy) return;
      kitaNuki('bottom');
      renderAll();
    });
    document.getElementById('btn-tsumo')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy) return;
      if (!isWinning(G.hands.bottom)) return;
      const ctx = { isTsumo: true, isRiichi: G.isRiichi.bottom, isOya: G.oya === 'bottom',
                    doraIndicator: G.doraIndicator, kitas: G.kitas.bottom, round: G.round,
                    isIppatsu: G.riichiTurnsLeft.bottom > 0 };
      const result = calcYaku(G.hands.bottom, ctx);
      if (result.han === 0 && !result.isYakuman) { toast('役なし'); return; }
      showWinModal('bottom', G.hands.bottom, ctx, result);
    });
    document.getElementById('btn-ron')?.addEventListener('click', () => {
      if (!G.pendingRon) return;
      const tile = G.pendingRon.tile;
      const test = [...G.hands.bottom, tile];
      const ctx = { isTsumo: false, isRiichi: G.isRiichi.bottom, isOya: G.oya === 'bottom',
                    doraIndicator: G.doraIndicator, kitas: G.kitas.bottom, round: G.round,
                    isIppatsu: G.riichiTurnsLeft.bottom > 0 };
      const result = calcYaku(test, ctx);
      G.pendingRon = null;
      G.busy = false;
      showWinModal('bottom', test, ctx, result);
    });
    document.getElementById('btn-riichi')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy) return;
      if (!canDeclareRiichi(G.hands.bottom)) return;
      G.isRiichi.bottom = true;
      G.riichiTurnsLeft.bottom = 4;  // 一発: 自分含めて 4ターン以内
      G.scores.bottom -= 1000;
      toast('リーチ! (-1000点) — 1巡以内ツモ/ロンで一発+1翻');
      renderAll();
    });
    document.getElementById('end-next')?.addEventListener('click', nextRound);
    document.getElementById('dice-ok')?.addEventListener('click', closeDiceCeremony);
  });
}

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
const SEAT_LABEL_BASE = { bottom: 'あなた', right: '下家', top: '対面', left: '上家' };

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
  kingTiles: [],       // 嶺上プール (カット側3幢、 補充で常時6枚維持)
  kingPoolCells: [],   // 嶺上プールの表示セル (kingTiles と同順)
  kanDoraDefs: [],     // カンドラ予約 ({ind, ura, cell} × 最大3、 ドラ隣から順)
  kingUsedCells: [],   // 嶺上消費済セル (表示 hidden 用)
  kanDoraCells: [],    // めくり済カンドラの表示セル (王牌内で表向き表示)
  doraIndicator: null,
  uraIndicator: null,  // 裏ドラ表示牌 (ホスト専有、 ゲストには配信しない)
  diceD1: 0,
  diceD2: 0,
  ceremonyActive: false,
  startSeat: null,
  cutPosInStart: 0,  // = サイコロ目X (= カット位置 = 該当家山の右端からX幢目)
  diceTotal: 0,
  doraSeat: null,
  doraDouIdx: -1,
  // 山の視覚同期用: applyDice が返す 実データ (推測モデルは使わない)
  drawPosList: [],   // 自摸山 各牌の {seat, douIdx, dan} — drawTiles と同順 (先頭から消費)
  kingCells: [],     // 王牌 14セルの {seat, douIdx, dan} — kingTiles と同順 (嶺上は末尾から pop)
  hands: { bottom: [], right: [], top: [], left: [] },
  rivers: { bottom: [], right: [], top: [], left: [] },
  kitas: { bottom: 0, right: 0, top: 0, left: 0 },
  kitaTiles: { bottom: [], right: [], top: [], left: [] },  // 抜いた北の実体 (手牌横に表示)
  turn: 'bottom',
  selected: null,
  justDrawn: null,
  busy: false,
  // リーチ状態
  isRiichi: { bottom: false, right: false, top: false, left: false },
  // ダブルリーチ (1巡目宣言)。 ⚠️ G リテラルに必須: net ゲストは startNewRound を実行しないため、
  // ここに無いと updateActionButtons / ロン・ツモのハンドラが TypeError で沈黙する (v0.9.0〜の実バグ)
  doubleRiichi: { bottom: false, right: false, top: false, left: false },
  riichiTurnsLeft: { bottom: 0, right: 0, top: 0, left: 0 }, // 一発カウント
  // 点数 (簡易: 各家 35000スタート、 三麻=3人 + 空席は0)
  scores: { bottom: 35000, right: 35000, top: 35000, left: 35000 },
  // ロン保留 (他家打牌直後に 自家があがれる場合 設定)
  pendingRon: null,  // { fromSeat, tile } or null
  // ロン確認キュー (ダブロン対応): { fromSeat, tile, entries: {seat:{ctx,result}}, pending: [seat], accepted: [seat] }
  ronQueue: null,
  // 喰い替え禁止 (ポン直後、 鳴いた牌と同じ牌は捨てられない): { seat, id } or null
  kuikaeBan: null,
  // ポン/明槓保留 (他家打牌に自家が鳴ける場合 設定): { fromSeat, tile, canKan, cpu? }
  pendingCall: null,
  // 加槓保留 (搶槓確認中): { seat, meldId, tile } — 全員スルーで completePendingKakan
  pendingKakan: null,
  // 直近ツモが嶺上牌 (カン補充) の席 — 嶺上開花判定用、 打牌 or 通常ツモで解除
  justKanDrawn: null,
  // リーチ宣言直後の打牌マーク (= 横向きにする)
  justRiichiDeclared: null,  // seat or null
  // 局終了フラグ (あがりモーダル表示決定後 true — 裏でターン進行しないためのガード)
  roundOver: false,
  // 供託 (リーチ棒 — 次のあがり者が回収、 流局時は持ち越し)
  kyotaku: 0,
  // 前局の結果 ('oyaWin' | 'koWin' | 'tenpaiOya' | 'notenOya') — 連荘判定用
  lastResult: null,
  // 見逃しフリテン (全席管理 — CPU/リモート含む。 待ち牌が河を通過したら付く)
  passFuriten: { bottom: false, right: false, top: false, left: false },  // リーチ中の見逃し → この局ずっとロン不可
  tempFuriten: { bottom: false, right: false, top: false, left: false },  // 見逃し → 次の自摸まで ロン不可
  // 最新の打牌 (河でハイライト表示する)
  lastDiscard: null,
  // 各席の 直近ツモ牌 index (net対戦の 秘匿手牌配信用。 bottom は justDrawn と同値)
  justDrawnAll: {},
  // 半荘終了フラグ (net対戦でアクション受付を止める)
  gameEnded: false,
  // 副露 (Stage1: 暗槓のみ / Stage2: ポン・明槓): seat → [{type:'ankan', id, tiles:[4枚]}]
  melds: { bottom: [], right: [], top: [], left: [] },
  // カンドラ表示牌 (暗槓ごとに王牌からめくる、 中央+リザルトに表示)
  kanDoraInd: [],
  // ルールオプション (URL ?naki=0&tobi=0 で off、 既定 on。 net はホスト設定を pub で配布)
  rules: { naki: true, tobi: true },
};

// ─── 副露ヘルパー ─────────────────────────
// 面子評価は 「槓 = 同一牌3枚を手牌に足す」 等価形で既存ロジックを再利用する
// (4枚目は meldExtraTiles でドラ/赤ドラ計算にのみ加算)
function meldTriples(seat) {
  const out = [];
  for (const m of (G.melds[seat] || [])) out.push(...m.tiles.slice(0, 3));
  return out;
}
function equivHand(seat, tiles) {
  return (tiles || G.hands[seat]).concat(meldTriples(seat));
}
function meldExtraTiles(seat) {
  const out = [];
  for (const m of (G.melds[seat] || [])) if (m.tiles.length === 4) out.push(m.tiles[3]);
  return out;
}
function openMeldIds(seat) {
  return (G.melds[seat] || []).filter(m => m.type === 'pon' || m.type === 'minkan' || m.type === 'kakan').map(m => m.id);
}
function handFullCount(seat) { return 14 - 3 * (G.melds[seat] || []).length; }
function hasDrawn(seat) { return G.hands[seat].length === handFullCount(seat); }

// net対戦層 (netgame.js) が読み込まれていれば返す (未読込は null)
function NETQ() { return (typeof NetGame !== 'undefined') ? NetGame : null; }
// 席の表示名 (net対戦ではプレイヤー名、 ソロは あなた/下家/対面/上家)
function seatLabel(seat) {
  const n = NETQ();
  return (n && n.seatDispName) ? n.seatDispName(seat) : SEAT_LABEL_BASE[seat];
}
// 結果モーダル等 「全クライアント共有テキスト」 用の席名。
// net対戦では 視点語 (下家/あなた等) を使わず 絶対名 (プレイヤー名/CPU①) にする
// (ホストが生成した html を ゲストもそのまま見るため、 視点語だとホスト視点になってしまう)
function seatShareLabel(seat) {
  const n = NETQ();
  if (n && n.isHost && n.isHost() && n.pubName) return n.pubName(seat);
  return SEAT_LABEL_BASE[seat];
}
// 自風 (親=東 から反時計回りに 南・西、 空席は風なし)
function seatWindOf(seat) {
  if (!G.oya || seat === G.emptySeat) return '';
  const order = ccwFrom(G.oya).filter(s => s !== G.emptySeat);
  const i = order.indexOf(seat);
  return ['東', '南', '西'][i] || '';
}
// リモート席のロンオファー待ちか (ターン進行の追加ガード)
function netOfferPending() {
  const n = NETQ();
  return !!(n && n.hasOffer && n.hasOffer());
}

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

  // 起点家視点の 通し番号 (1-based、 1〜13 = 起点家、 0以下 = 反時計回り次家へまたがる)
  // 物理接続: 起点家1幢目 (山右端) ←→ ccw[1] 14幢目 (反時計回り次家の山左端=単独だが 単独はskipして13幢目)
  //          起点家13幢目 (山左端ペア) ←→ ccw[3] 1幢目 (時計回り次家の山右端)
  // ※ 14単独 (douIdx0=13) は 王牌・ドラ計算から 完全 skip
  function gToPos(g) {
    if (g >= 1 && g <= 13) return { seat: startSeat, douIdx0: g - 1 };
    if (g <= 0) {
      // 起点家右端より右 = ccw[1] (反時計回り次家) の 大きい douIdx 側 (山左端寄り)、 14単独skip
      return { seat: ccw[1], douIdx0: 12 + g };  // g=0→12 (=13幢目), g=-1→11 (=12幢目)
    }
    if (g >= 14) {
      // 起点家左端ペアより左 = ccw[3] (時計回り次家) の 小さい douIdx 側 (山右端寄り)
      return { seat: ccw[3], douIdx0: g - 14 };  // g=14→0 (=1幢目)
    }
    return null;
  }

  // ドラ位置 = 割れ目 (カット) から3幢目の上段 (1-based 通し番号 = X-2、 実麻雀と同配置)
  //   割れ目側から: X (嶺上1) → X-1 (嶺上2) → X-2 (ドラ表示) → X-3〜X-6 (カンドラ予約4幢)
  const doraGlobal = X - 2;
  const dorPos = gToPos(doraGlobal);
  const doraSeat = dorPos.seat;
  const doraDouIdx = dorPos.douIdx0;
  const doraIndicator = walls[doraSeat][douToArrIdx(doraDouIdx, 'top')];
  // 裏ドラ表示牌 = ドラ表示牌と同じ幢の下段 (リーチ和了時のみ公開・加算)
  const uraIndicator = walls[doraSeat][douToArrIdx(doraDouIdx, 'bot')];

  // 王牌 = カット位置直右の X幢目 〜 X-6幢目 (7幢 = 14牌、 実麻雀の物理配置と一致)
  // kingTiles / kingCells は 「カットから遠い側 → カット側」 の順で構築、
  // 各幢は 下段→上段 の順 → 嶺上 (北抜き/カン補充) の pop() が 「カット側の幢の上段から」 取れる
  const kingPosList = [];
  const kingCells = [];
  const kingTiles = [];
  for (let g = X - 6; g <= X; g++) {
    const pos = gToPos(g);
    if (!pos) continue;
    kingPosList.push(pos);
    for (const dan of ['bot', 'top']) {
      kingCells.push({ seat: pos.seat, douIdx: pos.douIdx0, dan });
      kingTiles.push(walls[pos.seat][douToArrIdx(pos.douIdx0, dan)]);
    }
  }
  // 検証: kingTiles 必ず 14牌 (= 7幢×2)

  // 自摸山 = 全108牌 - 王牌14牌 = 94牌
  // ツモ順: カット位置の左隣 (= 起点家のX+1幢目 = 0-based X) から、 各幢 上→下
  const kingSet = new Set(kingPosList.map(p => `${p.seat}#${p.douIdx0}`));
  const drawTiles = [];
  const drawPosList = [];
  function addAllExceptKing(seat, douIdx0) {
    if (kingSet.has(`${seat}#${douIdx0}`)) return;
    drawTiles.push(walls[seat][douToArrIdx(douIdx0, 'top')]);
    drawPosList.push({ seat, douIdx: douIdx0, dan: 'top' });
    if (douIdx0 !== 13) {
      drawTiles.push(walls[seat][douToArrIdx(douIdx0, 'bot')]);
      drawPosList.push({ seat, douIdx: douIdx0, dan: 'bot' });
    }
  }
  // ツモ取り順 (= 山が消費される順): 起点家のカット位置左隣 から 「物理接続」 順に 進む
  // 「ツモる人 反時計、 牌は時計回り」 = 山取り順は 起点家 → ccw[3] (時計回り次家) → ccw[2] → ccw[1] → 起点家右半分
  // 各幢内は 上→下 (14単独は上のみ)
  // (1) 起点家: (X+1)幢目 〜 14単独
  for (let d = X; d <= 13; d++) addAllExceptKing(startSeat, d);
  // (2) ccw[3] (時計回り次家、 物理接続: 起点家14単独 → ccw[3] 1幢目)
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[3], d);
  // (3) ccw[2]
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[2], d);
  // (4) ccw[1] (= 起点家の 反時計回り 次家、 = 起点家1幢目と物理接続)
  for (let d = 0; d <= 13; d++) addAllExceptKing(ccw[1], d);
  // (5) 起点家: 1幢目 〜 X幢目 (王牌外の残り)
  for (let d = 0; d <= X - 1; d++) addAllExceptKing(startSeat, d);

  // 王牌の内訳 (kingTiles/kingCells は 遠→カット順、 各幢 [下,上] で 14枚 — 実麻雀と完全同配置):
  //   idx 0-7   = カットから遠い側4幢 = カンドラゾーン (上段=カンドラ表示×4、 下段=カン裏×4)
  //   idx 8-9   = 割れ目から3幢目 (下段=裏ドラ、 上段=ドラ表示)
  //   idx 10-13 = カット側2幢 = 嶺上プール (補充ツモ用4枚、 カット側の上段から消費)
  // カンドラは ドラ表示牌の隣 (嶺上の反対側) から順にめくり、 王牌内で表向きのまま残す (最大4回 = 実ルール)
  const kanDoraDefs = [
    { ind: kingTiles[7], ura: kingTiles[6], cell: kingCells[7] },
    { ind: kingTiles[5], ura: kingTiles[4], cell: kingCells[5] },
    { ind: kingTiles[3], ura: kingTiles[2], cell: kingCells[3] },
    { ind: kingTiles[1], ura: kingTiles[0], cell: kingCells[1] },
  ];
  return { startSeat, cutPosInStart: X,
           kingTiles: kingTiles.slice(10), kingPoolCells: kingCells.slice(10), kanDoraDefs,
           drawTiles, doraIndicator, uraIndicator,
           doraSeat, doraDouIdx, kingPosList, kingCells, drawPosList };
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
  if (tile && tile.isRiichiDeclared) el.classList.add('tile--riichi-dec');
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

// 標準形の 全分解を列挙: [{ pair: id, melds: [{type:'kotsu'|'shuntsu', id}] }, ...]
// (ピンフ / 一盃口 / 一気通貫 判定用)
function enumerateDecomps(hand) {
  const out = [];
  const baseCounts = countTiles(hand);
  function collect(counts, melds, pairId) {
    const ids = Object.keys(counts).filter(k => counts[k] > 0).map(Number).sort((a, b) => a - b);
    if (ids.length === 0) { out.push({ pair: pairId, melds: [...melds] }); return; }
    const id = ids[0];
    if (counts[id] >= 3) {
      counts[id] -= 3;
      melds.push({ type: 'kotsu', id });
      collect(counts, melds, pairId);
      melds.pop();
      counts[id] += 3;
    }
    if (SHUNTSU_HEAD_IDS.includes(id) && counts[id + 1] > 0 && counts[id + 2] > 0) {
      counts[id]--; counts[id + 1]--; counts[id + 2]--;
      melds.push({ type: 'shuntsu', id });
      collect(counts, melds, pairId);
      melds.pop();
      counts[id]++; counts[id + 1]++; counts[id + 2]++;
    }
  }
  for (const idStr of Object.keys(baseCounts)) {
    const id = Number(idStr);
    if (baseCounts[id] >= 2) {
      const counts = { ...baseCounts };
      counts[id] -= 2;
      collect(counts, [], id);
    }
  }
  return out;
}

// 役牌になる id (雀頭がこれだと ピンフ不成立): 三元牌 + 東 (場風/親自風) + 南 (南場)
function isYakuhaiPairId(id, context) {
  if (id === 24 || id === 25 || id === 26) return true;  // 白發中
  if (id === 20) return true;  // 東 (東場の場風 + 親の自風)
  if (id === 21 && context.round && context.round.startsWith('南')) return true;  // 南 (南場)
  return false;
}

// ピンフ: 全順子 + 雀頭が役牌以外 + 和了牌が両面待ち
function isPinfu(decomps, context) {
  const w = context.winTile ? context.winTile.id : null;
  if (w == null) return false;
  for (const d of decomps) {
    if (d.melds.some(m => m.type !== 'shuntsu')) continue;
    if (isYakuhaiPairId(d.pair, context)) continue;
    // 和了牌が いずれかの順子の 両面部分に 入っているか
    for (const m of d.melds) {
      const n = tileNum(m.id);  // 順子の最小数字 (1-7)
      if (w === m.id && n <= 6) return true;        // 例: 45 待ち 3/6 の 3側
      if (w === m.id + 2 && n >= 2) return true;    // 例: 45 待ち 3/6 の 6側
    }
  }
  return false;
}

// 一盃口 / 二盃口: 同一順子 2組 (×2で二盃口)
function countPeiko(decomps) {
  let best = 0;
  for (const d of decomps) {
    const seen = {};
    d.melds.forEach(m => { if (m.type === 'shuntsu') seen[m.id] = (seen[m.id] || 0) + 1; });
    let pairs = 0;
    for (const k in seen) pairs += Math.floor(seen[k] / 2);
    best = Math.max(best, pairs);
  }
  return best;
}

// 一気通貫: 同色 123 456 789
function isIttsuu(decomps) {
  for (const d of decomps) {
    const heads = new Set(d.melds.filter(m => m.type === 'shuntsu').map(m => m.id));
    if (heads.has(2) && heads.has(5) && heads.has(8)) return true;    // 筒子 (1p=2)
    if (heads.has(11) && heads.has(14) && heads.has(17)) return true; // 索子 (1s=11)
  }
  return false;
}

// 三色同刻: 同じ数字の刻子を 萬筒索3色で (三麻は萬子1・9のみなので 111 / 999 限定)
function isSanshokuDoukou(decomps) {
  for (const d of decomps) {
    const kotsuIds = new Set(d.melds.filter(m => m.type === 'kotsu').map(m => m.id));
    if (kotsuIds.has(0) && kotsuIds.has(2) && kotsuIds.has(11)) return true;   // 111
    if (kotsuIds.has(1) && kotsuIds.has(10) && kotsuIds.has(19)) return true;  // 999
  }
  return false;
}

// 幺九牌 (1・9・字牌) — チャンタ系判定用
const YAOCHU_IDS = new Set([0, 1, 2, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26]);
// チャンタ/ジュンチャン: 全面子+雀頭に幺九牌が絡む ('junchan'=字牌なし3翻 / 'chanta'=2翻 / null)
function chantaType(decomps) {
  const meldYaochu = (m) => m.type === 'kotsu'
    ? YAOCHU_IDS.has(m.id)
    : (tileNum(m.id) === 1 || tileNum(m.id) === 7);  // 順子は 123 or 789 のみ
  let best = null;
  for (const d of decomps) {
    if (!YAOCHU_IDS.has(d.pair)) continue;
    if (!d.melds.every(meldYaochu)) continue;
    const hasHonor = isJihaiId(d.pair) || d.melds.some(m => m.type === 'kotsu' && isJihaiId(m.id));
    if (!hasHonor) return 'junchan';
    best = 'chanta';
  }
  return best;
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
  // 場風: 東場=東 (id=20)、 南場=南 (id=21)
  if ((counts[20] || 0) >= 3 && context.round && context.round.startsWith('東')) {
    yakus.push({ name: '場風 東', han: 1 });
  }
  if ((counts[21] || 0) >= 3 && context.round && context.round.startsWith('南')) {
    yakus.push({ name: '場風 南', han: 1 });
  }
  // 自風: 東=20 / 南=21 / 西=22 (seatWind 未指定の旧呼び出しは 親=東 のみ)
  const sw = context.seatWind || (context.isOya ? '東' : null);
  const swId = { '東': 20, '南': 21, '西': 22 }[sw];
  if (swId && (counts[swId] || 0) >= 3) {
    yakus.push({ name: `自風 ${sw}`, han: 1 });
  }
  return yakus;
}

// 役満系: 四暗刻(単騎はダブル)、 字一色、 緑一色、 清老頭、 大三元、 国士無双、
//        大四喜(ダブル)/小四喜、 九蓮宝燈、 天和/地和
function checkYakuman(hand, context) {
  const ymList = [];
  const counts = countTiles(hand);
  if (isKokushi(hand)) ymList.push({ name: '国士無双', han: 13 });
  // 四暗刻: 対子+刻子のみの形。 単騎待ち (あがり牌=雀頭) は ロンでも成立 + ダブル役満。
  //         単騎以外は ツモ限定 (ロンだと最後の刻子が明刻扱い)。 ポン/明槓があると不成立
  if (!(context.openMeldIds || []).length) {
    let ankoCount = 0, pairId = null, valid = true;
    for (const id in counts) {
      if (counts[id] === 3) ankoCount++;
      else if (counts[id] === 2) pairId = Number(id);
      else { valid = false; break; }
    }
    if (valid && ankoCount === 4 && pairId != null) {
      const tanki = context.winTile && context.winTile.id === pairId;
      if (tanki) ymList.push({ name: '四暗刻単騎', han: 26 });
      else if (context.isTsumo) ymList.push({ name: '四暗刻', han: 13 });
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
  if ((counts[24] || 0) >= 3 && (counts[25] || 0) >= 3 && (counts[26] || 0) >= 3) {
    ymList.push({ name: '大三元', han: 13 });
  }
  // 四喜和 (東南西北): 大四喜 = 4種刻子 (ダブル) / 小四喜 = 3種刻子+1種雀頭
  {
    const windKo = [20, 21, 22, 23].filter(id => (counts[id] || 0) >= 3).length;
    const windPair = [20, 21, 22, 23].filter(id => (counts[id] || 0) === 2).length;
    if (windKo === 4) ymList.push({ name: '大四喜', han: 26 });
    else if (windKo === 3 && windPair === 1) ymList.push({ name: '小四喜', han: 13 });
  }
  // 九蓮宝燈 (清一色 1112345678999+1枚、 三麻は筒子/索子のみ)
  for (const base of [2, 11]) {
    if (!hand.every(t => t.id >= base && t.id <= base + 8)) continue;
    let extra = 0, ok = true;
    for (let n = 0; n < 9; n++) {
      const need = (n === 0 || n === 8) ? 3 : 1;
      const c = counts[base + n] || 0;
      if (c < need) { ok = false; break; }
      extra += c - need;
    }
    if (ok && extra === 1) { ymList.push({ name: '九蓮宝燈', han: 13 }); break; }
  }
  // 天和 (親の配牌ツモ) / 地和 (子の第一ツモ、 北抜き・打牌なし)
  if (context.firstDraw && context.isTsumo) {
    ymList.push(context.isOya ? { name: '天和', han: 13 } : { name: '地和', han: 13 });
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

// 役の表示順 (慣例順: 状況役 → 手役 → ドラ系)
const YAKU_DISPLAY_ORDER = [
  'ダブルリーチ', '立直', '一発', '門前清自摸和', '嶺上開花', '搶槓', '海底摸月', '河底撈魚',
  'ピンフ', 'タンヤオ', '一盃口',
  '白', '發', '中', '場風 東', '場風 南', '自風 東', '自風 南', '自風 西',
  '七対子', '対々和', '三暗刻', '三色同刻', '一気通貫', '二盃口', 'チャンタ', 'ジュンチャン', '混老頭', '小三元', '混一色', '清一色',
  'ドラ', '赤ドラ', 'カンドラ', '裏ドラ', 'カン裏', '北抜き',
];
function yakuOrderIdx(name) {
  const i = YAKU_DISPLAY_ORDER.findIndex(o => name === o || name.startsWith(o));
  return i < 0 ? 40 : i;
}

// ─── 役判定 メイン ─────────────────────────
function calcYaku(hand, context) {
  // context: { isTsumo, isRiichi, isOya, doraIndicator, kitas, round, extraTiles, kanDora, ... }
  // hand = 面子評価用 (槓は3枚等価済)。 ドラ/赤ドラ系のみ 槓の4枚目 (extraTiles) を加えて数える
  const scanHand = (context.extraTiles && context.extraTiles.length) ? hand.concat(context.extraTiles) : hand;
  const openIds = context.openMeldIds || [];   // ポン/明槓の牌id (暗槓は含まない = 門前扱い)
  const hasOpen = openIds.length > 0;
  const yakuList = [];
  let han = 0;
  let isYakuman = false;

  if (!isWinning(hand)) {
    return { yakuList: [], han: 0, isYakuman: false, error: 'あがり形ではありません' };
  }

  // 役満チェック (優先、 ダブル役満は han26 で加算)
  const yms = checkYakuman(hand, context);
  if (yms.length > 0) {
    for (const ym of yms) yakuList.push(ym);
    return { yakuList, han: yms.reduce((n, y) => n + y.han, 0), isYakuman: true };
  }

  // 七対子チェック (二盃口形にも取れる場合は 高点法で 標準形を優先)
  const chiitoi = isChiitoitsu(hand);
  const stdDecomps = isStandardWin(hand) ? enumerateDecomps(hand) : [];
  if (chiitoi && !(stdDecomps.length > 0 && countPeiko(stdDecomps) >= 2)) {
    yakuList.push({ name: '七対子', han: 2 });
    han += 2;
  } else {
    // 標準形の役
    const decomps = stdDecomps;
    if (isToitoi(hand)) { yakuList.push({ name: '対々和', han: 2 }); han += 2; }
    if (isSanshokuDoukou(decomps)) { yakuList.push({ name: '三色同刻', han: 2 }); han += 2; }
    // 三暗刻: 暗刻3つ (ポン/明槓は除外)。 ロンの場合 ロン牌で完成した刻子は明刻扱いのため、
    // 「ロン牌を除いた13枚の時点で完成していた刻子」 だけを暗刻として数える (実ルール準拠)
    let ankoCount;
    if (context.isTsumo || !context.winTile) {
      ankoCount = countAnkoCount(hand) - openIds.length;
    } else {
      const c13 = countTiles(hand);
      c13[context.winTile.id] = (c13[context.winTile.id] || 0) - 1;
      ankoCount = Object.keys(c13).filter(id => c13[id] >= 3).length - openIds.length;
    }
    if (ankoCount >= 3) { yakuList.push({ name: '三暗刻', han: 2 }); han += 2; }
    // ピンフ (全順子 + 雀頭非役牌 + 両面待ち)
    if (isPinfu(decomps, context)) { yakuList.push({ name: 'ピンフ', han: 1 }); han += 1; }
    // 一盃口 / 二盃口 (門前のみ)
    const peiko = hasOpen ? 0 : countPeiko(decomps);
    if (peiko >= 2) { yakuList.push({ name: '二盃口', han: 3 }); han += 3; }
    else if (peiko === 1) { yakuList.push({ name: '一盃口', han: 1 }); han += 1; }
    // 一気通貫
    if (isIttsuu(decomps)) { const v = hasOpen ? 1 : 2; yakuList.push({ name: '一気通貫', han: v }); han += v; }
    // 役牌
    const yakuhai = countYakuhai(hand, context);
    for (const y of yakuhai) { yakuList.push(y); han += y.han; }
  }

  // タンヤオ・混一色・清一色 (両形共通)
  if (isTanyao(hand)) { yakuList.push({ name: 'タンヤオ', han: 1 }); han += 1; }
  if (isHonitsu(hand)) { const v = hasOpen ? 2 : 3; yakuList.push({ name: '混一色', han: v }); han += v; }
  if (isChinitsu(hand)) { const v = hasOpen ? 5 : 6; yakuList.push({ name: '清一色', han: v }); han += v; }

  // チャンタ系 (混老頭 > ジュンチャン > チャンタ の順で1つだけ)
  const allYaochu = hand.every(t => YAOCHU_IDS.has(t.id));
  if (allYaochu) {
    yakuList.push({ name: '混老頭', han: 2 }); han += 2;  // 全帯幺九の上位互換 (字一色/清老頭は役満で処理済)
  } else if (stdDecomps.length > 0) {
    const ch = chantaType(stdDecomps);
    if (ch === 'junchan') { const v = hasOpen ? 2 : 3; yakuList.push({ name: 'ジュンチャン', han: v }); han += v; }
    else if (ch === 'chanta') { const v = hasOpen ? 1 : 2; yakuList.push({ name: 'チャンタ', han: v }); han += v; }
  }
  // 小三元 (三元牌2種刻子 + 1種雀頭、 役牌2翻とは別に +2翻)
  const cAll = countTiles(hand);
  const sangenKo = SAN_GEN_IDS.filter(id => (cAll[id] || 0) >= 3).length;
  const sangenHead = SAN_GEN_IDS.some(id => (cAll[id] || 0) === 2);
  if (sangenKo === 2 && sangenHead) { yakuList.push({ name: '小三元', han: 2 }); han += 2; }

  // 立直 (1巡目宣言はダブルリーチ)・一発・門前清自摸
  if (context.isRiichi) {
    if (context.isDoubleRiichi) { yakuList.push({ name: 'ダブルリーチ', han: 2 }); han += 2; }
    else { yakuList.push({ name: '立直', han: 1 }); han += 1; }
  }
  if (context.isIppatsu) { yakuList.push({ name: '一発', han: 1 }); han += 1; }
  if (context.isTsumo && !hasOpen) { yakuList.push({ name: '門前清自摸和', han: 1 }); han += 1; }
  // 嶺上開花 (カン補充牌でのツモあがり) / 搶槓 (他家の加槓牌でのロン)
  if (context.isRinshan && context.isTsumo) { yakuList.push({ name: '嶺上開花', han: 1 }); han += 1; }
  if (context.isChankan && !context.isTsumo) { yakuList.push({ name: '搶槓', han: 1 }); han += 1; }
  // 海底摸月 / 河底撈魚 (山0枚での ツモ / 最終打牌ロン)。 嶺上ツモは海底にならない (標準ルール)
  if (context.isHaitei && !(context.isRinshan && context.isTsumo)) {
    if (context.isTsumo) { yakuList.push({ name: '海底摸月', han: 1 }); han += 1; }
    else { yakuList.push({ name: '河底撈魚', han: 1 }); han += 1; }
  }

  // ドラ計算 (表ドラ + 赤ドラ + カンドラ + 北ドラ)
  const doraCount = countDora(scanHand, context.doraIndicator);
  if (doraCount > 0) { yakuList.push({ name: 'ドラ', han: doraCount }); han += doraCount; }
  const akaCount = scanHand.filter(t => t.isRed).length;
  if (akaCount > 0) { yakuList.push({ name: '赤ドラ', han: akaCount }); han += akaCount; }
  // カンドラ (暗槓ごとに1枚めくる、 全員に有効)
  if (context.kanDora && context.kanDora.length > 0) {
    let kd = 0;
    for (const ind of context.kanDora) kd += countDora(scanHand, ind);
    if (kd > 0) { yakuList.push({ name: 'カンドラ', han: kd }); han += kd; }
  }
  // 裏ドラ (リーチ和了時のみ、 王牌のドラ表示牌の下段をめくる)
  if (context.isRiichi && context.uraIndicator) {
    const uraCount = countDora(scanHand, context.uraIndicator);
    if (uraCount > 0) { yakuList.push({ name: '裏ドラ', han: uraCount }); han += uraCount; }
  }
  // カン裏 (リーチ和了時のみ、 めくり済カンドラ表示牌の下段)
  if (context.isRiichi && context.kanUra && context.kanUra.length > 0) {
    let ku = 0;
    for (const ind of context.kanUra) ku += countDora(scanHand, ind);
    if (ku > 0) { yakuList.push({ name: 'カン裏', han: ku }); han += ku; }
  }
  if (context.kitas > 0) { yakuList.push({ name: `北抜き×${context.kitas}`, han: context.kitas }); han += context.kitas; }

  // 表示順を慣例順に整列: リーチ系 → 手役 → ドラ系 (雀魂等と同じ並び)
  yakuList.sort((a, b) => yakuOrderIdx(a.name) - yakuOrderIdx(b.name));

  // 役なし? (役牌・タンヤオ等 1翻役以上が必要、 ドラ・北だけでは役なし)
  // ただし簡略化: 1翻以上あれば OK とする
  const yakuOnly = yakuList.filter(y =>
    !['ドラ', '赤ドラ', 'カンドラ', '裏ドラ', 'カン裏', '北抜き'].some(p => y.name.startsWith(p)));
  if (yakuOnly.length === 0) {
    return { yakuList, han, isYakuman: false, error: '役なし (ドラ・北抜きだけではあがれません)' };
  }

  return { yakuList, han, isYakuman: false };
}

// 点数移動アニメーション: 各席のラベル付近に ±点数バッジを浮かせる
// deltas = {seat: 増減} (表示座席キー)。 net ゲストは pub のスコア差分から呼ばれる
function showScoreBadges(deltas) {
  try {
    for (const s of ALL_SEATS) {
      const d = deltas[s];
      if (!d) continue;
      const label = document.getElementById(`label-${s}`);
      if (!label) continue;
      const r = label.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'score-badge ' + (d > 0 ? 'score-badge--plus' : 'score-badge--minus');
      el.textContent = (d > 0 ? '+' : '') + d.toLocaleString();
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${Math.max(24, r.top - 6)}px`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1900);
    }
  } catch (e) { /* 演出失敗でもゲームは止めない */ }
}

// 結果モーダル用の牌スパン (手牌を小さく描く共通ヘルパー)
function tileSpanHtml(t, extra = '') {
  return `<span style="display:inline-block; width:26px; height:35px; border-radius:3px; background:url('assets/${encodeURIComponent(TILE_IMG[t.id])}') center/100% 100% no-repeat; ${extra}"></span>`;
}

// ─── 翻数 → 名前 ─────────────────────────
function hanToTier(han, isYakuman) {
  if (isYakuman) return han >= 39 ? 'トリプル役満' : han >= 26 ? 'ダブル役満' : '役満';
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
    // リーチ宣言モード (雀魂式支援): 捨ててもテンパイ維持できる牌=緑発光、 他=暗転
    const declaring = (G.justRiichiDeclared === 'bottom');
    const keepSet = new Set();
    if (declaring) {
      G.hands.bottom.forEach(t => {
        if (isTenpai13(G.hands.bottom.filter(x => x !== t), meldTriples('bottom'))) keepSet.add(t);
      });
    }
    const decorate = (el, tile) => {
      if (declaring) el.classList.add(keepSet.has(tile) ? 'tile--riichi-ok' : 'tile--dimmed');
      el.addEventListener('click', () => onMyHandClick(tile));
      el.addEventListener('dblclick', () => onMyHandDblClick(tile));
      attachTileDrag(el, tile);  // モバイル: 上へドラッグで打牌
      if (G.selected === tile) el.classList.add('tile--selected');
    };
    sorted.forEach(tile => {
      const el = createTileEl(tile, { mine: true });
      decorate(el, tile);
      container.appendChild(el);
    });
    if (drawnTile) {
      const sep = document.createElement('span');
      sep.style.cssText = 'width:6px;display:inline-block;';
      container.appendChild(sep);
      const el = createTileEl(drawnTile, { mine: true, justDrawn: true });
      decorate(el, drawnTile);
      container.appendChild(el);
    }
    // 副露 (暗槓): 手牌右端にグループ表示
    if (G.melds.bottom.length > 0) {
      const msep = document.createElement('span');
      msep.style.cssText = 'width:14px;display:inline-block;';
      container.appendChild(msep);
      G.melds.bottom.forEach(m => {
        m.tiles.forEach(mt => {
          const el = createTileEl(mt, { small: true });
          el.classList.add('tile--meld');
          el.title = m.type === 'pon' ? 'ポン' : m.type === 'minkan' ? '明槓' : m.type === 'kakan' ? '加槓' : '暗槓';
          container.appendChild(el);
        });
      });
    }
    // 抜いた北: 手牌の右端に 少し間隔を空けて 並べる
    if (G.kitaTiles.bottom.length > 0) {
      const sep = document.createElement('span');
      sep.style.cssText = 'width:20px;display:inline-block;';
      container.appendChild(sep);
      G.kitaTiles.bottom.forEach(kt => {
        const el = createTileEl(kt, { small: true });
        el.classList.add('tile--kita');
        el.title = '北抜き (+1翻)';
        container.appendChild(el);
      });
    }
  } else {
    // CPU: 通常は伏せ、 局終了後は 表向きに公開 (「盤面を見る」 用)。
    // 抜いた北は 「本人から見て手牌の右」 = 対面: 画面左(先頭) / 下家: 画面上(先頭) / 上家: 画面下(末尾)
    const handEls = [];
    if (G.roundOver && G.hands[seat].length > 0 && G.hands[seat][0] && G.hands[seat][0].id != null) {
      sortHand(G.hands[seat]).forEach(t => {
        handEls.push(createTileEl(t, { small: true }));
      });
    } else {
      G.hands[seat].forEach(() => {
        handEls.push(createTileEl(null, { back: true, small: true }));
      });
    }
    const kitaEls = G.kitaTiles[seat].map(kt => {
      const el = createTileEl(kt, { small: true });
      el.classList.add('tile--kita');
      el.title = '北抜き (+1翻)';
      return el;
    });
    const meldEls = [];
    (G.melds[seat] || []).forEach(m => {
      m.tiles.forEach(mt => {
        const el = createTileEl(mt, { small: true });
        el.classList.add('tile--meld');
        el.title = m.type === 'pon' ? 'ポン' : m.type === 'minkan' ? '明槓' : m.type === 'kakan' ? '加槓' : '暗槓';
        meldEls.push(el);
      });
    });
    const ordered = (seat === 'top' || seat === 'right')
      ? [...meldEls, ...kitaEls, ...handEls]
      : [...handEls, ...kitaEls, ...meldEls];
    ordered.forEach(e => container.appendChild(e));
  }
}

// ─── 描画: 河 (全席 正立・最新打牌はハイライト) ──
// 段の伸び方向は 実卓と同じ 「1段目が中央寄り、 増えるほど自分の手前側へ」 に統一:
//   bottom: 上の段から下へ / top: 下の段から上へ / left: 右の列から左へ / right: 左の列から右へ
function renderRiver(seat) {
  const container = document.getElementById(`river-${seat}`);
  if (!container) return;
  container.innerHTML = '';
  const arr = G.rivers[seat];
  // 全席 実卓と同じ 6枚/段 (横河=6列×可変段、 縦河=6行×可変列。 CSS grid と同値)
  const perLine = 6;
  const lines = Math.max(3, Math.ceil(arr.length / perLine));
  arr.forEach((tile, i) => {
    const el = createTileEl(tile, { river: true });
    if (tile === G.lastDiscard) el.classList.add('tile--latest');
    const line = Math.floor(i / perLine);   // 何段目 (0-based)
    const pos = (i % perLine) + 1;          // 段内位置 (1-based)
    if (seat === 'bottom') {
      el.style.gridRow = line + 1;          // 上 (中央寄り) → 下
      el.style.gridColumn = pos;
    } else if (seat === 'top') {
      el.style.gridRow = lines - line;               // 下 (中央寄り) → 上
      el.style.gridColumn = perLine + 1 - pos;       // 本人視点で左詰め = 画面では右から左
    } else if (seat === 'left') {
      el.style.gridColumn = lines - line;            // 右 (中央寄り) → 左
      el.style.gridRow = pos;                        // 本人の左 = 画面上 → 上から下
    } else {                                          // right
      el.style.gridColumn = line + 1;                // 左 (中央寄り) → 右
      el.style.gridRow = perLine + 1 - pos;          // 本人の左 = 画面下 → 下から上
    }
    container.appendChild(el);
  });
}

// ─── 描画: 山 (applyDice が返した 実データで 消費/王牌/ドラを 同期表示) ─
// レイアウト: 各家 14列×2行の grid (14幢目=左端 単独上段は 視覚非表示 v0.7.5)
// 消費表示: G.drawPosList (ツモ山の実消費順) の 先頭 consumedCount 個を hidden
// 王牌表示: G.kingCells の 14セル、 嶺上消費 (北抜き補充) は 末尾から hidden
function renderWalls() {
  const consumedCount = G.drawPosList.length > 0
    ? (G.drawPosList.length - G.drawTiles.length) : 0;
  const consumedSet = new Set();
  for (let i = 0; i < consumedCount; i++) {
    const p = G.drawPosList[i];
    consumedSet.add(`${p.seat}#${p.douIdx}#${p.dan}`);
  }
  const kingSet = new Set(G.kingCells.map(p => `${p.seat}#${p.douIdx}#${p.dan}`));
  // 嶺上消費済セル (北抜き/カンの補充ツモで取られた牌) — 実データで hidden
  const kingConsumedSet = new Set((G.kingUsedCells || []).map(p => `${p.seat}#${p.douIdx}#${p.dan}`));
  // めくり済カンドラ表示セル → 表向き表示 (王牌内に残る、 実麻雀ルール)
  const kanDoraCellMap = {};
  (G.kanDoraCells || []).forEach((p, i) => {
    if (p && G.kanDoraInd[i]) kanDoraCellMap[`${p.seat}#${p.douIdx}#${p.dan}`] = G.kanDoraInd[i];
  });
  const doraSeat = G.doraSeat;
  const doraDouIdx = (typeof G.doraDouIdx === 'number') ? G.doraDouIdx : -1;

  ALL_SEATS.forEach(seat => {
    const container = document.getElementById(`wall-${seat}`);
    if (!container) return;
    container.innerHTML = '';

    // 13幢 × 2段 = 26牌 を grid に 配置 (各家で 視覚配置が違う)
    // 14単独 (douIdx=13、 dan='top') は **視覚的には表示しない** (= 内部ロジック上は 自摸山に含む)
    // → 各家 「13幢ペア = 26牌」 で 揃った表示になり、 「1枚減った印象」 を 解消
    for (let douIdx = 0; douIdx <= 12; douIdx++) {
      for (const dan of ['top', 'bot']) {
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

        const key = `${seat}#${douIdx}#${dan}`;
        const isK = kingSet.has(key);
        const isDora = (seat === doraSeat && douIdx === doraDouIdx && dan === 'top');
        const kanDoraTile = kanDoraCellMap[key];

        // ゲスト: サイコロ儀式のめくり演出が終わるまで 王牌の紫・ドラ表示を隠す (先見え防止、
        // ホストと同じく「数えて→カットして→めくる」演出の後に初めて見える)
        const revealPending = !!G._doraRevealPending;
        if (isDora && !revealPending) {
          t.classList.add('wall-tile--dora');
          if (G.doraIndicator) {
            const fn = TILE_IMG[G.doraIndicator.id];
            if (fn) t.style.backgroundImage = `url('assets/${encodeURIComponent(fn)}')`;
            t.title = 'ドラ表示: ' + TILE_NAMES[G.doraIndicator.id];
          }
        } else if (kanDoraTile && !revealPending) {
          // カンドラ表示牌: ドラ表示の隣で表向き (カンのたびに1枚ずつ増える)
          t.classList.add('wall-tile--dora', 'wall-tile--kandora');
          const fn = TILE_IMG[kanDoraTile.id];
          if (fn) t.style.backgroundImage = `url('assets/${encodeURIComponent(fn)}')`;
          t.title = 'カンドラ表示: ' + TILE_NAMES[kanDoraTile.id];
        } else if (isK) {
          if (!revealPending) t.classList.add('wall-tile--king');
          if (kingConsumedSet.has(key)) t.style.visibility = 'hidden';  // 嶺上消費済
        } else {
          // 自摸山: 消費済は hidden
          if (consumedSet.has(key)) {
            t.style.visibility = 'hidden';
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
  document.getElementById('center-round').textContent = G.round + (G.honba > 0 ? `・${G.honba}本場` : '');
  const remain = G.drawTiles.length;
  document.getElementById('game-remain').textContent = `山残: ${remain}`;
  const cr = document.getElementById('center-remain');
  if (cr) cr.textContent = remain;
  const ck = document.getElementById('center-kyotaku');
  if (ck) ck.textContent = G.kyotaku > 0 ? `供託${G.kyotaku}` : '';
  const turnLabel = (G.turn === 'bottom') ? 'あなたの番' : `${seatLabel(G.turn)} の番`;
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
      return;
    }
    seatEl.classList.remove('seat--empty');
    if (!labelEl) return;
    let label = seatLabel(seat);
    if (seat !== 'bottom' && label === SEAT_LABEL_BASE[seat]) label += ' (CPU)';
    if (G.oya === seat) label += '【親】';
    const wind = seatWindOf(seat);
    if (wind) label = `${wind}・${label}`;
    label += ` ${G.scores[seat].toLocaleString()}点`;
    if (G.isRiichi[seat]) label += ' 🔴リーチ';
    labelEl.textContent = label;
    // 手番の家をハイライト
    labelEl.classList.toggle('seat__label--turn', G.turn === seat && !G.roundOver);
  });
  // 中央: カンドラ表示 (暗槓が出たら以降ずっと見える)
  const kd = document.getElementById('center-kandora');
  if (kd) {
    if (G.kanDoraInd.length > 0) {
      kd.hidden = false;
      kd.innerHTML = 'カンドラ ' + G.kanDoraInd.map(t => tileSpanHtml(t, 'width:14px; height:19px; vertical-align:middle;')).join('');
    } else { kd.hidden = true; kd.innerHTML = ''; }
  }
}

// ─── 全描画 ─────────────────────────────────
function renderAll() {
  renderHeader();
  renderSeats();
  ALL_SEATS.forEach(s => { renderHand(s); renderRiver(s); });
  renderWalls();
  renderRiichiGuide();
  updateActionButtons();
  updateHint();
  // net対戦ホスト: 描画のたびに 公開状態を配信 (debounce は netgame 側)
  if (NETQ()) NETQ().onRender();
}

// ─── ヒントバー ────────────────────────────────
function updateHint() {
  const hint = document.getElementById('game-hint');
  if (!hint) return;
  hint.classList.remove('game__hint--cpu', 'game__hint--idle');
  if (G.pendingRon) {
    hint.textContent = `🎉 ロンできます! 「ロン」 であがる / 「パス」 で見逃し`;
    return;
  }
  if (G.busy && G.turn !== 'bottom') {
    hint.textContent = `🤖 ${seatLabel(G.turn)} が考え中…`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  if (G.turn !== 'bottom') {
    hint.textContent = `⏳ ${seatLabel(G.turn)} の番`;
    hint.classList.add('game__hint--cpu');
    return;
  }
  if (hasDrawn('bottom')) {
    const hasKita = G.hands.bottom.some(t => t.id === KITA_ID);
    if (G.selected) {
      // 待ち牌プレビュー: 選択牌を切った後の形を先読み表示 (初心者ガイドの核)
      const rest = G.hands.bottom.filter(t => t !== G.selected);
      const waits = waitingIds(rest, meldTriples('bottom'));
      const selName = `${TILE_NAMES[G.selected.id]}${G.selected.isRed ? '(赤)' : ''}`;
      if (waits.length > 0) {
        const furiten = G.rivers.bottom.some(t => waits.includes(t.id));
        const head = (G.justRiichiDeclared === 'bottom') ? 'を切って リーチ!' : 'を切ると テンパイ!';
        hint.textContent = `🎯 ${selName}${head} 待ち: ${waitsLabel(waits)}${furiten ? ' ⚠️フリテン(ロン不可)' : ''}`;
      } else if (G.justRiichiDeclared === 'bottom') {
        hint.textContent = `🟢 ${selName}では リーチできません — 光っている牌から選んでください`;
      } else {
        const sh = shantenOf(rest);
        hint.textContent = `${selName} 選択中 — 切ると テンパイまで あと${sh}枚`;
      }
    } else if (G.justRiichiDeclared === 'bottom') {
      hint.textContent = '🟢 光っている牌を捨てると リーチ成立 / やめるなら 「リーチ取消」';
    } else if (hasKita) {
      hint.textContent = '👆 牌タップ → 「打牌」 / 北 (🀃) は 「北抜き」 もOK';
    } else {
      hint.textContent = '👆 手牌から捨てる牌をタップ → 「打牌」 (ダブルクリックで即打牌)';
    }
  } else if (G.hands.bottom.length === handFullCount('bottom') - 1) {
    const waits = waitingIds(G.hands.bottom, meldTriples('bottom'));
    if (waits.length > 0) {
      const furiten = G.rivers.bottom.some(t => waits.includes(t.id)) || G.passFuriten.bottom || G.tempFuriten.bottom;
      hint.textContent = `🎯 テンパイ中! 待ち: ${waitsLabel(waits)}${furiten ? ' ⚠️フリテン(ロン不可)' : ''}`;
    } else {
      hint.textContent = '⏳ ツモ待ち…';
      hint.classList.add('game__hint--idle');
    }
  } else {
    hint.textContent = '配牌中…';
    hint.classList.add('game__hint--idle');
  }
}

// ─── 待ち牌表示 (残り枚数付き — 見えている牌を除いた枚数) ────
function visibleCountOf(id) {
  let n = 0;
  G.hands.bottom.forEach(t => { if (t && t.id === id) n++; });
  for (const s of ALL_SEATS) {
    G.rivers[s].forEach(t => { if (t && t.id === id) n++; });
    (G.kitaTiles[s] || []).forEach(t => { if (t && t.id === id) n++; });
  }
  if (G.doraIndicator && G.doraIndicator.id === id) n++;
  return n;
}
function waitsLabel(waits) {
  return waits.map(id => `${TILE_NAMES[id]}(残${Math.max(0, 4 - visibleCountOf(id))})`).join('・');
}

// ─── AI採点コーチ (打牌の即時評価 — シャンテン数+受け入れ枚数ベース) ──
// 🎓トグルで ON/OFF (localStorage)。 net対戦でも自分の打牌のみを手元で評価 (他人には見えない)
let coachOn = true;

// 自分から見えている牌 (自手牌・全河・北抜き・副露・ドラ表示) を除いた残り枚数
function coachRemainingOf(id) {
  let seen = 0;
  G.hands.bottom.forEach(t => { if (t && t.id === id) seen++; });
  for (const s of ALL_SEATS) {
    G.rivers[s].forEach(t => { if (t && t.id === id) seen++; });
    (G.kitaTiles[s] || []).forEach(t => { if (t && t.id === id) seen++; });
    (G.melds[s] || []).forEach(m => (m.tiles || []).forEach(t => { if (t && t.id === id) seen++; }));
  }
  if (G.doraIndicator && G.doraIndicator.id === id) seen++;
  (G.kanDoraInd || []).forEach(t => { if (t && t.id === id) seen++; });
  return Math.max(0, 4 - seen);
}

// 13枚形の受け入れ = シャンテンが進む牌の残り枚数合計 (北は北抜き前提のため対象外)
function coachUkeire(hand13, melds) {
  const base = shantenOf(hand13.concat(melds));
  let total = 0;
  const ids = [];
  for (let id = 0; id < 27; id++) {
    if (id === KITA_ID) continue;
    if (shantenOf(hand13.concat(melds, [{ id, copy: 0, isRed: false }])) < base) {
      const r = coachRemainingOf(id);
      if (r > 0) { total += r; ids.push(id); }
    }
  }
  return { shanten: base, total, ids };
}

// 守備評価コア (G非依存): リーチ中他家の河に対する 打牌の安全度 (現物 > 字牌 > スジ > 無スジ)
// riichiRivers = リーチ中他家の河 (id配列の配列)、 remainOf(id) = 残枚数
function coachSafetyCore(tile, riichiRivers, remainOf) {
  if (!riichiRivers || riichiRivers.length === 0) return null;
  if (riichiRivers.every(riv => riv.includes(tile.id))) {
    return '🛡 <b>現物</b> — リーチに対して安全です';
  }
  if (isJihaiId(tile.id)) {
    return remainOf(tile.id) <= 1
      ? '🛡 字牌 (残りわずか) — 比較的安全'
      : '⚠️ 字牌 — 単騎・シャンポン待ちには注意';
  }
  const n = tileNum(tile.id);
  if (n != null && (isPinId(tile.id) || isSouId(tile.id))) {
    const base = isPinId(tile.id) ? 1 : 10;  // id = base + 数字
    const sujiOk = riichiRivers.every(riv => {
      const rs = new Set(riv);
      if (n <= 3) return rs.has(base + n + 3);
      if (n >= 7) return rs.has(base + n - 3);
      return rs.has(base + n - 3) && rs.has(base + n + 3);
    });
    if (sujiOk) return '🔶 スジ — 両面待ちには当たりにくい牌です (単騎等は注意)';
  }
  return '⚠️ <b>無スジ</b> — リーチに危険な牌です';
}

// 解析コア (G非依存 — ライブ🎓と牌譜ふりかえりで共用):
// hand14 = 手牌14枚相当 / melds3 = 副露の3枚等価 / tile = 検討する捨て牌 (hand14内のオブジェクト)
// remainOf(id) = 残枚数取得 / riichiRivers = リーチ中他家の河 (id配列の配列)
// 戻り値: { mark, cls, msg, safety } / null
function coachAnalyzeCore(hand14, melds3, tile, remainOf, riichiRivers) {
  const evals = hand14.map(t => ({ t, sh: shantenOf(hand14.filter(x => x !== t).concat(melds3)) }));
  const minSh = Math.min(...evals.map(e => e.sh));
  const chosen = evals.find(e => e.t === tile);
  if (!chosen) return null;
  // 受け入れ (牌idごとに1回だけ計算)
  const ukeCache = {};
  const ukeOf = (t) => {
    if (!(t.id in ukeCache)) {
      const hand13 = hand14.filter(x => x !== t);
      const base = shantenOf(hand13.concat(melds3));
      let total = 0;
      for (let id = 0; id < 27; id++) {
        if (id === KITA_ID) continue;
        if (shantenOf(hand13.concat(melds3, [{ id, copy: 0, isRed: false }])) < base) {
          total += Math.max(0, remainOf(id));
        }
      }
      ukeCache[t.id] = { total };
    }
    return ukeCache[t.id];
  };
  let grade, msg;
  const selName = TILE_NAMES[tile.id];
  if (chosen.sh > minSh) {
    const bests = evals.filter(e => e.sh === minSh);
    const best = bests.reduce((a, b) => (ukeOf(b.t).total > ukeOf(a.t).total ? b : a), bests[0]);
    const bn = TILE_NAMES[best.t.id];
    msg = minSh === 0
      ? `もったいない — <b>${bn}</b>切りなら テンパイでした`
      : `もったいない — <b>${bn}</b>切りなら テンパイまで あと${minSh}枚 (${selName}切りは あと${chosen.sh}枚)`;
    grade = ['✖', 'bad'];
  } else {
    const myUke = ukeOf(tile);
    const bestTotal = Math.max(...evals.filter(e => e.sh === minSh).map(e => ukeOf(e.t).total));
    if (minSh === 0) {
      const waits = waitingIds(hand14.filter(x => x !== tile), melds3);
      const wLabel = waits.map(id => TILE_NAMES[id]).join('・');
      if (myUke.total >= bestTotal) { grade = ['◎', 'best']; msg = `最善! テンパイ — 待ち: ${wLabel} (残${myUke.total}枚)`; }
      else { grade = ['○', 'good']; msg = `テンパイ — 待ち: ${wLabel} (残${myUke.total}枚)。 より広い待ちもありました (最大${bestTotal}枚)`; }
    } else if (myUke.total >= bestTotal) {
      grade = ['◎', 'best']; msg = `最善です! 受け入れ${myUke.total}枚`;
    } else if (bestTotal - myUke.total <= 4) {
      grade = ['○', 'good']; msg = `いい選択 (受け入れ${myUke.total}枚 / 最大${bestTotal}枚)`;
    } else {
      const best = evals.filter(e => e.sh === minSh).reduce((a, b) => (ukeOf(b.t).total > ukeOf(a.t).total ? b : a));
      grade = ['△', 'ok']; msg = `おしい — <b>${TILE_NAMES[best.t.id]}</b>切りなら受け入れ${bestTotal}枚 (今回${myUke.total}枚)`;
    }
  }
  return { mark: grade[0], cls: grade[1], msg, safety: coachSafetyCore(tile, riichiRivers, remainOf) };
}

// 打牌評価本体 (ライブ🎓): 実際に捨てる直前 (手牌14枚のうち) に呼ぶ。
// リーチ確定後のツモ切りは選択の余地がないため対象外
function coachEvaluateDiscard(tile) {
  if (!coachOn || G.roundOver) return;
  if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') return;
  try {
    const riichiRivers = ALL_SEATS
      .filter(s => s !== 'bottom' && s !== G.emptySeat && G.isRiichi[s])
      .map(s => G.rivers[s].map(t => t.id));
    const r = coachAnalyzeCore(G.hands.bottom, meldTriples('bottom'), tile, coachRemainingOf, riichiRivers);
    if (!r) return;
    let html = `<span class="coach-grade coach-grade--${r.cls}">${r.mark}</span> ${r.msg}`;
    if (r.safety) html += `<span class="coach-safety">${r.safety}</span>`;
    showCoach(html);
  } catch (e) { /* 評価失敗でもゲームは止めない */ }
}

let _coachTimer = null;
function showCoach(html) {
  const el = document.getElementById('coach-banner');
  if (!el) return;
  el.innerHTML = '🎓 ' + html;
  el.hidden = false;
  if (_coachTimer) clearTimeout(_coachTimer);
  _coachTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// ============================================================
// 牌譜ふりかえり (局の全手順を記録 → コーチエンジンで全手採点)
//   保存: あがり局 直近3 + 振込局 直近3 (localStorage、 端末保持)
//   ソロ/net ホストで記録 (net ゲストは v1 対象外)
// ============================================================
const KIFU_LS_KEY = 'omoroi-kifu-v1';
const KIFU = { steps: [], active: false, lastSaved: null };

function kifuStartRound() {
  KIFU.steps = [];
  KIFU.active = true;
  KIFU.lastSaved = null;
  const endKifuBtn = document.getElementById('end-kifu');
  if (endKifuBtn) endKifuBtn.hidden = true;
}

// 自分の打牌1手を記録 (捨てる直前の状態スナップショット)。 auto = リーチ後の自動ツモ切り
function kifuRecordStep(tile, opts = {}) {
  if (!KIFU.active || G.roundOver) return;
  try {
    const meldsSnap = {};
    ALL_SEATS.forEach(s => { meldsSnap[s] = (G.melds[s] || []).map(m => ({ type: m.type, id: m.id, n: m.tiles.length })); });
    KIFU.steps.push({
      hand: G.hands.bottom.map(t => ({ id: t.id, isRed: !!t.isRed })),
      drawnIdx: (G.justDrawn != null) ? G.justDrawn : null,
      chosenIdx: G.hands.bottom.indexOf(tile),
      auto: !!opts.auto,
      declaring: G.justRiichiDeclared === 'bottom',
      myRiichi: G.isRiichi.bottom,
      riichi: ALL_SEATS.filter(s => s !== 'bottom' && s !== G.emptySeat && G.isRiichi[s]),
      rivers: Object.fromEntries(ALL_SEATS.map(s => [s, G.rivers[s].map(t => t.id)])),
      kitas: Object.fromEntries(ALL_SEATS.map(s => [s, (G.kitaTiles[s] || []).map(t => t.id)])),
      melds: meldsSnap,
      doraInd: G.doraIndicator ? G.doraIndicator.id : null,
      kanDora: (G.kanDoraInd || []).map(t => t.id),
      remain: G.drawTiles.length,
    });
  } catch (e) { /* 記録失敗でもゲームは止めない */ }
}

function kifuLoad() {
  try {
    const j = JSON.parse(localStorage.getItem(KIFU_LS_KEY) || '{}');
    return { wins: j.wins || [], dealins: j.dealins || [] };
  } catch (e) { return { wins: [], dealins: [] }; }
}

// 局終了時に保存 (showWinModal から): type = 'win' | 'dealin'
function kifuFinishRound(type, summary) {
  if (!KIFU.active || KIFU.steps.length === 0) return;
  KIFU.active = false;  // 二重保存防止
  try {
    const entry = { ts: Date.now(), round: G.round, honba: G.honba, type, summary, steps: KIFU.steps };
    const store = kifuLoad();
    const key = type === 'win' ? 'wins' : 'dealins';
    store[key].push(entry);
    store[key] = store[key].slice(-3);  // 直近3局のみ保持
    localStorage.setItem(KIFU_LS_KEY, JSON.stringify(store));
    KIFU.lastSaved = entry;
  } catch (e) { /* 保存失敗でもゲームは止めない */ }
}

// ─── 牌譜: 1手の再採点 (スナップショットから コーチコアを再実行) ───
function kifuEvalStep(step) {
  // 見えていた牌 → 残枚数
  const seen = {};
  const add = (id) => { seen[id] = (seen[id] || 0) + 1; };
  step.hand.forEach(h => add(h.id));
  for (const s of ALL_SEATS) {
    (step.rivers[s] || []).forEach(add);
    (step.kitas[s] || []).forEach(add);
    (step.melds[s] || []).forEach(m => { for (let k = 0; k < m.n; k++) add(m.id); });
  }
  if (step.doraInd != null) add(step.doraInd);
  (step.kanDora || []).forEach(add);
  const remainOf = (id) => Math.max(0, 4 - (seen[id] || 0));
  const hand14 = step.hand.map((h, i) => ({ id: h.id, copy: i, isRed: h.isRed }));
  const tile = hand14[step.chosenIdx];
  const melds3 = (step.melds.bottom || [])
    .flatMap(m => [0, 1, 2].map(k => ({ id: m.id, copy: 100 + k, isRed: false })));
  const riichiRivers = (step.riichi || []).map(s => step.rivers[s] || []);
  if (!tile) return null;
  if (step.auto) {
    // リーチ後の自動ツモ切り: 採点対象外、 安全度情報のみ
    return { mark: '🔒', cls: 'auto', msg: 'リーチ後の自動ツモ切り (選択の余地なし)',
             safety: coachSafetyCore(tile, riichiRivers, remainOf) };
  }
  return coachAnalyzeCore(hand14, melds3, tile, remainOf, riichiRivers);
}

// ─── ⚙️ 対局中設定 (雀魂の 理/和/鳴/切 を参考: 理牌=常時自動、 ツモ切り=非採用) ───
// 鳴きなし: 自分へのポン/カン確認を自動スルー / 自動和了: ツモ・ロン可能時に自動あがり /
// 自動北抜き: 北をツモったら自動で抜く / 効果音・AI採点: 既存トグルを集約
let optNoNaki = false;
let optAutoWin = false;
let optAutoKita = false;

function loadGameOptions() {
  optNoNaki = localStorage.getItem('omoroi-opt-nonaki') === '1';
  optAutoWin = localStorage.getItem('omoroi-opt-autowin') === '1';
  optAutoKita = localStorage.getItem('omoroi-opt-autokita') === '1';
  seMuted = localStorage.getItem('omoroi-se-muted') === '1';
  coachOn = localStorage.getItem('omoroi-coach') !== '0';
}

function openSettings() {
  let ov = document.getElementById('settings-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'settings-overlay';
    ov.className = 'end-overlay settings-overlay';  // 既存モーダルとデザイン統一
    ov.hidden = true;
    const row = (id, icon, label, desc) => `
      <label class="settings-row" for="${id}">
        <span class="settings-row__main">${icon} ${label}<span class="settings-row__desc">${desc}</span></span>
        <input type="checkbox" id="${id}" class="settings-row__cb">
      </label>`;
    ov.innerHTML = `
      <div class="end-modal settings-modal">
        <h2 class="end-modal__title">⚙️ 対局設定</h2>
        <div class="settings-body">
          ${row('opt-nonaki', '🚫', '鳴きなし', 'ポン・カンの確認を自動でスルー (ロンは出ます)')}
          ${row('opt-autowin', '🎉', '自動和了', 'ツモ・ロンできる時に自動であがる')}
          ${row('opt-autokita', '🀃', '自動北抜き', '北をツモったら自動で抜く')}
          ${row('opt-se', '🔊', '効果音・ボイス', '打牌音や「リーチ!」等の発声')}
          ${row('opt-coach', '🎓', 'AI採点コーチ', '打牌のたびに一言評価 (牌効率+安全度)')}
        </div>
        <div class="end-modal__nav">
          <button class="end-modal__btn kifu-btn" id="settings-close">閉じる</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    // トグル反映 (即時保存)
    const bind = (id, fn) => document.getElementById(id).addEventListener('change', (e) => fn(e.target.checked));
    bind('opt-nonaki', (v) => { optNoNaki = v; localStorage.setItem('omoroi-opt-nonaki', v ? '1' : '0'); toast(v ? '🚫 鳴きなし ON — ポン/カン確認をスルーします' : '🚫 鳴きなし OFF'); });
    bind('opt-autowin', (v) => { optAutoWin = v; localStorage.setItem('omoroi-opt-autowin', v ? '1' : '0'); toast(v ? '🎉 自動和了 ON' : '🎉 自動和了 OFF'); updateActionButtons(); });
    bind('opt-autokita', (v) => { optAutoKita = v; localStorage.setItem('omoroi-opt-autokita', v ? '1' : '0'); toast(v ? '🀃 自動北抜き ON' : '🀃 自動北抜き OFF'); updateActionButtons(); });
    bind('opt-se', (v) => {
      seMuted = !v;
      localStorage.setItem('omoroi-se-muted', seMuted ? '1' : '0');
      if (seMuted) { try { window.speechSynthesis?.cancel(); } catch (e) {} }
      else playVoice('on');
    });
    bind('opt-coach', (v) => {
      coachOn = v;
      localStorage.setItem('omoroi-coach', v ? '1' : '0');
      if (!v) { const cb = document.getElementById('coach-banner'); if (cb) cb.hidden = true; }
    });
    // Esc閉じ + Tabフォーカストラップ (capture でゲームショートカットより優先)
    document.addEventListener('keydown', (e) => {
      const o = document.getElementById('settings-overlay');
      if (!o || o.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); }
      else if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        const items = Array.from(o.querySelectorAll('input, button'));
        const i = items.indexOf(document.activeElement);
        const ni = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1);
        items[ni].focus();
      } else { e.stopPropagation(); }
    }, true);
  }
  // 現在値を反映して表示
  document.getElementById('opt-nonaki').checked = optNoNaki;
  document.getElementById('opt-autowin').checked = optAutoWin;
  document.getElementById('opt-autokita').checked = optAutoKita;
  document.getElementById('opt-se').checked = !seMuted;
  document.getElementById('opt-coach').checked = coachOn;
  ov.hidden = false;
  document.getElementById('settings-close').focus();
}
function closeSettings() {
  const ov = document.getElementById('settings-overlay');
  if (ov) ov.hidden = true;
}

// ─── 自動プレイ (⚙️設定: 自動和了 / 自動北抜き) — updateActionButtons 末尾から発火 ───
let _autoTimer = null;
function scheduleAutoPlays() {
  if (_autoTimer) return;
  if (!optAutoWin && !optAutoKita) return;
  _autoTimer = setTimeout(() => {
    _autoTimer = null;
    try {
      if (G.roundOver || G.gameEnded) return;
      if (optAutoWin) {
        const t = document.getElementById('btn-tsumo');
        if (t && !t.disabled) { t.click(); return; }
        const r = document.getElementById('btn-ron');
        if (r && !r.disabled) { r.click(); return; }
      }
      if (optAutoKita && G.turn === 'bottom' && !G.busy && !G.isRiichi.bottom) {
        const k = document.getElementById('btn-kita');
        if (k && !k.disabled) { k.click(); return; }
      }
    } catch (e) { /* 自動操作失敗でもゲームは止めない */ }
  }, 350);
}

// ─── 共通確認モーダル (破壊的操作の最終確認 — 退出/見逃し等。 Esc=キャンセル/Tabトラップ/44px) ───
let _confirmOnOk = null;
function appConfirm(message, onOk, okLabel = 'はい', cancelLabel = 'やめる') {
  let ov = document.getElementById('confirm-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'confirm-overlay';
    ov.className = 'end-overlay confirm-overlay';  // 既存モーダルとデザイン統一
    ov.hidden = true;
    ov.innerHTML = `
      <div class="end-modal confirm-modal">
        <p class="end-modal__text confirm-modal__text" id="confirm-text"></p>
        <div class="end-modal__nav">
          <button class="end-modal__btn end-modal__btn--secondary kifu-btn" id="confirm-cancel">やめる</button>
          <button class="end-modal__btn kifu-btn confirm-ok" id="confirm-ok">はい</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById('confirm-cancel').addEventListener('click', appConfirmClose);
    document.getElementById('confirm-ok').addEventListener('click', () => {
      const fn = _confirmOnOk;
      appConfirmClose();
      if (fn) fn();
    });
    // Esc=キャンセル / Tabトラップ (capture でゲーム側キー操作より優先)
    document.addEventListener('keydown', (e) => {
      const o = document.getElementById('confirm-overlay');
      if (!o || o.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); appConfirmClose(); }
      else if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        const btns = [document.getElementById('confirm-cancel'), document.getElementById('confirm-ok')];
        btns[document.activeElement === btns[0] ? 1 : 0].focus();
      } else if (e.key === 'Enter') {
        // Enter 誤爆で OK にしない (フォーカスされたボタンのみ発火に任せる)
        if (document.activeElement !== document.getElementById('confirm-ok')) { e.preventDefault(); e.stopPropagation(); }
      } else {
        e.stopPropagation();  // 確認中は R/T/L 等のゲームショートカットを止める
      }
    }, true);
  }
  document.getElementById('confirm-text').innerHTML = message;
  document.getElementById('confirm-ok').textContent = okLabel;
  document.getElementById('confirm-cancel').textContent = cancelLabel;
  _confirmOnOk = onOk;
  ov.hidden = false;
  document.getElementById('confirm-cancel').focus();  // 既定フォーカスは安全側 (キャンセル)
}
function appConfirmClose() {
  const ov = document.getElementById('confirm-overlay');
  if (ov) ov.hidden = true;
  _confirmOnOk = null;
}

// ロビーへ戻る確認 (対局状況に応じてメッセージ切替、 半荘終了後は確認なしで直行)
let _leavingConfirmed = false;
function confirmLeaveToLobby() {
  const inGame = G.hands.bottom.length > 0 && !G.gameEnded;
  if (!inGame) { _leavingConfirmed = true; location.href = 'index.html'; return; }
  const n = NETQ();
  let msg;
  if (n && n.isGuest && n.isGuest()) {
    msg = 'ルームから退出して ロビーへ戻りますか?<br><b>対戦の途中です</b> — 退出すると この対戦には戻れません (あなたの手番はCPUが代打ちします)';
  } else if (n && n.isHost && n.isHost()) {
    msg = 'ロビーへ戻りますか?<br><b>あなたはホストです</b> — 退出すると ルーム全体の対戦が終了します';
  } else {
    msg = 'ロビーへ戻りますか?<br>進行中の半荘は ここで終了します (保存されません)';
  }
  appConfirm(msg, () => { _leavingConfirmed = true; location.href = 'index.html'; }, '退出する', 'つづける');
}

// ─── 牌譜ビューア (リザルト/ロビー共用のオーバーレイ、 Esc/←→/Tabトラップ対応) ───
let _kifuView = null;  // { entry, idx, evals, fromList }
function kifuEnsureOverlay() {
  let ov = document.getElementById('kifu-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'kifu-overlay';
  ov.className = 'end-overlay';  // 既存モーダルとデザイン統一
  ov.hidden = true;
  ov.innerHTML = `
    <div class="end-modal kifu-modal">
      <h2 class="end-modal__title" id="kifu-title">📖 牌譜ふりかえり</h2>
      <div id="kifu-body" class="kifu-body"></div>
      <div class="kifu-nav" id="kifu-stepnav">
        <button class="end-modal__btn end-modal__btn--secondary kifu-btn" id="kifu-prev">◀ 前へ</button>
        <button class="end-modal__btn end-modal__btn--secondary kifu-btn" id="kifu-bad" title="次の △/✖ の手へジャンプ">△✖へ</button>
        <button class="end-modal__btn kifu-btn" id="kifu-next">次へ ▶</button>
      </div>
      <div class="kifu-nav">
        <button class="end-modal__btn end-modal__btn--secondary kifu-btn" id="kifu-back">閉じる</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('kifu-prev').addEventListener('click', () => kifuStepMove(-1));
  document.getElementById('kifu-next').addEventListener('click', () => kifuStepMove(1));
  document.getElementById('kifu-bad').addEventListener('click', kifuJumpBad);
  document.getElementById('kifu-back').addEventListener('click', kifuBack);
  return ov;
}
function kifuClose() {
  const ov = document.getElementById('kifu-overlay');
  if (ov) ov.hidden = true;
  _kifuView = null;
}
function kifuBack() {
  if (_kifuView && _kifuView.fromList) kifuOpenList();
  else kifuClose();
}
function kifuStepMove(d) {
  if (!_kifuView || !_kifuView.entry) return;
  const n = _kifuView.entry.steps.length;
  _kifuView.idx = Math.min(n - 1, Math.max(0, _kifuView.idx + d));
  kifuRenderStep();
}
function kifuJumpBad() {
  if (!_kifuView || !_kifuView.entry) return;
  const { evals, idx } = _kifuView;
  for (let i = 1; i <= evals.length; i++) {
    const j = (idx + i) % evals.length;
    const e = evals[j];
    if (e && (e.cls === 'ok' || e.cls === 'bad')) { _kifuView.idx = j; kifuRenderStep(); return; }
  }
  toast('△✖の手はありません — 全手ナイス打牌!');
}

// 牌譜一覧 (ロビー/ゲーム共通)
function kifuOpenList() {
  const ov = kifuEnsureOverlay();
  const store = kifuLoad();
  const fmt = (ts) => {
    const d = new Date(ts);
    const z = (x) => String(x).padStart(2, '0');
    return `${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  };
  const row = (e, i, key) => {
    const s = e.summary || {};
    const badge = e.type === 'win'
      ? `<span class="kifu-badge kifu-badge--win">🏆 あがり</span>`
      : `<span class="kifu-badge kifu-badge--dealin">💥 振込</span>`;
    const desc = e.type === 'win'
      ? `${s.winType || ''} ${s.tier || ''} (${(s.yaku || []).slice(0, 3).join('・')}${(s.yaku || []).length > 3 ? '…' : ''})`
      : `${s.winnerLabel || '他家'}に ${s.tier || ''} ${s.chankan ? '(搶槓)' : ''}`;
    return `<button class="kifu-row kifu-btn" data-key="${key}" data-i="${i}">${badge}
      <span class="kifu-row__main">${e.round}局${e.honba ? ` ${e.honba}本場` : ''} — ${desc}</span>
      <span class="kifu-row__sub">${fmt(e.ts)} / ${e.steps.length}手</span></button>`;
  };
  const store2 = { wins: [...store.wins].reverse(), dealins: [...store.dealins].reverse() };  // 新しい順
  let html = '<div class="kifu-list">';
  html += '<p class="kifu-section">🏆 あがった局 (直近3局)</p>';
  html += store2.wins.length ? store2.wins.map((e, i) => row(e, i, 'wins')).join('') : '<p class="kifu-empty">まだありません — あがるとここに残ります</p>';
  html += '<p class="kifu-section">💥 振り込んだ局 (直近3局)</p>';
  html += store2.dealins.length ? store2.dealins.map((e, i) => row(e, i, 'dealins')).join('') : '<p class="kifu-empty">まだありません — 振り込むとここに残ります</p>';
  html += '<p class="kifu-note">各手順を 🎓コーチエンジンが再採点します (牌効率+安全度)。 ←→キー / ボタンで手順送り。</p>';
  html += '</div>';
  document.getElementById('kifu-title').textContent = '📖 牌譜ふりかえり';
  document.getElementById('kifu-body').innerHTML = html;
  document.getElementById('kifu-stepnav').hidden = true;
  document.getElementById('kifu-back').textContent = '閉じる';
  _kifuView = { list: store2 };
  ov.hidden = false;
  document.getElementById('kifu-body').querySelectorAll('.kifu-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const e = _kifuView.list[btn.dataset.key][Number(btn.dataset.i)];
      if (e) kifuOpenViewer(e, true);
    });
  });
}

// 牌譜ビューア本体
function kifuOpenViewer(entry, fromList = false) {
  const ov = kifuEnsureOverlay();
  // 全手を先に採点 (ドット色 + 悪手ジャンプ用)
  const evals = entry.steps.map(st => { try { return kifuEvalStep(st); } catch (e) { return null; } });
  _kifuView = { entry, evals, idx: 0, fromList };
  // 振込局は 放銃の1打 (最終手) から開く
  if (entry.type === 'dealin' && !entry.summary?.chankan) _kifuView.idx = entry.steps.length - 1;
  document.getElementById('kifu-stepnav').hidden = false;
  document.getElementById('kifu-back').textContent = fromList ? '← 一覧へ' : '閉じる';
  ov.hidden = false;
  kifuRenderStep();
}

function kifuRenderStep() {
  if (!_kifuView || !_kifuView.entry) return;
  const { entry, evals, idx } = _kifuView;
  const step = entry.steps[idx];
  const ev = evals[idx];
  const s = entry.summary || {};
  const typeBadge = entry.type === 'win'
    ? '<span class="kifu-badge kifu-badge--win">🏆 あがり局</span>'
    : '<span class="kifu-badge kifu-badge--dealin">💥 振込局</span>';
  document.getElementById('kifu-title').innerHTML = `📖 ${entry.round}局${entry.honba ? ` ${entry.honba}本場` : ''} ${typeBadge}`;

  // ドット (手順ごとの評価色、 現在手は枠)
  let dots = '<div class="kifu-dots">';
  evals.forEach((e, i) => {
    const cls = e ? e.cls : 'auto';
    dots += `<span class="kifu-dot kifu-dot--${cls}${i === idx ? ' kifu-dot--cur' : ''}"></span>`;
  });
  dots += '</div>';

  // 手牌表示 (ソート + ツモ牌分離、 選択打牌を赤枠)
  const hand14 = step.hand.map((h, i) => ({ ...h, _i: i }));
  const drawn = (step.drawnIdx != null) ? hand14[step.drawnIdx] : null;
  const rest = hand14.filter(h => h !== drawn).sort((a, b) => a.id - b.id);
  const tileHtml = (h, extra = '') => tileSpanHtml({ id: h.id }, `width:20px; height:27px; ${h._i === step.chosenIdx ? 'box-shadow: 0 0 0 2px #f44336, 0 0 8px rgba(244,67,54,0.8);' : ''} ${extra}`);
  let handHtml = '<div class="kifu-hand">';
  handHtml += rest.map(h => tileHtml(h)).join('');
  if (drawn) handHtml += '<span style="display:inline-block; width:8px;"></span>' + tileHtml(drawn);
  handHtml += `<div class="kifu-hand__note">手順 ${idx + 1}/${entry.steps.length} — 赤枠 = 実際に切った牌${drawn ? ' / 右端 = ツモ牌' : ''}${step.declaring ? ' / 🔴リーチ宣言打' : ''}</div>`;
  handHtml += '</div>';

  // 評価ボックス
  let evalHtml = '<div class="kifu-eval">';
  if (ev) {
    evalHtml += `<span class="coach-grade coach-grade--${ev.cls}">${ev.mark}</span> ${ev.msg}`;
    if (ev.safety) evalHtml += `<span class="coach-safety">${ev.safety}</span>`;
  } else {
    evalHtml += '評価できませんでした';
  }
  evalHtml += '</div>';

  // 状況情報 (ドラ/山残/リーチ者)
  let infoHtml = '<div class="kifu-info">';
  if (step.doraInd != null) infoHtml += `ドラ表示: ${TILE_NAMES[step.doraInd]}`;
  if ((step.kanDora || []).length) infoHtml += ` / カンドラ表示: ${step.kanDora.map(id => TILE_NAMES[id]).join('・')}`;
  infoHtml += ` / 山残 ${step.remain}`;
  if ((step.riichi || []).length) infoHtml += ` / 🔴リーチ者: ${step.riichi.map(r => SEAT_LABEL_BASE[r]).join('・')}`;
  infoHtml += '</div>';

  // 振込局の最終手: 敗因分析パネル
  let dealinHtml = '';
  const isDealinStep = (entry.type === 'dealin' && idx === entry.steps.length - 1);
  if (isDealinStep) {
    const chosenId = (step.hand[step.chosenIdx] || {}).id;
    const autoDealt = (s.winTileId != null && chosenId !== s.winTileId);  // 記録外のリーチ自動ツモ切り等で放銃
    dealinHtml = '<div class="kifu-dealin">';
    if (s.chankan) {
      dealinHtml += `<b>💥 搶槓されました</b> — 加槓した牌 (${s.winTileId != null ? TILE_NAMES[s.winTileId] : '?'}) を ${s.winnerLabel || '他家'} がロン。 ポン済みの牌で他家がテンパイしていそうな時の加槓は要注意です。`;
    } else if (autoDealt) {
      dealinHtml += `<b>💥 ${TILE_NAMES[s.winTileId]} で ${s.winnerLabel || '他家'} に放銃</b> (${s.tier || ''} — リーチ後の自動ツモ切りなど、 この記録の後の打牌でした)`;
    } else {
      dealinHtml += `<b>💥 この1打で ${s.winnerLabel || '他家'} に放銃</b> (${s.tier || ''}${s.yaku && s.yaku.length ? ' — ' + s.yaku.slice(0, 4).join('・') : ''})`;
      if (s.winnerSeat && step.rivers[s.winnerSeat]) {
        const winnerRiver = new Set(step.rivers[s.winnerSeat]);
        const safeIds = [...new Set(step.hand.map(h => h.id))].filter(id => winnerRiver.has(id));
        dealinHtml += safeIds.length
          ? `<br>🛡 この時 手牌にあった<b>現物 (振り込まなかった牌)</b>: ${safeIds.map(id => TILE_NAMES[id]).join('・')}`
          : '<br>現物は手牌にありませんでした — 難しい局面でした';
      }
      if ((s.winnerHand || []).length) {
        dealinHtml += `<br>相手の手: <span class="kifu-mini-tiles">${s.winnerHand.map(id => tileSpanHtml({ id }, 'width:18px; height:24px;')).join('')}</span>`;
      }
    }
    dealinHtml += '</div>';
  }
  // あがり局の最終手: あがりサマリ
  let winHtml = '';
  if (entry.type === 'win' && idx === entry.steps.length - 1) {
    winHtml = `<div class="kifu-win"><b>🏆 この局は ${s.winType || ''}あがり!</b> ${s.tier || ''}${s.yaku && s.yaku.length ? ' — ' + s.yaku.join('・') : ''}</div>`;
  }

  document.getElementById('kifu-body').innerHTML = dots + handHtml + evalHtml + infoHtml + dealinHtml + winHtml;
  document.getElementById('kifu-prev').disabled = (idx === 0);
  document.getElementById('kifu-next').disabled = (idx === entry.steps.length - 1);
}

// ロビーの 📖牌譜 ボタン (index.html)
if (typeof document !== 'undefined' && document.addEventListener) {
  const bindKifuLobby = () => document.getElementById('btn-kifu')?.addEventListener('click', kifuOpenList);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindKifuLobby);
  else bindKifuLobby();
}

// キー操作 (capture: ゲーム側の ←→ より先に取り、 ビューア表示中はゲームへ通さない)
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', (e) => {
    const ov = document.getElementById('kifu-overlay');
    if (!ov || ov.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kifuClose(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); kifuStepMove(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); kifuStepMove(1); }
    else if (e.key === 'Tab') {
      // フォーカストラップ: ビューア内のボタンのみ循環
      const btns = Array.from(ov.querySelectorAll('button')).filter(b => !b.disabled && !b.hidden && b.offsetParent !== null);
      if (btns.length) {
        e.preventDefault(); e.stopPropagation();
        const i = btns.indexOf(document.activeElement);
        const ni = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i < 0 || i === btns.length - 1 ? 0 : i + 1);
        btns[ni].focus();
      }
    }
  }, true);
}

// ─── リーチ中の待ち牌ガイド (雀魂式: 牌画像+残り枚数を 手牌の上に常時表示) ──
function renderRiichiGuide() {
  const el = document.getElementById('riichi-guide');
  if (!el) return;
  if (!G.isRiichi.bottom || G.roundOver) {
    el.hidden = true;
    return;
  }
  // ガイド本体を組み立てる共通部品
  const build = (labelText, waits, withFuriten) => {
    el.innerHTML = '';
    const lab = document.createElement('span');
    lab.className = 'riichi-guide__label';
    lab.textContent = labelText;
    el.appendChild(lab);
    waits.forEach(id => {
      el.appendChild(createTileEl({ id, copy: 0, isRed: false }, { mini: true }));
      const c = document.createElement('span');
      c.className = 'riichi-guide__count';
      c.textContent = `残${Math.max(0, 4 - visibleCountOf(id))}`;
      el.appendChild(c);
    });
    if (withFuriten) {
      const furiten = G.rivers.bottom.some(t => waits.includes(t.id)) || G.passFuriten.bottom || G.tempFuriten.bottom;
      if (furiten) {
        const f = document.createElement('span');
        f.className = 'riichi-guide__furiten';
        f.textContent = '⚠️フリテン(ロン不可)';
        el.appendChild(f);
      }
    }
    el.hidden = false;
  };

  // ① リーチ宣言中 (宣言牌を選んでいる最中): 選択中の候補牌で あがり牌をプレビュー
  if (G.justRiichiDeclared === 'bottom') {
    const keepers = G.hands.bottom.filter(t => isTenpai13(G.hands.bottom.filter(x => x !== t), meldTriples('bottom')));
    if (keepers.length === 0) { el.hidden = true; return; }
    const target = (G.selected && keepers.includes(G.selected)) ? G.selected : keepers[0];
    const waits = waitingIds(G.hands.bottom.filter(t => t !== target), meldTriples('bottom'));
    if (waits.length === 0) { el.hidden = true; return; }
    const multi = keepers.length > 1 ? ' (光る牌タップで切替)' : '';
    build(`🔴${TILE_NAMES[target.id]}を切ると → あがり牌:`, waits, true);
    if (multi) {
      const m = document.createElement('span');
      m.className = 'riichi-guide__count';
      m.textContent = multi;
      el.appendChild(m);
    }
    return;
  }

  // ② リーチ成立後: 確定した待ちを常時表示
  // 14枚時 (ツモ直後の自動処理中) は ツモ牌を除いた 13枚で待ちを計算
  const base = (hasDrawn('bottom') && G.justDrawn != null)
    ? G.hands.bottom.filter((_, i) => i !== G.justDrawn)
    : G.hands.bottom;
  if (base.length !== 13) { el.hidden = true; return; }
  const waits = waitingIds(base, meldTriples('bottom'));
  if (waits.length === 0) { el.hidden = true; return; }
  build('🔴リーチ中 — あがり牌:', waits, true);
}

// ─── アクションボタン ─────────────────────────
function updateActionButtons() {
  const myTurn = (G.turn === 'bottom' && !G.busy);
  const has14 = hasDrawn('bottom');
  document.getElementById('btn-discard').disabled = !(myTurn && has14 && G.selected);
  // 北抜き: 通常は 手牌に北があれば可、 リーチ後は 「ツモった牌が北」 の時のみ
  const drawnTile = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
  const hasKita = G.hands.bottom.some(t => t.id === KITA_ID);
  const kitaOk = canRinshanDraw() && G.justRiichiDeclared !== 'bottom'
    && (G.isRiichi.bottom ? (drawnTile && drawnTile.id === KITA_ID) : hasKita);
  document.getElementById('btn-kita').disabled = !(myTurn && has14 && kitaOk);
  // 暗槓: 自分の番 + ツモ済 + 同一牌4枚 + 王牌残2以上 (リーチ中は不可)
  const callable = (G.pendingCall && !G.pendingCall.cpu);
  const kanBtn = document.getElementById('btn-kan');
  if (kanBtn) kanBtn.disabled = !((myTurn && has14 && G.justRiichiDeclared !== 'bottom'
      && (ankanCandidateIds('bottom').length > 0 || kakanCandidateIds('bottom').length > 0))
    || (callable && G.pendingCall.canKan));
  const ponBtn = document.getElementById('btn-pon');
  if (ponBtn) ponBtn.disabled = !callable;
  // ツモ判定: 14牌でかつ あがり形 + 役あり (ドラ・北だけはNG)
  // ※ リーチ宣言直後 (宣言牌を捨てる前) は ツモ不可 (宣言牌を捨ててリーチ成立が先)
  let canTsumo = false;
  if (myTurn && has14 && G.justDrawn != null && G.justRiichiDeclared !== 'bottom') {
    if (isWinning(equivHand('bottom'))) {
      const result = calcYaku(equivHand('bottom'), {
        isTsumo: true, isRiichi: G.isRiichi.bottom, isOya: G.oya === 'bottom', seatWind: seatWindOf('bottom'),
        doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles('bottom'), openMeldIds: openMeldIds('bottom'), kitas: G.kitas.bottom, round: G.round,
        isDoubleRiichi: G.doubleRiichi.bottom, firstDraw: G.rivers.bottom.length === 0 && G.kitas.bottom === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft.bottom > 0, winTile: drawnTile,
        isRinshan: G.justKanDrawn === 'bottom',
      });
      canTsumo = !result.error && (result.han > 0 || result.isYakuman);
    }
  }
  const tsumoBtn = document.getElementById('btn-tsumo');
  if (tsumoBtn) tsumoBtn.disabled = !canTsumo;
  // ロン判定: pendingRon あれば active (パスも同時に有効化)
  const ronBtn = document.getElementById('btn-ron');
  if (ronBtn) ronBtn.disabled = !G.pendingRon;
  const passBtn = document.getElementById('btn-pass');
  if (passBtn) passBtn.disabled = !(G.pendingRon || callable);
  // リーチ判定: 自分の番、 14牌、 リーチしてない、 1000点以上、 テンパイ (= 1枚捨てたらテンパイ形)
  // 宣言直後 (打牌前) は 「リーチ取消」 ボタンとして有効化
  const riichiBtn = document.getElementById('btn-riichi');
  if (riichiBtn) {
    if (G.justRiichiDeclared === 'bottom') {
      riichiBtn.textContent = 'リーチ取消';
      riichiBtn.disabled = !(G.turn === 'bottom' && !G.busy);
    } else {
      riichiBtn.textContent = 'リーチ';
      let canRiichi = false;
      if (myTurn && has14 && !G.isRiichi.bottom && G.scores.bottom >= 1000 && openMeldIds('bottom').length === 0) {
        canRiichi = canDeclareRiichi(G.hands.bottom, meldTriples('bottom'));
      }
      riichiBtn.disabled = !canRiichi;
    }
  }

  // ─── コンテキスト表示 (雀魂式): 押せないボタンは隠す ───
  // 打牌のみ 「自分の番なら常設」 (選択前は disabled のまま見せて 操作の目印にする)。
  // ツモ/ロンは同時に成立しないため、 あがれる時はどちらか1つだけが現れる
  const discardBtn2 = document.getElementById('btn-discard');
  if (discardBtn2) discardBtn2.hidden = !(myTurn && has14 && G.justRiichiDeclared !== 'bottom' || (G.justRiichiDeclared === 'bottom' && G.turn === 'bottom'));
  ['btn-riichi', 'btn-tsumo', 'btn-ron', 'btn-pass', 'btn-pon', 'btn-kita', 'btn-kan'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.hidden = b.disabled;
  });
  // パスボタンの文言: ロン見逃し と 鳴きスルー で切替
  if (passBtn && !passBtn.hidden) passBtn.textContent = G.pendingRon ? '見逃す' : 'スルー';
  // ⚙️自動設定 (自動和了/自動北抜き) の発火
  scheduleAutoPlays();
}

// ─── シャンテン数 (テンパイまでの残り枚数、 標準形+七対子+国士の最小) ───
// 13牌: 0=テンパイ、 1=あと1枚、 ... / 14牌: -1=あがり形
function seqPartialOk(a, b) {
  // a<b が 同色数牌の 両面/嵌張 塔子になれるか (萬子は1m/9mのみで塔子不可)
  const na = tileNum(a), nb = tileNum(b);
  if (na == null || nb == null) return false;
  const sameSuit = (isPinId(a) && isPinId(b)) || (isSouId(a) && isSouId(b));
  return sameSuit && (nb - na === 1 || nb - na === 2);
}
function shantenStandardFrom(countsObj) {
  const c = new Array(27).fill(0);
  for (const k in countsObj) c[k] = countsObj[k];
  let best = 8;
  function rec(start, melds, partials, hasPair) {
    let i = start;
    while (i < 27 && c[i] === 0) i++;
    if (i >= 27) {
      const s = 8 - 2 * melds - Math.min(partials, 4 - melds) - (hasPair ? 1 : 0);
      if (s < best) best = s;
      return;
    }
    if (melds < 4) {
      // 刻子
      if (c[i] >= 3) { c[i] -= 3; rec(i, melds + 1, partials, hasPair); c[i] += 3; }
      // 順子
      if (SHUNTSU_HEAD_IDS.includes(i) && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        rec(i, melds + 1, partials, hasPair);
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    // 対子 (雀頭 or 部分面子)
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!hasPair) rec(i, melds, partials, true);
      if (melds + partials < 4) rec(i, melds, partials + 1, hasPair);
      c[i] += 2;
    }
    // 塔子 (両面/嵌張)
    if (melds + partials < 4) {
      if (i + 1 < 27 && c[i + 1] > 0 && seqPartialOk(i, i + 1)) {
        c[i]--; c[i + 1]--; rec(i, melds, partials + 1, hasPair); c[i]++; c[i + 1]++;
      }
      if (i + 2 < 27 && c[i + 2] > 0 && seqPartialOk(i, i + 2)) {
        c[i]--; c[i + 2]--; rec(i, melds, partials + 1, hasPair); c[i]++; c[i + 2]++;
      }
    }
    // この牌を使わない (孤立牌扱い)
    const saved = c[i];
    c[i] = 0;
    rec(i + 1, melds, partials, hasPair);
    c[i] = saved;
  }
  rec(0, 0, 0, false);
  return best;
}
function shantenChiitoi(countsObj) {
  let pairs = 0, kinds = 0;
  for (const k in countsObj) {
    if (countsObj[k] > 0) { kinds++; if (countsObj[k] >= 2) pairs++; }
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}
function shantenKokushi(countsObj) {
  let kinds = 0, hasPair = false;
  for (const id of KOKUSHI_IDS) {
    const n = countsObj[id] || 0;
    if (n > 0) kinds++;
    if (n >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}
function shantenOf(hand) {
  const counts = countTiles(hand);
  return Math.min(shantenStandardFrom(counts), shantenChiitoi(counts), shantenKokushi(counts));
}

// ─── テンパイ判定 (1枚捨てたら 13牌が 聴牌か) ─────
function isTenpai13(hand13, melds = []) {
  // 13牌相当 (手牌 + 副露3枚等価) で 1枚加えたら あがり形になる id があるか
  for (let id = 0; id < 27; id++) {
    const test = [...hand13, ...melds, { id, copy: 0, isRed: false }];
    if (isWinning(test)) return true;
  }
  return false;
}
function canDeclareRiichi(hand14, melds = []) {
  // 14牌相当から 手牌1枚を捨てて 聴牌になるか (副露牌は捨てられない)
  for (let i = 0; i < hand14.length; i++) {
    const tmp = hand14.slice(0, i).concat(hand14.slice(i + 1));
    if (isTenpai13(tmp, melds)) return true;
  }
  return false;
}

// ─── 待ち牌 (13牌相当のテンパイ形が あがれる牌 id 一覧) ──
function waitingIds(hand13, melds = []) {
  const waits = [];
  for (let id = 0; id < 27; id++) {
    if (isWinning([...hand13, ...melds, { id, copy: 0, isRed: false }])) waits.push(id);
  }
  return waits;
}

// ─── フリテン判定 (自分の河に 待ち牌が 1枚でもあれば ロン不可) ──
function isFuriten(seat) {
  const waits = waitingIds(G.hands[seat], meldTriples(seat));
  if (waits.length === 0) return false;
  return G.rivers[seat].some(t => waits.includes(t.id));
}

// ─── ロン判定 (任意の家、 fromSeat の打牌 / isChankan=true なら加槓牌に対して) ──
function checkRonForSeat(seat, fromSeat, tile, isChankan = false) {
  if (seat === G.emptySeat || seat === fromSeat) return null;
  if (G.hands[seat].length !== handFullCount(seat) - 1) return null;
  const test = [...G.hands[seat], tile, ...meldTriples(seat)];
  if (!isWinning(test)) return null;
  // フリテン: 自河に待ち牌 / 見逃しフリテン (自家のみ)
  if (isFuriten(seat)) return null;
  if (G.passFuriten[seat] || G.tempFuriten[seat]) return null;  // 見逃しフリテン (全席)
  const ctx = {
    isTsumo: false, isRiichi: G.isRiichi[seat], isOya: G.oya === seat, seatWind: seatWindOf(seat),
    doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles(seat), openMeldIds: openMeldIds(seat), kitas: G.kitas[seat], round: G.round,
    isDoubleRiichi: G.doubleRiichi[seat], firstDraw: G.rivers[seat].length === 0 && G.kitas[seat] === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft[seat] > 0,
    winTile: tile, fromSeat, isChankan,
  };
  const result = calcYaku(test, ctx);
  // 役なし (= error あり、 ドラ・赤・北だけは 役にならない) はロン不可
  if (result.error || (result.han === 0 && !result.isYakuman)) return null;
  return { result, ctx };
}

function onMyHandClick(tile) {
  if (G.turn !== 'bottom' || G.busy) return;
  if (!hasDrawn('bottom')) return;
  // リーチ後 (宣言牌すでに捨てた状態) は 手牌操作禁止
  // ※ リーチ宣言直後 (= G.justRiichiDeclared === 'bottom') は 1枚捨てるまで 操作OK
  if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') {
    toast('リーチ後は 手牌を変更できません');
    return;
  }
  G.selected = (G.selected === tile) ? null : tile;
  renderHand('bottom');
  renderRiichiGuide();
  updateActionButtons();
  updateHint();
}

// ─── 打牌の共通経路 (打牌ボタン / PCダブルクリック / モバイルドラッグ が全てここを通る) ───
// バリデーション (リーチ宣言中のテンパイ維持) → AI採点 → 牌譜記録 → 打牌/net送信 → ターン進行
function attemptDiscard(tile) {
  if (G.turn !== 'bottom' || G.busy || !tile || G.roundOver) return false;
  if (!hasDrawn('bottom')) return false;
  if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') return false;  // リーチ後は自動進行に任せる
  if (!G.hands.bottom.includes(tile)) return false;
  // 喰い替え禁止: ポンした牌と同じ牌は その直後の打牌で捨てられない (実ルール)
  if (G.kuikaeBan && G.kuikaeBan.seat === 'bottom' && tile.id === G.kuikaeBan.id) {
    toast(`喰い替え禁止 — ポンした ${TILE_NAMES[tile.id]} と同じ牌は捨てられません`);
    return false;
  }
  // リーチ宣言直後: テンパイが崩れる牌は 捨てられない
  if (G.justRiichiDeclared === 'bottom') {
    const rest = G.hands.bottom.filter(t => t !== tile);
    if (!isTenpai13(rest, meldTriples('bottom'))) {
      toast('リーチ中は テンパイが崩れる牌は 捨てられません');
      return false;
    }
  }
  // AI採点: 捨てる直前の手牌14枚で評価 (🎓トグルON時のみ) + 牌譜記録
  coachEvaluateDiscard(tile);
  kifuRecordStep(tile);
  // net対戦ゲスト: アクション送信のみ (ホストが適用して状態が返る)
  if (NETQ() && NETQ().isGuest()) { NETQ().sendDiscard(tile); return true; }
  discardTile('bottom', tile);
  toast(`あなたが ${TILE_NAMES[tile.id]} を打牌`);
  renderAll();
  // CPU/リモートがロンした場合 (busy/roundOver/オファー中) は ターン進行しない
  if (G.roundOver || G.busy || G.ronQueue || netOfferPending()) return true;
  setTimeout(() => { nextTurn(); startTurn(); }, 120);
  return true;
}

// ダブルクリック = 選択 + 即打牌 (PC=マウス環境限定のショートカット。
// タッチ端末では 素早い2タップ (選択→取消のつもり) が 誤打牌になるため無効化 — 代わりにドラッグ打牌)
const _dblDiscardOk = (typeof window !== 'undefined' && window.matchMedia)
  ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true;
function onMyHandDblClick(tile) {
  if (!_dblDiscardOk) return;
  if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
  if (!hasDrawn('bottom')) return;
  if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') return;
  G.selected = tile;
  updateActionButtons();
  attemptDiscard(tile);
}

// ─── モバイル: ドラッグ打牌 (牌を上方向=河へスワイプで捨てる、 タッチ端末のみ) ───
const DRAG_DISCARD_PX = 60;   // これ以上 上へ動かして離すと打牌
let _tileDrag = null;
function attachTileDrag(el, tile) {
  if (_dblDiscardOk) return;  // マウス環境は対象外 (クリック+打牌 or ダブルクリック)
  el.addEventListener('touchstart', (e) => {
    if (G.turn !== 'bottom' || G.busy || G.roundOver || !hasDrawn('bottom')) return;
    if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') return;
    const t = e.touches[0];
    _tileDrag = { tile, el, x0: t.clientX, y0: t.clientY, moved: false };
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!_tileDrag || _tileDrag.el !== el) return;
    const t = e.touches[0];
    const dx = t.clientX - _tileDrag.x0;
    const dy = t.clientY - _tileDrag.y0;
    if (!_tileDrag.moved && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;  // タップ猶予
    _tileDrag.moved = true;
    e.preventDefault();  // 画面スクロール抑止
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.classList.toggle('tile--drag-ready', dy < -DRAG_DISCARD_PX);
  }, { passive: false });
  const endDrag = () => {
    if (!_tileDrag || _tileDrag.el !== el) return;
    const d = _tileDrag;
    _tileDrag = null;
    const ready = el.classList.contains('tile--drag-ready');
    el.style.transform = '';
    el.classList.remove('tile--drag-ready');
    if (d.moved && ready) {
      if (!attemptDiscard(d.tile)) renderHand('bottom');  // 打牌不可なら元の位置へ
    }
  };
  el.addEventListener('touchend', endDrag);
  el.addEventListener('touchcancel', endDrag);
}

// ─── ツモ動作 ──────────────────────────────────
function drawTile(seat) {
  if (G.drawTiles.length === 0) return null;
  const tile = G.drawTiles.shift();
  G.justKanDrawn = null;  // 通常ツモで嶺上フラグ解除
  G.tempFuriten[seat] = false;  // 見逃しフリテン (同巡) は 自分のツモで解除 (全席)
  G.hands[seat].push(tile);
  G.justDrawnAll[seat] = G.hands[seat].length - 1;
  if (seat === 'bottom') G.justDrawn = G.hands.bottom.length - 1;
  return tile;
}

function discardTile(seat, tile) {
  const idx = G.hands[seat].indexOf(tile);
  if (idx < 0) return false;
  G.hands[seat].splice(idx, 1);
  if (G.justKanDrawn === seat) G.justKanDrawn = null;  // 嶺上開花フラグは打牌で解除
  // リーチは 宣言牌が河に落ちる この瞬間に成立 (ボタン押下時ではない — 取消できるため。
  // isRiichi / -1000点 / 供託 / 🔴表示 / 発声 の全てをここでコミット。 実卓・雀魂と同じ)
  if (G.justRiichiDeclared === seat) {
    tile.isRiichiDeclared = true;
    G.justRiichiDeclared = null;
    G.isRiichi[seat] = true;
    G.riichiTurnsLeft[seat] = 4;  // 一発: 直後の decrement で 3 になる (自分含め4ターン以内)
    G.doubleRiichi[seat] = (G.rivers[seat].length === 0);  // 1巡目リーチ = ダブルリーチ
    G.scores[seat] -= 1000;
    G.kyotaku += 1000;
    playSE('riichi');
    announce('riichi');
  }
  G.rivers[seat].push(tile);
  G.lastDiscard = tile;
  playSE('discard');
  delete G.justDrawnAll[seat];
  if (seat === 'bottom') {
    G.selected = null;
    G.justDrawn = null;
  }
  // 一発カウント減 (打牌した家のリーチ後 1巡経過)
  for (const p of ALL_SEATS) {
    if (G.riichiTurnsLeft[p] > 0) G.riichiTurnsLeft[p]--;
  }
  // 喰い替え禁止は 何かを捨てた時点で解除 (禁止牌の enforcement は attemptDiscard/cpuDiscard 側)
  if (G.kuikaeBan && G.kuikaeBan.seat === seat) G.kuikaeBan = null;
  // 全家のロン判定 (ダブロン対応: 候補全員に反時計回り順で確認 → 全員の返答が揃ってから確定)
  if (beginRonResolution(seat, tile)) return true;
  // ロンなし → ポン/明槓チェック (鳴きオプション時のみ)
  checkCallsAfterDiscard(seat, tile);
  return true;
}

// ─── ロン確認キュー (ダブロン対応) ────────────────
// 候補全席の ctx/result を打牌時点で確定し、 反時計回り順に 1人ずつ意思確認
// (CPU=即ロン / 人間=ボタン / リモート=オファー)。 確定牌はこの時点の状態で評価済みのため、
// 先に付ける見逃しフリテンが 受諾者のロンを妨げない
function beginRonResolution(fromSeat, tile) {
  const ccw = ccwFrom(fromSeat);
  const entries = {};
  const order = [];
  const furitenMarks = [];
  for (let i = 1; i < 4; i++) {
    const s = ccw[i];
    if (s === G.emptySeat) continue;
    // 見逃しフリテン対象: 13枚形で待ちに この牌を含む全席 (役なしで拾えない場合も含む — 実ルール)
    if (G.hands[s].length === handFullCount(s) - 1) {
      const waits = waitingIds(G.hands[s], meldTriples(s));
      if (waits.includes(tile.id)) furitenMarks.push(s);
    }
    const rc = checkRonForSeat(s, fromSeat, tile);
    if (rc) {
      entries[s] = rc;
      order.push(s);
    }
  }
  // フリテン付与 (ロンした席は局終了で無意味、 見逃し/役なし通過の席に効く)
  for (const s of furitenMarks) {
    if (G.isRiichi[s]) G.passFuriten[s] = true;
    else G.tempFuriten[s] = true;
  }
  if (order.length === 0) return false;
  G.ronQueue = { fromSeat, tile, entries, pending: order, accepted: [] };
  G.busy = true;
  processRonQueue();
  return true;
}

function processRonQueue() {
  const q = G.ronQueue;
  if (!q || G.roundOver) return;
  while (q.pending.length > 0) {
    const seat = q.pending[0];
    if (seat === 'bottom' && !(NETQ() && NETQ().isGuest())) {
      // 人間 (ソロ/ホスト): 既存のロン/見逃すUIで確認
      G.pendingRon = { fromSeat: q.fromSeat, tile: q.tile };
      playSE('alert');
      toast('ロン可! 「ロン」 ボタンで あがれます');
      renderAll();
      return;
    }
    if (NETQ() && NETQ().isRemoteSeat(seat)) {
      toast(`${seatLabel(seat)} ロン確認中…`);
      NETQ().offerRon(seat, q.fromSeat, q.tile);
      return;
    }
    // CPU: 常にロン
    q.pending.shift();
    q.accepted.push(seat);
  }
  finalizeRonQueue();
}

// 現在確認中の席の意思決定 (human ボタン / netgame オファー応答・時間切れ から呼ばれる)
function ronQueueDecide(seat, accept) {
  const q = G.ronQueue;
  if (!q || q.pending[0] !== seat) return;
  q.pending.shift();
  if (accept) q.accepted.push(seat);
  processRonQueue();
}

function finalizeRonQueue() {
  const q = G.ronQueue;
  G.ronQueue = null;
  if (!q || G.roundOver) return;
  const winners = q.accepted.map(s => ({ seat: s, ctx: q.entries[s].ctx, result: q.entries[s].result }));
  if (winners.length === 0) {
    // 全員見逃し → 進行再開
    G.busy = false;
    renderAll();
    setTimeout(() => { nextTurn(); startTurn(); }, 120);
    return;
  }
  G.roundOver = true;
  G.busy = true;
  announce('ron');
  if (winners.length === 1) {
    const w = winners[0];
    toast(`${seatLabel(w.seat)} ロン! (${TILE_NAMES[q.tile.id]})`);
    const test = [...G.hands[w.seat], q.tile, ...meldTriples(w.seat)];
    setTimeout(() => showWinModal(w.seat, test, w.ctx, w.result), 600);
  } else {
    toast(`ダブルロン! (${winners.map(w => seatShareLabel(w.seat)).join(' と ')})`);
    setTimeout(() => showDoubleRonModal(winners, q.fromSeat, q.tile), 600);
  }
}

// ─── 嶺上ツモ + 王牌14枚維持 (実麻雀ルール) ─────────
// 嶺上を1枚取るたび 海底牌 (自摸山の最後の1枚) を王牌の反対端へ移動 → 王牌は常に14枚、
// 山残が1枚減り 海底が1枚手前にずれる。 自摸山が空だと補充できないため 嶺上ツモ不可 (海底でのカン禁止と同義)
function canRinshanDraw() {
  return G.kingTiles.length > 0 && G.drawTiles.length > 0;
}
// カン可能条件: 嶺上補充可 + カンドラの残りめくり枠あり (王牌レイアウト上 1局最大3回)
// ※ net ゲストは kanDoraDefs を持たない (ホスト専有) ため 空配列は既定値3枚にフォールバック
function kanAllowed() {
  const max = (G.kanDoraDefs && G.kanDoraDefs.length > 0) ? G.kanDoraDefs.length : 4;
  return canRinshanDraw() && (G.kanDoraInd || []).length < max;
}
// 嶺上から1枚ツモ → 海底牌で王牌補充。 戻り値 = 補充ツモした牌
function drawRinshan(seat) {
  const replacement = G.kingTiles.pop();
  G.kingUsedCells.push(G.kingPoolCells.pop());
  // 王牌補充: 海底牌をプールの反対端 (カットから遠い側) へ — pop の消費順は カット側から変わらない
  const t = G.drawTiles.pop();
  const c = G.drawPosList.pop();
  G.kingTiles.unshift(t);
  G.kingPoolCells.unshift(c);
  G.kingCells.push(c);  // 表示上も王牌の一部になる (山の端の牌が王牌へスライド)
  G.hands[seat].push(replacement);
  G.justDrawnAll[seat] = G.hands[seat].length - 1;
  if (seat === 'bottom') G.justDrawn = G.hands[seat].length - 1;
  return replacement;
}
// カンドラをめくる: ドラ表示牌の隣 (嶺上の反対側) の幢の上段を順に表向き、 王牌内に残す
function flipKanDora() {
  const def = (G.kanDoraDefs || [])[G.kanDoraInd.length];
  if (!def) return false;
  G.kanDoraInd.push(def.ind);
  G.kanDoraCells.push(def.cell);
  return true;
}
// カン裏 (めくり済カンドラ表示牌の下段) — リーチ和了時のみ加算
function kanUraNow() {
  return (G.kanDoraDefs || []).slice(0, G.kanDoraInd.length).map(d => d.ura);
}

function kitaNuki(seat) {
  if (!canRinshanDraw()) return false;  // 嶺上切れ or 山0 (補充不可): 北抜き不可
  const idx = G.hands[seat].findIndex(t => t.id === KITA_ID);
  if (idx < 0) return false;
  const kitaTile = G.hands[seat].splice(idx, 1)[0];
  G.kitaTiles[seat].push(kitaTile);
  G.kitas[seat]++;
  if (G.justKanDrawn === seat) G.justKanDrawn = null;  // 北補充は嶺上開花の対象外 (簡略)
  drawRinshan(seat);  // 嶺上ツモ + 王牌補充
  playSE('kita');
  announce('kita');
  toast(`${seatLabel(seat)} 北抜き (+1翻) / 抜き合計 ${G.kitas[seat]}`);
  return true;
}

// ─── 暗槓 (常時ルール): 手牌の同一牌4枚 → 槓子 + カンドラめくり + 嶺上補充 ──
// 条件: 嶺上補充可 (山1枚以上) + カンドラめくり枠あり。
// リーチ中は 「ツモった牌で4枚目が揃い、 かつ待ちが変わらない」 場合のみ可 (標準ルール)
function ankanCandidateIds(seat) {
  if (!kanAllowed()) return [];
  const counts = countTiles(G.hands[seat]);
  const ids = Object.keys(counts).map(Number).filter(id => counts[id] === 4 && id !== KITA_ID);
  if (!G.isRiichi[seat]) return ids;
  // リーチ中: ツモ牌の4枚目のみ + 待ち不変チェック
  const drawnIdx = (G.justDrawnAll && G.justDrawnAll[seat] != null) ? G.justDrawnAll[seat] : null;
  const drawn = drawnIdx != null ? G.hands[seat][drawnIdx] : null;
  if (!drawn || !ids.includes(drawn.id)) return [];
  const id = drawn.id;
  // 待ち比較: カン前 (手牌からツモ牌を除いた13枚) vs カン後 (4枚除去 + 槓子3枚等価)
  const before = waitingIds(G.hands[seat].filter(t => t !== drawn), meldTriples(seat));
  const kanTriple = G.hands[seat].filter(t => t.id === id).slice(0, 3);
  const after = waitingIds(G.hands[seat].filter(t => t.id !== id),
    meldTriples(seat).concat(kanTriple));
  if (before.length === 0 || before.length !== after.length) return [];
  if (!before.every((w, i) => w === after[i])) return [];
  return [id];
}
function doAnkan(seat, id) {
  const tiles = G.hands[seat].filter(t => t.id === id);
  if (tiles.length !== 4 || !kanAllowed()) return false;
  if (G.isRiichi[seat] && !ankanCandidateIds(seat).includes(id)) return false;
  G.hands[seat] = G.hands[seat].filter(t => t.id !== id);
  G.melds[seat].push({ type: 'ankan', id, tiles });
  // カンドラ: ドラ表示牌の隣を王牌内でめくる + 嶺上ツモ (海底牌で王牌補充)
  flipKanDora();
  drawRinshan(seat);
  G.justKanDrawn = seat;  // 嶺上開花フラグ (打牌 or 通常ツモで解除)
  if (seat === 'bottom') G.selected = null;
  playSE('riichi');
  announce('kan');
  toast(`${seatLabel(seat)} 暗槓! カンドラが1枚増えました`);
  return true;
}

// ─── 加槓: ポンした刻子に手牌の4枚目を追加 → 搶槓確認 → カンドラ + 嶺上補充 ──
// 候補 = ポン済み meld と同じ id の牌を手牌に持っている (リーチ中は不可)
function kakanCandidateIds(seat) {
  if (G.isRiichi[seat] || !kanAllowed()) return [];
  const ponIds = (G.melds[seat] || []).filter(m => m.type === 'pon').map(m => m.id);
  return ponIds.filter(id => G.hands[seat].some(t => t.id === id));
}
// 戻り値: 'done' (完了) / 'pending' (搶槓確認待ち — 人間/リモートの選択後に completePendingKakan) /
//         'robbed' (CPUに搶槓された = 局終了) / false (不可)
function doKakan(seat, id) {
  if (!kakanCandidateIds(seat).includes(id)) return false;
  const tile = G.hands[seat].find(t => t.id === id);
  const meld = G.melds[seat].find(m => m.type === 'pon' && m.id === id);
  if (!tile || !meld) return false;
  announce('kan');
  toast(`${seatLabel(seat)} 加槓! (${TILE_NAMES[id]})`);
  G.pendingKakan = { seat, meldId: id, tile };
  // 搶槓チェック: 加槓牌で他家がロンできるか (反時計回り優先)
  const ccw = ccwFrom(seat);
  for (let i = 1; i < 4; i++) {
    const cs = ccw[i];
    if (cs === G.emptySeat) continue;
    const rc = checkRonForSeat(cs, seat, tile, true);
    if (!rc) continue;
    if (cs === 'bottom' && !(NETQ() && NETQ().isGuest())) {
      G.pendingRon = { fromSeat: seat, tile, chankan: true };
      G.busy = true;
      playSE('alert');
      toast(`搶槓ロンできます! (${TILE_NAMES[id]}) — ロン/見逃す を選択`);
      renderAll();
      return 'pending';
    }
    if (NETQ() && NETQ().isRemoteSeat(cs)) {
      toast(`${seatLabel(cs)} 搶槓確認中…`);
      NETQ().offerRon(cs, seat, tile, true);
      return 'pending';
    }
    // CPU 搶槓: 即ロン
    G.pendingKakan = null;
    const hi = G.hands[seat].indexOf(tile);
    if (hi >= 0) G.hands[seat].splice(hi, 1);  // 加槓牌はロン者に渡る
    const test = [...G.hands[cs], tile, ...meldTriples(cs)];
    announce('ron');
    toast(`${seatLabel(cs)} 搶槓ロン! (${TILE_NAMES[tile.id]})`);
    G.busy = true;
    G.roundOver = true;
    setTimeout(() => showWinModal(cs, test, rc.ctx, rc.result), 600);
    return 'robbed';
  }
  completePendingKakan();
  return 'done';
}
// 搶槓なし (全員スルー) → 加槓を完了: meld を槓子化 + カンドラ + 嶺上補充
function completePendingKakan() {
  const pk = G.pendingKakan;
  if (!pk) return false;
  G.pendingKakan = null;
  const { seat, meldId, tile } = pk;
  const meld = G.melds[seat].find(m => m.type === 'pon' && m.id === meldId);
  const hi = G.hands[seat].indexOf(tile);
  if (!meld || hi < 0 || !kanAllowed()) return false;
  G.hands[seat].splice(hi, 1);
  meld.type = 'kakan';
  meld.tiles.push(tile);
  for (const p of ALL_SEATS) G.riichiTurnsLeft[p] = 0;  // 一発消し
  flipKanDora();
  drawRinshan(seat);
  G.justKanDrawn = seat;
  if (seat === 'bottom') G.selected = null;
  playSE('riichi');
  toast(`${seatLabel(seat)} の加槓成立 — カンドラが1枚増えました`);
  return true;
}
// 搶槓見逃し後の再開 (ソロ/ホスト): 加槓を完了して 加槓者のターンを続行
function resumeAfterChankanPass() {
  const pk = G.pendingKakan;
  completePendingKakan();
  if (!pk || G.roundOver) { renderAll(); return; }
  const seat = pk.seat;
  if (NETQ() && NETQ().isRemoteSeat(seat)) {
    G.busy = false;
    renderAll();
    if (NETQ().armTurnTimeout) NETQ().armTurnTimeout(seat);
  } else if (seat === 'bottom') {
    G.busy = false;
    renderAll();  // 人間: 嶺上牌を持って操作継続
  } else {
    G.busy = true;
    renderAll();
    setTimeout(() => cpuDiscard(seat), 500);  // CPU: ツモ勝ち判定込みで打牌続行
  }
}

// ─── ポン/明槓 (鳴きオプション ON のとき) ─────────────
// 打牌へのロンが無かった場合に呼ばれる。 候補は高々1家 (同一牌は残り3枚のため)
function checkCallsAfterDiscard(fromSeat, tile) {
  if (!G.rules || !G.rules.naki || G.roundOver || G.drawTiles.length === 0) return false;
  if (G.pendingRon || netOfferPending()) return false;
  const ccw = ccwFrom(fromSeat);
  for (let i = 1; i < 4; i++) {
    const seat = ccw[i];
    if (seat === G.emptySeat || G.isRiichi[seat]) continue;
    const cnt = G.hands[seat].filter(t => t.id === tile.id).length;
    if (cnt < 2 || tile.id === KITA_ID) continue;
    const canKan = cnt >= 3 && kanAllowed();
    if (seat === 'bottom' && !(NETQ() && NETQ().isGuest())) {
      if (optNoNaki) continue;  // ⚙️鳴きなし: 自分へのポン/カン確認を自動スルー
      // 自家 (ソロ/ホスト): ボタン待ち
      G.pendingCall = { fromSeat, tile, canKan };
      G.busy = true;
      playSE('alert');
      toast(`ポンできます! (${TILE_NAMES[tile.id]}) — ポン${canKan ? '/カン' : ''}/スルー を選択`);
      renderAll();
      return true;
    }
    if (NETQ() && NETQ().isRemoteSeat(seat)) {
      toast(`${seatLabel(seat)} ポン確認中…`);
      NETQ().offerCall(seat, fromSeat, tile, canKan);
      return true;
    }
    // CPU: 役牌 (三元牌/場風東/自風) のみ 60% でポン。 3枚持ちなら 50% で明槓 (カンドラ+嶺上)
    const swId = { '東': 20, '南': 21, '西': 22 }[seatWindOf(seat)];
    if ([24, 25, 26, 20, swId].includes(tile.id) && Math.random() < 0.6) {
      const useKan = canKan && Math.random() < 0.5;
      G.busy = true;
      G.pendingCall = { fromSeat, tile, cpu: true };
      setTimeout(() => {
        G.pendingCall = null;
        if (G.roundOver) return;
        if (useKan) doMinkan(seat, fromSeat, tile);
        else doPon(seat, fromSeat, tile);
        renderAll();
        setTimeout(() => cpuDiscard(seat), 700);
      }, 500);
      return true;
    }
    return false;
  }
  return false;
}
function doPon(seat, fromSeat, tile) {
  const rv = G.rivers[fromSeat];
  const ri = rv.indexOf(tile);
  if (ri >= 0) rv.splice(ri, 1);
  const own = G.hands[seat].filter(t => t.id === tile.id).slice(0, 2);
  if (own.length < 2) return false;
  G.hands[seat] = G.hands[seat].filter(t => !own.includes(t));
  G.melds[seat].push({ type: 'pon', id: tile.id, tiles: [...own, tile], from: fromSeat });
  for (const p of ALL_SEATS) G.riichiTurnsLeft[p] = 0;  // 一発消し
  if (G.lastDiscard === tile) G.lastDiscard = null;
  G.kuikaeBan = { seat, id: tile.id };  // 喰い替え禁止: 鳴いた牌と同じ牌はこの打牌で捨てられない
  G.turn = seat;
  delete G.justDrawnAll[seat];
  if (seat === 'bottom') { G.justDrawn = null; G.selected = null; }
  announce('pon');
  toast(`${seatLabel(seat)} ポン! (${TILE_NAMES[tile.id]})`);
  return true;
}
function doMinkan(seat, fromSeat, tile) {
  if (!kanAllowed()) return false;
  const rv = G.rivers[fromSeat];
  const ri = rv.indexOf(tile);
  if (ri >= 0) rv.splice(ri, 1);
  const own = G.hands[seat].filter(t => t.id === tile.id).slice(0, 3);
  if (own.length < 3) return false;
  G.hands[seat] = G.hands[seat].filter(t => !own.includes(t));
  G.melds[seat].push({ type: 'minkan', id: tile.id, tiles: [...own, tile], from: fromSeat });
  for (const p of ALL_SEATS) G.riichiTurnsLeft[p] = 0;  // 一発消し
  if (G.lastDiscard === tile) G.lastDiscard = null;
  // カンドラ + 嶺上補充 (暗槓と同じ)
  flipKanDora();
  drawRinshan(seat);
  G.justKanDrawn = seat;  // 嶺上開花フラグ
  G.turn = seat;
  if (seat === 'bottom') G.selected = null;
  playSE('riichi');
  announce('kan');
  toast(`${seatLabel(seat)} 明槓! カンドラが1枚増えました`);
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
  if (G.roundOver) return;
  if (G.drawTiles.length === 0) return endRound('流局');
  if (G.turn === 'bottom') {
    drawTile('bottom');
    renderAll();
    // リーチ後 自家: 北なら自動北抜き → ツモあがり可能なら ツモボタン待ち → それ以外は 自動ツモ切り
    // ※ リーチ宣言直後 (= まだ宣言牌を捨てていない) は スキップ (ユーザーが自分で1枚選んで捨てる)
    if (G.isRiichi.bottom && hasDrawn('bottom') && G.justRiichiDeclared !== 'bottom') {
      handleRiichiAutoBottom();
    }
  } else if (NETQ() && NETQ().isRemoteSeat(G.turn)) {
    // リモート人間の番: ツモらせて 本人の操作待ち (netgame がタイムアウト管理)
    drawTile(G.turn);
    NETQ().remotePlay(G.turn);
  } else {
    G.busy = true;
    renderAll();
    setTimeout(() => cpuPlay(G.turn), 120);
  }
}

// リーチ後の自家ターン処理 (北抜き → ツモ判定 → 自動ツモ切り)
function handleRiichiAutoBottom() {
  if (G.roundOver) return;
  const drawnTile = G.hands.bottom[G.justDrawn];
  if (!drawnTile) return;
  // ツモった牌が北 → 自動北抜き (補充牌で 再帰的に 同じ処理)
  if (drawnTile.id === KITA_ID && canRinshanDraw()) {
    G.busy = true;
    renderAll();  // busy 反映 (ツモ等のボタンを即 disabled に)
    setTimeout(() => {
      if (G.roundOver) return;
      kitaNuki('bottom');
      renderAll();
      G.busy = false;
      handleRiichiAutoBottom();
    }, 250);
    return;
  }
  let canTsumoNow = false;
  if (isWinning(equivHand('bottom'))) {
    const result = calcYaku(equivHand('bottom'), {
      isTsumo: true, isRiichi: true, isOya: G.oya === 'bottom', seatWind: seatWindOf('bottom'),
      doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles('bottom'), openMeldIds: openMeldIds('bottom'), kitas: G.kitas.bottom, round: G.round,
      isDoubleRiichi: G.doubleRiichi.bottom, firstDraw: G.rivers.bottom.length === 0 && G.kitas.bottom === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft.bottom > 0, winTile: drawnTile,
      isRinshan: G.justKanDrawn === 'bottom',
    });
    canTsumoNow = !result.error && (result.han > 0 || result.isYakuman);
  }
  if (canTsumoNow) {
    playSE('alert');
    toast('ツモできます! 「ツモ」 ボタンを押してください');
    return;  // ボタン待ち (updateActionButtons が ツモを有効化)
  }
  // リーチ中の暗槓が可能 (ツモ牌4枚目 + 待ち不変) → 自動打牌せず選択待ち
  if (ankanCandidateIds('bottom').length > 0) {
    G.busy = false;
    G.selected = drawnTile;
    playSE('alert');
    toast('カンできます! 「カン」 または 「打牌」 (ツモ切り) を選択');
    renderAll();
    return;
  }
  // 自動でツモ牌を 捨てる (リーチ後 待ち変更不可)
  G.busy = true;
  setTimeout(() => {
    kifuRecordStep(drawnTile, { auto: true });  // 牌譜: 自動ツモ切りも記録 (採点対象外)
    discardTile('bottom', drawnTile);
    toast(`(リーチ自動打牌) ${TILE_NAMES[drawnTile.id]}`);
    renderAll();
    if (G.pendingRon || G.pendingCall || G.ronQueue || G.roundOver || netOfferPending()) return;  // ロン発生時は 進行停止
    G.busy = false;
    setTimeout(() => { nextTurn(); startTurn(); }, 120);
  }, 300);
}

function cpuPlay(seat) {
  const wasRiichiBefore = G.isRiichi[seat];  // 前ターン から リーチ済か (= 既リーチ)
  drawTile(seat);
  renderHand(seat);
  // 既リーチ (前ターンから) = ツモ牌固定で 捨て (待ち変更不可)。 ツモ牌が北なら 先に北抜き、
  // ツモ牌で4枚目が揃い 待ちが変わらない暗槓は 80% で実行 (リーチ中の暗槓)
  if (wasRiichiBefore) {
    let drawn = G.hands[seat][G.hands[seat].length - 1];
    let acted = true;
    while (acted) {
      acted = false;
      while (drawn && drawn.id === KITA_ID && canRinshanDraw()) {
        kitaNuki(seat);
        renderAll();
        drawn = G.hands[seat][G.hands[seat].length - 1];
        acted = true;
      }
      const rKanIds = ankanCandidateIds(seat);  // リーチ中は待ち不変の暗槓のみ返る
      if (rKanIds.length > 0 && Math.random() < 0.8) {
        doAnkan(seat, rKanIds[0]);
        renderAll();
        drawn = G.hands[seat][G.hands[seat].length - 1];
        acted = true;
      }
    }
    setTimeout(() => cpuDiscard(seat, true), 300);
    return;
  }
  // 暗槓 (同一牌4枚、 王牌残2以上、 80%): カンドラ+嶺上補充してから 以降の判断へ
  if (!G.isRiichi[seat]) {
    const kanIds = ankanCandidateIds(seat);
    if (kanIds.length > 0 && Math.random() > 0.2) {
      doAnkan(seat, kanIds[0]);
      renderAll();
    }
    // 加槓 (ポン済み刻子 + 手牌の4枚目、 70%): 搶槓確認が入ったら フロー中断 (ロン/パス側で再開)
    const kkIds = kakanCandidateIds(seat);
    if (kkIds.length > 0 && Math.random() > 0.3) {
      const kr = doKakan(seat, kkIds[0]);
      renderAll();
      if (kr === 'pending' || kr === 'robbed') return;
    }
  }
  // 未リーチ → リーチ判定 (14牌、 1000点以上、 テンパイ、 70%確率)
  // ※ 既にあがり形なら リーチせず そのままツモ (cpuDiscard 側で処理) — 宣言直後ツモの不正防止
  if (hasDrawn(seat) && G.scores[seat] >= 1000 && openMeldIds(seat).length === 0
      && !isWinning(equivHand(seat)) && canDeclareRiichi(G.hands[seat], meldTriples(seat))) {
    if (Math.random() > 0.3) {
      // 宣言モードのみ — リーチ成立 (isRiichi/-1000/供託/発声) は 宣言牌を捨てた瞬間 (discardTile)
      G.justRiichiDeclared = seat;
      // ※ 宣言ターンは テンパイ維持できる牌のみ捨てる (cpuDiscard 側で制限)
    }
  }
  const kitaIdx = G.hands[seat].findIndex(t => t.id === KITA_ID);
  if (G.justRiichiDeclared !== seat && kitaIdx >= 0 && Math.random() > 0.1) {
    setTimeout(() => {
      kitaNuki(seat);
      renderAll();
      setTimeout(() => cpuDiscard(seat), 120);
    }, 120);
  } else {
    setTimeout(() => cpuDiscard(seat), 120);
  }
}

function cpuDiscard(seat, forceTsumoTile = false) {
  if (G.roundOver) return;
  // CPU が ツモあがり 可能か (役なしはあがれない)
  if (hasDrawn(seat) && isWinning(equivHand(seat))) {
    const drawn = G.hands[seat][G.hands[seat].length - 1];
    const ctx = {
      isTsumo: true, isRiichi: G.isRiichi[seat], isOya: G.oya === seat, seatWind: seatWindOf(seat),
      doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles(seat), openMeldIds: openMeldIds(seat), kitas: G.kitas[seat], round: G.round,
      isDoubleRiichi: G.doubleRiichi[seat], firstDraw: G.rivers[seat].length === 0 && G.kitas[seat] === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft[seat] > 0, winTile: drawn,
      isRinshan: G.justKanDrawn === seat,
    };
    const result = calcYaku(equivHand(seat), ctx);
    if (!result.error && (result.han > 0 || result.isYakuman)) {
      announce('tsumo');
      toast(`${seatLabel(seat)} ツモ!`);
      G.roundOver = true;
      showWinModal(seat, G.hands[seat], ctx, result);
      G.busy = false;
      return;
    }
  }
  // リーチ後 CPU: ツモ牌 (= 末尾) を 強制捨て
  if (forceTsumoTile) {
    const tile = G.hands[seat][G.hands[seat].length - 1];
    discardTile(seat, tile);
    toast(`${seatLabel(seat)} (リーチ自動) ${TILE_NAMES[tile.id]}`);
    renderAll();
    if (G.pendingRon || G.pendingCall || G.ronQueue || G.roundOver || netOfferPending()) return;
    G.busy = false;
    setTimeout(() => { nextTurn(); startTurn(); }, 120);
    return;
  }
  // 通常打牌: リーチ宣言ターンは 「捨ててもテンパイが維持される牌」 に限定
  let pool = G.hands[seat];
  if (G.justRiichiDeclared === seat) {
    const keep = pool.filter(t => isTenpai13(G.hands[seat].filter(x => x !== t), meldTriples(seat)));
    if (keep.length > 0) pool = keep;
  }
  // 喰い替え禁止: ポン直後は鳴いた牌と同じ牌を捨てられない
  if (G.kuikaeBan && G.kuikaeBan.seat === seat) {
    const legal = pool.filter(t => t.id !== G.kuikaeBan.id);
    if (legal.length > 0) pool = legal;
  }
  // シャンテン数が最小になる捨て牌を選ぶ (= 手が進む打牌)。
  // 強すぎ防止: 15% の確率で 「min+1 まで許容」 の気まぐれ打牌
  const evals = pool.map(t => ({ t, sh: shantenOf(G.hands[seat].filter(x => x !== t)) }));
  const minSh = Math.min(...evals.map(e => e.sh));
  let cands = evals.filter(e => e.sh === minSh).map(e => e.t);
  if (Math.random() < 0.15) {
    cands = evals.filter(e => e.sh <= minSh + 1).map(e => e.t);
  }
  // 同率タイブレーク: 孤立字牌 → 端牌 → 候補の末尾 (安全度は未実装の簡略AI)
  const counts = {};
  G.hands[seat].forEach(t => { counts[t.id] = (counts[t.id] || 0) + 1; });
  let target = null;
  for (let id = 20; id <= 26; id++) {
    if (id === KITA_ID) continue;
    if (counts[id] === 1) { target = cands.find(t => t.id === id); if (target) break; }
  }
  if (!target) {
    const ends = [0, 1, 2, 10, 11, 19];
    for (const id of ends) {
      if (counts[id] === 1) { target = cands.find(t => t.id === id); if (target) break; }
    }
  }
  if (!target) target = cands[cands.length - 1];
  discardTile(seat, target);
  toast(`${seatLabel(seat)} が ${TILE_NAMES[target.id]} を打牌`);
  renderAll();
  // ロン保留 / リモートロンオファー / 局終了なら ターン進行を停止
  if (G.pendingRon || G.pendingCall || G.ronQueue || G.roundOver || netOfferPending()) return;
  G.busy = false;
  setTimeout(() => { nextTurn(); startTurn(); }, 120);
}

function endRound(reason) {
  document.getElementById('end-title').textContent = reason;
  const ryuDeltas = {};  // 点棒移動バッジ用 {seat: 増減}
  if (reason === '流局') {
    // テンパイ判定 (各プレイヤー、 13牌時のみ判定)
    const tenpaiSeats = [];
    for (const seat of ALL_SEATS) {
      if (seat === G.emptySeat) continue;
      const h = G.hands[seat];
      if (h.length === handFullCount(seat) - 1 && isTenpai13(h, meldTriples(seat))) tenpaiSeats.push(seat);
      else if (h.length === handFullCount(seat)) {
        // 自家14牌 → 1枚捨てた 13牌で テンパイ判定
        const tmp13s = [];
        for (let i = 0; i < 14; i++) tmp13s.push(h.slice(0, i).concat(h.slice(i + 1)));
        if (tmp13s.some(t => isTenpai13(t, meldTriples(seat)))) tenpaiSeats.push(seat);
      }
    }
    // 点棒移動 (テンパイ料: 計3000点 = ノーテン家 → テンパイ家)
    const playingSeats = ALL_SEATS.filter(s => s !== G.emptySeat);
    const notenSeats = playingSeats.filter(s => !tenpaiSeats.includes(s));
    if (tenpaiSeats.length > 0 && notenSeats.length > 0) {
      const totalPay = 3000;
      const payPer = Math.floor(totalPay / notenSeats.length);
      const recvPer = Math.floor(totalPay / tenpaiSeats.length);
      for (const s of notenSeats) { G.scores[s] -= payPer; ryuDeltas[s] = -payPer; }
      for (const s of tenpaiSeats) { G.scores[s] += recvPer; ryuDeltas[s] = recvPer; }
    }
    let txt = `山が尽きました。<br>`;
    txt += `点棒移動: ${notenSeats.length > 0 && tenpaiSeats.length > 0 ? '3000点 ノーテン→テンパイ' : 'なし'}<br>`;
    txt += `現スコア: ${playingSeats.map(s => `${seatShareLabel(s)}=${G.scores[s].toLocaleString()}`).join(' / ')}`;
    if (G.kyotaku > 0) txt += `<br>供託 ${G.kyotaku}点 は 次のあがり者へ持ち越し`;
    // 全員の手牌公開 (テンパイ=明るく強調 / ノーテン=薄く)
    txt += '<div style="text-align:left; margin-top:8px;">';
    for (const s of playingSeats) {
      const tp = tenpaiSeats.includes(s);
      txt += `<div style="margin:6px 0;${tp ? '' : ' opacity:0.45;'}">`;
      txt += `<div style="font-size:11px; color:${tp ? '#ffeb3b' : '#aac'}; margin-bottom:2px;">${tp ? '✅ テンパイ' : '─ ノーテン'} ${seatShareLabel(s)}</div>`;
      txt += '<div style="background:rgba(0,0,0,0.35); padding:4px 3px; border-radius:6px; line-height:1;">';
      txt += sortHand(G.hands[s]).map(t => tileSpanHtml(t, 'width:20px; height:27px;')).join('');
      if (G.kitaTiles[s] && G.kitaTiles[s].length > 0) {
        txt += '<span style="display:inline-block; width:8px;"></span>';
        txt += G.kitaTiles[s].map(t => tileSpanHtml(t, 'width:16px; height:22px; opacity:0.8;')).join('');
      }
      txt += '</div></div>';
    }
    txt += '</div>';
    document.getElementById('end-text').innerHTML = txt;
    // 親流れ判定: 親がテンパイなら 連荘、 ノーテンなら 流れる (流局は 常に本場+1)
    G.honba++;
    G.lastResult = tenpaiSeats.includes(G.oya) ? 'tenpaiOya' : 'notenOya';
  } else {
    document.getElementById('end-text').textContent = `${G.round}局 終了。`;
  }
  G.roundOver = true;
  renderAll();  // 全員の手牌を表向き公開 (「盤面を見る」 用)
  // 点棒移動があれば バッジ演出 → 一拍おいて モーダル表示
  const hasPay = Object.keys(ryuDeltas).length > 0;
  if (hasPay) setTimeout(() => showScoreBadges(ryuDeltas), 300);
  setTimeout(() => {
    document.getElementById('end-overlay').hidden = false;
    // net対戦ホスト: 流局結果をゲストへ配信
    if (NETQ()) {
      NETQ().onEndRound(document.getElementById('end-title').textContent,
        document.getElementById('end-text').innerHTML);
    }
  }, hasPay ? 1600 : 400);
}

// ─── 勝利時の点数移動 (供託回収 + 本場加算込み) ─────
// 戻り値: {seat: 増減} — 表示用
function applyWinScore(seat, context, result) {
  const row = SCORE_TABLE.find(r => r.match(result.han, result.isYakuman))
    || SCORE_TABLE[SCORE_TABLE.length - 1];
  const isOya = (G.oya === seat);
  const playing = ALL_SEATS.filter(s => s !== G.emptySeat);
  // 複数役満 (例: 字一色+大三元 = 26翻) は 役満N個分の支払い
  const ymMult = result.isYakuman ? Math.max(1, Math.round(result.han / 13)) : 1;
  const delta = {};
  playing.forEach(s => { delta[s] = 0; });
  if (context.isTsumo) {
    for (const p of playing) {
      if (p === seat) continue;
      const pay = (isOya ? row.oyaTsumo : (p === G.oya ? row.koTsumoOya : row.koTsumoKo)) * ymMult
        + 100 * G.honba;
      delta[p] -= pay;
      delta[seat] += pay;
    }
  } else if (context.fromSeat) {
    const pay = (isOya ? row.oyaRon : row.koRon) * ymMult + 300 * G.honba;
    delta[context.fromSeat] -= pay;
    delta[seat] += pay;
  }
  // 供託 (リーチ棒) 回収
  if (G.kyotaku > 0) {
    delta[seat] += G.kyotaku;
    G.kyotaku = 0;
  }
  for (const s of playing) G.scores[s] += delta[s];
  return delta;
}

// ─── あがりモーダル (翻数表示) ─────────────────
// 翻数 → 点数表 (4麻標準、 三麻も同じ表で簡略化、 30符固定)
// rowHan: 表の翻区分 (1,2,3,'満貫','跳満','倍満','3倍満','役満')
// matchHan(han, isYakuman): han が この行に属するか
const SCORE_TABLE = [
  { label: '1翻',           match: (h,y) => !y && h === 1,  oyaRon: 1500,  oyaTsumo: 500,  koRon: 1000,  koTsumoOya: 500,  koTsumoKo: 300 },
  { label: '2翻',           match: (h,y) => !y && h === 2,  oyaRon: 2900,  oyaTsumo: 1000, koRon: 2000,  koTsumoOya: 1000, koTsumoKo: 500 },
  { label: '3翻',           match: (h,y) => !y && h === 3,  oyaRon: 5800,  oyaTsumo: 2000, koRon: 3900,  koTsumoOya: 2000, koTsumoKo: 1000 },
  { label: '4-5翻 (満貫)',  match: (h,y) => !y && (h === 4 || h === 5), oyaRon: 12000, oyaTsumo: 4000, koRon: 8000,  koTsumoOya: 4000,  koTsumoKo: 2000 },
  { label: '6-7翻 (跳満)',  match: (h,y) => !y && (h === 6 || h === 7), oyaRon: 18000, oyaTsumo: 6000, koRon: 12000, koTsumoOya: 6000,  koTsumoKo: 3000 },
  { label: '8-10翻 (倍満)', match: (h,y) => !y && (h >= 8 && h <= 10),  oyaRon: 24000, oyaTsumo: 8000, koRon: 16000, koTsumoOya: 8000,  koTsumoKo: 4000 },
  { label: '11-12翻 (3倍満)', match: (h,y) => !y && (h === 11 || h === 12), oyaRon: 36000, oyaTsumo: 12000, koRon: 24000, koTsumoOya: 12000, koTsumoKo: 6000 },
  { label: '13翻+ (役満)',  match: (h,y) => y || h >= 13,    oyaRon: 48000, oyaTsumo: 16000, koRon: 32000, koTsumoOya: 16000, koTsumoKo: 8000 },
];

function showWinModal(seat, hand, context, result) {
  const overlay = document.getElementById('end-overlay');
  const titleEl = document.getElementById('end-title');
  const textEl = document.getElementById('end-text');
  if (!overlay || !titleEl || !textEl) return;
  G.roundOver = true;
  G.busy = true;
  // 牌譜: 自分のあがり局 or 振り込んだ局を保存 (📖ふりかえり用)。
  // netSummary は net対戦の pub にも載せて ゲスト側の牌譜保存にも使う (座席は canonical)
  let kifuNetSummary = null;
  try {
    kifuNetSummary = {
      winnerSeat: seat, fromSeat: context.fromSeat || null,
      winnerLabel: seatShareLabel(seat),
      winType: context.isTsumo ? 'ツモ' : 'ロン',
      han: result.han, isYakuman: result.isYakuman,
      tier: hanToTier(result.han, result.isYakuman),
      yaku: (result.yakuList || []).map(y => y.name),
      winTileId: context.winTile ? context.winTile.id : null,
      winnerHand: hand ? sortHand(hand.filter(t => t && t.id != null)).map(t => t.id) : [],
      chankan: !!context.isChankan,
    };
    const kType = (seat === 'bottom') ? 'win' : (context.fromSeat === 'bottom' ? 'dealin' : null);
    if (kType) {
      kifuFinishRound(kType, kifuNetSummary);
      const kifuBtn = document.getElementById('end-kifu');
      if (kifuBtn && KIFU.lastSaved) kifuBtn.hidden = false;
    }
  } catch (e) { /* 牌譜失敗でも表示は続行 */ }
  // ─ 勝利演出: カットイン+ボイス (announce済) → 全員の手牌を表向き公開して一拍 → リザルト
  renderAll();

  // 実ルール: リーチ宣言牌がロンされた場合 リーチ不成立 — 宣言者の -1000点/供託 を差し戻す
  if (!context.isTsumo && context.fromSeat && context.winTile && context.winTile.isRiichiDeclared
      && G.isRiichi[context.fromSeat] && G.kyotaku >= 1000) {
    G.isRiichi[context.fromSeat] = false;
    G.doubleRiichi[context.fromSeat] = false;
    G.riichiTurnsLeft[context.fromSeat] = 0;
    G.scores[context.fromSeat] += 1000;
    G.kyotaku -= 1000;
  }
  // 点数移動 (現在の本場で計算) → その後 連荘/本場 更新
  const prevHonba = G.honba;
  const prevKyotaku = G.kyotaku;
  const transfers = applyWinScore(seat, context, result);
  if (G.oya === seat) {
    G.honba++;
    G.lastResult = 'oyaWin';   // 親あがり = 連荘
  } else {
    G.honba = 0;
    G.lastResult = 'koWin';    // 子あがり = 親流れ
  }

  const whoLabel = seatShareLabel(seat);
  const winType = context.isTsumo ? 'ツモ' : 'ロン';
  const tier = hanToTier(result.han, result.isYakuman);
  const isOya = (G.oya === seat);
  titleEl.textContent = `🎉 ${whoLabel}の${winType}あがり! ${tier} (${result.isYakuman ? '役満' : result.han + '翻'})`;

  // 該当翻数の row index
  const hitRowIdx = SCORE_TABLE.findIndex(r => r.match(result.han, result.isYakuman));

  // タブUI (親/子)、 上がった人で デフォルト
  const defaultTab = isOya ? 'oya' : 'ko';

  // あがり手牌 (ソート済 + あがり牌を右端で強調)
  const tileSpan = tileSpanHtml;
  let handHtml = '<div style="background:rgba(0,0,0,0.35); padding:8px 6px 4px; border-radius:6px; margin:6px 0; text-align:center; line-height:1;">';
  const winTile = context.winTile;
  const meldSet = new Set(meldTriples(seat));
  const handDisp = hand.filter(t => !meldSet.has(t));
  const restTiles = winTile ? (() => {
    const rest = [...handDisp];
    const wi = rest.indexOf(winTile);
    if (wi >= 0) rest.splice(wi, 1);
    return rest;
  })() : handDisp;
  handHtml += sortHand(restTiles).map(t => tileSpan(t)).join('');
  if (winTile) {
    handHtml += '<span style="display:inline-block; width:8px;"></span>';
    handHtml += tileSpan(winTile, 'box-shadow: 0 0 0 2px #ff9800, 0 0 8px rgba(255,152,0,0.9);');
  }
  // 抜いた北も 右に添える
  if (G.kitaTiles[seat] && G.kitaTiles[seat].length > 0) {
    handHtml += '<span style="display:inline-block; width:10px;"></span>';
    handHtml += G.kitaTiles[seat].map(t => tileSpan(t, 'width:20px; height:27px; opacity:0.85;')).join('');
  }
  if (G.melds[seat] && G.melds[seat].length > 0) {
    handHtml += '<span style="display:inline-block; width:10px;"></span>';
    G.melds[seat].forEach(m => {
      handHtml += m.tiles.map(t => tileSpan(t, 'width:20px; height:27px; box-shadow:0 0 0 1px #66bb6a;')).join('');
      handHtml += '<span style="display:inline-block; width:6px;"></span>';
    });
  }
  handHtml += `<div style="font-size:9px; color:#aac; margin-top:3px;">${winTile ? `右端が${winType}あがり牌` : ''}${G.kitaTiles[seat] && G.kitaTiles[seat].length > 0 ? ' / 小さい北=北抜き' : ''}</div>`;
  handHtml += '</div>';

  // 獲得点バナー (今回の点数を 最初に大きく)
  const gain = transfers[seat] || 0;
  const payerCount = ALL_SEATS.filter(s => s !== G.emptySeat && s !== seat).length;
  const honbaAdd = prevHonba > 0 ? (context.isTsumo ? 100 * prevHonba * payerCount : 300 * prevHonba) : 0;
  const baseGain = gain - prevKyotaku - honbaAdd;
  const fromLabel = context.isTsumo
    ? (isOya ? `親ツモ — 全員から ${(baseGain / Math.max(1, payerCount)).toLocaleString()}点ずつ` : 'ツモ — 親と子から')
    : `ロン — ${seatShareLabel(context.fromSeat) || ''} の支払い`;
  // 初心者向け: 「基本点」 を大きく (点数表の値と一致 = 覚えられる)、 本場/供託は別枠で加算表示
  let bannerHtml = '<div style="background:rgba(255,235,59,0.15); border:1px solid rgba(255,235,59,0.5); border-radius:8px; padding:8px 10px; margin:6px 0; text-align:center;">';
  bannerHtml += `<div style="font-size:26px; font-weight:bold; color:#ffeb3b; line-height:1.2;">${baseGain.toLocaleString()}<span style="font-size:14px;">点</span></div>`;
  const parts = [];
  if (honbaAdd > 0) parts.push(`本場 ${honbaAdd.toLocaleString()}`);
  if (prevKyotaku > 0) parts.push(`供託 ${prevKyotaku.toLocaleString()}`);
  if (parts.length > 0) {
    bannerHtml += `<div style="font-size:14px; color:#ffd54f; margin-top:2px;">+ ( ${parts.join(' + ')} )</div>`;
    bannerHtml += `<div style="font-size:12px; color:#cde; margin-top:2px;">= 合計 <b style="color:#ffeb3b;">+${gain.toLocaleString()}点</b></div>`;
  }
  bannerHtml += `<div style="font-size:10px; color:#cde; margin-top:3px;">${fromLabel}</div>`;
  bannerHtml += '</div>';

  // ドラ確認セクション (表ドラ + リーチ和了なら裏ドラも公開)
  const tinyTile = (t) => tileSpanHtml(t, 'width:20px; height:27px; vertical-align:middle;');
  let doraHtml = '<div style="background:rgba(0,0,0,0.25); padding:6px 8px; border-radius:6px; margin:6px 0; font-size:11px; text-align:left;">';
  if (G.doraIndicator) {
    doraHtml += `<b style="color:#4fc3f7;">ドラ表示牌:</b> ${tinyTile(G.doraIndicator)} <small style="color:#aac;">→ ドラは「${TILE_NAMES[nextTileId(G.doraIndicator.id)]}」</small>`;
  }
  if (G.kanDoraInd.length > 0) {
    doraHtml += `<br><b style="color:#81c784;">カンドラ表示牌:</b> ${G.kanDoraInd.map(t => tinyTile(t)).join('')} <small style="color:#aac;">→ ${G.kanDoraInd.map(t => `「${TILE_NAMES[nextTileId(t.id)]}」`).join(' ')} もドラ扱い</small>`;
  }
  if (context.isRiichi && G.uraIndicator) {
    doraHtml += `<br><b style="color:#ce93d8;">裏ドラ表示牌:</b> ${tinyTile(G.uraIndicator)} <small style="color:#aac;">→ 裏ドラは「${TILE_NAMES[nextTileId(G.uraIndicator.id)]}」 (リーチしていたので公開)</small>`;
  }
  if (context.isRiichi && context.kanUra && context.kanUra.length > 0) {
    doraHtml += `<br><b style="color:#ce93d8;">カン裏表示牌:</b> ${context.kanUra.map(t => tinyTile(t)).join('')} <small style="color:#aac;">→ ${context.kanUra.map(t => `「${TILE_NAMES[nextTileId(t.id)]}」`).join(' ')} も裏ドラ扱い</small>`;
  }
  doraHtml += '</div>';

  // 役一覧 (今回の hit のみ)
  let yakuHtml = bannerHtml + handHtml + doraHtml;
  yakuHtml += '<div style="background:rgba(255,235,59,0.12); padding:6px 8px; border-radius:6px; margin:6px 0; text-align:left; font-size:11px;">';
  yakuHtml += '<b style="color:#ffeb3b;">今回の役:</b> ';
  yakuHtml += result.yakuList.map(y => `${y.name}<small>(${y.han}翻)</small>`).join(' / ');
  yakuHtml += '</div>';

  // 点数表 (タブ切替)
  function buildTable(tab) {
    let html = '<table style="width:100%; border-collapse:collapse; font-size:10px; margin-top:4px;">';
    html += '<thead><tr>';
    html += '<th style="padding:3px 4px; background:#2d6b3f; color:#fff; text-align:left; border:1px solid #4a6;">翻数</th>';
    if (tab === 'oya') {
      html += '<th style="padding:3px 4px; background:#2d6b3f; color:#fff; border:1px solid #4a6;">親ロン</th>';
      html += '<th style="padding:3px 4px; background:#2d6b3f; color:#fff; border:1px solid #4a6;">親ツモ<br><small>(各家払い)</small></th>';
    } else {
      html += '<th style="padding:3px 4px; background:#2d6b3f; color:#fff; border:1px solid #4a6;">子ロン</th>';
      html += '<th style="padding:3px 4px; background:#2d6b3f; color:#fff; border:1px solid #4a6;">子ツモ<br><small>(親 / 子)</small></th>';
    }
    html += '</tr></thead><tbody>';
    SCORE_TABLE.forEach((row, i) => {
      const hit = (i === hitRowIdx);
      const rowStyle = hit ? 'background:#ffeb3b; color:#000; font-weight:bold;' : 'background:rgba(255,255,255,0.05); color:#ddd;';
      // 今回の点数セル: あがった人のタブ + 該当翻の行 + ロン/ツモの列 に 赤枠+📍
      const isWinnerTab = (tab === defaultTab);
      const hiRon = (hit && isWinnerTab && !context.isTsumo) ? ' outline:2px solid #f44336; outline-offset:-2px;' : '';
      const hiTsumo = (hit && isWinnerTab && context.isTsumo) ? ' outline:2px solid #f44336; outline-offset:-2px;' : '';
      const pinRon = hiRon ? '📍' : '';
      const pinTsumo = hiTsumo ? '📍' : '';
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding:3px 4px; border:1px solid #4a6;">${row.label}</td>`;
      if (tab === 'oya') {
        html += `<td style="padding:3px 4px; border:1px solid #4a6; text-align:right;${hiRon}">${pinRon}${row.oyaRon.toLocaleString()}</td>`;
        html += `<td style="padding:3px 4px; border:1px solid #4a6; text-align:right;${hiTsumo}">${pinTsumo}${row.oyaTsumo.toLocaleString()}</td>`;
      } else {
        html += `<td style="padding:3px 4px; border:1px solid #4a6; text-align:right;${hiRon}">${pinRon}${row.koRon.toLocaleString()}</td>`;
        html += `<td style="padding:3px 4px; border:1px solid #4a6; text-align:right;${hiTsumo}">${pinTsumo}${row.koTsumoOya.toLocaleString()} / ${row.koTsumoKo.toLocaleString()}</td>`;
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  let html = yakuHtml;
  // 点数移動 + 現スコア
  const playing = ALL_SEATS.filter(s => s !== G.emptySeat);
  html += '<div style="background:rgba(76,175,80,0.12); padding:6px 8px; border-radius:6px; margin:6px 0; text-align:left; font-size:11px;">';
  html += '<b style="color:#4caf50;">点数移動:</b> ';
  html += playing.filter(s => transfers[s] !== 0)
    .map(s => `${seatShareLabel(s)} <b style="color:${transfers[s] > 0 ? '#ffeb3b' : '#ff8a80'};">${transfers[s] > 0 ? '+' : ''}${transfers[s].toLocaleString()}</b>`)
    .join(' / ');
  html += '<br><b style="color:#4caf50;">現スコア:</b> ';
  html += playing.map(s => `${seatShareLabel(s)}=${G.scores[s].toLocaleString()}`).join(' / ');
  html += '</div>';
  // タブ
  html += '<div style="display:flex; gap:4px; margin-top:8px;">';
  html += `<button id="win-tab-oya" class="win-tab" data-tab="oya" style="flex:1; padding:6px; border:1px solid #4a6; background:${defaultTab === 'oya' ? '#4caf50' : '#143820'}; color:#fff; cursor:pointer; border-radius:4px 4px 0 0; font-size:12px;">親で上がった場合</button>`;
  html += `<button id="win-tab-ko" class="win-tab" data-tab="ko" style="flex:1; padding:6px; border:1px solid #4a6; background:${defaultTab === 'ko' ? '#4caf50' : '#143820'}; color:#fff; cursor:pointer; border-radius:4px 4px 0 0; font-size:12px;">子で上がった場合</button>`;
  html += '</div>';
  html += `<div id="win-table-area">${buildTable(defaultTab)}</div>`;
  html += `<p style="margin:8px 0 0; font-size:10px; color:#aac; text-align:left;">※ 30符固定の簡易点数表 (4麻標準)。 黄色行=該当翻数、 📍赤枠=今回の基本点 (これに本場・供託が足されます)</p>`;
  // 勝利演出の間 (カットイン ~1.2秒 + 公開手牌をひと目 + 点数移動バッジ) を置いてから リザルト表示
  setTimeout(() => showScoreBadges(transfers), 700);
  const WIN_REVEAL_MS = 2600;
  setTimeout(() => {
    playSE('win');
    textEl.innerHTML = html;
    renderAll();  // ラベル点数更新 (「盤面を見る」用)
    overlay.hidden = false;
    // net対戦ホスト: 結果をゲストへ配信 (ゲストにも同じ間で届く、 sum はゲストの牌譜保存用)
    if (NETQ()) NETQ().onWinModal(titleEl.textContent, html, kifuNetSummary);

    // タブ クリック
    document.querySelectorAll('.win-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.win-tab').forEach(b => {
          b.style.background = (b.dataset.tab === tab) ? '#4caf50' : '#143820';
        });
        document.getElementById('win-table-area').innerHTML = buildTable(tab);
      });
    });
  }, WIN_REVEAL_MS);
}

// ─── ダブロン リザルト (2人同時ロン — 供託・本場は上家取り = 討ち取り順で先の勝者) ───
function showDoubleRonModal(winners, fromSeat, tile) {
  const overlay = document.getElementById('end-overlay');
  const titleEl = document.getElementById('end-title');
  const textEl = document.getElementById('end-text');
  if (!overlay || !titleEl || !textEl) return;
  G.roundOver = true;
  G.busy = true;
  // 牌譜: 自分が勝者に含まれる → win / 自分の放銃 → dealin
  let kifuNetSummary = null;
  try {
    kifuNetSummary = {
      double: true, fromSeat,
      winnerSeat: winners[0].seat,
      winnerSeats: winners.map(w => w.seat),
      winnerLabel: winners.map(w => seatShareLabel(w.seat)).join('・'),
      winType: 'ロン',
      tier: winners.map(w => hanToTier(w.result.han, w.result.isYakuman)).join(' + '),
      yaku: winners.flatMap(w => w.result.yakuList.map(y => y.name)).slice(0, 8),
      winTileId: tile.id,
      winnerHand: sortHand([...G.hands[winners[0].seat], tile].filter(t => t && t.id != null)).map(t => t.id),
      chankan: false,
    };
    const mine = winners.find(w => w.seat === 'bottom');
    if (mine) {
      kifuFinishRound('win', { ...kifuNetSummary, winnerSeat: 'bottom', tier: hanToTier(mine.result.han, mine.result.isYakuman), yaku: mine.result.yakuList.map(y => y.name) });
    } else if (fromSeat === 'bottom') {
      kifuFinishRound('dealin', kifuNetSummary);
    }
    const kifuBtn = document.getElementById('end-kifu');
    if (kifuBtn && KIFU.lastSaved) kifuBtn.hidden = false;
  } catch (e) { /* 牌譜失敗でも表示は続行 */ }
  renderAll();

  // リーチ宣言牌への放銃: リーチ不成立 (差し戻し)
  if (tile.isRiichiDeclared && G.isRiichi[fromSeat] && G.kyotaku >= 1000) {
    G.isRiichi[fromSeat] = false;
    G.doubleRiichi[fromSeat] = false;
    G.riichiTurnsLeft[fromSeat] = 0;
    G.scores[fromSeat] += 1000;
    G.kyotaku -= 1000;
  }
  // 点数移動: 1人目 (討ち取り順で上家) が 本場・供託を総取り、 2人目は素点のみ
  const totals = {};
  ALL_SEATS.forEach(s => { totals[s] = 0; });
  const t1 = applyWinScore(winners[0].seat, { isTsumo: false, fromSeat }, winners[0].result);
  Object.keys(t1).forEach(s => { totals[s] += t1[s]; });
  const savedHonba = G.honba;
  G.honba = 0;  // 2人目には本場を付けない (供託は1人目が回収済みで0)
  const t2 = applyWinScore(winners[1].seat, { isTsumo: false, fromSeat }, winners[1].result);
  G.honba = savedHonba;
  Object.keys(t2).forEach(s => { totals[s] += t2[s]; });
  // 連荘判定: 勝者に親が含まれれば連荘
  if (winners.some(w => w.seat === G.oya)) {
    G.honba++;
    G.lastResult = 'oyaWin';
  } else {
    G.honba = 0;
    G.lastResult = 'koWin';
  }

  titleEl.textContent = `🎉 ダブルロン! ${winners.map(w => seatShareLabel(w.seat)).join(' と ')}`;
  const playing = ALL_SEATS.filter(s => s !== G.emptySeat);
  let html = '';
  for (const w of winners) {
    const tier = hanToTier(w.result.han, w.result.isYakuman);
    const handTiles = sortHand([...G.hands[w.seat]]);
    html += '<div style="background:rgba(0,0,0,0.3); border:1px solid #4a6; border-radius:8px; padding:8px 10px; margin:6px 0; text-align:left;">';
    html += `<div style="font-size:13px;"><b style="color:#ffeb3b;">${seatShareLabel(w.seat)}</b> — ${tier} (${w.result.isYakuman ? '役満' : w.result.han + '翻'})</div>`;
    html += '<div style="margin:5px 0; line-height:1; text-align:center;">';
    html += handTiles.map(t => tileSpanHtml(t, 'width:20px; height:27px;')).join('');
    html += '<span style="display:inline-block; width:8px;"></span>';
    html += tileSpanHtml(tile, 'width:20px; height:27px; box-shadow: 0 0 0 2px #ff9800, 0 0 8px rgba(255,152,0,0.9);');
    html += '</div>';
    html += `<div style="font-size:11px; color:#dde;">${w.result.yakuList.map(y => `${y.name}<small>(${y.han}翻)</small>`).join(' / ')}</div>`;
    html += '</div>';
  }
  html += '<div style="background:rgba(76,175,80,0.12); padding:6px 8px; border-radius:6px; margin:6px 0; text-align:left; font-size:11px;">';
  html += '<b style="color:#4caf50;">点数移動:</b> ';
  html += playing.filter(s => totals[s] !== 0)
    .map(s => `${seatShareLabel(s)} <b style="color:${totals[s] > 0 ? '#ffeb3b' : '#ff8a80'};">${totals[s] > 0 ? '+' : ''}${totals[s].toLocaleString()}</b>`)
    .join(' / ');
  html += '<br><b style="color:#4caf50;">現スコア:</b> ';
  html += playing.map(s => `${seatShareLabel(s)}=${G.scores[s].toLocaleString()}`).join(' / ');
  html += `<br><small style="color:#9ab;">※ 本場・供託は 討ち取り順で先の ${seatShareLabel(winners[0].seat)} が受け取ります (上家取り)</small>`;
  html += '</div>';

  setTimeout(() => showScoreBadges(totals), 700);
  setTimeout(() => {
    playSE('win');
    textEl.innerHTML = html;
    renderAll();
    overlay.hidden = false;
    if (NETQ()) NETQ().onWinModal(titleEl.textContent, html, kifuNetSummary);
  }, 2600);
}

// 三麻 半荘 = 東3+南3 = 6局
const ROUND_ORDER = ['東1', '東2', '東3', '南1', '南2', '南3'];
function nextRound() {
  if (G.type === 'single') { location.href = 'index.html'; return; }
  // トビ終了 (オプション): 誰かの持ち点が0点未満なら半荘打ち切り
  const playingT = ALL_SEATS.filter(s => s !== G.emptySeat);
  if (G.rules && G.rules.tobi && playingT.some(s => G.scores[s] < 0)) {
    document.getElementById('end-title').textContent = '半荘終了 (トビ)';
    const rankedT = [...playingT].sort((a, b) => G.scores[b] - G.scores[a]);
    document.getElementById('end-text').innerHTML
      = `${rankedT.filter(s => G.scores[s] < 0).map(s => seatShareLabel(s)).join('・')} の持ち点がマイナスになったため終了です。<br>最終スコア:<br>${rankedT.map((s, i) => `${i + 1}位 ${seatShareLabel(s)} = ${G.scores[s].toLocaleString()}点`).join('<br>')}`;
    const nextBtnT = document.getElementById('end-next');
    if (nextBtnT) nextBtnT.style.display = 'none';
    G.gameEnded = true;  // 半荘終了と同じ扱い (退出確認を出さない + net の操作受付停止)
    document.getElementById('end-overlay').hidden = false;
    if (NETQ()) NETQ().onGameEnd(document.getElementById('end-title').textContent, document.getElementById('end-text').innerHTML);
    return;
  }
  // 親連荘判定: 親あがり or 流局時親テンパイ → 局を進めず 連荘 (本場は 終了処理側で更新済)
  // 親流れ → 局進行 + 親を反時計回り次家に
  const continuingDealer = (G.lastResult === 'oyaWin' || G.lastResult === 'tenpaiOya');
  if (!continuingDealer) {
    const idx = ROUND_ORDER.indexOf(G.round);
    if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
      // 半荘終了 (「次の局へ」 は隠して ロビーのみ)
      document.getElementById('end-title').textContent = '半荘終了';
      const playingSeats = ALL_SEATS.filter(s => s !== G.emptySeat);
      const ranked = [...playingSeats].sort((a, b) => G.scores[b] - G.scores[a]);
      document.getElementById('end-text').innerHTML
        = `東3局〜南3局まで完走しました。<br>最終スコア:<br>${ranked.map((s, i) => `${i + 1}位 ${seatShareLabel(s)} = ${G.scores[s].toLocaleString()}点`).join('<br>')}`;
      const nextBtn = document.getElementById('end-next');
      if (nextBtn) nextBtn.style.display = 'none';
      G.gameEnded = true;
      if (NETQ()) NETQ().onGameEnd('半荘終了', document.getElementById('end-text').innerHTML);
      return;
    }
    G.round = ROUND_ORDER[idx + 1];
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
  // 席が未割当のときのみ ランダム配置 (net対戦は hostStart が割当済 —
  // ゲスト2人だと cpuSeats=[] になるため、 emptySeat 未設定を「未割当」の判定に使う)
  if ((!G.cpuSeats || G.cpuSeats.length === 0) && !G.emptySeat) {
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
  G.kitaTiles = { bottom: [], right: [], top: [], left: [] };
  G.hands = { bottom: [], right: [], top: [], left: [] };
  G.turn = G.oya;
  G.selected = null;
  G.justDrawn = null;
  G.busy = false;
  G.startSeat = null;
  G.diceTotal = 0;
  G.diceD1 = 0;
  G.diceD2 = 0;
  G.ceremonyActive = true;  // net: ゲストへ「儀式中」を公開 (closeDiceCeremony で解除)
  G.cutPosInStart = 0;
  G.kingTiles = [];
  G.kingPoolCells = [];
  G.kanDoraDefs = [];
  G.kingUsedCells = [];
  G.kanDoraCells = [];
  G.drawTiles = [];
  G.doraIndicator = null;
  G.uraIndicator = null;
  G.doraSeat = null;
  G.doraDouIdx = -1;
  G.drawPosList = [];
  G.kingCells = [];
  G.isRiichi = { bottom: false, right: false, top: false, left: false };
  G.doubleRiichi = { bottom: false, right: false, top: false, left: false };
  G.riichiTurnsLeft = { bottom: 0, right: 0, top: 0, left: 0 };
  G.melds = { bottom: [], right: [], top: [], left: [] };
  G.kanDoraInd = [];
  G.pendingRon = null;
  G.pendingCall = null;
  G.pendingKakan = null;
  G.justKanDrawn = null;
  G.justRiichiDeclared = null;
  G.roundOver = false;
  G.passFuriten = { bottom: false, right: false, top: false, left: false };
  G.tempFuriten = { bottom: false, right: false, top: false, left: false };
  G.ronQueue = null;
  G.kuikaeBan = null;
  G.lastDiscard = null;
  const nextBtn = document.getElementById('end-next');
  if (nextBtn) nextBtn.style.display = '';
  const peekReturn = document.getElementById('peek-return');
  if (peekReturn) peekReturn.hidden = true;
  kifuStartRound();  // 牌譜: 新しい局の記録開始 (📖ボタンも隠す)
  if (NETQ()) NETQ().onNewRound();  // net対戦: endInfo クリア
  renderAll();

  if (localStorage.getItem('omoroi-guide-done')) {
    setTimeout(showDiceCeremony, 400);
  }
}

// ─── サイコロ セレモニー ─────────────────────
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const SEAT_NAME_FOR_DICE = { bottom: 'あなた (自家)', right: '下家', top: '対面', left: '上家' };

async function showDiceCeremony(preset) {
  // preset = {guest:true, d1, d2}: net対戦ゲスト用 — ホストが振ったサイコロ値で同じ演出を再生
  // (壁/王牌/起点データは ingestPub 済みの G を使い、 applyDice は実行しない)
  const isGuestView = !!(preset && preset.guest);
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
  overlay.classList.remove('dice-overlay--low');
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

  const d1 = isGuestView ? preset.d1 : Math.floor(Math.random() * 6) + 1;
  const d2 = isGuestView ? preset.d2 : Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2;
  d1El.textContent = DICE_FACES[d1 - 1];
  d2El.textContent = DICE_FACES[d2 - 1];
  d1El.classList.remove('dice--rolling');
  d2El.classList.remove('dice--rolling');
  totalEl.textContent = total;

  if (!isGuestView) {
    G.diceTotal = total;
    G.diceD1 = d1;
    G.diceD2 = d2;

    // サイコロ結果を 山に適用 (親 G.oya から 反時計回りに数える)
    const r = applyDice(G.walls, total, G.oya);
    G.startSeat = r.startSeat;
    G.cutPosInStart = r.cutPosInStart;  // = サイコロ目X (= カット位置 = 右端からX幢目)
    G.kingTiles = r.kingTiles;
    G.kingPoolCells = r.kingPoolCells;
    G.kanDoraDefs = r.kanDoraDefs;
    G.kingUsedCells = [];
    G.kanDoraCells = [];
    G.drawTiles = r.drawTiles;
    G.doraSeat = r.doraSeat;
    G.doraDouIdx = r.doraDouIdx;
    G.drawPosList = r.drawPosList;
    G.kingCells = r.kingCells;
    G.doraIndicator = r.doraIndicator;
    G.uraIndicator = r.uraIndicator;
    // net-host: サイコロ値+壁データを即公開 → ゲストも同じ儀式を再生
    if (NETQ() && NETQ().isHost()) NETQ().onCeremony();
  }
  const startSeat = G.startSeat;  // guest は ingestPub 済みの値 (自分視点に回転済)

  // 起点家の山 (カウント・王牌・ドラ) がポップアップに隠れないよう、
  // カウントが画面上側で進む 対面/下家 起点のときは ポップアップを下側へ退避
  overlay.classList.toggle('dice-overlay--low', startSeat === 'top' || startSeat === 'right');

  await sleep(400);
  titleEl.textContent = `合計 ${total}!`;
  explainEl.textContent = `親 (${SEAT_NAME_FOR_DICE[G.oya]}) から反時計回りに ${total} 番目 = 「${SEAT_NAME_FOR_DICE[startSeat]}」 の山から決めます`;
  if (mnemonicEl) mnemonicEl.hidden = false;
  await sleep(2200);

  counterEl.hidden = false;
  titleEl.textContent = '👉 起点家の山の右端から数えます';
  explainEl.textContent = `右端から ${total} 幢 数えた位置で カット → カットの右隣 7幢 (14牌) が「王牌」、 割れ目から3幢目の上段が「ドラ表示」`;

  // カウントアニメ: 起点家の山の 「右端から N幢目」 を 順に ハイライト (視覚的に)
  // DOM 順 (= append 順) は dou0_top, dou0_bot, ..., dou12_top, dou12_bot, dou13_top
  // 視覚的に「右端 = dou0」 なので 1幢目 = dou0、 2幢目 = dou1、 ... 同一幢は 上段+下段 両方ハイライト
  const wallEl = document.getElementById(`wall-${startSeat}`);
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
  G._doraRevealPending = false;  // めくり演出の瞬間 — ここで初めてドラ表示牌を公開 (ゲスト先見え防止)
  renderWalls();  // 王牌 (紫) + ドラ表示牌 (表向き) を 山に反映
  titleEl.textContent = '✨ 王牌+ドラ表示 決定!';
  explainEl.textContent = `紫の 7幢 (14牌) が王牌。 割れ目から3幢目で 表向きになっている牌が ドラ表示です (割れ目側の2幢は カン・北抜き用の嶺上牌)。`;
  counterEl.hidden = true;
  if (isGuestView) {
    // ゲストは配牌の権限なし: ホストの配牌 (phase=play の pub) を待って自動で閉じる
    explainEl.textContent += ' まもなくホストの合図で配牌が始まります…';
    G._guestCeremonyAnimDone = true;
    if (G._guestCeremonyCloseWanted) closeGuestCeremony();
  } else {
    okBtn.hidden = false;
  }
}

function closeGuestCeremony() {
  const ov = document.getElementById('dice-overlay');
  if (ov) ov.hidden = true;
  G._guestCeremonyAnimDone = false;
  G._guestCeremonyCloseWanted = false;
  if (G._doraRevealPending) {  // 演出スキップ時もここでドラ公開 (安全網)
    G._doraRevealPending = false;
    renderWalls();
  }
}

function closeDiceCeremony() {
  document.getElementById('dice-overlay').hidden = true;
  G.ceremonyActive = false;  // net: 以降の pub は phase=play (ゲスト儀式の閉幕合図)
  // ガード: サイコロ未適用 (山0) や 二重呼び出し (配牌済で山55枚等) では配牌しない
  if (G.drawTiles.length !== 94) return;
  // 配牌実施
  const dealt = dealHands(G.drawTiles, G.oya, G.cpuSeats, G.emptySeat);
  G.hands = dealt.hands;
  G.drawTiles = dealt.drawTilesRemain;
  renderAll();
  setTimeout(() => startTurn(), 200);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 効果音 (Web Audio 合成 — 音声ファイル不要、 再生時以外は処理ゼロで省電力) ──
let _audioCtx = null;
let seMuted = false;
function _seCtx() {
  if (seMuted) return null;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  } catch (e) { return null; }
}
function _tone(ctx, freq, t0, dur, vol, type = 'sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur);
}
function playSE(kind) {
  const ctx = _seCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    if (kind === 'discard')      _tone(ctx, 1700, t, 0.045, 0.10, 'square');
    else if (kind === 'kita')    { _tone(ctx, 620, t, 0.08, 0.14); _tone(ctx, 930, t + 0.07, 0.10, 0.14); }
    else if (kind === 'riichi')  { _tone(ctx, 880, t, 0.12, 0.18); _tone(ctx, 1320, t + 0.11, 0.18, 0.18); }
    else if (kind === 'alert')   { _tone(ctx, 1046, t, 0.15, 0.22); _tone(ctx, 1568, t + 0.13, 0.20, 0.22); }
    else if (kind === 'win')     [523, 659, 784, 1046].forEach((f, i) => _tone(ctx, f, t + i * 0.09, 0.25, 0.18));
  } catch (e) { /* 音は失敗しても ゲーム進行を止めない */ }
}

// ─── ボイス (Web Speech API — 端末内蔵の日本語音声で 「リーチ!」 等を発声、 ファイル不要) ──
let _jpVoice = null;
function _pickJpVoice() {
  try {
    const vs = (typeof window !== 'undefined' && window.speechSynthesis)
      ? window.speechSynthesis.getVoices() : [];
    _jpVoice = vs.find(v => v.lang === 'ja-JP' && /Nanami|Haruka|Kyoko|Google 日本語|日本/i.test(v.name))
      || vs.find(v => v.lang && v.lang.startsWith('ja'))
      || null;
  } catch (e) { _jpVoice = null; }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = _pickJpVoice;
  _pickJpVoice();
}
// ボイス種別 → フォールバック読み上げテキスト。
// assets/voice/{kind}.mp3 (または .wav) が存在すれば **ファイルを優先再生**
// (= 初音ミク等の録音ボイスをここに置くだけで差し替わる)。 無ければ内蔵音声合成。
const VOICE_DEFS = {
  riichi: 'リーチ!',
  ron: 'ロン!',
  tsumo: 'ツモ!',
  kita: 'ペイ',    // 北は麻雀読みで「ペイ」
  on: 'オン',
};
const _voiceAudio = {};  // kind → HTMLAudioElement (ロード成功) | null (ファイル無し確定)
function _loadVoiceFile(kind) {
  if (kind in _voiceAudio) return;
  if (typeof Audio === 'undefined') { _voiceAudio[kind] = null; return; }
  _voiceAudio[kind] = null;  // 判定完了まで null (フォールバック使用)
  const tryLoad = (exts) => {
    if (exts.length === 0) return;
    try {
      const a = new Audio(`assets/voice/${kind}.${exts[0]}`);
      a.preload = 'auto';
      a.addEventListener('canplaythrough', () => { _voiceAudio[kind] = a; }, { once: true });
      a.addEventListener('error', () => tryLoad(exts.slice(1)), { once: true });
    } catch (e) { /* Audio 非対応環境 */ }
  };
  tryLoad(['mp3', 'wav']);
}
if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  Object.keys(VOICE_DEFS).forEach(_loadVoiceFile);  // 起動時にプリロード判定
}
// ─── 宣言カットイン演出 (帯バナー) + ボイス/SE をまとめて発火 ───
const CALLOUT_DEFS = {
  riichi: { text: 'リーチ!', color: 'rgba(230,81,0,0.92)' },
  ron:    { text: 'ロン!',   color: 'rgba(198,40,40,0.94)' },
  tsumo:  { text: 'ツモ!',   color: 'rgba(175,124,10,0.94)' },
  kita:   { text: '北抜き',  color: 'rgba(21,101,192,0.92)' },
  kan:    { text: 'カン!',   color: 'rgba(46,125,50,0.94)' },
  pon:    { text: 'ポン!',   color: 'rgba(93,64,155,0.94)' },
};
let _calloutTimer = null;
function showCallout(kind) {
  try {
    const def = CALLOUT_DEFS[kind];
    const el = document.getElementById('callout');
    const tx = document.getElementById('callout-text');
    if (!def || !el || !tx) return;
    tx.textContent = def.text;
    tx.style.setProperty('--callout-bg', def.color);
    el.hidden = false;
    // 連続宣言でもアニメを 先頭から再生
    tx.style.animation = 'none';
    void tx.offsetWidth;
    tx.style.animation = '';
    if (_calloutTimer) clearTimeout(_calloutTimer);
    _calloutTimer = setTimeout(() => { el.hidden = true; }, 1150);
  } catch (e) { /* 演出失敗でもゲームは止めない */ }
}
// 宣言 = カットイン + ボイス (SE は 各所で既存のまま)
// net-host はイベントとして pub に載せ、 ゲスト側でも各自の announce で再生される
// 連続宣言 (例: リーチ宣言牌に即ロン) は 900ms 間隔のキューで順番に鳴らす (声被り防止)
let _announceUntil = 0;
function announce(kind) {
  const GAP = 900;  // ボイス1発分の長さ
  const now = Date.now();
  if (now < _announceUntil) {
    const wait = _announceUntil - now;
    _announceUntil += GAP;
    setTimeout(() => { showCallout(kind); playVoice(kind); }, wait);
  } else {
    _announceUntil = now + GAP;
    showCallout(kind);
    playVoice(kind);
  }
  if (NETQ() && NETQ().isHost()) NETQ().recordEvent(kind);
}

function playVoice(kind) {
  if (seMuted) return;
  const text = VOICE_DEFS[kind];
  if (!text) return;
  try {
    // ① 録音ボイスファイルがあれば優先 (初音ミク差し替え口)
    const a = _voiceAudio[kind];
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
      return;
    }
    // ② フォールバック: 端末内蔵の日本語音声合成
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!_jpVoice) _pickJpVoice();
    const u = new SpeechSynthesisUtterance(text);
    if (_jpVoice) u.voice = _jpVoice;
    u.lang = 'ja-JP';
    u.rate = 1.2;   // 掛け声らしく 少し速め
    u.pitch = 1.15;
    u.volume = 1.0;
    window.speechSynthesis.cancel();  // 前の発声が残っていたら 打ち切って 即発声
    window.speechSynthesis.speak(u);
  } catch (e) { /* ボイス失敗でもゲームは止めない */ }
}

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
  { title: '🎲 サイコロで起点家+カット位置', text: '親がサイコロ2個を振り、 出目で 起点家を決定 + 起点家の山の右端から出目数の位置で カット → カット右隣の7幢 (14牌) が王牌、 割れ目から3幢目の上段がドラ表示 (実際の麻雀と同じ)。' },
  { title: '🟡 卓全体で1つの山', text: '4家それぞれ前に27牌の山。 ツモは 起点家のカット位置から反時計回りに進みます。' },
  { title: '🀃 北抜き', text: '北 (🀃) を引いたら「北抜き」 で抜き、 王牌末尾 (嶺上) から補充自摸。 抜くたび1翻 (関西ルール)。' },
  { title: '✨ 全部赤ドラ', text: '5筒×4枚 + 5索×4枚 = 計8枚 全赤ドラ。 引いただけで 1翻ずつ加算。' },
  { title: 'はじめよう!', text: '牌タップ→「打牌」 で捨てる。 ターンは 反時計回り、 空席はスキップ。 3・3・3・3・2 を作るのが目的! オレンジに光る牌が 最新の捨て牌。 PCなら ←→ で牌選択、 Enter で打牌もOK。' }
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

// ─── Service Worker 登録 (オフライン対応 + 通信料削減: 牌画像/CSS/JS をキャッシュ) ──
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && location.protocol && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ─── ゲーム初期化 ─────────────────────────
function initGame() {
  const params = new URLSearchParams(location.search);
  // ルールオプション (既定 on。 net はホストのURL設定が pub で全員に配布される)
  G.rules = { naki: params.get('naki') !== '0', tobi: params.get('tobi') !== '0' };
  // net対戦 (?net=host / ?net=join&room=1234): netgame.js に委譲
  const netMode = params.get('net');
  if (netMode && NETQ()) {
    G.mode = 'net';
    G.type = 'hanchan';
    NETQ().boot(netMode, params);
    return;
  }
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
    // ⚙️対局設定 (鳴きなし/自動和了/自動北抜き/効果音/AI採点 — 端末ごとに localStorage 保持)
    loadGameOptions();
    initGame();
    document.getElementById('settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('guide-next')?.addEventListener('click', () => {
      guideIdx++;
      if (guideIdx >= GUIDE_STEPS.length) finishGuide();
      else renderGuideStep();
    });
    document.getElementById('guide-skip')?.addEventListener('click', finishGuide);
    document.getElementById('guide-btn')?.addEventListener('click', showGuide);
    document.getElementById('btn-discard')?.addEventListener('click', () => {
      attemptDiscard(G.selected);
    });
    document.getElementById('btn-kita')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
      if (!hasDrawn('bottom') || G.justRiichiDeclared === 'bottom') return;
      // リーチ後は ツモった牌が北の時のみ (updateActionButtons と同条件)
      const drawnTile = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
      if (G.isRiichi.bottom && !(drawnTile && drawnTile.id === KITA_ID)) return;
      if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('kita'); return; }
      kitaNuki('bottom');
      renderAll();
    });
    document.getElementById('btn-pon')?.addEventListener('click', () => {
      if (!G.pendingCall || G.pendingCall.cpu || G.roundOver) return;
      if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('pon'); return; }
      const pc = G.pendingCall;
      G.pendingCall = null;
      G.busy = false;
      doPon('bottom', pc.fromSeat, pc.tile);
      renderAll();
    });
    document.getElementById('btn-kan')?.addEventListener('click', () => {
      // 明槓 (他家の打牌への3枚鳴き): ポンオファー中でカン可なら優先
      if (G.pendingCall && !G.pendingCall.cpu && G.pendingCall.canKan && !G.roundOver) {
        if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('minkan'); return; }
        const pc = G.pendingCall;
        G.pendingCall = null;
        G.busy = false;
        doMinkan('bottom', pc.fromSeat, pc.tile);
        renderAll();
        return;
      }
      if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
      if (!hasDrawn('bottom') || G.justRiichiDeclared === 'bottom') return;
      const ids = ankanCandidateIds('bottom');
      if (ids.length > 0) {
        // 暗槓: ツモ牌で4枚目が揃った牌を優先
        const drawnTile = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
        const id = (drawnTile && ids.includes(drawnTile.id)) ? drawnTile.id : ids[0];
        if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('ankan', { id }); return; }
        doAnkan('bottom', id);
        renderAll();
        // リーチ中の暗槓後: 嶺上牌で リーチ自動フロー再開 (ツモ判定 → 自動打牌)
        if (G.isRiichi.bottom) handleRiichiAutoBottom();
        return;
      }
      // 加槓: ポン済み刻子に手牌の4枚目を追加 (搶槓確認あり)
      const kIds = kakanCandidateIds('bottom');
      if (kIds.length === 0) return;
      const drawnTile2 = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
      const kid = (drawnTile2 && kIds.includes(drawnTile2.id)) ? drawnTile2.id : kIds[0];
      if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('kakan', { id: kid }); return; }
      doKakan('bottom', kid);
      renderAll();
    });
    document.getElementById('btn-tsumo')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
      if (G.justRiichiDeclared === 'bottom') return;  // 宣言牌を捨てる前はツモ不可
      if (!hasDrawn('bottom') || !isWinning(equivHand('bottom'))) return;
      const drawnTile = (G.justDrawn != null) ? G.hands.bottom[G.justDrawn] : null;
      const ctx = { isTsumo: true, isRiichi: G.isRiichi.bottom, isOya: G.oya === 'bottom', seatWind: seatWindOf('bottom'),
                    doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles('bottom'), openMeldIds: openMeldIds('bottom'), kitas: G.kitas.bottom, round: G.round,
                    isDoubleRiichi: G.doubleRiichi.bottom, firstDraw: G.rivers.bottom.length === 0 && G.kitas.bottom === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft.bottom > 0, winTile: drawnTile,
                    isRinshan: G.justKanDrawn === 'bottom' };
      const result = calcYaku(equivHand('bottom'), ctx);
      if (result.error) { toast(result.error); return; }
      if (result.han === 0 && !result.isYakuman) { toast('役なし'); return; }
      if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('tsumo'); return; }  // 演出はホスト確定後にイベントで届く
      announce('tsumo');
      showWinModal('bottom', equivHand('bottom'), ctx, result);
    });
    document.getElementById('btn-ron')?.addEventListener('click', () => {
      if (!G.pendingRon || G.roundOver) return;
      const { tile, fromSeat, chankan } = G.pendingRon;
      if (NETQ() && NETQ().isGuest()) {
        // ゲスト: 軽い事前チェックのみ (確定判定はホスト)
        const test0 = [...G.hands.bottom, tile, ...meldTriples('bottom')];
        if (!isWinning(test0)) return;
        NETQ().guestAction('ron');
        return;
      }
      if (chankan) {
        // 搶槓 (単独ロンのみ): 加槓牌はロン者へ渡る (加槓者の手牌から除去、 加槓は不成立のまま)
        const test = [...G.hands.bottom, tile, ...meldTriples('bottom')];
        const ctx = { isTsumo: false, isRiichi: G.isRiichi.bottom, isOya: G.oya === 'bottom', seatWind: seatWindOf('bottom'),
                      doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kanDora: G.kanDoraInd, kanUra: kanUraNow(), extraTiles: meldExtraTiles('bottom'), openMeldIds: openMeldIds('bottom'), kitas: G.kitas.bottom, round: G.round,
                      isDoubleRiichi: G.doubleRiichi.bottom, firstDraw: G.rivers.bottom.length === 0 && G.kitas.bottom === 0, isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft.bottom > 0, winTile: tile, fromSeat,
                      isChankan: true };
        const result = calcYaku(test, ctx);
        if (result.error) { toast(result.error); return; }
        if (G.pendingKakan) {
          const hi = G.hands[fromSeat].indexOf(tile);
          if (hi >= 0) G.hands[fromSeat].splice(hi, 1);
          G.pendingKakan = null;
        }
        G.pendingRon = null;
        G.busy = false;
        announce('ron');
        showWinModal('bottom', test, ctx, result);
        return;
      }
      // 通常ロン: キューに受諾を伝える (ダブロンの可能性があるため直接あがらない)
      G.pendingRon = null;
      ronQueueDecide('bottom', true);
    });
    document.getElementById('btn-pass')?.addEventListener('click', () => {
      // ポン/明槓のスルー
      if (G.pendingCall && !G.pendingCall.cpu && !G.roundOver) {
        if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('pass'); return; }
        G.pendingCall = null;
        G.busy = false;
        toast('スルーしました');
        renderAll();
        setTimeout(() => { nextTurn(); startTurn(); }, 120);
        return;
      }
      if (!G.pendingRon || G.roundOver) return;
      // あがり放棄は取り返しがつかない (フリテン) ため 最終確認を挟む
      appConfirm('<b>あがれる牌です。</b>本当に見逃しますか?<br>見逃すと フリテンになり しばらくロンできません', () => {
        if (!G.pendingRon || G.roundOver) return;  // 確認中にオファー時間切れ等で消えた場合
        if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('pass'); return; }
        const wasChankan = !!G.pendingRon.chankan;
        // 見逃しフリテン: 通常ロンは beginRonResolution で付与済み。 搶槓のみここで付与
        if (wasChankan) {
          if (G.isRiichi.bottom) G.passFuriten.bottom = true;
          else G.tempFuriten.bottom = true;
        }
        G.pendingRon = null;
        toast('見逃しました (フリテン: しばらくロンできません)');
        if (wasChankan) { G.busy = false; resumeAfterChankanPass(); return; }  // 加槓成立 → 加槓者のターン続行
        ronQueueDecide('bottom', false);
      }, '見逃す', 'やめる');
    });
    document.getElementById('btn-riichi')?.addEventListener('click', () => {
      if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
      // 宣言直後 (宣言牌を捨てる前) は 取消として動作。 まだ何も確定していないので状態を戻すだけ
      if (G.justRiichiDeclared === 'bottom') {
        G.justRiichiDeclared = null;
        G.selected = null;
        toast('リーチをやめました');
        renderAll();
        return;
      }
      if (G.isRiichi.bottom || G.scores.bottom < 1000) return;
      if (!canDeclareRiichi(G.hands.bottom, meldTriples('bottom'))) return;
      if (NETQ() && NETQ().isGuest()) { NETQ().guestAction('riichi'); return; }  // 成立は宣言牌打牌時 (ホスト側 discardTile)
      // ここでは宣言モードに入るだけ — リーチ成立 (isRiichi/-1000/供託/発声) は 宣言牌を捨てた瞬間 (discardTile)
      G.justRiichiDeclared = 'bottom';
      // 先頭の候補牌を自動選択 → あがり牌ガイドが即表示される (雀魂式)
      const dispOrder = sortHand(G.hands.bottom.filter((_, i) => i !== G.justDrawn));
      if (G.justDrawn != null && G.hands.bottom[G.justDrawn]) dispOrder.push(G.hands.bottom[G.justDrawn]);
      G.selected = dispOrder.find(t => isTenpai13(G.hands.bottom.filter(x => x !== t), meldTriples('bottom'))) || null;
      toast('光っている牌を捨てるとリーチ成立 (やめるなら「リーチ取消」)');
      renderAll();
    });
    document.getElementById('end-next')?.addEventListener('click', nextRound);
    // 牌譜: リザルトから直接ふりかえり
    document.getElementById('end-kifu')?.addEventListener('click', () => {
      if (KIFU.lastSaved) kifuOpenViewer(KIFU.lastSaved, false);
    });
    // ロビー退出は必ず最終確認を挟む (誤タップ防止 — ゲストは対戦復帰不能のため特に重要)
    document.getElementById('btn-back')?.addEventListener('click', (e) => { e.preventDefault(); confirmLeaveToLobby(); });
    document.getElementById('end-lobby')?.addEventListener('click', (e) => { e.preventDefault(); confirmLeaveToLobby(); });
    // ブラウザバック/リロード/スワイプバックの誤操作ガード (対局中のみ、 確認済み退出は素通し)
    window.addEventListener('beforeunload', (e) => {
      if (_leavingConfirmed || G.gameEnded || G.hands.bottom.length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    });
    document.getElementById('dice-ok')?.addEventListener('click', closeDiceCeremony);
    // 盤面を見る ⇄ 結果に戻る (局終了時、 モーダルを一時的に閉じて 公開された手牌と河を見る)
    document.getElementById('end-peek')?.addEventListener('click', () => {
      document.getElementById('end-overlay').hidden = true;
      const pr = document.getElementById('peek-return');
      if (pr) pr.hidden = false;
    });
    document.getElementById('peek-return')?.addEventListener('click', () => {
      const pr = document.getElementById('peek-return');
      if (pr) pr.hidden = true;
      document.getElementById('end-overlay').hidden = false;
    });
    // 画面幅が変わったら 河のグリッド配置を再計算 (モバイル⇔PC)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { ALL_SEATS.forEach(s => renderRiver(s)); }, 200);
    });

    // キーボード操作 (PC): ←→=牌選択 / Enter・Space=打牌 / R=リーチ / T=ツモ / L=ロン / P=パス / K=北抜き / Esc=ガイド閉じ
    document.addEventListener('keydown', (e) => {
      const guideOv = document.getElementById('guide-overlay');
      if (e.key === 'Escape') {
        if (guideOv && !guideOv.hidden) finishGuide();
        return;
      }
      if (guideOv && !guideOv.hidden) return;  // ガイド表示中は他キー無効
      const clickIf = (id) => {
        const b = document.getElementById(id);
        if (b && !b.disabled) b.click();
      };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (G.turn !== 'bottom' || G.busy || G.roundOver) return;
        if (!hasDrawn('bottom')) return;
        if (G.isRiichi.bottom && G.justRiichiDeclared !== 'bottom') return;  // リーチ後は選択不可
        // 表示順 (ソート済 + ツモ牌が末尾) で 選択を移動
        const displayed = sortHand(G.hands.bottom.filter((_, i) => i !== G.justDrawn));
        if (G.justDrawn != null && G.hands.bottom[G.justDrawn]) displayed.push(G.hands.bottom[G.justDrawn]);
        if (displayed.length === 0) return;
        let idx = displayed.indexOf(G.selected);
        idx = (e.key === 'ArrowRight')
          ? (idx + 1) % displayed.length
          : (idx <= 0 ? displayed.length - 1 : idx - 1);
        G.selected = displayed[idx];
        renderHand('bottom');
        renderRiichiGuide();
        updateActionButtons();
        updateHint();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickIf('btn-discard');
      } else if (e.key === 'r' || e.key === 'R') clickIf('btn-riichi');
      else if (e.key === 't' || e.key === 'T') clickIf('btn-tsumo');
      else if (e.key === 'l' || e.key === 'L') clickIf('btn-ron');
      else if (e.key === 'p' || e.key === 'P') clickIf('btn-pass');
      else if (e.key === 'g' || e.key === 'G') clickIf('btn-kan');
      else if (e.key === 'o' || e.key === 'O') clickIf('btn-pon');
      else if (e.key === 'k' || e.key === 'K') clickIf('btn-kita');
    });
  });
}

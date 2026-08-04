// テストハーネス — net.js / netgame.js を Node 上で動かすための最小環境
//
// 方針:
//   - 通信は FakeNet (同一プロセス内の共有ストア) に差し替え、ホストとゲストを同時に動かす。
//     LocalBusNet は BroadcastChannel が要るので Node では使えない。
//   - G は script.js の G リテラルを「実ファイルから抽出」して使う。
//     テスト用に手書きすると本体と乖離して、テストが通るのに本番で落ちる状態になるため。
//   - script.js 全体は DOM 依存が重いので読み込まない。netgame.js の通信層だけを対象にする。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const readSrc = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ─── script.js から G リテラルを抽出 ───────────────
// 本体と同じ初期値を使うため。抽出に失敗したら黙って進まず落とす。
function extractG() {
  const src = readSrc('script.js');
  const start = src.indexOf('\nconst G = {');
  if (start < 0) throw new Error('script.js から G リテラルを抽出できません (定義が変わった?)');
  // 対応する閉じ括弧を数えて切り出す
  const from = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('script.js の G リテラルの終端が見つかりません');
  return src.slice(from, end + 1);
}

// ─── FakeNet (共有ストア) ─────────────────────
// net.js の LocalBusNet と同じインターフェース。全インスタンスが1つの store を共有する。
function pathParts(p) { return p.split('/').filter(Boolean); }
function pathGet(obj, p) {
  let cur = obj;
  for (const k of pathParts(p)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}
function pathSet(obj, p, val) {
  const parts = pathParts(p);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (val === null) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = val;
}

class SharedStore {
  constructor() {
    this.data = {};
    this.valListeners = [];
    this.childListeners = [];
    this.writes = [];          // {path, bytes} — 通信量の計測用
    this.disconnects = [];     // {path, val} — onDisconnect の予約
  }
  set(p, val) {
    this.writes.push({ path: p, bytes: val == null ? 0 : JSON.stringify(val).length });
    pathSet(this.data, p, val);
    this.fire(p);
  }
  fire(p) {
    for (const l of this.valListeners) {
      if (p === l.path || p.startsWith(l.path + '/') || l.path.startsWith(p + '/')) {
        l.cb(pathGet(this.data, l.path));
      }
    }
  }
  push(p, val) {
    const key = 'k' + (this.writes.length) + Math.random().toString(36).slice(2, 6);
    this.writes.push({ path: p, bytes: JSON.stringify(val).length });
    pathSet(this.data, p + '/' + key, val);
    for (const l of this.childListeners) {
      if (l.path === p && !l.seen.has(key)) { l.seen.add(key); l.cb(val, key); }
    }
    this.fire(p);
    return key;
  }
  // 切断のシミュレート: 予約された onDisconnect を発火させる
  simulateDisconnect(uid) {
    for (const d of this.disconnects.filter(d => d.uid === uid)) this.set(d.path, d.val);
  }
  writesTo(prefix) { return this.writes.filter(w => w.path.startsWith(prefix)); }
  resetWrites() { this.writes = []; }
}

function makeFakeNet(store, uid) {
  return {
    uid,
    async init() { return this; },
    async setVal(p, val) { store.set(p, val); },
    onVal(p, cb) { store.valListeners.push({ path: p, cb }); cb(pathGet(store.data, p)); },
    async pushVal(p, val) { return store.push(p, val); },
    onChildAdd(p, cb) {
      const l = { path: p, cb, seen: new Set() };
      store.childListeners.push(l);
      const node = pathGet(store.data, p) || {};
      Object.keys(node).forEach(k => { l.seen.add(k); cb(node[k], k); });
    },
    async once(p) { return pathGet(store.data, p); },
    onDisconnectSet(p, val) { store.disconnects.push({ uid, path: p, val }); },
  };
}

// ─── 最小 DOM スタブ ─────────────────────────
function makeDom() {
  // addEventListener は記録する (テストから click を発火できるように)
  const mk = (id) => ({
    id, hidden: false, textContent: '', innerHTML: '', style: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    _h: {},
    addEventListener(type, fn) { (this._h[type] = this._h[type] || []).push(fn); },
    fire(type, ev) { (this._h[type] || []).forEach(fn => fn(ev || {})); },
    appendChild() {},
  });
  const els = {};
  return {
    getElementById(id) { return (els[id] = els[id] || mk(id)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return mk('_' + tag); },
    // DOMContentLoaded は発火させない (script.js の initGame を走らせないため)
    addEventListener() {}, removeEventListener() {},
    readyState: 'complete',
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    documentElement: { style: {} },
    _els: els,
  };
}

// ─── インスタンス生成 ───────────────────────
// mode: 'host' | 'guest'。 呼び出し側は inst.NetGame / inst.G / inst.S を操作する。
function makeInstance(store, uid, opts = {}) {
  const dom = makeDom();
  const logs = { toast: [], calls: [] };
  const noop = (name) => (...a) => { logs.calls.push({ name, args: a }); };

  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean,
    Set, Map, Promise, Error, URLSearchParams, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: dom,
    location: { search: '', href: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    ALL_SEATS: ['bottom', 'right', 'top', 'left'],
    SEAT_LABEL_BASE: { bottom: 'あなた', right: '下家', top: '対面', left: '上家' },
    KITA_ID: 23,
    KIFU: { active: false, steps: [], lastSaved: null },
    optNoNaki: false,
    // ゲームエンジン側はスタブ (通信層のテストなので実進行はさせない)
    renderAll: noop('renderAll'),
    toast: (m) => { logs.toast.push(m); },
    startNewRound: noop('startNewRound'),
    cpuDiscard: noop('cpuDiscard'),
    kitaNuki: noop('kitaNuki'),
    canRinshanDraw: () => false,
    // ターン進行 (オファー解決後に resumeAfterOffer から呼ばれる)
    nextTurn: noop('nextTurn'),
    startTurn: noop('startTurn'),
    completePendingKakan: noop('completePendingKakan'),
    checkCallsAfterDiscard: () => false,
    ronQueueDecide: noop('ronQueueDecide'),
    doPon: () => true,
    doMinkan: () => true,
    doAnkan: () => true,
    doKakan: () => true,
    kanUraNow: () => [],
    calcYaku: () => ({ yakuList: [], han: 0, isYakuman: false, error: 'stub' }),
    seatWindOf: () => '東',
    meldTriples: () => [],
    meldExtraTiles: () => [],
    openMeldIds: () => [],
    canKyuushu: () => false,
    doKyuushu: noop('doKyuushu'),
    showDiceCeremony: noop('showDiceCeremony'),
    closeGuestCeremony: noop('closeGuestCeremony'),
    announce: noop('announce'),
    showScoreBadges: noop('showScoreBadges'),
    updateActionButtons: noop('updateActionButtons'),
    showWinModal: noop('showWinModal'),
    kifuStartRound: noop('kifuStartRound'),
    kifuFinishRound: noop('kifuFinishRound'),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // net.js → netgame.js を1本のスクリプトとして評価 (const のスコープを共有させるため)。
  // 末尾で createNet を FakeNet に差し替えてから参照を返す。
  const code = [
    'const G = ' + extractG() + ';',
    readSrc('net.js'),
    readSrc('netgame.js'),
    'createNet = () => __fakeNet;',
    '({ NetGame, G, S: NetGame._S })',
  ].join('\n');
  ctx.__fakeNet = makeFakeNet(store, uid);
  const out = vm.runInContext(code, ctx, { filename: 'bundle.js' });

  return { NetGame: out.NetGame, G: out.G, S: out.S, dom, logs, uid, ctx };
}

// ─── ゲームエンジン (script.js) を読み込む ──────────
// script.js のトップレベル実行は全て `if (typeof document !== 'undefined')` 等のガード付きで、
// 実処理は DOMContentLoaded 経由。イベントを発火させないので 関数定義だけが手に入る。
function makeGame() {
  const dom = makeDom();
  dom.readyState = 'complete';
  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean,
    Set, Map, Promise, Error, URLSearchParams, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: dom,
    location: { search: '', href: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    // 対局の点数計算は score.js (符計算エンジン) に委ねている
    ScoreCalc: require('../score.js'),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = readSrc('script.js') + `
;({ G, calcYaku, isWinning, countTiles, sortHand, shantenOf, isTenpai13,
    TILE_NAMES, TILE_IMG, YAOCHU_IDS, RED_DORA_IDS, KITA_ID, ALL_SEATS,
    meldExtraTiles, openMeldIds, meldTriples, equivHand, seatWindOf,
    countYaochuKinds: (typeof countYaochuKinds === 'function' ? countYaochuKinds : null),
    canKyuushu: (typeof canKyuushu === 'function' ? canKyuushu : null),
    isNagashiMangan: (typeof isNagashiMangan === 'function' ? isNagashiMangan : null),
    coachAnalyzeCore: (typeof coachAnalyzeCore === 'function' ? coachAnalyzeCore : null),
    coachRemainingOf: (typeof coachRemainingOf === 'function' ? coachRemainingOf : null),
    coachDangerOf: (typeof coachDangerOf === 'function' ? coachDangerOf : null),
    coachShapeOf: (typeof coachShapeOf === 'function' ? coachShapeOf : null),
    waitingIds: (typeof waitingIds === 'function' ? waitingIds : null),
    nextTileId: (typeof nextTileId === 'function' ? nextTileId : null),
    calcFuForWin: (typeof calcFuForWin === 'function' ? calcFuForWin : null),
    calcFuBest: (typeof calcFuBest === 'function' ? calcFuBest : null),
    applyWinScore: (typeof applyWinScore === 'function' ? applyWinScore : null),
    waitCandidatesOf: (typeof waitCandidatesOf === 'function' ? waitCandidatesOf : null),
    roundWindId: (typeof roundWindId === 'function' ? roundWindId : null),
    seatWindIdOf: (typeof seatWindIdOf === 'function' ? seatWindIdOf : null) })`;
  const api = vm.runInContext(code, ctx, { filename: 'script.js' });
  return { ...api, ctx, dom };
}

// 牌の生成ヘルパー: 'あ1p' のような表記ではなく id 直指定。
//   萬子 0=1m 1=9m / 筒子 2..10 = 1p..9p / 索子 11..19 = 1s..9s
//   字牌 20=東 21=南 22=西 23=北 24=白 25=發 26=中
const T = (id, copy = 0, isRed = false) => ({ id, copy, isRed });
// 同一牌を n 枚 (copy 番号は自動で振る)
const Tn = (id, n) => Array.from({ length: n }, (_, i) => T(id, i));
// 連続する数牌 (順子): 起点 id から3枚
const Tseq = (id, copy = 0) => [T(id, copy), T(id + 1, copy), T(id + 2, copy)];

// ─── アサーション ─────────────────────────
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? '  — ' + detail : ''}`);
  return !!cond;
}
function summary(title) {
  const ng = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`${title}: ${results.length - ng.length}/${results.length} PASS`);
  if (ng.length) {
    console.log('\n失敗:');
    ng.forEach(r => console.log(`  ✗ ${r.name}  ${r.detail}`));
  }
  console.log('='.repeat(60));
  return ng.length === 0;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { SharedStore, makeInstance, makeGame, check, summary, sleep, results, pathGet, T, Tn, Tseq };

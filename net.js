// おもろい三麻 — 通信層 (Phase 2 リアルタイム対戦)
// 2実装を同一インターフェースで提供:
//   FirebaseNet : 本番 (Realtime DB + 匿名認証、 firebase-config.js の設定が必要)
//   LocalBusNet : 同一ブラウザのタブ間対戦 (BroadcastChannel、 テスト/デモ用 — ?local=1)
// インターフェース:
//   await net.init()
//   net.uid
//   await net.setVal(path, val) / net.onVal(path, cb) / await net.pushVal(path, val)
//   net.onChildAdd(path, cb) / await net.once(path) / net.onDisconnectSet(path, val)

'use strict';

// ─── パスユーティリティ ───────────────────────
function _pathParts(path) { return path.split('/').filter(Boolean); }
function _pathGet(obj, path) {
  let cur = obj;
  for (const p of _pathParts(path)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
}
function _pathSet(obj, path, val) {
  const parts = _pathParts(path);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (val === null) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = val;
}

// ─── LocalBusNet (BroadcastChannel、 同一ブラウザ限定) ──
class LocalBusNet {
  constructor() {
    this.uid = 'local-' + Math.random().toString(36).slice(2, 10);
    this.store = {};
    this.valListeners = [];   // {path, cb}
    this.childListeners = []; // {path, cb, seen:Set}
    this.ready = false;
  }
  async init() {
    this.ch = new BroadcastChannel('omoroi-sanma-net');
    this.ch.onmessage = (ev) => this._onMsg(ev.data);
    // 既存タブから 現在の store をもらう (200ms 待って 返答なければ 自分が最初)
    this.ch.postMessage({ op: 'hello', from: this.uid });
    await new Promise(r => setTimeout(r, 300));
    this.ready = true;
    return this;
  }
  _onMsg(m) {
    if (m.from === this.uid) return;
    if (m.op === 'hello') {
      this.ch.postMessage({ op: 'state', from: this.uid, to: m.from, store: this.store });
    } else if (m.op === 'state') {
      if (m.to === this.uid && !this.ready) {
        this.store = m.store || {};
        this._fireAll();
      }
    } else if (m.op === 'set') {
      _pathSet(this.store, m.path, m.val);
      this._fire(m.path);
    } else if (m.op === 'push') {
      _pathSet(this.store, m.path + '/' + m.key, m.val);
      this._fireChild(m.path, m.key, m.val);
      this._fire(m.path);
    }
  }
  _fire(path) {
    this.valListeners.forEach(l => {
      if (path === l.path || path.startsWith(l.path + '/') || l.path.startsWith(path + '/')) {
        l.cb(_pathGet(this.store, l.path));
      }
    });
  }
  _fireChild(path, key, val) {
    this.childListeners.forEach(l => {
      if (l.path === path && !l.seen.has(key)) { l.seen.add(key); l.cb(val, key); }
    });
  }
  _fireAll() {
    this.valListeners.forEach(l => l.cb(_pathGet(this.store, l.path)));
    this.childListeners.forEach(l => {
      const node = _pathGet(this.store, l.path) || {};
      Object.keys(node).forEach(k => {
        if (!l.seen.has(k)) { l.seen.add(k); l.cb(node[k], k); }
      });
    });
  }
  async setVal(path, val) {
    _pathSet(this.store, path, val);
    this.ch.postMessage({ op: 'set', from: this.uid, path, val });
    this._fire(path);
  }
  onVal(path, cb) {
    this.valListeners.push({ path, cb });
    cb(_pathGet(this.store, path));
  }
  async pushVal(path, val) {
    const key = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    _pathSet(this.store, path + '/' + key, val);
    this.ch.postMessage({ op: 'push', from: this.uid, path, key, val });
    this._fireChild(path, key, val);
    return key;
  }
  onChildAdd(path, cb) {
    const l = { path, cb, seen: new Set() };
    this.childListeners.push(l);
    const node = _pathGet(this.store, path) || {};
    Object.keys(node).forEach(k => { l.seen.add(k); cb(node[k], k); });
  }
  async once(path) { return _pathGet(this.store, path); }
  onDisconnectSet() { /* LocalBus は非対応 (タイムアウト代打ちで代替) */ }
}

// ─── FirebaseNet (Realtime DB compat SDK を動的ロード) ──
const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/9.23.0/';
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('SDK load failed: ' + src));
    document.head.appendChild(s);
  });
}
class FirebaseNet {
  constructor(config) { this.config = config; this.uid = null; }
  async init() {
    await _loadScript(FIREBASE_SDK_BASE + 'firebase-app-compat.js');
    await _loadScript(FIREBASE_SDK_BASE + 'firebase-auth-compat.js');
    await _loadScript(FIREBASE_SDK_BASE + 'firebase-database-compat.js');
    /* global firebase */
    this.app = firebase.initializeApp(this.config, 'omoroi-net');
    // タブ単位の匿名ユーザー (SESSION 永続化)。 LOCAL だと同一ブラウザの2タブが同一uidになり
    // players/{uid} を互いに上書きして同席できない (同一PC 2窓テストで発覚)
    await this.app.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
    const cred = await this.app.auth().signInAnonymously();
    this.uid = cred.user.uid;
    this.db = this.app.database();
    return this;
  }
  async setVal(path, val) { return this.db.ref(path).set(val); }
  onVal(path, cb) { this.db.ref(path).on('value', s => cb(s.val())); }
  async pushVal(path, val) { const r = await this.db.ref(path).push(val); return r.key; }
  onChildAdd(path, cb) { this.db.ref(path).on('child_added', s => cb(s.val(), s.key)); }
  async once(path) { const s = await this.db.ref(path).once('value'); return s.val(); }
  onDisconnectSet(path, val) { this.db.ref(path).onDisconnect().set(val); }
}

// ─── ファクトリ ────────────────────────────
// ?local=1 → LocalBusNet (タブ間) / それ以外 → FirebaseNet (要 firebase-config.js)
function createNet() {
  const params = new URLSearchParams(location.search);
  if (params.get('local') === '1') return new LocalBusNet();
  if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG) return new FirebaseNet(FIREBASE_CONFIG);
  return null;  // 未セットアップ
}

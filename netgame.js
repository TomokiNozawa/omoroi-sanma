// おもろい三麻 — リアルタイム対戦層 (Phase 2)
// 方式: ホスト権威 — ホスト端末が既存エンジン (script.js) をそのまま実行し、
//   ゲストは 「公開状態の購読 + 自分の手牌 (秘匿パス) + アクション送信」 のみ。
// ゲストの座席系: 受信時に 「自分の席が bottom になる回転」 を適用するため、
//   ゲスト側の G は常に自分視点 = 既存の描画/入力コードが無改修で動く。
'use strict';

const NetGame = (() => {
  const REMOTE_TURN_MS = 45000;  // リモート番の打牌待ち (超過で CPU 代打ち)
  const OFFER_MS = 10000;        // ロンオファー待ち (超過で自動パス)

  const S = {
    mode: null,          // 'host' | 'guest'
    net: null,
    room: null,
    name: '',
    players: {},         // uid -> {name}
    remoteSeats: {},     // canonical seat -> uid (host)
    seatNames: null,     // 表示名 override {displaySeat: label}
    rot: 0,              // guest: canonical -> display の回転量
    myCanonical: 'bottom',
    started: false,
    pubSeq: 0,
    pubTimer: null,
    turnTimer: null,
    offerTimer: null,
    pendingOffer: null,  // host: {seat, fromSeat, tile}
    lastPub: '',
    lastHands: {},       // uid -> last JSON (差分送信)
    endInfoShown: false,
    lastPubTime: 0,
    busySent: false,
    ceremonySeq: 0,      // host: 儀式ごとに +1 (ゲストの再生トリガー)
    seenCeremony: 0,     // guest: 再生済み儀式 seq
    evSeq: 0,            // host: 演出イベント通番
    events: [],          // host: 直近イベント [{q, k}] (pub に載せる)
    lastEvSeq: -1,       // guest: 再生済みイベント seq (-1 = 初回pub未受信)
    lastScores: null,    // guest: 前回pubのスコア (点数移動バッジ用)
    wasRoundOver: false, // guest: roundOver 立ち上がり検出
  };

  const rotSeat = (seat, k) => (seat && ALL_SEATS.includes(seat))
    ? ALL_SEATS[(ALL_SEATS.indexOf(seat) + k) % 4] : seat;
  const rotKeys = (obj, k) => {
    const o = {};
    for (const s of ALL_SEATS) o[rotSeat(s, k)] = obj ? obj[s] : undefined;
    return o;
  };
  const tileKey = (t) => `${t.id}#${t.copy}`;
  const isHost = () => S.mode === 'host' && S.started;
  const isGuest = () => S.mode === 'guest';
  const isRemoteSeat = (seat) => isHost() && !!S.remoteSeats[seat];
  const seatDispName = (seat) => {
    const base = (S.seatNames && S.seatNames[seat]) || SEAT_LABEL_BASE[seat];
    // ホスト自身の bottom は 「名前 (あなた)」 表示
    if (seat === 'bottom' && S.mode === 'host' && S.started && S.seatNames) return `${base} (あなた)`;
    return base;
  };
  // 共有テキスト用の絶対名 ((あなた) 等の視点装飾なし)
  const pubName = (seat) => (S.seatNames && S.seatNames[seat]) || SEAT_LABEL_BASE[seat];

  // ─── 待機画面 ─────────────────────────
  function showWaiting(html) {
    let ov = document.getElementById('net-wait-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'net-wait-overlay';
      ov.className = 'end-overlay';
      ov.innerHTML = '<div class="end-modal" id="net-wait-modal"></div>';
      document.body.appendChild(ov);
    }
    document.getElementById('net-wait-modal').innerHTML = html;
    ov.hidden = false;
  }
  function hideWaiting() {
    const ov = document.getElementById('net-wait-overlay');
    if (ov) ov.hidden = true;
  }
  function renderWaitingRoom() {
    const list = Object.values(S.players).map(p => `<li>${escapeHtml(p.name)}</li>`).join('')
      || '<li>(まだ誰もいません)</li>';
    const guests = Object.keys(S.players).filter(u => u !== S.net.uid).length;
    let html = `<h2 class="end-modal__title">🀄 ルーム待機中</h2>`;
    html += `<p class="end-modal__text">合言葉: <b style="font-size:26px; color:#ffeb3b; letter-spacing:4px;">${S.room}</b><br>`;
    html += `参加者に この4桁を伝えてください</p>`;
    html += `<ul style="text-align:left; font-size:13px; color:#ddd; margin:8px 0 8px 24px;">${list}</ul>`;
    if (S.mode === 'host') {
      html += `<p style="font-size:11px; color:#aac;">足りない席は CPU が埋めます (最大3人)</p>`;
      html += `<div class="end-modal__nav"><button class="end-modal__btn" id="net-start-btn">対戦開始 (${Math.min(guests, 2) + 1}人+CPU)</button>`;
      html += `<a href="index.html" class="end-modal__btn end-modal__btn--secondary">やめる</a></div>`;
    } else {
      html += `<p class="end-modal__text">⏳ ホストの開始待ち…</p>`;
      html += `<div class="end-modal__nav"><a href="index.html" class="end-modal__btn end-modal__btn--secondary">退出</a></div>`;
    }
    showWaiting(html);
    document.getElementById('net-start-btn')?.addEventListener('click', hostStart);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─── 起動 (initGame から呼ばれる) ─────────────
  async function boot(mode, params) {
    S.mode = mode === 'host' ? 'host' : 'guest';
    S.name = (params.get('name') || 'プレイヤー').slice(0, 10);
    localStorage.setItem('omoroi-guide-done', '1');  // net対戦ではガイド/自動セレモニー制御を自前で行う
    showWaiting('<h2 class="end-modal__title">接続中…</h2>');
    S.net = createNet();
    if (!S.net) {
      showWaiting('<h2 class="end-modal__title">⚠️ 準備中</h2><p class="end-modal__text">ルーム対戦は Firebase セットアップ後に利用できます。</p><div class="end-modal__nav"><a href="index.html" class="end-modal__btn">ロビーへ</a></div>');
      return;
    }
    try {
      await S.net.init();
    } catch (e) {
      showWaiting(`<h2 class="end-modal__title">⚠️ 接続失敗</h2><p class="end-modal__text">${escapeHtml(e.message)}</p><div class="end-modal__nav"><a href="index.html" class="end-modal__btn">ロビーへ</a></div>`);
      return;
    }
    if (S.mode === 'host') await createRoom();
    else await joinRoom(params.get('room') || '');
  }

  async function createRoom() {
    for (let i = 0; i < 5; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const meta = await S.net.once(`rooms/${code}/meta`);
      if (!meta || (Date.now() - (meta.createdAt || 0)) > 6 * 3600 * 1000) {
        S.room = code;
        await S.net.setVal(`rooms/${code}`, null);  // 古い残骸を掃除
        await S.net.setVal(`rooms/${code}/meta`, { createdAt: Date.now(), hostUid: S.net.uid, status: 'waiting' });
        await S.net.setVal(`rooms/${code}/players/${S.net.uid}`, { name: S.name, joinedAt: Date.now() });
        watchPlayers();
        return;
      }
    }
    showWaiting('<h2 class="end-modal__title">⚠️ ルーム作成失敗</h2><p class="end-modal__text">もう一度お試しください。</p>');
  }

  async function joinRoom(code) {
    const meta = await S.net.once(`rooms/${code}/meta`);
    if (!meta || meta.status === 'ended') {
      showWaiting('<h2 class="end-modal__title">⚠️ ルームが見つかりません</h2><p class="end-modal__text">合言葉を確認してください。</p><div class="end-modal__nav"><a href="index.html" class="end-modal__btn">ロビーへ</a></div>');
      return;
    }
    S.room = code;
    await S.net.setVal(`rooms/${code}/players/${S.net.uid}`, { name: S.name, joinedAt: Date.now() });
    watchPlayers();
    // 公開状態 + 自分の手牌を購読
    S.net.onVal(`rooms/${code}/pub`, (json) => { if (json) ingestPub(json); });
    S.net.onVal(`hands/${code}/${S.net.uid}`, (json) => { if (json) ingestHand(json); });
  }

  function watchPlayers() {
    S.net.onVal(`rooms/${S.room}/players`, (players) => {
      S.players = players || {};
      if (!S.started) renderWaitingRoom();
    });
  }

  // ─── ホスト: 開始 ───────────────────────
  function hostStart() {
    const guestUids = Object.keys(S.players)
      .filter(u => u !== S.net.uid)
      .sort((a, b) => (S.players[a].joinedAt || 0) - (S.players[b].joinedAt || 0))
      .slice(0, 2);
    const seats = ['left', 'top', 'right'].sort(() => Math.random() - 0.5);
    S.remoteSeats = {};
    guestUids.forEach((uid, i) => { S.remoteSeats[seats[i]] = uid; });
    const cpuCount = 2 - guestUids.length;
    G.cpuSeats = seats.slice(guestUids.length, guestUids.length + cpuCount);
    G.emptySeat = seats[2];
    // 表示名 (公開するのは素の名前。 「(あなた)」 は各クライアントが自分の bottom にだけ付ける)
    // CPU席にも絶対名を付与 (視点語「下家(CPU)」だと ホスト視点の言葉が全員に見えてしまう)
    S.seatNames = { bottom: S.name };
    for (const st of Object.keys(S.remoteSeats)) S.seatNames[st] = S.players[S.remoteSeats[st]].name;
    G.cpuSeats.forEach((st, i) => { S.seatNames[st] = `CPU${['①', '②'][i] || ''}`; });
    S.started = true;
    S.net.setVal(`rooms/${S.room}/meta/status`, 'playing');
    // ゲストへ座席通知 (秘匿手牌パスに 席情報を先行送信)
    for (const st of Object.keys(S.remoteSeats)) {
      S.net.setVal(`hands/${S.room}/${S.remoteSeats[st]}`,
        JSON.stringify({ seat: st, tiles: [], justDrawn: null }));
    }
    S.net.onChildAdd(`rooms/${S.room}/acts`, onAction);
    hideWaiting();
    // 既存フローで開始 (点数リセット込み)
    G.mode = 'net'; G.type = 'hanchan'; G.round = '東1'; G.honba = 0; G.oya = 'bottom';
    G.scores = { bottom: 35000, right: 35000, top: 35000, left: 35000 };
    G.kyotaku = 0; G.lastResult = null;
    startNewRound();
  }

  // ─── ホスト: 状態公開 ─────────────────────
  function buildPub() {
    const pub = {
      seq: ++S.pubSeq, t: Date.now(), status: 'playing',
      round: G.round, honba: G.honba, kyotaku: G.kyotaku,
      oya: G.oya, turn: G.turn, emptySeat: G.emptySeat, cpuSeats: G.cpuSeats,
      scores: G.scores, kitas: G.kitas, kitaTiles: G.kitaTiles,
      isRiichi: G.isRiichi, riichiTurnsLeft: G.riichiTurnsLeft,
      justRiichiDeclared: G.justRiichiDeclared,
      rivers: G.rivers,
      handCounts: Object.fromEntries(ALL_SEATS.map(s => [s, G.hands[s].length])),
      remain: G.drawTiles.length, kingRemain: G.kingTiles.length,
      doraIndicator: G.doraIndicator, doraSeat: G.doraSeat, doraDouIdx: G.doraDouIdx,
      drawPosList: G.drawPosList, kingCells: G.kingCells,
      startSeat: G.startSeat, cutPosInStart: G.cutPosInStart,
      lastDiscardSeat: lastDiscardSeat(),
      seatNames: S.seatNames,
      phase: G.ceremonyActive ? 'dice' : 'play',
      roundOver: !!G.roundOver,
      handsOpen: G.roundOver ? G.hands : null,  // 局終了後は全手牌公開 (勝利演出/テンパイ確認)
      dice: (G.diceD1 ? [G.diceD1, G.diceD2] : null),
      ceremonySeq: S.ceremonySeq,
      events: S.events,
      ronOffer: S.pendingOffer
        ? { seat: S.pendingOffer.seat, fromSeat: S.pendingOffer.fromSeat, tile: S.pendingOffer.tile }
        : null,
      endInfo: S.endInfo || null,
    };
    return pub;
  }
  function lastDiscardSeat() {
    if (!G.lastDiscard) return null;
    for (const s of ALL_SEATS) {
      const rv = G.rivers[s];
      if (rv.length && rv[rv.length - 1] === G.lastDiscard) return s;
    }
    return null;
  }
  function publish() {
    if (!isHost()) return;
    const json = JSON.stringify(buildPub());
    if (json !== S.lastPub) {
      S.lastPub = json;
      S.net.setVal(`rooms/${S.room}/pub`, json);
    }
    // 秘匿手牌
    for (const st of Object.keys(S.remoteSeats)) {
      const uid = S.remoteSeats[st];
      const payload = JSON.stringify({
        seat: st,
        tiles: G.hands[st],
        justDrawn: (G.justDrawnAll && G.justDrawnAll[st] != null) ? G.justDrawnAll[st] : null,
      });
      if (S.lastHands[uid] !== payload) {
        S.lastHands[uid] = payload;
        S.net.setVal(`hands/${S.room}/${uid}`, payload);
      }
    }
  }
  function onRender() {  // renderAll 末尾から呼ばれる
    if (!isHost()) return;
    if (S.pubTimer) clearTimeout(S.pubTimer);
    S.pubTimer = setTimeout(publish, 60);
  }
  // 儀式開始 (showDiceCeremony がサイコロ適用直後に呼ぶ): 即公開してゲストにも再生させる
  function onCeremony() {
    if (!isHost()) return;
    S.ceremonySeq++;
    publish();
  }
  // 宣言演出 (announce がホスト側で呼ぶ): イベントとして pub に載せる
  function recordEvent(kind) {
    if (!isHost()) return;
    S.evSeq++;
    S.events.push({ q: S.evSeq, k: kind });
    if (S.events.length > 6) S.events.shift();
    publish();
  }

  // ─── ホスト: リモート番の進行 ──────────────────
  function remotePlay(seat) {
    // リーチ済リモート: 自動進行 (北自動抜き → ツモ勝ち → ツモ切り、 雀魂の自動和了と同様)
    if (G.isRiichi[seat] && G.justRiichiDeclared !== seat) {
      let drawn = G.hands[seat][G.hands[seat].length - 1];
      while (drawn && drawn.id === KITA_ID && G.kingTiles.length > 0) {
        kitaNuki(seat);
        renderAll();
        drawn = G.hands[seat][G.hands[seat].length - 1];
      }
      // ツモった14枚目を全クライアントに見せてから捨てる (河に直行させない)
      renderAll();
      setTimeout(() => cpuDiscard(seat, true), 900);
      return;
    }
    // 通常: 公開して 本人の操作待ち (タイムアウトで CPU 代打ち)
    G.busy = false;
    renderAll();
    armTurnTimeout(seat);
  }
  function armTurnTimeout(seat) {
    clearTimeout(S.turnTimer);
    S.turnTimer = setTimeout(() => {
      if (G.roundOver || G.turn !== seat) return;
      toast(`${seatDispName(seat)} 時間切れ — 自動打牌`);
      G.busy = true;
      cpuDiscard(seat);  // シャンテンAIで代打ち (ツモ勝ち/リーチ宣言中の制限も内包)
    }, REMOTE_TURN_MS);
  }

  // ─── ホスト: アクション受信 ─────────────────
  function onAction(act) {
    if (!isHost() || !act || G.gameEnded) return;
    const seat = Object.keys(S.remoteSeats).find(st => S.remoteSeats[st] === act.uid);
    if (!seat) return;
    try {
      if (act.type === 'discard') return hostApplyDiscard(seat, act.key);
      if (act.type === 'riichi') return hostApplyRiichi(seat);
      if (act.type === 'kita') return hostApplyKita(seat);
      if (act.type === 'tsumo') return hostApplyTsumo(seat);
      if (act.type === 'ron') return hostApplyRon(seat);
      if (act.type === 'pass') return hostApplyPass(seat);
    } catch (e) {
      console.error('action error', e);
    }
  }
  function findTile(seat, key) {
    return G.hands[seat].find(t => tileKey(t) === key) || null;
  }
  function hostApplyDiscard(seat, key) {
    if (G.roundOver || G.turn !== seat || G.hands[seat].length !== 14) return;
    const tile = findTile(seat, key);
    if (!tile) return;
    if (G.justRiichiDeclared === seat) {
      const rest = G.hands[seat].filter(t => t !== tile);
      if (!isTenpai13(rest)) return;  // 不正打牌は無視 (ゲスト側でも防止済)
    }
    clearTimeout(S.turnTimer);
    discardTile(seat, tile);
    toast(`${seatDispName(seat)} が ${TILE_NAMES[tile.id]} を打牌`);
    renderAll();
    if (G.pendingRon || G.roundOver || S.pendingOffer) return;
    G.busy = false;
    setTimeout(() => { nextTurn(); startTurn(); }, 120);
  }
  function hostApplyRiichi(seat) {
    if (G.roundOver || G.turn !== seat || G.hands[seat].length !== 14) return;
    if (G.isRiichi[seat] || G.scores[seat] < 1000) return;
    if (!canDeclareRiichi(G.hands[seat])) return;
    G.isRiichi[seat] = true;
    G.riichiTurnsLeft[seat] = 4;
    G.scores[seat] -= 1000;
    G.kyotaku += 1000;
    G.justRiichiDeclared = seat;
    G.doubleRiichi[seat] = (G.rivers[seat].length === 0);  // 1巡目リーチ = ダブルリーチ
    // 発声/カットインは宣言牌の打牌時 (discardTile) に一本化
    toast(`${seatDispName(seat)} リーチ! (-1000点)`);
    renderAll();
    armTurnTimeout(seat);  // 宣言牌の打牌待ち
  }
  function hostApplyKita(seat) {
    if (G.roundOver || G.turn !== seat || G.hands[seat].length !== 14) return;
    const drawnIdx = (G.justDrawnAll && G.justDrawnAll[seat] != null) ? G.justDrawnAll[seat] : null;
    const drawn = drawnIdx != null ? G.hands[seat][drawnIdx] : null;
    if (G.isRiichi[seat] && !(drawn && drawn.id === KITA_ID)) return;
    if (kitaNuki(seat)) {
      renderAll();
      armTurnTimeout(seat);
    }
  }
  function hostApplyTsumo(seat) {
    if (G.roundOver || G.turn !== seat || G.hands[seat].length !== 14) return;
    if (G.justRiichiDeclared === seat) return;
    if (!isWinning(G.hands[seat])) return;
    const drawnIdx = (G.justDrawnAll && G.justDrawnAll[seat] != null) ? G.justDrawnAll[seat] : null;
    const ctx = {
      isTsumo: true, isRiichi: G.isRiichi[seat], isOya: G.oya === seat, seatWind: seatWindOf(seat),
      doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kitas: G.kitas[seat], round: G.round,
      isDoubleRiichi: G.doubleRiichi[seat], isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft[seat] > 0,
      winTile: drawnIdx != null ? G.hands[seat][drawnIdx] : null,
    };
    const result = calcYaku(G.hands[seat], ctx);
    if (result.error || (result.han === 0 && !result.isYakuman)) return;
    clearTimeout(S.turnTimer);
    announce('tsumo');
    toast(`${seatDispName(seat)} ツモ!`);
    showWinModal(seat, G.hands[seat], ctx, result);
  }
  function hostApplyRon(seat) {
    if (!S.pendingOffer || S.pendingOffer.seat !== seat || G.roundOver) return;
    const { fromSeat, tile } = S.pendingOffer;
    clearTimeout(S.offerTimer);
    S.pendingOffer = null;
    const test = [...G.hands[seat], tile];
    const ctx = {
      isTsumo: false, isRiichi: G.isRiichi[seat], isOya: G.oya === seat, seatWind: seatWindOf(seat),
      doraIndicator: G.doraIndicator, uraIndicator: G.uraIndicator, kitas: G.kitas[seat], round: G.round,
      isDoubleRiichi: G.doubleRiichi[seat], isHaitei: G.drawTiles.length === 0, isIppatsu: G.riichiTurnsLeft[seat] > 0, winTile: tile, fromSeat,
    };
    const result = calcYaku(test, ctx);
    if (result.error || (result.han === 0 && !result.isYakuman)) return resumeAfterOffer();
    announce('ron');
    toast(`${seatDispName(seat)} ロン!`);
    showWinModal(seat, test, ctx, result);
  }
  function hostApplyPass(seat) {
    if (!S.pendingOffer || S.pendingOffer.seat !== seat) return;
    clearTimeout(S.offerTimer);
    S.pendingOffer = null;
    resumeAfterOffer();
  }
  function resumeAfterOffer() {
    if (G.roundOver) return;
    G.busy = false;
    renderAll();
    setTimeout(() => { nextTurn(); startTurn(); }, 120);
  }

  // ─── ホスト: リモート席へのロンオファー (discardTile から) ──
  function offerRon(seat, fromSeat, tile) {
    S.pendingOffer = { seat, fromSeat, tile };
    G.busy = true;
    renderAll();
    clearTimeout(S.offerTimer);
    S.offerTimer = setTimeout(() => {
      if (!S.pendingOffer) return;
      S.pendingOffer = null;
      toast(`${seatDispName(seat)} 見逃し (時間切れ)`);
      resumeAfterOffer();
    }, OFFER_MS);
  }

  // ─── ホスト: 局終了/次局 フック ─────────────────
  function onWinModal(title, html) {
    if (!isHost()) return;
    clearTimeout(S.turnTimer);
    clearTimeout(S.offerTimer);
    S.pendingOffer = null;
    S.endInfo = { kind: 'win', title, html };
    publish();
  }
  function onEndRound(title, html) {
    if (!isHost()) return;
    clearTimeout(S.turnTimer);
    S.endInfo = { kind: 'ryuukyoku', title, html };
    publish();
  }
  function onGameEnd(title, html) {
    if (!isHost()) return;
    G.gameEnded = true;
    S.endInfo = { kind: 'gameEnd', title, html };
    publish();
    S.net.setVal(`rooms/${S.room}/meta/status`, 'ended');
  }
  function onNewRound() {
    if (!isHost()) return;
    S.endInfo = null;
    publish();
  }

  // ─── ゲスト: 受信 ─────────────────────
  function ingestPub(json) {
    let pub;
    try { pub = JSON.parse(json); } catch (e) { return; }
    if (!S.started) { S.started = true; hideWaiting(); }
    S.lastPubTime = Date.now();
    const k = S.rot;
    G.round = pub.round; G.honba = pub.honba; G.kyotaku = pub.kyotaku;
    G.oya = rotSeat(pub.oya, k);
    G.turn = rotSeat(pub.turn, k);
    G.emptySeat = rotSeat(pub.emptySeat, k);
    G.cpuSeats = (pub.cpuSeats || []).map(s => rotSeat(s, k));
    G.scores = rotKeys(pub.scores, k);
    G.kitas = rotKeys(pub.kitas, k);
    G.kitaTiles = rotKeys(pub.kitaTiles, k);
    ALL_SEATS.forEach(s => { if (!G.kitaTiles[s]) G.kitaTiles[s] = []; });
    G.isRiichi = rotKeys(pub.isRiichi, k);
    G.riichiTurnsLeft = rotKeys(pub.riichiTurnsLeft, k);
    G.justRiichiDeclared = rotSeat(pub.justRiichiDeclared, k);
    G.rivers = rotKeys(pub.rivers, k);
    ALL_SEATS.forEach(s => { if (!G.rivers[s]) G.rivers[s] = []; });
    // 他家の手牌は 枚数のみ (伏せ牌)、 自分の手は ingestHand で反映
    // 局終了後 (handsOpen) は全手牌が公開される (勝利演出/テンパイ確認)
    const counts = rotKeys(pub.handCounts, k);
    const open = pub.handsOpen ? rotKeys(pub.handsOpen, k) : null;
    ALL_SEATS.forEach(s => {
      if (s === 'bottom') return;
      G.hands[s] = (open && open[s]) ? open[s] : new Array(counts[s] || 0).fill({ id: 0, copy: 0 });
    });
    G.drawTiles = new Array(pub.remain || 0).fill(null);
    G.kingTiles = new Array(pub.kingRemain || 0).fill(null);
    G.doraIndicator = pub.doraIndicator;
    G.doraSeat = rotSeat(pub.doraSeat, k);
    G.doraDouIdx = pub.doraDouIdx;
    G.drawPosList = (pub.drawPosList || []).map(p => ({ ...p, seat: rotSeat(p.seat, k) }));
    G.kingCells = (pub.kingCells || []).map(p => ({ ...p, seat: rotSeat(p.seat, k) }));
    G.startSeat = rotSeat(pub.startSeat, k);
    G.cutPosInStart = pub.cutPosInStart;
    S.seatNames = rotKeys(pub.seatNames || {}, k);
    S.seatNames.bottom = 'あなた';
    // 最新打牌
    const lds = rotSeat(pub.lastDiscardSeat, k);
    G.lastDiscard = (lds && G.rivers[lds] && G.rivers[lds].length)
      ? G.rivers[lds][G.rivers[lds].length - 1] : null;
    // ロンオファー (自分宛てのみ pendingRon 化)
    const offer = pub.ronOffer;
    if (offer && rotSeat(offer.seat, k) === 'bottom') {
      G.pendingRon = { fromSeat: rotSeat(offer.fromSeat, k), tile: offer.tile };
    } else {
      G.pendingRon = null;
    }
    // 演出イベント再生 (リーチ/ロン/ツモ/北抜き のカットイン+ボイス)
    // 初回受信 (途中参加/再接続) では過去イベントを再生しない
    const evs = pub.events || [];
    if (S.lastEvSeq < 0) {
      S.lastEvSeq = evs.reduce((m, e) => Math.max(m, e.q), 0);
    } else {
      for (const e of evs) {
        if (e.q > S.lastEvSeq) { S.lastEvSeq = e.q; announce(e.k); }
      }
    }
    // サイコロ儀式: ホストと同じサイコロ値・壁で再生 (山分けを全員で確認)
    if (pub.phase === 'dice' && pub.dice && pub.ceremonySeq > S.seenCeremony) {
      S.seenCeremony = pub.ceremonySeq;
      G._guestCeremonyAnimDone = false;
      G._guestCeremonyCloseWanted = false;
      setTimeout(() => showDiceCeremony({ guest: true, d1: pub.dice[0], d2: pub.dice[1] }), 200);
    } else if (pub.phase !== 'dice') {
      // ホストが配牌 → ゲスト儀式はアニメ完了を待って閉じる
      const dov = document.getElementById('dice-overlay');
      if (dov && !dov.hidden) {
        if (G._guestCeremonyAnimDone) closeGuestCeremony();
        else G._guestCeremonyCloseWanted = true;
      }
    }
    // 局終了表示 (roundOver は endInfo より先に立つ = 勝利演出の「手牌公開の間」)
    const prevScores = S.lastScores;
    G.roundOver = !!pub.roundOver || !!pub.endInfo;
    // 点数移動バッジ (局終了の立ち上がりで、前回pubとのスコア差分を表示)
    if (G.roundOver && !S.wasRoundOver && prevScores) {
      const deltas = {};
      let any = false;
      for (const s of ALL_SEATS) {
        const d = (G.scores[s] || 0) - (prevScores[s] || 0);
        if (d) { deltas[s] = d; any = true; }
      }
      if (any) setTimeout(() => showScoreBadges(deltas), 400);
    }
    S.wasRoundOver = G.roundOver;
    S.lastScores = { ...G.scores };
    if (pub.endInfo && !S.endInfoShown) {
      S.endInfoShown = true;
      showGuestEnd(pub.endInfo);
    } else if (!pub.endInfo && S.endInfoShown) {
      S.endInfoShown = false;
      document.getElementById('end-overlay').hidden = true;
    }
    S.busySent = false;
    G.busy = false;
    G.selected = null;
    renderAll();
  }
  function ingestHand(json) {
    let h;
    try { h = JSON.parse(json); } catch (e) { return; }
    if (h.seat) {
      S.myCanonical = h.seat;
      S.rot = (4 - ALL_SEATS.indexOf(h.seat)) % 4;
    }
    G.hands.bottom = h.tiles || [];
    G.justDrawn = (h.justDrawn != null) ? h.justDrawn : null;
    renderAll();
  }
  function showGuestEnd(info) {
    const overlay = document.getElementById('end-overlay');
    document.getElementById('end-title').textContent = info.title;
    document.getElementById('end-text').innerHTML = info.html
      + '<p style="font-size:11px; color:#aac; margin-top:8px;">⏳ ホストが次へ進めるのを待っています…</p>';
    const nextBtn = document.getElementById('end-next');
    if (nextBtn) nextBtn.style.display = 'none';
    overlay.hidden = false;
  }

  // ─── ゲスト: アクション送信 ──────────────────
  function guestAction(type, payload = {}) {
    if (!isGuest() || S.busySent) return;
    S.busySent = true;         // 状態が返ってくるまで 二重送信防止
    G.busy = true;
    updateActionButtons();
    S.net.pushVal(`rooms/${S.room}/acts`, { uid: S.net.uid, type, t: Date.now(), ...payload });
  }
  const sendDiscard = (tile) => guestAction('discard', { key: tileKey(tile) });

  const hasOffer = () => !!S.pendingOffer;

  return {
    boot, onRender, onWinModal, onEndRound, onGameEnd, onNewRound,
    onCeremony, recordEvent,
    offerRon, remotePlay, isRemoteSeat, hasOffer,
    isGuest, isHost,
    guestAction, sendDiscard,
    seatDispName, pubName,
    _S: S,
  };
})();

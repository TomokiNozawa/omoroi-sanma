// v0.9.7 ネット対戦の地盤固め + 無料枠最適化 の検証
//   A. 満室/開始後入室の拒否・席未確定時の盤面秘匿・ホスト切断検知・ゲスト切断の代打ち短縮
//   B. pub の差分判定・山データ(wall)の分離・ルームの後始末
//
// 実行: node tests/test_net_v097.js
'use strict';

const { SharedStore, makeInstance, check, summary, sleep, pathGet } = require('./harness');

// 山の静的データ (drawPosList 94件 / kingCells 14件) を実データ相当で作る
function fakeWallData(G) {
  const seats = ['bottom', 'right', 'top', 'left'];
  G.drawPosList = Array.from({ length: 94 }, (_, i) => ({
    seat: seats[i % 4], douIdx: i % 14, dan: i % 2 ? 'top' : 'bottom',
  }));
  G.kingCells = Array.from({ length: 14 }, (_, i) => ({
    seat: 'left', douIdx: i % 7, dan: i % 2 ? 'top' : 'bottom',
  }));
}

async function bootHost(store) {
  const host = makeInstance(store, 'uid-host');
  await host.NetGame.boot('host', new URLSearchParams('name=ホスト'));
  return host;
}
async function bootGuest(store, uid, code, name) {
  const g = makeInstance(store, uid);
  await g.NetGame.boot('guest', new URLSearchParams(`room=${code}&name=${name}`));
  return g;
}
// 待機画面の 「対戦開始」 ボタンを押す
function clickStart(host) {
  const btn = host.dom._els['net-start-btn'];
  if (!btn) throw new Error('net-start-btn が生成されていません');
  btn.fire('click');
}
const waitHtml = (inst) => (inst.dom._els['net-wait-modal'] || {}).innerHTML || '';

(async () => {
  console.log('\n── A. 入室制御 ────────────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    check('ホストがルームを作成できる', /^\d{4}$/.test(code || ''), `合言葉=${code}`);
    check('hands/{code} も初期化される (残骸の掃除)',
      store.writes.some(w => w.path === `hands/${code}`));
    check('ホストの presence が登録される',
      store.disconnects.some(d => d.path === `rooms/${code}/meta/hostOnline` && d.val === false));

    const g1 = await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    const g2 = await bootGuest(store, 'uid-g2', code, 'ゲスト2');
    check('ゲスト2人は入室できる', g1.S.room === code && g2.S.room === code);

    // 4人目 = 満室
    const g3 = await bootGuest(store, 'uid-g3', code, 'ゲスト3');
    check('4人目は満席で弾かれる', g3.S.room === null && /満席/.test(waitHtml(g3)));

    // 開始後の新規入室
    clickStart(host);
    await sleep(20);
    const g4 = await bootGuest(store, 'uid-g4', code, '乱入者');
    check('対戦開始後の新規入室は拒否される',
      g4.S.room === null && /すでに始まっています/.test(waitHtml(g4)));
    check('拒否された入室者には盤面が出ない (幽霊観戦の防止)',
      g4.S.started === false && g4.S.seatKnown === false);
  }

  console.log('\n── A. 再接続 ────────────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    const g1 = await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    await sleep(20);
    check('着席したゲストは席が確定する', g1.S.seatKnown === true, `席=${g1.S.myCanonical}`);
    // 同一 uid で入り直す (リロード相当) → 席があるので通す
    const again = await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    check('席を持つ人は対戦中でも復帰できる', again.S.room === code && !/すでに始まっています/.test(waitHtml(again)));
  }

  console.log('\n── A. 席未確定のあいだは盤面を出さない ──────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    // hands より先に pub が届くケースを再現する
    const g = makeInstance(store, 'uid-solo');
    await g.NetGame.boot('guest', new URLSearchParams(`room=${code}&name=先着`));
    store.set(`rooms/${code}/pub`, JSON.stringify({ round: '東1', handCounts: {}, rivers: {} }));
    check('席が未確定なら pub が来ても盤面を出さない', g.S.started === false && g.S.pendingPub !== null);
    // 席が届いたら 保留していた pub を適用する
    store.set(`hands/${code}/uid-solo`, JSON.stringify({ seat: 'left', tiles: [], justDrawn: null }));
    check('席の確定後に 保留していた pub が適用される',
      g.S.seatKnown === true && g.S.started === true && g.S.pendingPub === null);
  }

  console.log('\n── A. 定員オーバーの通知 ──────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    await bootGuest(store, 'uid-g2', code, 'ゲスト2');
    // 満室チェックをすり抜けて 3人目が players に載った状況 (同時入室の競合) を作る
    store.set(`rooms/${code}/players/uid-late`, { name: '同時入室', joinedAt: Date.now() + 1 });
    const late = makeInstance(store, 'uid-late');
    late.S.room = code; late.S.mode = 'guest';
    store.valListeners.push({ path: `hands/${code}/uid-late`, cb: (j) => { if (j) late.NetGame._ingestHandForTest?.(j); } });
    clickStart(host);
    await sleep(20);
    const notice = pathGet(store.data, `hands/${code}/uid-late`);
    check('席に着けなかった人へ full 通知が飛ぶ',
      !!notice && JSON.parse(notice).full === true);
  }

  console.log('\n── A. ホスト切断の検知 ────────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    const g1 = await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    await sleep(20);
    check('通常時は切断オーバーレイを出さない', g1.S.hostGone === false);
    store.simulateDisconnect('uid-host');   // onDisconnect 発火 = ホストのタブが閉じた
    check('ホスト切断でゲストに告知が出る',
      g1.S.hostGone === true && /接続が切れました/.test(waitHtml(g1)));
  }

  console.log('\n── A. ゲスト切断で代打ちが早くなる ──────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    await sleep(20);
    const seat = Object.keys(host.S.remoteSeats).find(s => host.S.remoteSeats[s] === 'uid-g1');
    check('ゲストが着席している', !!seat, `席=${seat}`);
    check('接続中は offline 扱いにしない', !host.S.offline['uid-g1']);
    store.simulateDisconnect('uid-g1');
    check('ゲスト切断をホストが検知する', host.S.offline['uid-g1'] === true);
    check('切断が toast で知らされる', host.logs.toast.some(t => /切断/.test(t)),
      host.logs.toast.join(' / ') || '(toast なし)');
    // 切断席のターン: 45秒ではなく 1.5秒で代打ちに入る
    host.G.turn = seat; host.G.roundOver = false;
    host.NetGame.armTurnTimeout(seat);
    await sleep(1800);
    check('切断席は 1.5秒で CPU 代打ちに切り替わる',
      host.logs.calls.some(c => c.name === 'cpuDiscard'));
  }

  console.log('\n── B. 山データ(wall)の分離 ─────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    fakeWallData(host.G);
    store.resetWrites();
    host.NetGame.onRender();
    await sleep(120);

    const pubRaw = pathGet(store.data, `rooms/${code}/pub`);
    const wallRaw = pathGet(store.data, `rooms/${code}/wall`);
    const pub = JSON.parse(pubRaw || '{}');
    const wall = JSON.parse(wallRaw || '{}');
    check('pub に drawPosList が含まれない', pub.drawPosList === undefined);
    check('pub に kingCells が含まれない', pub.kingCells === undefined);
    check('wall に drawPosList 94件がある', (wall.drawPosList || []).length === 94);
    check('wall に kingCells 14件がある', (wall.kingCells || []).length === 14);
    check('pub は wallSeq で山データの版を指す', typeof pub.wallSeq === 'number');

    const pubBytes = pubRaw.length, wallBytes = wallRaw.length;
    const staticBytes = JSON.stringify({ drawPosList: host.G.drawPosList, kingCells: host.G.kingCells }).length;
    check('pub 1回のサイズが 静的データ分だけ小さくなっている', pubBytes < staticBytes,
      `pub=${pubBytes}B / 分離した静的データ=${staticBytes}B (wall=${wallBytes}B)`);

    // 局中に何度描画しても wall は再送されない
    store.resetWrites();
    for (let i = 0; i < 5; i++) { host.G.honba = i; host.NetGame.onRender(); await sleep(80); }
    check('局中 wall は再送されない', store.writesTo(`rooms/${code}/wall`).length === 0,
      `wall書込=${store.writesTo(`rooms/${code}/wall`).length}回 / pub書込=${store.writesTo(`rooms/${code}/pub`).length}回`);
  }

  console.log('\n── B. pub の差分判定 ─────────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    fakeWallData(host.G);
    host.NetGame.onRender();
    await sleep(120);

    store.resetWrites();
    // 状態を1ビットも変えずに 5回 再描画 → 1回も送られないのが正しい
    for (let i = 0; i < 5; i++) { host.NetGame.onRender(); await sleep(80); }
    const idle = store.writesTo(`rooms/${code}/pub`).length;
    check('無変化の再描画では pub を送らない', idle === 0, `送信=${idle}回 (v0.9.6 までは 5回)`);

    // 状態が変われば送る
    store.resetWrites();
    host.G.honba = 99;
    host.NetGame.onRender();
    await sleep(120);
    check('状態が変われば pub を送る', store.writesTo(`rooms/${code}/pub`).length === 1);
  }

  console.log('\n── B. 回帰: 山データを分離しても座席回転が壊れない ────');
  {
    // wall は canonical 座席で配信され、ゲスト側で「自分が bottom」になるよう回転される。
    // ここが壊れると 山・王牌が別の家の位置に描かれる (v0.9.7 で最も危険な回帰点)
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    const g1 = await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    fakeWallData(host.G);
    host.NetGame.onRender();
    await sleep(120);

    const seat = Object.keys(host.S.remoteSeats).find(s => host.S.remoteSeats[s] === 'uid-g1');
    const ALL = ['bottom', 'right', 'top', 'left'];
    const rot = (4 - ALL.indexOf(seat)) % 4;
    const rotSeat = (s) => ALL[(ALL.indexOf(s) + rot) % 4];

    check('ゲストが山データを受け取っている', (g1.G.drawPosList || []).length === 94,
      `受信=${(g1.G.drawPosList || []).length}件 / 自席=${seat}`);
    check('ゲストの王牌データも届いている', (g1.G.kingCells || []).length === 14);
    check('自分の席が bottom に回転されている',
      g1.G.drawPosList.every((p, i) => p.seat === rotSeat(host.G.drawPosList[i].seat)),
      `rot=${rot}`);
    check('王牌も同じ回転で揃っている',
      g1.G.kingCells.every((p, i) => p.seat === rotSeat(host.G.kingCells[i].seat)));
    check('山データの中身 (douIdx/dan) は変わらない',
      g1.G.drawPosList.every((p, i) => p.douIdx === host.G.drawPosList[i].douIdx
        && p.dan === host.G.drawPosList[i].dan));

    // pub と wall は別パスなので 到着順が入れ替わりうる (joinRoom は pub を先に購読する)。
    // wall 未着のまま pub を適用して山を空配列で潰すと 画面から山が消える。
    // 山は変えずに pub だけ動かす = wall は差分判定で再送されない状況を作って再現する。
    g1.S.wall = null;
    host.G.honba = 7;
    host.NetGame.onRender();
    await sleep(120);
    check('wall 未着の pub が来ても 山を空にしない',
      (g1.G.drawPosList || []).length === 94 && (g1.G.kingCells || []).length === 14,
      `山=${(g1.G.drawPosList || []).length}件 / 王牌=${(g1.G.kingCells || []).length}件`);
    check('pub 自体は反映されている', g1.G.honba === 7);

    // 次の局で山が変われば wall も更新される
    store.resetWrites();
    host.G.drawPosList = host.G.drawPosList.slice(0, 90);
    host.NetGame.onRender();
    await sleep(120);
    check('局が変わって山が変われば wall を送り直す',
      store.writesTo(`rooms/${code}/wall`).length === 1);
    check('ゲストの山も追従する', (g1.G.drawPosList || []).length === 90);
  }

  console.log('\n── B. ルームの後始末 ─────────────────────');
  {
    const store = new SharedStore();
    const host = await bootHost(store);
    const code = host.S.room;
    await bootGuest(store, 'uid-g1', code, 'ゲスト1');
    clickStart(host);
    await sleep(20);
    store.push(`rooms/${code}/acts`, { uid: 'uid-g1', type: 'pass', t: Date.now() });
    check('後始末の前は acts が残っている', !!pathGet(store.data, `rooms/${code}/acts`));

    host.NetGame.onGameEnd('半荘終了', '<p>結果</p>');
    await sleep(20);
    check('半荘終了で acts が削除される', pathGet(store.data, `rooms/${code}/acts`) === null);
    check('半荘終了で hands が削除される', pathGet(store.data, `hands/${code}`) === null);
    check('結果表示のため pub は残る', !!pathGet(store.data, `rooms/${code}/pub`));
    check('meta.status が ended になる', pathGet(store.data, `rooms/${code}/meta/status`) === 'ended');
  }

  const ok = summary('v0.9.7 ネット地盤 + 無料枠');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

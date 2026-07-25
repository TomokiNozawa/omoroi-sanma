// AI採点コーチの検証
//   ① 押し引き … 他家リーチ中に「降りるべき場面」を正しく叱れるか
//   ② 良形/愚形 … 同じテンパイでも待ちの広さを見分けられるか
//   ③ 打点 … ドラ/赤ドラを切った時に指摘できるか
//   ④ 役   … タンヤオが見える形を教えられるか
// 実行: node tests/test_coach.js
'use strict';

const { makeGame, check, summary, T, Tn, Tseq } = require('./harness');

const g = makeGame();
const { G } = g;
const ctx = g.ctx;

// 採点を呼ぶ (G の状態を作ってから coachAnalyzeCore を実行)
// ⚠️ coachAnalyzeCore は手牌の要素を参照比較 (e.t === tile) するので、
//    切る牌は「手牌の中にある実インスタンス」を渡す必要がある
function analyze(hand14, tileRef, opts = {}) {
  G.doraIndicator = opts.doraIndicator || null;
  G.kanDoraInd = [];
  G.hands = { bottom: hand14, right: [], top: [], left: [] };
  G.rivers = { bottom: [], right: [], top: [], left: [] };
  G.kitaTiles = { bottom: [], right: [], top: [], left: [] };
  G.melds = { bottom: [], right: [], top: [], left: [] };
  if (opts.myRiver) G.rivers.bottom = opts.myRiver;
  const tile = hand14.find(t => t.id === tileRef.id && t.copy === tileRef.copy) || tileRef;
  const riichiRivers = opts.riichiRivers || [];
  return g.coachAnalyzeCore(hand14, [], tile, g.coachRemainingOf, riichiRivers);
}
const txt = (r) => (r ? (r.msg + ' ' + (r.notes || []).join(' ')).replace(/<[^>]+>/g, '') : '');

(async () => {
  console.log('\n── ① 押し引き (他家リーチ中) ─────────────');
  {
    // 2シャンテン以上のバラバラ手。 リーチ者の河には 1p/9p/東 が通っている
    const bara = [T(2,0), T(4,0), T(6,0), T(8,0), T(10,0), T(11,0), T(13,0), T(15,0),
                  T(17,0), T(19,0), T(20,0), T(22,0), T(24,0), T(26,0)];
    const river = [2, 10, 20];   // 1p 9p 東 が現物

    // 現物を切った → 褒めるべき
    const good = analyze(bara, T(2,0), { riichiRivers: [river] });
    check('現物で降りたら ◎', good.mark === '◎', `${good.mark} ${txt(good)}`);
    check('降りが正解と伝える', /降り|安全/.test(txt(good)), txt(good));

    // 無スジを切った → 叱るべき (安全牌があるのに押した)
    const bad = analyze(bara, T(15,0), { riichiRivers: [river] });
    check('無スジを切ったら ✖', bad.mark === '✖', `${bad.mark} ${txt(bad)}`);
    check('降りるよう促す + 安全牌を教える',
      /降りましょう/.test(txt(bad)) && /なら安全/.test(txt(bad)), txt(bad));

    // リーチが無ければ 同じ牌でも叱られない (押し引きは他家リーチ中だけの判定)
    const noRiichi = analyze(bara, T(15,0), {});
    check('リーチが無ければ押し引きの判定は働かない',
      !/降りましょう/.test(txt(noRiichi)), txt(noRiichi));
  }

  console.log('\n── ① 押し引き: テンパイなら押してよい ──────────');
  {
    // 123p 456p 789p 123s + 東東 の1シャンテン相当 (テンパイに近い手)
    const ready = [...Tseq(2), ...Tseq(5), ...Tseq(8), ...Tseq(11), T(20,0), T(21,0)];
    const r = analyze(ready, T(21,0), { riichiRivers: [[2, 10]] });
    // シャンテンが浅いので「降りましょう」にはならないこと
    check('テンパイ/好形なら 降りろとは言わない', !/降りましょう/.test(txt(r)), `${r.mark} ${txt(r)}`);
  }

  console.log('\n── ② 良形 / 愚形 ─────────────────────');
  {
    // 123p 456p 789p 1s1s 4s5s + 東 (14枚)
    //   東を切る → 3s/6s の両面待ちテンパイ (良形)
    //   5s を切る → 1s単騎などの愚形 or テンパイ外れ
    const hand = [...Tseq(2), ...Tseq(5), ...Tseq(8), T(11,0), T(11,1), T(14,0), T(15,0), T(20,0)];
    const good = analyze(hand, T(20,0));
    check('両面テンパイなら「良い待ち」と言う',
      /良い待ち/.test(txt(good)), `${good.mark} ${txt(good)}`);
    check('待ち牌と残り枚数を出す', /三索|六索/.test(txt(good)) && /残\d+枚/.test(txt(good)), txt(good));

    // 愚形テンパイになる切り方 (1s を切ると 1s単騎)
    const bad = analyze(hand, T(11,0));
    check('愚形になる切り方には注意を出す',
      /愚形/.test(txt(bad)) || /両面に取れました/.test(txt(bad)) || /もったいない/.test(txt(bad)),
      `${bad.mark} ${txt(bad)}`);
  }

  console.log('\n── ③ 打点 (ドラ・赤ドラ) ──────────────────');
  {
    const hand = [...Tseq(2), ...Tseq(5), ...Tseq(11), T(20,0), T(20,1), T(9,0), T(9,1)];
    // ドラ表示が 7p(id=8) → ドラは 8p(id=9)
    const r = analyze(hand, T(9,0), { doraIndicator: T(8,3) });
    check('ドラを切ったら指摘する', /ドラ/.test((r.notes || []).join('')), (r.notes || []).join(' '));

    // 赤ドラ (isRed) を切った場合。 手牌内で id/copy が重複しないように組む
    const handRed = [...Tseq(2), ...Tseq(11), T(20,0), T(20,1), T(21,0), T(21,1),
                     T(6,0,true), T(9,1)];
    const rr = analyze(handRed, T(6,0,true), { doraIndicator: T(0,0) });
    check('赤ドラを切ったら指摘する', /赤ドラ/.test((rr.notes || []).join('')),
      (rr.notes || []).join(' ') || '(なし)');

    // ドラでない牌なら余計な指摘をしない
    const r3 = analyze(hand, T(20,0), { doraIndicator: T(8,3) });
    check('ドラでなければ打点の指摘は出ない',
      !/ドラを切りました/.test((r3.notes || []).join('')), (r3.notes || []).join(' ') || '(なし)');
  }

  console.log('\n── ④ 役 (タンヤオ) ─────────────────────');
  {
    // 幺九牌が 9p(id=10) 1枚だけ → それを払えばタンヤオが見える
    const hand = [T(3,0), T(4,0), T(5,0), T(6,0), T(7,0), T(12,0), T(13,0), T(14,0),
                  T(15,0), T(16,0), T(17,0), T(18,0), T(10,0), T(4,1)];
    const r = analyze(hand, T(4,1));   // 中張牌を切って 9p を残した
    check('幺九牌が1枚だけならタンヤオを示唆', /タンヤオ/.test((r.notes || []).join('')),
      (r.notes || []).join(' ') || '(なし)');

    // 9p を切った → 幺九牌ゼロ = タンヤオ確定
    const r2 = analyze(hand, T(10,0));
    check('幺九牌を払ったらタンヤオが狙えると伝える', /タンヤオ/.test((r2.notes || []).join('')),
      (r2.notes || []).join(' ') || '(なし)');
  }

  console.log('\n── 従来の採点が壊れていないか ──────────────');
  {
    // シャンテンが後退する切り方は ✖ のまま
    const hand = [...Tseq(2), ...Tseq(5), ...Tseq(8), ...Tseq(11), T(20,0), T(21,0)];
    const r = analyze(hand, T(2,0));   // 順子を崩す
    check('手を崩したら ✖', r.mark === '✖', `${r.mark} ${txt(r)}`);
    check('どれを切るべきだったか教える', /切りなら/.test(txt(r)), txt(r));

    // 最善手は ◎
    const r2 = analyze(hand, T(21,0));
    check('最善手は ◎ か ○', ['◎','○'].includes(r2.mark), `${r2.mark} ${txt(r2)}`);
    check('採点の戻り値が壊れていない',
      r2.mark && r2.cls && typeof r2.msg === 'string', JSON.stringify({ mark: r2.mark, cls: r2.cls }));
  }

  const ok = summary('AI採点コーチ (押し引き / 良形 / 打点 / 役)');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('\n実行時エラー:', e); process.exit(1); });

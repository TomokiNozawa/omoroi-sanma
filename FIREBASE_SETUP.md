# Firebase セットアップ手順 (Phase 2 リアルタイム対戦用、 約3分)

野沢さん用の1回きりの手順。完了後、⑥の設定を Claude に渡せばルーム対戦が本番で動きます。

## ① プロジェクト作成
https://console.firebase.google.com/ → 「プロジェクトを追加」
- プロジェクト名: `omoroi-sanma` (何でもOK)
- Google アナリティクス: **無効でOK**

## ② 匿名認証を有効化
左メニュー「構築 > Authentication」 → 「始める」 → ログイン方法タブ → 「匿名」 → 有効にする → 保存

## ③ Realtime Database 作成
左メニュー「構築 > Realtime Database」 → 「データベースを作成」
- ロケーション: **asia-southeast1 (シンガポール)** ※他プロジェクトと同じ
- セキュリティルール: 「ロック モード」 で開始 (次で置換するのでどちらでも可)

## ④ ルールを貼り付け
Realtime Database → 「ルール」 タブ → 全選択して削除 → 以下を貼り付け → 「公開」
(この JSON は Claude がクリップボードに入れて渡します)

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('meta/hostUid').val() === auth.uid || data.child('meta/createdAt').val() + 21600000 < now)",
        "acts": {
          ".write": "auth != null",
          "$id": {
            ".validate": "newData.child('uid').val() === auth.uid"
          }
        },
        "players": {
          "$uid": {
            ".write": "auth != null && $uid === auth.uid"
          }
        }
      }
    },
    "hands": {
      "$code": {
        ".write": "auth != null && root.child('rooms').child($code).child('meta/hostUid').val() === auth.uid",
        "$uid": {
          ".read": "auth != null && auth.uid === $uid"
        }
      }
    }
  }
}
```

**この内容で 2026-07-25 に本番へ公開済み** (野沢さん作業)。本番で攻撃を試して全項目ブロックを実測済み。

### ⚠️ コードを書く時の注意 (実際に踏んだ罠)

`hands/{code}` の書き込み権限は **`rooms/{code}/meta/hostUid` を参照して判定**している。
そのため **rooms を先に消すと hands が消せなくなる**（参照先が無くなり権限判定に失敗する）。

```
❌ rooms/{code} を削除 → hands/{code} を削除   … 2つ目が PERMISSION_DENIED
✅ meta を書く → hands/{code} を削除            … createRoom はこの順序
✅ acts と hands だけ削除 (meta は残す)         … onGameEnd はこの順序
```

### このルールが守っているもの (v0.9.7 で強化)

| 制限 | 何を防ぐか |
|---|---|
| `acts/$id` の `.validate` で `uid === auth.uid` | **他人へのなりすまし**。これが無いと第三者が「被害者の uid」でパスを送り、ロンを強制的に見逃させられる |
| `rooms/$code` の `.write` をホストに限定 | 第三者による盤面 (pub) の改竄。6時間経過したルームは他の人が再利用できる |
| `players/$uid` は本人のみ | 他人の接続状態を勝手に「切断」にされるのを防ぐ |
| `hands/$code` の書き込みをホストに限定 | 第三者が他人の手牌表示を壊すのを防ぐ |
| `hands/$code/$uid` の読み取りは本人のみ | 手牌の盗み見。パスを `rooms/` の外に置いているのは、親の `.read` が下位に伝播して覗けてしまうため |

⚠️ ルールを更新したら `index.html?local=1` ではなく **本番URLで1局** 通してください (local モードは Firebase を経由しないため、ルールの誤りを検出できません)。

## ⑤ Web アプリ登録
プロジェクトの概要 → 「⚙ > プロジェクトの設定」 → 下部「マイアプリ」 → Webアイコン `</>`
- アプリのニックネーム: `omoroi-sanma-web`
- Firebase Hosting: **チェック不要**
- 「アプリを登録」

## ⑥ 設定を Claude に渡す
登録後に表示される `const firebaseConfig = { apiKey: ..., ... }` のブロックをコピーして
Claude にチャットで貼るだけ (apiKey は Web クライアント用の公開識別子で、機密ではありません。
アクセス制御は④のルールと匿名認証が担います)。

Claude が `firebase-config.js` に反映 → dev で動作確認 → main リリースします。

---
- 対戦の仕組み: ホスト権威方式 (ルーム作成者の端末がゲーム進行、参加者は表示+操作送信)
- 無料 Spark プラン内で動作 (想定 20 同時接続、状態データは局ごと数KB)
- 開発中のタブ間テスト: `index.html?local=1` で Firebase なしに同一ブラウザの複数タブで対戦可能

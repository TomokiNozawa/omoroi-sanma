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
        ".write": "auth != null"
      }
    },
    "hands": {
      "$code": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": "auth != null"
        }
      }
    }
  }
}
```

※ hands (各自の手牌) は本人しか読めない構造。rooms は匿名ログイン済みの参加者のみ読み書き可。

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

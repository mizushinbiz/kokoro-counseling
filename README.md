# 🌱 こころの相談室 (kokoro-counseling)

**Google Workspace for Education × Google Gemini API で実現する、児童生徒向けセキュアAI相談室**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Gemini API](https://img.shields.io/badge/Google%20Gemini%20API-8E75C2?logo=googlegemini&logoColor=white)](https://ai.google.dev/)

---

## 📖 プロジェクト概要

『こころの相談室』は、小中学校に配備されている **Google Workspace for Education 環境（ChromebookやiPad、PC）と Google Gemini API のみ** で動作する、サーバーレス＆セキュアなWeb相談システムです。

誰にも言えない悩みを抱える児童生徒が、学校の端末からいつでも安心して気持ちを吐き出せる安全な対話空間を提供します。また、深刻なSOSを検知した際には、児童本人の同意のもとで担任や管理職のGoogle Chatスペース・教師用管理簿へ即座に連携し、学校の早期対応を強力に支援します。

本プロジェクトは、**「どの学校でも、既存のGoogle環境だけで、ゼロから安全に無料導入できる」** ことを目指して設計されたオープンソースソフトウェアです。

---

## 🌟 主な機能と特徴

### 1. 🤖 小学生に寄り添うAI共感対話パートナー (Gemini 2.5 Flash-Lite)
* **温かい対話設計:** ふんわり／しっかりモード、低学年向け「ぜんぶひらがな」モードに対応。
* **感情に応じた豊かな表情変化:** AIの心情タグと連動し、25種類以上のアバター表情がリアルタイムに切り替わります。
* **二重安全フォールバック機構:** ネットワーク切断やレート制限（429）時の自動リトライ、および安定モデルへの自動切り替えを搭載。

### 2. 🔒 徹底した児童のプライバシー保護 (AES暗号化 & ゼロトラスト)
* **生徒ごとの個別暗号化シート:** 児童1人ひとりに暗号化された相談記録スプレッドシートを自動生成。
* **AES暗号化 (CryptoJS):** 相談内容、日々の要約、プロフィール、ファイル名に至るまで、全データを暗号化して保存。
* **アクセス権の完全分離:** 児童が閲覧できるのは自分自身の過去ログのみ。他の児童の相談記録に触れることは原理的に不可能です。

### 3. 🚨 命を守るSOS連携 (教師用管理簿 & Google Chat)
* **児童主体の共有選択:** 相談終了時に「せんせいに伝える」を選択した場合のみ、担任・教頭・養護教諭等へ通知。
* **AI自動要約:** 会話ログから教職員が即座に状況を把握できる客観的な相談要約を自動生成。
* **Google Chat 即時通知:** 職員室の専用スペースへ CardsV2 形式のSOSカードをWebhookで即座に配信。

### 4. 🎁 毎日のラッキーアクション (ガチャ & コレクション)
* 相談の前後に楽しめる「1日1回限定」のラッキーアクション抽選。
* スーパーレア／レア／コモンのカードと、前向きになれる今日のアクションをプレゼント。
* 「たからもの」コレクション画面で獲得したカードをいつでも鑑賞可能。

### 5. ⚙️ Web管理パネル（初期設定・診断テスト・パスワード保護）
* URL末尾に `?view=admin` を付けることで、教職員専用の管理ダッシュボードを表示。
* コード内のIDハードコードを全廃し、各種フォルダID・スプレッドシートID・APIキー・Webhook・GeminiモデルをWeb画面から一発設定。
* 各種Google DriveフォルダやGemini APIへの疎通を1クリックで確認できる「接続・権限診断テスト」を搭載。

---

## 📁 ディレクトリ構成

```text
kokoro-counseling/
├── src/                                # アプリケーション本体コード
│   ├── appsscript.json                 # GASマニフェスト設定
│   ├── Config.js                       # システム定数・スクリプトプロパティ動的取得
│   ├── AdminService.js                 # 管理者認証・設定保存・接続診断テスト
│   ├── GeminiService.js                # Gemini API対話・プロンプト構築・フォールバック
│   ├── StorageService.js               # 相談記録・プロフィールのAES暗号化保存/復号
│   ├── NotificationService.js          # 教師用管理簿への追記・Google Chat Webhook通知
│   ├── GachaService.js                 # ラッキーアクション抽選・コレクション管理
│   ├── Security.js                     # AES暗号化基盤・高速ファイル検索キャッシュ
│   ├── WebApp.js                       # doGetルーティング・画像サムネイル配信
│   ├── CryptoJS.js                     # AES暗号化ライブラリ
│   ├── admin.html                      # 管理者用設定・接続診断ダッシュボード
│   ├── index.html                      # 児童用相談室メインHTML
│   ├── _intro.html                     # はじめの約束（利用ルール）
│   ├── _modal_gacha.html               # ガチャ演出・コレクションモーダル
│   ├── _js_logic.html                  # フロントエンド状態管理・API通信制御
│   ├── _js_render.html                 # DOM描画・タイプライター表示制御
│   ├── _js_gacha.html                  # ガチャアニメーション・UI制御
│   ├── _css_layout.html                # レスポンシブレイアウトCSS
│   ├── _css_theme.html                 # テーマカラー・タイポグラフィCSS
│   └── _css.gacha.html                 # ガチャ・カード演出CSS
├── docs/                               # 導入・運用マニュアル（公式手順書）
│   ├── SETUP_MANUAL.md                 # 他校導入・初期設定マニュアル (PDF生成元)
│   ├── TEACHER_MANUAL.md               # 教師用機能説明・運用マニュアル (PDF生成元)
├── .clasp.json.sample                  # clasp環境設定テンプレート
└── README.md                           # 本ドキュメント
```

---

## 🚀 導入手順（クイックスタート）

詳細なステップごとの解説は [docs/SETUP_MANUAL.md](docs/SETUP_MANUAL.md) をご覧ください。

1. **Google Drive にフォルダを用意する**
   * 【校内共有フォルダ】（全校児童・教職員に「閲覧者」共有）: アバター画像・ガチャ画像を保存
   * 【教員管理用フォルダ】（教員のみアクセス）: 相談記録保管庫フォルダ、教師用管理簿シートを作成
2. **スクリプトを配置する**
   * GASプロジェクトを作成し、`src/` 配下の全ファイルを貼り付けます。
3. **Webアプリケーションとしてデプロイする**
   * 「次のユーザーとして実行: アクセスしているユーザー」
   * 「アクセスできるユーザー: （自校の組織名）の全員」
4. **管理画面（`?view=admin`）で初期設定を行う**
   * コピーしたウェブアプリURLの末尾に `?view=admin` を付けて開きます。
   * 初期パスワード `KokoroAdmin2026!` でログインし、各フォルダ・シートID、Gemini APIキーを入力して保存します。
   * 「接続テスト」を実行し、すべて「正常」であれば完了です！
5. **児童へ配付する**
   * 通常のウェブアプリURLを Google Classroom や Chromebook のブックマークで配信します。

---

## 🛡️ セキュリティとプライバシー

* **機密情報の完全隔離:** APIキー、Webhook URL、各種Drive IDはすべて `PropertiesService`（スクリプトプロパティ）に格納され、GitHubやコード上に学校固有の情報が残ることはありません。
* **通信・データの暗号化:** Googleのインフラによる暗号化通信（HTTPS）に加え、保存される相談内容自体もAES暗号化されています。
* **特定個人に依存しないリカバリー設計:** 管理者パスワードを忘れた場合でも、Google Drive上でGASを開ける先生が `AdminService.js` の `resetAdminPassword()` を実行すれば安全に初期化できます。

---

## 📄 ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。教育機関や自治体での自由な改変・再配布・商用利用が可能です。

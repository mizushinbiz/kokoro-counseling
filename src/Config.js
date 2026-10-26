/**
 * こころの相談室 - 設定・定数モジュール
 * システム設定、各種ID、スクリプトプロパティ取得を動的に管理します。
 */

// ==========================================
//  1. Google Drive / スプレッドシート設定（動的ゲッター）
// ==========================================
const APP_CONFIG = {
  // アプリフォルダ（生徒ごとの暗号化相談記録シートが格納されるフォルダ）
  get DESIGNER_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('DESIGNER_FOLDER_ID') || '';
  },

  // アバター画像フォルダ（校内共有フォルダ内）
  get CHAR_IMAGE_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('CHAR_IMAGE_FOLDER_ID') || '';
  },

  // 教師用マスタースプレッドシート（児童情報・児童より）
  get TEACHER_SHEET_ID() {
    return PropertiesService.getScriptProperties().getProperty('TEACHER_SHEET_ID') || '';
  },

  // ガチャ画像フォルダ & マスタースプレッドシート（校内共有フォルダ内）
  get GACHA_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('GACHA_FOLDER_ID') || '';
  },
  get GACHA_SHEET_ID() {
    return PropertiesService.getScriptProperties().getProperty('GACHA_SHEET_ID') || '';
  },

  // 会話制限
  MAX_TURN_COUNT: 20,          // 会話の最大往復回数
  CONTEXT_HISTORY_COUNT: 5,    // 過去ログから文脈に読み込む相談記録件数

  // シート名定数
  SHEET_NAME_RECORD: '相談記録',
  SHEET_NAME_PROFILE: 'プロフィール',
  SHEET_NAME_GACHA: 'ガチャ',

  // Gemini デフォルトモデル
  DEFAULT_GEMINI_MODEL: 'gemini-2.5-flash-lite',

  // アバター画像サムネイルサイズ（ピクセル）
  AVATAR_THUMBNAIL_SIZE: 's600',

  // キャッシュ有効期間（秒）
  CACHE_EXPIRATION_SEC: 21600, // 6時間

  // 管理者初期パスワード
  DEFAULT_ADMIN_PASSWORD: 'KokoroAdmin2026!'
};

// 互換性のためのゲッター関数
function getDesignerFolderId_() { return APP_CONFIG.DESIGNER_FOLDER_ID; }
function getCharImageFolderId_() { return APP_CONFIG.CHAR_IMAGE_FOLDER_ID; }
function getTeacherSheetId_() { return APP_CONFIG.TEACHER_SHEET_ID; }
function getGachaFolderId_() { return APP_CONFIG.GACHA_FOLDER_ID; }
function getGachaSheetId_() { return APP_CONFIG.GACHA_SHEET_ID; }

// ==========================================
//  2. スクリプトプロパティ取得ヘルパー
// ==========================================

/**
 * Gemini APIキーの取得
 */
function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    console.warn('⚠️ GEMINI_API_KEY がスクリプトプロパティに設定されていません。管理画面から設定してください。');
  }
  return key;
}

/**
 * Google Chat Webhook URL の取得
 */
function getChatWebhookUrl_() {
  return PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK') || '';
}

/**
 * 暗号化システムソルト（Pepper）の取得
 */
function getEncryptionPepper_() {
  return PropertiesService.getScriptProperties().getProperty('ENCRYPTION_PEPPER') || '';
}

/**
 * 使用するGeminiモデル名の取得
 */
function getGeminiModel_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || APP_CONFIG.DEFAULT_GEMINI_MODEL;
}

// ==========================================
//  3. 管理者用初期移行・セットアップスクリプト
// ==========================================

/**
 * スクリプトプロパティの初期化・セットアップ用関数
 * ※管理者がGASエディタから実行して、初期暗号鍵やパスワードを初期化できます。
 *   各種ID（フォルダ・シート・APIキー）は管理画面（?view=admin）から設定してください。
 */
function setupAppProperties() {
  const props = PropertiesService.getScriptProperties();

  // 1. デフォルトモデル
  if (!props.getProperty('GEMINI_MODEL')) {
    props.setProperty('GEMINI_MODEL', APP_CONFIG.DEFAULT_GEMINI_MODEL);
  }

  // 2. 暗号化Pepper（未設定なら自動生成）
  if (!props.getProperty('ENCRYPTION_PEPPER')) {
    const randomPepper = Utilities.getUuid() + '-' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
    props.setProperty('ENCRYPTION_PEPPER', randomPepper);
    console.log('✅ ENCRYPTION_PEPPER を新規生成・保存しました。');
  }

  // 3. 管理者初期パスワード（未設定ならデフォルトパスワードのハッシュを登録）
  if (!props.getProperty('ADMIN_PASSWORD_HASH')) {
    const defaultHash = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, 
      APP_CONFIG.DEFAULT_ADMIN_PASSWORD, 
      Utilities.Charset.UTF_8
    ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
    
    props.setProperty('ADMIN_PASSWORD_HASH', defaultHash);
    console.log(`✅ 管理者初期パスワード（${APP_CONFIG.DEFAULT_ADMIN_PASSWORD}）を設定しました。`);
  }

  console.log('🎉 アプリケーションの初期化が完了しました。');
  console.log('💡 各種フォルダID・シートIDは、管理画面（?view=admin）から安全に設定・変更してください。');
}

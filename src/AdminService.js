/**
 * こころの相談室 - 管理パネルバックエンドサービス
 * 管理者認証、システム設定の一括読み書き、パスワード管理、接続テスト
 */

// ==========================================
//  1. 管理者認証 & ハッシュ計算
// ==========================================

/**
 * 文字列のSHA-256ハッシュ値を計算
 */
function hashPassword_(password) {
  if (!password) return '';
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password),
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * 現在の管理者パスワードハッシュを取得
 * （未設定の場合はデフォルト初期パスワードのハッシュを返す）
 */
function getAdminPasswordHash_() {
  const hash = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD_HASH');
  if (hash) return hash;

  // 初期パスワードのハッシュ
  return hashPassword_(APP_CONFIG.DEFAULT_ADMIN_PASSWORD);
}

/**
 * パスワード検証
 */
function verifyAdminPassword(password) {
  if (!password) return false;
  const inputHash = hashPassword_(password);
  const currentHash = getAdminPasswordHash_();
  return inputHash === currentHash;
}

// ==========================================
//  2. 設定の取得・保存
// ==========================================

/**
 * 管理用設定データの取得
 */
function getAdminSettings(password) {
  if (!verifyAdminPassword(password)) {
    throw new Error('管理者パスワードが正しくありません。');
  }

  const props = PropertiesService.getScriptProperties();

  return {
    success: true,
    data: {
      DESIGNER_FOLDER_ID: props.getProperty('DESIGNER_FOLDER_ID') || '',
      CHAR_IMAGE_FOLDER_ID: props.getProperty('CHAR_IMAGE_FOLDER_ID') || '',
      TEACHER_SHEET_ID: props.getProperty('TEACHER_SHEET_ID') || '',
      GACHA_FOLDER_ID: props.getProperty('GACHA_FOLDER_ID') || '',
      GACHA_SHEET_ID: props.getProperty('GACHA_SHEET_ID') || '',
      GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || '',
      CHAT_WEBHOOK: props.getProperty('CHAT_WEBHOOK') || '',
      GEMINI_MODEL: props.getProperty('GEMINI_MODEL') || APP_CONFIG.DEFAULT_GEMINI_MODEL
    }
  };
}

/**
 * 管理用設定データの保存
 */
function saveAdminSettings(password, newSettings) {
  if (!verifyAdminPassword(password)) {
    throw new Error('管理者パスワードが正しくありません。');
  }

  const props = PropertiesService.getScriptProperties();

  // 許可された設定キーのみを更新
  const allowedKeys = [
    'DESIGNER_FOLDER_ID',
    'CHAR_IMAGE_FOLDER_ID',
    'TEACHER_SHEET_ID',
    'GACHA_FOLDER_ID',
    'GACHA_SHEET_ID',
    'GEMINI_API_KEY',
    'CHAT_WEBHOOK',
    'GEMINI_MODEL'
  ];

  for (const key of allowedKeys) {
    if (newSettings[key] !== undefined) {
      const val = String(newSettings[key]).trim();
      props.setProperty(key, val);
    }
  }

  // アバター画像とガチャマッピングのキャッシュをクリア（即時反映）
  try {
    CacheService.getScriptCache().remove('avatar_images_urls');
    CacheService.getScriptCache().remove('gacha_file_map');
  } catch (e) {}

  return { success: true, message: '設定を正常に保存しました。' };
}

// ==========================================
//  3. パスワード変更 & 緊急リセット
// ==========================================

/**
 * 管理者パスワードの変更
 */
function changeAdminPassword(oldPassword, newPassword) {
  if (!verifyAdminPassword(oldPassword)) {
    throw new Error('現在のパスワードが正しくありません。');
  }

  if (!newPassword || newPassword.length < 6) {
    throw new Error('新しいパスワードは6文字以上で入力してください。');
  }

  const newHash = hashPassword_(newPassword);
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', newHash);

  return { success: true, message: '管理者パスワードを変更しました。' };
}

/**
 * 【緊急用】管理者パスワードの初期化（リセット）
 * ※パスワードを紛失・忘れた場合、正当なGoogleアカウント権限を持つ先生が
 *   GASエディタからこの関数を手動実行することで、初期パスワードに戻せます。
 */
function resetAdminPassword() {
  const defaultHash = hashPassword_(APP_CONFIG.DEFAULT_ADMIN_PASSWORD);
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', defaultHash);
  
  console.log('========================================================');
  console.log('🔑 管理者パスワードを初期値にリセットしました！');
  console.log(`初期パスワード: ${APP_CONFIG.DEFAULT_ADMIN_PASSWORD}`);
  console.log('管理画面（?view=admin）からこのパスワードでログインしてください。');
  console.log('========================================================');
  
  return '管理者パスワードを初期パスワードにリセットしました。';
}

// ==========================================
//  4. 接続テスト（診断機能）
// ==========================================

/**
 * 登録された各IDへのアクセス診断テスト
 */
function testSystemConnections(password) {
  if (!verifyAdminPassword(password)) {
    throw new Error('認証に失敗しました。');
  }

  const results = [];
  const props = PropertiesService.getScriptProperties();

  // 1. 相談記録フォルダ
  const designerId = props.getProperty('DESIGNER_FOLDER_ID');
  try {
    if (!designerId) throw new Error('IDが未設定です');
    const folder = DriveApp.getFolderById(designerId);
    results.push({ name: '相談記録保管庫フォルダ', status: 'OK', detail: folder.getName() });
  } catch (e) {
    results.push({ name: '相談記録保管庫フォルダ', status: 'NG', detail: e.message });
  }

  // 2. アバター画像フォルダ
  const avatarId = props.getProperty('CHAR_IMAGE_FOLDER_ID');
  try {
    if (!avatarId) throw new Error('IDが未設定です');
    const folder = DriveApp.getFolderById(avatarId);
    const count = folder.getFiles().hasNext() ? '画像あり' : 'ファイルなし';
    results.push({ name: 'アバター画像フォルダ', status: 'OK', detail: `${folder.getName()} (${count})` });
  } catch (e) {
    results.push({ name: 'アバター画像フォルダ', status: 'NG', detail: e.message });
  }

  // 3. 教師用管理簿スプレッドシート
  const teacherId = props.getProperty('TEACHER_SHEET_ID');
  try {
    if (!teacherId) throw new Error('IDが未設定です');
    const ss = SpreadsheetApp.openById(teacherId);
    const hasInfo = !!ss.getSheetByName('児童情報');
    const hasLog = !!ss.getSheetByName('児童より');
    if (hasInfo && hasLog) {
      results.push({ name: '教師用管理簿スプレッドシート', status: 'OK', detail: `${ss.getName()} (必須シート確認済)` });
    } else {
      results.push({ name: '教師用管理簿スプレッドシート', status: 'WARN', detail: '『児童情報』または『児童より』シートがありません' });
    }
  } catch (e) {
    results.push({ name: '教師用管理簿スプレッドシート', status: 'NG', detail: e.message });
  }

  // 4. ガチャ画像フォルダ（任意）
  const gachaFolderId = props.getProperty('GACHA_FOLDER_ID');
  if (gachaFolderId) {
    try {
      const folder = DriveApp.getFolderById(gachaFolderId);
      results.push({ name: 'ガチャ画像フォルダ', status: 'OK', detail: folder.getName() });
    } catch (e) {
      results.push({ name: 'ガチャ画像フォルダ', status: 'NG', detail: e.message });
    }
  }

  // 5. ガチャマスタースプレッドシート（任意）
  const gachaSheetId = props.getProperty('GACHA_SHEET_ID');
  if (gachaSheetId) {
    try {
      const ss = SpreadsheetApp.openById(gachaSheetId);
      results.push({ name: 'ガチャマスタースプレッドシート', status: 'OK', detail: ss.getName() });
    } catch (e) {
      results.push({ name: 'ガチャマスタースプレッドシート', status: 'NG', detail: e.message });
    }
  }

  // 6. Gemini APIキー
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  if (geminiKey) {
    try {
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`;
      const res = UrlFetchApp.fetch(testUrl, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        results.push({ name: 'Gemini APIキー', status: 'OK', detail: '正常に通信できました' });
      } else {
        results.push({ name: 'Gemini APIキー', status: 'NG', detail: `HTTP ${res.getResponseCode()}: APIキーが無効です` });
      }
    } catch (e) {
      results.push({ name: 'Gemini APIキー', status: 'NG', detail: e.message });
    }
  } else {
    results.push({ name: 'Gemini APIキー', status: 'NG', detail: 'APIキーが未設定です' });
  }

  return { success: true, results: results };
}

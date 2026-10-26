/**
 * こころの相談室 - セキュリティ & 暗号化モジュール
 * パターンB（新旧キー後方互換対応）および高速ファイル探索キャッシュ
 */

// ==========================================
//  1. 暗号化キー導出
// ==========================================

/**
 * ユーザー秘密鍵の生成
 * @param {string} userEmail 対象ユーザーのメールアドレス
 * @param {boolean} usePepper Pepperを含めるかどうか
 * @returns {string} CryptoJS用パスフレーズ
 */
function getDerivedSecretKey_(userEmail, usePepper = true) {
  const email = (userEmail || Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const pepper = usePepper ? getEncryptionPepper_() : '';

  // Pepperがない場合は従来通りのemail単体キー
  if (!pepper) {
    return email;
  }

  // Pepperがある場合はシステムソルトを結合した強固なキーパスフレーズを生成
  // （CryptoJS.AESは文字列パスフレーズからEvpKDFで安全に暗号化キーを自動導出します）
  return email + ':' + pepper;
}

/**
 * 既存コード互換用ヘルパー
 */
function getUserSecretKey_() {
  return getDerivedSecretKey_(Session.getActiveUser().getEmail(), true);
}

// ==========================================
//  2. 暗号化 & 復号化（パターンB: 後方互換フォールバック）
// ==========================================

/**
 * テキストの暗号化
 * ※Pepperが設定されている場合は新キーで暗号化します
 * @param {string} message 暗号化する平文
 * @param {string} secretKey 指定キーまたはメールアドレス（省略時は現在ユーザー）
 * @returns {string} 暗号化文字列
 */
function encryptText(message, secretKey) {
  if (message === null || message === undefined || message === '') return '';
  const strMessage = String(message);

  // 引数secretKeyがメールアドレス形式または未指定の場合はPepper適用キーを取得
  // （もしカスタムキーが直接渡された場合はそれを優先）
  let key;
  if (!secretKey || secretKey.indexOf('@') !== -1) {
    key = getDerivedSecretKey_(secretKey, true);
  } else {
    key = secretKey;
  }

  try {
    const encrypted = CryptoJS.AES.encrypt(strMessage, key);
    return encrypted.toString();
  } catch (e) {
    console.error('Encrypt Error:', e);
    return strMessage;
  }
}

/**
 * テキストの復号化（二段階フォールバック）
 * 1. まず新キー（Pepper付き）で復号試行
 * 2. 失敗時は旧キー（email単体）で復号試行
 * 3. どちらも失敗した場合は原文のまま安全に返却
 * 
 * @param {string} encryptedMessage 暗号化文字列
 * @param {string} secretKey メールアドレスまたは旧来のキー
 * @returns {string} 復号された平文
 */
function decryptText(encryptedMessage, secretKey) {
  if (!encryptedMessage) return '';
  const email = (secretKey && secretKey.indexOf('@') !== -1)
    ? secretKey.trim().toLowerCase()
    : (Session.getActiveUser().getEmail() || '').trim().toLowerCase();

  const pepper = getEncryptionPepper_();

  // ----------------------------------------------------
  // ステップ1: Pepperがある場合、まず新キー（Pepper付き）で復号
  // ----------------------------------------------------
  if (pepper) {
    try {
      const newKey = getDerivedSecretKey_(email, true);
      const decrypted = CryptoJS.AES.decrypt(encryptedMessage, newKey);
      const str = decrypted.toString(CryptoJS.enc.Utf8);
      if (str && str.length > 0) {
        return str; // 新キーでの復号成功
      }
    } catch (e) {
      // 新キーでの復号失敗は無視してステップ2へ
    }
  }

  // ----------------------------------------------------
  // ステップ2: 旧キー（email単体、または渡されたキー）で復号
  // ----------------------------------------------------
  try {
    const oldKey = secretKey || email;
    const decryptedOld = CryptoJS.AES.decrypt(encryptedMessage, oldKey);
    const strOld = decryptedOld.toString(CryptoJS.enc.Utf8);
    if (strOld && strOld.length > 0) {
      return strOld; // 旧キーでの復号成功（既存ファイル・過去ログ）
    }
  } catch (e) {
    // 旧キーでの復号失敗
  }

  // ----------------------------------------------------
  // ステップ3: どちらでも復号できない場合は原文をそのまま返す
  // ----------------------------------------------------
  return encryptedMessage;
}

// ==========================================
//  3. 高速ファイル検索（キャッシュ + 新旧両対応）
// ==========================================

/**
 * ユーザーファイル探索（CacheServiceによるO(1)高速化付き）
 * 過去に旧キーで暗号化されたファイル名も、新キーで暗号化されたファイル名も両方検索可能
 * 
 * @param {Folder} folder 検索対象フォルダ
 * @param {string} userEmail 対象児童のメールアドレス
 * @returns {File|null} 見つかったファイル
 */
function findUserFile_(folder, userEmail) {
  const email = (userEmail || Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) return null;

  const cache = CacheService.getUserCache();
  const cacheKey = 'kokoro_user_file_id_' + email;

  // 1. キャッシュからIDを取得して即時オープンを試みる
  const cachedFileId = cache.get(cacheKey);
  if (cachedFileId) {
    try {
      const cachedFile = DriveApp.getFileById(cachedFileId);
      if (!cachedFile.isTrashed()) {
        return cachedFile; // キャッシュヒット（超高速）
      }
    } catch (e) {
      // 削除等で無効な場合はキャッシュ破棄して通常探索へ
      cache.remove(cacheKey);
    }
  }

  // 2. フォルダ内を探索（新旧キー両対応復号）
  const targetNamePlain = `相談記録_${email}`;
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    // decryptTextは新旧両キーを試すため、どちらで暗号化されていても正しく合致する
    const decryptedName = decryptText(fileName, email);
    if (decryptedName === targetNamePlain) {
      // 見つかったファイルIDを6時間キャッシュ
      cache.put(cacheKey, file.getId(), APP_CONFIG.CACHE_EXPIRATION_SEC);
      return file;
    }
  }

  return null;
}

/**
 * ユーザーファイルキャッシュのクリア用ヘルパー
 * （新規作成時や再探索が必要な場合に使用）
 */
function clearUserFileCache_(userEmail) {
  try {
    const email = (userEmail || Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    CacheService.getUserCache().remove('kokoro_user_file_id_' + email);
  } catch (e) {
    console.warn('Cache clear error:', e);
  }
}

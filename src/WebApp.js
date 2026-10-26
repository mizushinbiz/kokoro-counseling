/**
 * こころの相談室 - Webアプリ基盤モジュール
 * doGet、HTMLインクルード、フロント連携用アバター読み込み
 */

// ==========================================
//  1. Webアプリ基本エンドポイント
// ==========================================

/**
 * Webアプリケーション表示エントリポイント
 */
function doGet(e) {
  // 管理者設定画面 (?view=admin)
  if (e && e.parameter && e.parameter.view === 'admin') {
    return HtmlService.createTemplateFromFile('admin')
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
      .setTitle('こころの相談室 - システム管理・初期設定');
  }

  // 児童用メイン画面
  const template = HtmlService.createTemplateFromFile('index');
  template.serverMaxTurn = APP_CONFIG.MAX_TURN_COUNT;
  return template.evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setTitle('こころのそうだんしつ');
}

/**
 * HTMLファイルの分割インクルード用ヘルパー
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * フォルダID取得用ヘルパー
 */
function getAppFolderId_() {
  return getDesignerFolderId_();
}

// ==========================================
//  2. アバター画像取得（サイズ最適化 & キャッシュ）
// ==========================================

/**
 * アバター画像の取得（権限チェック & サムネイル最適化）
 * ※Chromebookやスマホの通信負荷を軽減するため、4000pxから600pxに最適化
 */
function getAvatarImages() {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get('avatar_images_urls'); 
  
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  const folderId = getCharImageFolderId_();
  if (!folderId) {
    console.warn("⚠️ CHAR_IMAGE_FOLDER_ID が未設定です。管理画面から設定してください。");
    return {};
  }

  console.log("★Google Driveからアバター画像リストを取得します...");
  const imageUrls = {};

  try {
    const folder = DriveApp.getFolderById(folderId);

    // フォルダの共有権限チェック
    const access = folder.getSharingAccess();
    if (access === DriveApp.Access.PRIVATE) {
      console.warn("⚠️【確認】画像フォルダが「制限付き（非公開）」になっています。全校児童・教職員が閲覧可能な校内共有フォルダに配置してください。");
    }

    const files = folder.getFiles();
    let fileCount = 0;
    const thumbSize = APP_CONFIG.AVATAR_THUMBNAIL_SIZE || 's600';

    while (files.hasNext()) {
      const file = files.next();
      const mimeType = file.getMimeType();
      
      // 画像以外はスキップ
      if (mimeType.indexOf('image') === -1) continue;

      const fileName = file.getName();
      const lastDotIndex = fileName.lastIndexOf('.');
      let key = (lastDotIndex === -1 ? fileName : fileName.substring(0, lastDotIndex)).toUpperCase();
      key = key.replace(/[\[\]]/g, '');

      // サムネイル生成URL（sz=s600で軽量・高画質を両立）
      imageUrls[key] = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=${thumbSize}`;
      fileCount++;
    }

    console.log(`★合計 ${fileCount} 枚のアバター画像を登録しました。`);
    
    if (fileCount > 0) {
      cache.put('avatar_images_urls', JSON.stringify(imageUrls), APP_CONFIG.CACHE_EXPIRATION_SEC);
    }
    
    return imageUrls;

  } catch (e) {
    console.error("getAvatarImages エラー:", e.toString());
    return {};
  }
}

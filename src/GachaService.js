/**
 * こころの相談室 - ガチャ & コレクションモジュール
 * ラッキーアクション抽選、所持カードの暗号化保存、コレクション一覧生成
 */

// ガチャシート名ヘルパー（未定義エラー防止フォールバック付き）
function getGachaSheetName_() {
  if (typeof SHEET_NAME_GACHA !== 'undefined') return SHEET_NAME_GACHA;
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SHEET_NAME_GACHA) return APP_CONFIG.SHEET_NAME_GACHA;
  return 'ガチャ';
}

// ==========================================
//  1. ガチャ実行可否判定
// ==========================================

/**
 * 本日すでにガチャを引いたかどうかチェック
 * @returns {boolean} 引ける場合は true
 */
function checkUserAvailability() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const folder = DriveApp.getFolderById(getDesignerFolderId_());
    const file = findUserFile_(folder, userEmail);
    
    // ファイルがない（初回）なら引ける
    if (!file) return true;

    const ss = SpreadsheetApp.open(file);
    const sheet = ss.getSheetByName(getGachaSheetName_());
    
    // シートがない、またはデータがないなら引ける
    if (!sheet || sheet.getLastRow() < 2) return true;

    // A2の最終実施日チェック
    const lastDateVal = sheet.getRange(2, 1).getValue();
    if (!lastDateVal) return true;

    const lastDate = new Date(lastDateVal);
    const today = new Date();

    // 日本時間の日付（yyyyMMdd）で比較
    const fmt = 'yyyyMMdd';
    const lastStr = Utilities.formatDate(lastDate, 'Asia/Tokyo', fmt);
    const todayStr = Utilities.formatDate(today, 'Asia/Tokyo', fmt);

    // 最終実施日が今日より前ならOK
    return parseInt(todayStr) > parseInt(lastStr);

  } catch (e) {
    console.warn("Availability Check Error:", e);
    return true; // エラー時はユーザー有利に倒す
  }
}

// ==========================================
//  2. ガチャ抽選 & 保存
// ==========================================

/**
 * ガチャ実行メイン関数
 */
function doGacha() {
  try {
    if (!checkUserAvailability()) {
      throw new Error("今日はもう引いたみたい。また明日あそぼうね！");
    }

    // 1. 確率抽選
    const rand = Math.random() * 100;
    let targetFolderName = "コモン"; 
    if (rand < 5) targetFolderName = "スーパーレア";   // 5%
    else if (rand < 25) targetFolderName = "レア";     // 20%

    // 2. フォルダ取得とファイル選択
    const rootFolder = DriveApp.getFolderById(getGachaFolderId_());
    const folders = rootFolder.getFoldersByName(targetFolderName);
    if (!folders.hasNext()) throw new Error("フォルダが見つかりません: " + targetFolderName);
    const targetFolder = folders.next();

    const files = targetFolder.getFiles();
    const fileList = [];
    while (files.hasNext()) {
      fileList.push(files.next());
    }
    if (fileList.length === 0) throw new Error("画像がありません");
    
    const pickedFile = fileList[Math.floor(Math.random() * fileList.length)];
    const fileName = pickedFile.getName(); // 例: "1.webp"
    const cardNo = fileName.split('.')[0]; // "1"

    // 画像をBase64化 (即時表示用)
    const imgBlob = pickedFile.getBlob();
    const base64Img = "data:" + imgBlob.getContentType() + ";base64," + Utilities.base64Encode(imgBlob.getBytes());

    // 3. マスタースプレッドシートからデータ取得
    const ss = SpreadsheetApp.openById(getGachaSheetId_());
    const sheet = ss.getSheets()[0]; 
    const data = sheet.getDataRange().getValues(); 
    
    let cardData = { no: cardNo, rarity: "?", action: "???", comment: "???" };
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cardNo)) {
        cardData.rarity = data[i][1];
        cardData.action = data[i][2]; // ラッキーアクション名
        cardData.comment = data[i][6];
        break;
      }
    }

    // 4. ユーザーファイルへの保存（暗号化）
    const isNew = saveToUserFile_(cardNo, cardData.action);

    return {
      no: cardData.no,
      rarity: cardData.rarity,
      action: cardData.action,
      comment: cardData.comment,
      image: base64Img,
      isNew: isNew
    };

  } catch (e) {
    console.error("Gacha Error:", e);
    throw new Error(e.message);
  }
}

/**
 * ユーザーファイルへガチャ結果を保存
 * A2: 最終実施日時
 * B2: 所持IDリスト(暗号化)
 * C2: 最新ラッキーアクション(暗号化)
 */
function saveToUserFile_(newCardNo, actionName) {
  const userEmail = Session.getActiveUser().getEmail();
  const folder = DriveApp.getFolderById(getDesignerFolderId_());
  
  let file = findUserFile_(folder, userEmail);
  let ss;
  
  if (!file) {
    const originalFileName = `相談記録_${userEmail}`;
    const encryptedFileName = encryptText(originalFileName, userEmail);
    ss = SpreadsheetApp.create(encryptedFileName);
    file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
    CacheService.getUserCache().put(
      'kokoro_user_file_id_' + userEmail.toLowerCase(), 
      file.getId(), 
      APP_CONFIG.CACHE_EXPIRATION_SEC
    );
  } else {
    ss = SpreadsheetApp.open(file);
  }

  const gachaSheetName = getGachaSheetName_();
  let sheet = ss.getSheetByName(gachaSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(gachaSheetName);
    sheet.appendRow(["最終実施日", "所持カード(暗号化)", "ラッキーアクション(暗号化)"]);
    sheet.getRange("A2:C2").setValues([["", "", ""]]);
  }

  const dataRange = sheet.getRange("A2:C2");
  const currentValues = dataRange.getValues()[0];
  
  let currentIds = [];
  const encryptedIds = currentValues[1];

  if (encryptedIds) {
    const decryptedString = decryptText(encryptedIds, userEmail);
    if (decryptedString) {
      currentIds = decryptedString.split(',').filter(Boolean);
    }
  }

  let isNew = false;
  if (!currentIds.includes(String(newCardNo))) {
    currentIds.push(String(newCardNo));
    isNew = true; 
  }

  const now = new Date();
  const newEncryptedIds = isNew ? encryptText(currentIds.join(','), userEmail) : encryptedIds;
  const newEncryptedAction = encryptText(actionName, userEmail);

  sheet.getRange(2, 1).setValue(now);
  if (isNew) {
    sheet.getRange(2, 2).setValue(newEncryptedIds);
  }
  sheet.getRange(2, 3).setValue(newEncryptedAction);

  return isNew;
}

// ==========================================
//  3. コレクション一覧取得
// ==========================================

/**
 * たからもの（コレクション）一覧の取得
 */
function getCollectionList() {
  const userEmail = Session.getActiveUser().getEmail();
  
  // 1. マスターデータ取得
  const ssMaster = SpreadsheetApp.openById(getGachaSheetId_());
  const masterData = ssMaster.getSheets()[0].getDataRange().getValues();
  
  // 2. ユーザーの所持IDリスト取得
  let userIds = [];
  try {
    const folder = DriveApp.getFolderById(getDesignerFolderId_());
    const file = findUserFile_(folder, userEmail);
    if (file) {
      const ss = SpreadsheetApp.open(file);
      const sheet = ss.getSheetByName(getGachaSheetName_());
      if (sheet && sheet.getLastRow() >= 2) {
        const enc = sheet.getRange(2, 2).getValue();
        const dec = decryptText(enc, userEmail);
        if (dec) userIds = dec.split(',');
      }
    }
  } catch (e) {
    console.error("Collection Load UserData Error", e);
  }

  // 3. 画像マッピング（キャッシュ利用）
  const imageMap = getGachaImageMap_(); 

  // 4. データ結合
  const resultList = [];
  for (let i = 1; i < masterData.length; i++) {
    const no = String(masterData[i][0]);
    if (!no) continue;

    const isOwned = userIds.includes(no);
    const fileId = imageMap[no];
    
    let imageUrl = null;
    if (fileId) {
      imageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=s256`;
    }

    resultList.push({
      no: no,
      rarity: masterData[i][1],
      action: masterData[i][2],
      comment: masterData[i][6],
      count: isOwned ? 1 : 0,
      image: imageUrl,
      isOwned: isOwned
    });
  }

  return resultList;
}

/**
 * カードNoとDriveFileIDの対応表キャッシュ
 */
function getGachaImageMap_() {
  const cache = CacheService.getScriptCache();
  const cachedMap = cache.get("gacha_file_map");
  
  if (cachedMap) {
    return JSON.parse(cachedMap);
  }
  
  console.log("Building Gacha Image Map...");
  const map = {};
  const rootFolder = DriveApp.getFolderById(getGachaFolderId_());
  const targetNames = ["スーパーレア", "レア", "コモン"];
  
  targetNames.forEach(name => {
    const folders = rootFolder.getFoldersByName(name);
    if (folders.hasNext()) {
      const folder = folders.next();
      const files = folder.getFiles();
      while (files.hasNext()) {
        const file = files.next();
        const fileName = file.getName();
        const no = fileName.split('.')[0];
        map[no] = file.getId();
      }
    }
  });
  
  cache.put("gacha_file_map", JSON.stringify(map), APP_CONFIG.CACHE_EXPIRATION_SEC);
  return map;
}

/**
 * 直近（5分以内）のラッキーアクションを取得（AIチャット挨拶用）
 */
function getLastLuckyAction(userEmail) {
  try {
    const email = userEmail || Session.getActiveUser().getEmail();
    const folder = DriveApp.getFolderById(getDesignerFolderId_());
    const file = findUserFile_(folder, email);
    if (!file) return null;
    
    const ss = SpreadsheetApp.open(file);
    const sheet = ss.getSheetByName(getGachaSheetName_());
    if (!sheet) return null;

    const lastDateVal = sheet.getRange(2, 1).getValue();
    if (!lastDateVal) return null;
    
    const lastTime = new Date(lastDateVal).getTime();
    const nowTime = new Date().getTime();
    const diffMinutes = (nowTime - lastTime) / (1000 * 60);
    
    if (diffMinutes <= 5) {
      const encryptedAction = sheet.getRange(2, 3).getValue();
      return decryptText(encryptedAction, email);
    }
  } catch (e) {
    console.warn("Lucky Action Check Error", e);
  }
  return null;
}

/**
 * こころの相談室 - ストレージ・データ管理モジュール
 * Google Drive / スプレッドシート操作、暗号化記録の読み書きを管理します。
 */

// シート名ヘルパー（未定義エラー防止フォールバック付き）
function getRecordSheetName_() {
  if (typeof SHEET_NAME_RECORD !== 'undefined') return SHEET_NAME_RECORD;
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SHEET_NAME_RECORD) return APP_CONFIG.SHEET_NAME_RECORD;
  return '相談記録';
}

function getProfileSheetName_() {
  if (typeof SHEET_NAME_PROFILE !== 'undefined') return SHEET_NAME_PROFILE;
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SHEET_NAME_PROFILE) return APP_CONFIG.SHEET_NAME_PROFILE;
  return 'プロフィール';
}

// ==========================================
//  1. ユーザー情報・コンテキスト取得
// ==========================================

/**
 * ユーザー名の取得 (暗号化対応版)
 */
function getUserName() {
  const email = Session.getActiveUser().getEmail();
  
  // 1. プロフィールシートから取得を試みる
  try {
    const file = findUserFile_(DriveApp.getFolderById(getDesignerFolderId_()), email);
    if (file) {
      const ss = SpreadsheetApp.open(file);
      const pSheet = ss.getSheetByName(getProfileSheetName_());
      if (pSheet) {
        const encryptedName = pSheet.getRange(2, 1).getValue();
        const name = decryptText(encryptedName, email);
        if (name) return name + "さん";
      }
    }
  } catch (e) {
    console.warn("Profile Name Load Error:", e);
  }

  // 2. 教師用シートから取得
  try {
    const nameFromTeacher = getNameFromTeacherSheet_(email);
    if (nameFromTeacher) return nameFromTeacher + "さん";
  } catch (e) {
    console.error("Teacher Sheet Name Load Error:", e);
  }

  return "えっと、おなまえは…";
}

/**
 * 教師用シート（児童情報）から名前を取得
 */
function getNameFromTeacherSheet_(email) {
  try {
    const ss = SpreadsheetApp.openById(getTeacherSheetId_());
    const sheet = ss.getSheetByName('児童情報');
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) { 
        if (data[i][0] === email) {
          const name = data[i][7]; 
          if (name && name.toString().trim() !== "") return name;
        }
      }
    }
  } catch (e) {
    console.error("Get Name Error:", e);
  }
  return null;
}

/**
 * チャット開始前に「プロフィール」と「過去の相談概要」を取得
 */
function getUserContext_(userEmail) {
  const ERROR_TEXT = "要約生成エラー。この記述は相談記録として反映しない。";
  const email = userEmail || Session.getActiveUser().getEmail();

  try {
    const folder = DriveApp.getFolderById(getDesignerFolderId_());
    const file = findUserFile_(folder, email);
    
    if (!file) return { profile: "", history: "" };
    
    const ss = SpreadsheetApp.open(file);
    
    // 1. プロフィール取得
    let profileText = "";
    const pSheet = ss.getSheetByName(getProfileSheetName_());
    if (pSheet) {
      const encryptedProfile = pSheet.getRange(2, 2).getValue();
      const decrypted = decryptText(encryptedProfile, email);
      profileText = decrypted || ERROR_TEXT;
    }
    
    // 2. 過去ログ取得
    let historyContext = "";
    const rSheet = ss.getSheetByName(getRecordSheetName_()) || ss.getSheets()[0];
    const lastRow = rSheet.getLastRow();
    
    if (lastRow > 1) {
      const count = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CONTEXT_HISTORY_COUNT) ? APP_CONFIG.CONTEXT_HISTORY_COUNT : 5;
      const startRow = Math.max(2, lastRow - count + 1);
      const numRows = lastRow - startRow + 1;
      
      if (numRows > 0) {
        try {
          const data = rSheet.getRange(startRow, 8, numRows, 1).getValues();
          const summaries = data.map(row => {
            try { 
              const res = decryptText(row[0], email);
              return res || ERROR_TEXT; 
            } catch(e) { 
              return ERROR_TEXT; 
            }
          }).filter(Boolean);
          
          if (summaries.length > 0) {
            historyContext = summaries.join("\n\n");
          }
        } catch(e) {
          console.warn("History Range Read Error:", e);
        }
      }
    }
    
    return { profile: profileText, history: historyContext };
  } catch (e) {
    console.error("getUserContext_ Error:", e);
    return { profile: "", history: "" };
  }
}

// ==========================================
//  2. 相談データの保存
// ==========================================

/**
 * 相談セッションの完了時データ保存処理
 */
function saveCounselingData(data) {
  const userEmail = Session.getActiveUser().getEmail();
  const folder = DriveApp.getFolderById(getDesignerFolderId_());
  const now = new Date();
  const japanDate = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  
  try {
    let ss, sheet1, sheet2;
    let file = findUserFile_(folder, userEmail);
    
    const recordSheetName = getRecordSheetName_();
    const profileSheetName = getProfileSheetName_();

    if (file) {
      ss = SpreadsheetApp.open(file);
      sheet1 = ss.getSheetByName(recordSheetName) || ss.getSheets()[0];
      sheet2 = ss.getSheetByName(profileSheetName);
      if (!sheet2) {
        sheet2 = ss.insertSheet(profileSheetName);
        sheet2.appendRow(['ユーザー名', 'プロフィール']);
        sheet2.appendRow(['', '']); 
      }
    } else {
      // 新規作成
      const originalFileName = `相談記録_${userEmail}`;
      const encryptedFileName = encryptText(originalFileName, userEmail);
      
      ss = SpreadsheetApp.create(encryptedFileName);
      file = DriveApp.getFileById(ss.getId());
      file.moveTo(folder);

      // キャッシュに即座に登録
      CacheService.getUserCache().put(
        'kokoro_user_file_id_' + userEmail.toLowerCase(), 
        file.getId(), 
        APP_CONFIG.CACHE_EXPIRATION_SEC
      );
      
      sheet1 = ss.getSheets()[0];
      sheet1.setName(recordSheetName);
      sheet1.appendRow(['そうだんび', 'はじめのきもち', 'ようやく', 'おわりのきもち', 'メモ', 'せんせい', 'かいけつ', '相談概要']);
      
      sheet2 = ss.insertSheet(profileSheetName);
      sheet2.appendRow(['ユーザー名', 'プロフィール']);
      sheet2.appendRow(['', '']); 
    }

    // 1. AIによる要約 & プロフィール更新生成
    const encryptedCurrentProfile = sheet2.getRange(2, 2).getValue();
    const currentProfile = decryptText(encryptedCurrentProfile, userEmail) || "";

    const aiResult = generateSummaryAndProfileUpdate_(data.fullHistory, currentProfile);

    // 2. 相談データの暗号化と保存
    const teacherStatus = data.shareWithTeacher ? 'つたえた' : 'ひみつにした';
    const studentSummary = data.history || "（なし）"; 

    const encryptedRow = [
      japanDate, 
      encryptText(data.startFeel, userEmail),
      encryptText(studentSummary, userEmail),
      encryptText(data.endFeel, userEmail),
      encryptText(data.memo, userEmail),
      encryptText(teacherStatus, userEmail),
      'まだ', 
      encryptText(aiResult.summary, userEmail)
    ];
    sheet1.appendRow(encryptedRow);

    // 3. プロフィールと名前の更新（暗号化して保存）
    sheet2.getRange(2, 2).setValue(encryptText(aiResult.newProfile, userEmail));
    
    const nameFromTeacher = getNameFromTeacherSheet_(userEmail);
    if (nameFromTeacher) {
      sheet2.getRange(2, 1).setValue(encryptText(nameFromTeacher, userEmail));
    }

    // 4. 先生への共有処理
    if (data.shareWithTeacher) {
      shareWithTeacher_(userEmail, data, aiResult.summary, data.targetTeacher);
    }

    return "ok";
  } catch (e) {
    console.error("Save Error:", e);
    throw new Error("保存中にエラーが発生しました: " + e.message);
  }
}

// ==========================================
//  3. 相談にっき（記録一覧・メモ更新）
// ==========================================

/**
 * 過去の相談記録一覧の取得 (暗号化対応版)
 */
function getConsultationRecords() {
  const userEmail = Session.getActiveUser().getEmail();
  const folder = DriveApp.getFolderById(getDesignerFolderId_());

  const file = findUserFile_(folder, userEmail);
  if (!file) return [];
  
  const ss = SpreadsheetApp.open(file);
  const sheet = ss.getSheetByName(getRecordSheetName_()) || ss.getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numCols = sheet.getLastColumn();
  const rangeCols = (numCols >= 8) ? 8 : numCols;

  const dataValues = sheet.getRange(2, 1, lastRow - 1, rangeCols).getDisplayValues();
  
  return dataValues.map((row, index) => ({
    rowIndex: index + 2, 
    date: row[0],
    start: decryptText(row[1], userEmail), 
    summary: decryptText(row[2], userEmail),
    end: decryptText(row[3], userEmail),
    memo: decryptText(row[4], userEmail),
    teacher: decryptText(row[5], userEmail),
    solved: row[6]
  })).reverse();
}

/**
 * 記録の更新（メモまたは解決フラグ）
 */
function updateRecord(rowIndex, column, value) {
  const userEmail = Session.getActiveUser().getEmail();
  const folder = DriveApp.getFolderById(getDesignerFolderId_());

  const file = findUserFile_(folder, userEmail);

  if (file) {
    const ss = SpreadsheetApp.open(file);
    const sheet = ss.getSheetByName(getRecordSheetName_()) || ss.getSheets()[0];
    const colNum = (column === 'E') ? 5 : 7;
    
    let valToSave = value;
    if (column === 'E') {
      valToSave = encryptText(value, userEmail);
    }
    
    sheet.getRange(rowIndex, colNum).setValue(valToSave);
    return "ok";
  }
  return "error";
}

/**
 * メモ更新用エイリアス
 */
function updateMemo(rowIndex, text) {
  return updateRecord(rowIndex, 'E', text);
}

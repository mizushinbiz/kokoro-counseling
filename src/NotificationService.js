/**
 * こころの相談室 - 通知・先生連携モジュール
 * 教師用スプレッドシートへの記録およびGoogle Chat Webhook通知を管理します。
 */

// ==========================================
//  1. 先生への共有処理
// ==========================================

/**
 * 先生への共有（スプレッドシート記録 & Google Chat通知）
 * 
 * @param {string} userEmail 生徒のEmail
 * @param {Object} data 相談データ
 * @param {string} summaryText 要約テキスト
 * @param {string} targetTeacher 担当者名（例: "こうちょうせんせい", "たんにんのせんせい"）
 */
function shareWithTeacher_(userEmail, data, summaryText, targetTeacher) {
  let studentInfo = ['?', '?', '?', '不明な生徒'];
  const teacherSummary = summaryText;
  const teacherRole = targetTeacher || "担当";

  // 1. 教師用スプレッドシートへの記録（同時書き込み衝突を防ぐLockService排他制御）
  const lock = LockService.getScriptLock();
  try {
    // 最大10秒待機してロックを取得
    const hasLock = lock.tryLock(10000);
    if (!hasLock) {
      console.warn("⚠️ 教師用シートの書き込みロック取得タイムアウト（ロックなしで書き込み試行）");
    }

    const teacherSS = SpreadsheetApp.openById(getTeacherSheetId_());
    const now = new Date();
    const japanDate = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    
    // 児童情報の検索
    const infoSheet = teacherSS.getSheetByName('児童情報');
    if (infoSheet) {
      const infoData = infoSheet.getDataRange().getValues();
      for (let i = 1; i < infoData.length; i++) {
        if (infoData[i][0] === userEmail) {
          studentInfo = [infoData[i][1], infoData[i][2], infoData[i][3], infoData[i][4]];
          break;
        }
      }
    }

    // 児童よりシートへ安全に追記
    const logSheet = teacherSS.getSheetByName('児童より');
    if (logSheet) {
      logSheet.appendRow([japanDate, userEmail, ...studentInfo, teacherSummary]);
      SpreadsheetApp.flush(); // 即時確定
    }

  } catch (e) {
    console.error("Teacher Sheet Write Error:", e);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }

  // 2. Google Chat Webhook 通知送信（ロック解放後に実行）
  try {
    const webhookUrl = getChatWebhookUrl_();
    if (webhookUrl) {
      sendGoogleChatNotification_(webhookUrl, studentInfo, teacherSummary, teacherRole);
    }
  } catch (e) {
    console.error("Teacher Webhook Error:", e);
  }
}

/**
 * Google Chat Webhook通知送信内部関数
 */
function sendGoogleChatNotification_(webhookUrl, studentInfo, teacherSummary, teacherRole) {
  try {
    const ssUrl = `https://docs.google.com/spreadsheets/d/${getTeacherSheetId_()}/edit`;
    const titleText = `${studentInfo[0]}年${studentInfo[1]}組${studentInfo[2]}番 ${studentInfo[3]}さん`;
    
    const payload = {
      "cardsV2": [{
        "cardId": "consultation-" + Date.now(),
        "card": {
          "header": {
            "title": titleText,
            "subtitle": "こころの相談室：SOS通知",
            "imageUrl": "https://lh4.googleusercontent.com/proxy/4akEkZirajlqIl1ykoZvxUpSXiOm1xQsLhejcQf0B-74VPR-I4Jgj4QA__6OtgpNJsLoXdUn26D1VtddPpmG5avBvkN-J7C3HSUOQW19QpfTM07mXlkiKdLPtkr3bZt_"
          },
          "sections": [{
            "widgets": [
              {
                "textParagraph": {
                  "text": `<b>相談要約：</b><br>${teacherSummary}<br><br><b>担当者：</b>${teacherRole}`
                }
              },
              {
                "buttonList": {
                  "buttons": [{
                    "text": "スプレッドシートを開く",
                    "color": { "red": 0, "green": 0, "blue": 1, "alpha": 1 },
                    "onClick": { "openLink": { "url": ssUrl } }
                  }]
                }
              }
            ]
          }]
        }
      }]
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(webhookUrl, options);
    const code = res.getResponseCode();
    if (code >= 400) {
      console.warn(`Google Chat Notification Failed: HTTP ${code}`, res.getContentText());
    }

  } catch (e) {
    console.warn("sendGoogleChatNotification_ Exception:", e.toString());
  }
}

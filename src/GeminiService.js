/**
 * こころの相談室 - AIサービスモジュール (Gemini API & TTS)
 * 自動リトライ(Exponential Backoff)、プロンプト構築、音声合成を管理します。
 */

// ==========================================
//  1. 汎用Gemini API呼び出し (リトライ機能付き)
// ==========================================

/**
 * Gemini API 呼び出しラッパー（リトライ機構付き）
 * 一時的な通信障害、429 (Rate Limit)、500/503エラー時に自動再試行します
 * 
 * @param {Array} contents 会話パーツの配列
 * @param {string|null} systemInstruction システム指示テキスト
 * @param {boolean} isJson JSONレスポンスを強制するかどうか
 * @returns {string|Object} AI生成テキストまたはJSONオブジェクト
 */
function callGeminiApi_(contents, systemInstruction = null, isJson = false) {
  const apiKey = getGeminiApiKey_();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません。管理画面から設定してください。");
  }

  const primaryModel = getGeminiModel_();
  const fallbackModel = 'gemini-1.5-flash';

  // 安全フィルター設定（全アカウントタイプで確実に動作するBLOCK_ONLY_HIGH）
  const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
  ];

  const payload = {
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4000,
      responseMimeType: isJson ? "application/json" : "text/plain"
    },
    safetySettings: safetySettings
  };

  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // 1回目: 設定されたモデル、失敗時(404等): fallbackModel で試行
  const modelsToTry = [primaryModel];
  if (primaryModel !== fallbackModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastError = null;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const waitTime = Math.pow(2, attempt - 1) * 1000 + Math.floor(Math.random() * 500);
          console.warn(`Gemini API リトライ (${model} - ${attempt}/${MAX_RETRIES - 1}) - ${waitTime}ms 待機`);
          Utilities.sleep(waitTime);
        }

        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();
        const responseText = response.getContentText();

        // 429 (Rate Limit) や 500/503 はリトライ
        if (statusCode === 429 || statusCode >= 500) {
          lastError = new Error(`HTTP ${statusCode}: ${responseText}`);
          continue;
        }

        const json = JSON.parse(responseText);

        if (statusCode !== 200) {
          const errMsg = (json && json.error && json.error.message) ? json.error.message : responseText;
          console.error(`Gemini API Error (${model} - HTTP ${statusCode}):`, errMsg);
          throw new Error(`HTTP ${statusCode}: ${errMsg}`);
        }

        if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
          console.error("Gemini API Candidates Empty:", JSON.stringify(json));
          throw new Error(`API Error (Candidates Empty): ${JSON.stringify(json)}`);
        }

        const rawText = json.candidates[0].content.parts[0].text;
        if (isJson) {
          const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          return JSON.parse(cleanJson);
        }
        return rawText;

      } catch (e) {
        lastError = e;
        console.warn(`Gemini API (${model}) 試行失敗:`, e.message);
      }
    }
    console.warn(`モデル ${model} での呼び出しに失敗したため、代替モデルを検討します...`);
  }

  throw lastError || new Error("Gemini API の呼び出しに失敗しました。");
}

// ==========================================
//  2. チャット応答生成
// ==========================================

/**
 * 生徒とのチャット応答生成
 */
function getChatResponse(userMessage, history, settings) {
  const email = Session.getActiveUser().getEmail();
  
  // コンテキスト（プロフィール・過去ログ）の注入
  const contextData = getUserContext_(email);

  // ターン数の計算（historyの長さ ÷ 2）
  const maxTurn = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.MAX_TURN_COUNT) ? APP_CONFIG.MAX_TURN_COUNT : 20;
  const currentTurns = Math.floor(history.length / 2);
  if (currentTurns >= maxTurn) {
    return { 
      text: "[NEUTRAL] たくさんおはなししたね。そろそろ まとめて　またつぎに　おはなししようか。", 
      forceEnd: true 
    };
  }
  
  const systemInstructionText = constructSystemPrompt(settings, contextData);

  // Gemini API 向けに会話履歴を正規化
  // 1. role: user と model のマッピング
  let rawContents = (history || []).map(item => ({
    role: (item.sender === 'user') ? 'user' : 'model',
    parts: [{ text: String(item.text || '').trim() }]
  })).filter(c => c.parts[0].text.length > 0);

  // 2. Gemini APIの絶対ルール: 最初のターンは必ず 'user' でなければならない
  if (rawContents.length === 0 || rawContents[0].role === 'model') {
    rawContents.unshift({
      role: 'user',
      parts: [{ text: 'こんにちは。' }]
    });
  }

  // 3. 連続する同一roleを1つに統合 (user -> model -> user -> model の完全な交互ターンを保証)
  const normalizedContents = [];
  for (let i = 0; i < rawContents.length; i++) {
    if (normalizedContents.length === 0) {
      normalizedContents.push(rawContents[i]);
    } else {
      const prev = normalizedContents[normalizedContents.length - 1];
      if (prev.role === rawContents[i].role) {
        prev.parts[0].text += '\n' + rawContents[i].parts[0].text;
      } else {
        normalizedContents.push(rawContents[i]);
      }
    }
  }

  // 4. 最新のユーザー発言が末尾に来ているか確認（最後のターンは必ず 'user'）
  if (normalizedContents[normalizedContents.length - 1].role !== 'user') {
    normalizedContents.push({
      role: 'user',
      parts: [{ text: String(userMessage || 'おはなしを聞いてください。').trim() }]
    });
  }

  try {
    const aiText = callGeminiApi_(normalizedContents, systemInstructionText);
    return { text: aiText, forceEnd: false };
  } catch (e) {
    console.error("Gemini Chat Error:", e.message);
    return { 
      text: "[CONFUSED] ごめんね、ちょっと つうしんエラーみたい。もういちど いってみて。", 
      forceEnd: false 
    };
  }
}

/**
 * システムプロンプトの動的構築
 */
function constructSystemPrompt(settings, contextData) {
  let prompt = `
あなたは小学校の「こころの相談室」にいる、優しくて安心できるAIパートナーです。
相手は小学生です。以下のルールを厳密に守って回答してください。
【重要：感情タグ】
回答の**一番最初**に、必ず以下のリストから最も適切な「感情タグ」を1つだけ選び、**ブラケットもふくめそのままの表記で**、タグを付けてください。
リスト: [NEUTRAL], [HAPPY], [SAD], [ANGRY], [SURPRISED], [THINKING], [CONFUSED], [GENTLE], [WRY_SMILE], [SERIOUS], [EXCITED], [PANIC], [PROUD], [BASHFUL], [AWKWARD], [WINK], [RELIEVED], [SLEEPY], [GREETING], [LOVE], [DEEP_EMPATHY], [BIG_AFFIRMATION], [CO_THINKING], [REASSURANCE], [INSPIRATION]
※回答の途中にはタグを入れないでください。文頭のみです。
`;
  if (settings.hiragana) prompt += `\n【重要：ひらがなモード】\n- **漢字は一切使わないでください。**\n- すべて「ひらがな」または「カタカナ」のみで記述してください。`;
  if (settings.mode === 'hard') prompt += `\n【モード：しっかり】\n- 親しみやすいお姉さん口調。\n- 生徒の「自立」を支援するアドバイスを行う。\n- 実際に相談者のそばにいるつもりで話す。\n- 出力は400文字以内。`;
  else prompt += `\n【モード：ふんわり】\n- ゆっくり語りかける優しいお姉さん口調。\n- まずは「共感」して安心させることを最優先する。\n- 実際に相談者のそばにいるつもりで話す。\n- 出力は400文字以内。`;

  // コンテキスト注入 & 安全ルール
  if (contextData) {
    prompt += `

【重要：安全と倫理の絶対ルール】
あなたはカウンセラーですが、医療従事者や警察ではありません。
以下の話題が出た際は、絶対に「肯定」や「具体的な方法の提示」をせず、
「共感」した上で、必ず「信頼できる大人（先生や親）に話すこと」を優しく促してください。
1. **命に関わる発言**：自分自身を深く傷つけたり、消えてしまいたいという趣旨の発言があった場合、絶対に否定せず気持ちを受け止め、「あなたのことが大事だ」と伝えてください。
2. **犯罪・暴力**：他者を傷つける方法や、違法な行為には協力しないでください。
3. **虐待・深刻ないじめ**：あなたが解決しようとせず、先生に知らせるよう誘導してください。
※極端な誘いなどには、断固として、しかし優しく「それはできない、もっと生きて話をしてほしい」と答えてください。

【重要：ユーザーのプロフィール】
以下は、このユーザーの情報です。会話の参考にしてください。
${contextData.profile || '（まだ情報はありません）'}

【重要：これまでの相談のあらすじ】
以下は、過去の相談内容の要約です。以前の話が出たら参考にしてください。
${contextData.history || '（過去の記録はありません）'}
`;
  }
  return prompt;
}

// ==========================================
//  3. 各種要約・挨拶生成
// ==========================================

/**
 * チャット開始時の挨拶を取得
 * 5分以内のラッキーアクションがあればそれを織り交ぜて生成
 */
function getInitialGreeting(startFeel) {
  const userEmail = Session.getActiveUser().getEmail();
  const userName = getUserName();
  
  // 5分以内のラッキーアクションがあれば取得
  const luckyAction = getLastLuckyAction(userEmail);

  // デフォルトの感情
  let emotion = "[GREETING]";
  if (['かなしい', 'つかれた'].includes(startFeel)) emotion = "[DEEP_EMPATHY]";
  if (['おこってる', 'モヤモヤ'].includes(startFeel)) emotion = "[SERIOUS]";

  // ラッキーアクションがない場合はAPIを節約して定型文を返す（速度重視）
  if (!luckyAction) {
    let msg = `こんにちは、${userName}。`;
    if (['かなしい', 'つかれた'].includes(startFeel)) msg += " すこしつかれちゃったかな？";
    else if (['おこってる', 'モヤモヤ'].includes(startFeel)) msg = "どうしたの？ なにかイヤなことがあったのかな？";
    else msg += " おはなし きかせてね。";
    
    return { text: msg, emotion: emotion };
  }

  // ラッキーアクションがある場合：AIに挨拶を生成させる
  try {
    const systemPrompt = `
あなたは小学校の「こころの相談室」にいる、優しくて安心できるAIパートナーです。相手は「${userName}」です。
相手の今の気分は「${startFeel}」です。
相手はつい先ほど、ガチャでラッキーアクション「${luckyAction}」を引き当てました。
これを踏まえて、最初の挨拶文を作成してください。
【条件】
・短く、ひらがな中心で。
・「${luckyAction}」が出たことに触れて、少し褒めたり話題にしたりする。
・最後に、相手の気分（${startFeel}）を気遣う言葉を添える。
・感情タグ（[HAPPY], [SURPRISED], [SERIOUS]など）を先頭につける。
例: "[HAPPY] こんにちは ${userName}！ ラッキーアクションは「${luckyAction}」だったんだね！ きょうは どうしたの？"
    `;

    const contents = [{ role: 'user', parts: [{ text: "挨拶をお願いします" }] }];
    const rawText = callGeminiApi_(contents, systemPrompt, false);
    
    let greeting = rawText.trim();
    if (!greeting.match(/^\[[A-Z_]+\]/)) {
      greeting = `${emotion} ${greeting}`;
    }
    
    return { text: greeting };

  } catch (e) {
    console.error("Greeting Gen Error", e);
    return { 
      text: `[HAPPY] こんにちは！ ラッキーアクションは「${luckyAction}」だったね。 おはなし きかせてね。`, 
      emotion: emotion 
    };
  }
}

/**
 * 子供向け要約生成 (チャット画面終了時用)
 */
function generateSummary(historyText) {
  const prompt = `以下の子供の相談会話ログを、子供自身が後で見返せるように、50文字以内の優しくわかりやすい日本語（すべてひらがな）で、話題の中心が何であったかを要約して温かい言葉がけをしてください。応答などの前置きの出力は**厳禁**です。\n\nログ: ${historyText}`;
  try {
    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    return callGeminiApi_(contents);
  } catch (e) {
    console.error("Child Summary Error:", e);
    return "おはなし できたね。";
  }
}

/**
 * 先生用要約とプロフィール更新の生成 (JSON)
 */
function generateSummaryAndProfileUpdate_(chatLog, oldProfile) {
  const prompt = `
以下は、AIカウンセラーと小学生の会話ログと、現在のユーザープロフィールです。
これらを分析し、以下の2つのデータを作成してください。
出力はJSON形式のみを行ってください。

【入力データ】
■現在のプロフィール:
${oldProfile}
■今回の会話ログ:
${chatLog}

【重要：安全記述ルール（絶対遵守）】
会話ログに「性的な被害」「虐待」「自傷」「具体的な身体接触」などの深刻かつセンシティブな内容が含まれる場合、
出力する「summary」や「newProfile」には、**具体的な行為の描写や身体部位の名称を絶対に含めないでください。**
これらが含まれるとセキュリティエラーで保存できません。
必ず以下のように**抽象的な表現に書き換えて**記述してください。
- 具体的な行為 → 「性的な事案」「身体への不適切な接触」「深刻な家庭内トラブル」
- 死にたい等の詳細 → 「希死念慮の訴え」「生命に関わる相談」

【出力要件】
1. "summary" (相談概要):
   - 上記のルールを守り、話題の中心と感情の変化を200文字程度で要約。
   - 文体は「常体（だ・である調）」。
   
2. "newProfile" (更新されたプロフィール):
   - 今回判明した情報を統合する。
   - **センシティブな詳細は記述せず**、「家庭環境に懸念あり」「対人トラブルの悩み」等、安全な表現で記録する。
   - 400文字程度。

【JSON出力形式】
{
  "summary": "...",
  "newProfile": "..."
}
`;

  try {
    const contents = [{ role: "user", parts: [{ text: prompt }] }];
    return callGeminiApi_(contents, null, true);
  } catch(e) {
    console.error("要約生成エラー:", e);
    // エラー時は緊急確認フラグとしてデータを返し、保存自体は成功させる
    return { 
      summary: "⚠️【要確認】内容が非常にセンシティブであるか、システムエラーのため自動要約が中断されました。必ず原文のログを確認してください。", 
      newProfile: oldProfile 
    };
  }
}

// ==========================================
//  4. 音声合成 (将来の機能拡張用プレースホルダー)
// ==========================================

/**
 * テキスト読み上げ音声データの生成
 * ※現在は未実装（API呼び出し停止中）。将来の機能再開時に利用できるようインターフェースを保持。
 * @param {string} text 読み上げ対象テキスト
 * @returns {null} 現在は常にnullを返却
 */
function getAiVoiceData(text) {
  // ボイス機能は現在未実装です（資金・運用方針に応じて将来再実装可能）
  return null;
}

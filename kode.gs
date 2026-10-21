// ================= CONFIGURATION ================= // 
// Masukkan Spreadsheet ID utama Anda di sini khusus untuk membaca tab "Config" pertama kali 
function scriptSpreadsheetIdCheck() {
    return '13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo';
}

// Konfigurasi Sumopod AI
const SUMOPOD_API_KEY = 'sk-your-sumopod-key-here'; // Isi via Script Properties, jangan hardcode
const SUMOPOD_URL = 'https://ai.sumopod.com/v1/chat/completions'; // Base URL + Endpoint
const SUMOPOD_MODEL = 'seed-2-0-mini';

// Daftar Kategori Baku
const VALID_CATEGORIES = [
  "Bahan Kue", "Bahan Minuman", "Kebersihan", "Kantor", 
  "Kemasan", "Operasional", "Topper & Mainan", "Renovasi", 
  "Asset", "Iuran", "Tukar Cash"
];

function getConfig() { 
  try { 
    const sheet = SpreadsheetApp.openById(scriptSpreadsheetIdCheck()).getSheetByName('Config'); 
    if (!sheet) throw new Error("Sheet 'Config' tidak ditemukan!"); 
    const data = sheet.getDataRange().getValues(); 
    let config = {}; 
    for (let i = 1; i < data.length; i++) { 
      if (data[i][0]) config[data[i][0].toString().trim()] = data[i][1] ? data[i][1].toString().trim() : ""; 
    } 
    return config; 
  } catch (e) { 
    console.error(e); return null; 
  } 
}

// ================= UTAMA (DO POST) =================
function doPost(e) { 
  try { 
    const config = getConfig(); 
    if (!config) return HtmlService.createHtmlOutput("Error Config");

    const TELEGRAM_TOKEN = config.TELEGRAM_TOKEN;
    const SPREADSHEET_ID = config.SPREADSHEET_ID;
    const BOT_PASSWORD = config.BOT_PASSWORD || '12345';
    const ALLOWED_THREAD_ID = parseInt(config.ALLOWED_THREAD_ID) || 7;
    const TELEGRAM_URL = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

    const update = JSON.parse(e.postData.contents);

    // Penanganan Tombol Interaktif (Callback Query)
    if (update.callback_query) {
      handleCallbackQuery(update, SPREADSHEET_ID, TELEGRAM_URL);
      return HtmlService.createHtmlOutput("OK");
    }

    const message = update.message;
    if (!message) return HtmlService.createHtmlOutput("OK");

    const chatId = message.chat.id;
    const chatType = message.chat.type;
    const threadId = message.message_thread_id || null;
    const senderId = message.from.id;
    const text = (message.text || "").trim();
    const senderName = (message.from.first_name || "") + (message.from.last_name ? " " + message.from.last_name : "");
    
    // --- FITUR: MENDAPATKAN LINK CHAT ---
    const userMsgId = message.message_id;
    let msgLink = "Private Chat"; 
    if (chatType === "supergroup" || chatType === "group") {
      let cleanChatId = String(chatId).replace("-100", "");
      if (threadId) {
        msgLink = `https://t.me/c/${cleanChatId}/${threadId}/${userMsgId}`;
      } else {
        msgLink = `https://t.me/c/${cleanChatId}/${userMsgId}`;
      }
    }

    // --- 1. AUTENTIKASI ---
    let isAuthorized = false;
    if (chatType === "private") {
      if (isUserAuthenticated(senderId)) {
        isAuthorized = true; 
      } else {
        if (text === BOT_PASSWORD) {
          authenticateUser(senderId);
          sendMessage(chatId, threadId, TELEGRAM_URL, "🔓 **Akses Diterima!**");
          return HtmlService.createHtmlOutput("OK");
        } else {
          sendMessage(chatId, threadId, TELEGRAM_URL, "🔒 **Bot Terkunci.** Masukkan password.");
          return HtmlService.createHtmlOutput("OK");
        }
      }
    } else if (chatType === "group" || chatType === "supergroup") {
      if (threadId === ALLOWED_THREAD_ID) isAuthorized = true; 
    }

    if (!isAuthorized) return HtmlService.createHtmlOutput("OK");

    // --- 2. COMMAND INTERAKTIF ---
    if (text.startsWith("/rekap")) { generateReport(chatId, threadId, SPREADSHEET_ID, TELEGRAM_URL); return HtmlService.createHtmlOutput("OK"); }
    if (text.startsWith("/harga")) { cekHargaTerakhir(chatId, threadId, text.replace("/harga", "").trim(), SPREADSHEET_ID, TELEGRAM_URL); return HtmlService.createHtmlOutput("OK"); }
    if (text.startsWith("/audit hitung")) { 
      auditHitungan(chatId, threadId, SPREADSHEET_ID, TELEGRAM_URL); 
      return HtmlService.createHtmlOutput("OK"); 
    }
    if (text.startsWith("/audit")) { auditKategori(chatId, threadId, SPREADSHEET_ID, TELEGRAM_URL); return HtmlService.createHtmlOutput("OK"); } // AUDIT COMMAND
    if (text.startsWith("/menu") || text.startsWith("/help")) { sendActionListMenu(chatId, threadId, TELEGRAM_URL); return HtmlService.createHtmlOutput("OK"); }
    if (text.startsWith("/config")) {
      let msg = `⚙️ **Konfigurasi Aktif:**\n- Provider AI: *Sumopod AI*\n- Model: \`${SUMOPOD_MODEL}\``;
      sendMessage(chatId, threadId, TELEGRAM_URL, msg);
      return HtmlService.createHtmlOutput("OK");
    }

    // --- 3. INPUT CEPAT TEKS (/catat) ---
    if (text.startsWith("/catat")) {
      const inputTeks = text.replace("/catat", "").trim();
      if (!inputTeks) {
        sendMessage(chatId, threadId, TELEGRAM_URL, "⚠️ **Format Salah!**\nGunakan: `/catat [detail belanja]`");
        return HtmlService.createHtmlOutput("OK");
      }
      
      const sentMsg = sendMessage(chatId, threadId, TELEGRAM_URL, `⏳ **Memproses Teks...**\n\`[□□□□] 0%\`\n_Status: Memulai..._`);
      const msgId = sentMsg ? sentMsg.result.message_id : null;

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 2, `Menganalisis teks via AI...`);
      let extractedData = callSumopodText(inputTeks, config);
      extractedData = auditCalculations(extractedData); // AUDIT PERHITUNGAN
      
      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 4, "Menyimpan ke Sheets...");
      processExtractedDataWithLoading(extractedData, chatId, threadId, msgId, SPREADSHEET_ID, TELEGRAM_URL, msgLink);
      return HtmlService.createHtmlOutput("OK");
    }

    // --- 4. PROSES GAMBAR STRUK ---
    if (message.photo) {
      const sentMsg = sendMessage(chatId, threadId, TELEGRAM_URL, `⏳ **Memproses Data...**\n\`[□□□□] 0%\`\n_Status: Memulai..._`);
      const msgId = sentMsg ? sentMsg.result.message_id : null;
      
      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 1, "Mengunduh gambar...");
      const photoIndex = message.photo.length > 1 ? message.photo.length - 2 : message.photo.length - 1;
      const base64 = getTelegramImageBase64(message.photo[photoIndex].file_id, TELEGRAM_URL);
      if (!base64) {
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, "❌ Gagal mengunduh gambar.");
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 2, `Menganalisis struk via AI...`);
      let captionText = message.caption || "";
      if (captionText.toLowerCase().includes("/tukercash")) captionText += ` (Input oleh: ${senderName})`;
      
      let extractedData = callSumopodImage(base64, captionText, config);
      extractedData = auditCalculations(extractedData); // AUDIT PERHITUNGAN

      if (extractedData.error || !extractedData.items || extractedData.items.length === 0) {
        const errKeyboard = { inline_keyboard: [[ { text: "🔄 Coba Lagi", callback_data: "retry_scan" } ]] };
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, `❌ Gagal membaca isi struk atau format tidak dikenali.`, errKeyboard);
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 3, "Mengecek duplikasi data...");
      const isDuplicate = checkDuplicateInSheet(SPREADSHEET_ID, extractedData.items);
      if (isDuplicate) {
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, `⚠️ **Double Input Terdeteksi!**\nTransaksi ini sudah tercatat.`);
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 4, "Menyimpan ke Sheets...");
      processExtractedDataWithLoading(extractedData, chatId, threadId, msgId, SPREADSHEET_ID, TELEGRAM_URL, msgLink);
    }

    // --- 5. PROSES AUDIO / VOICE NOTE ---
    if (message.voice) {
      const sentMsg = sendMessage(chatId, threadId, TELEGRAM_URL, `⏳ **Memproses Data...**\n\`[□□□□] 0%\`\n_Status: Memulai..._`);
      const msgId = sentMsg ? sentMsg.result.message_id : null;

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 1, "Mengunduh audio...");
      const base64 = getTelegramVoiceBase64(message.voice.file_id, TELEGRAM_URL);
      if (!base64) {
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, "❌ Gagal mengunduh audio.");
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 2, `Transkripsi via AI...`);
      let extractedData = callSumopodVoice(base64, config);
      extractedData = auditCalculations(extractedData); // AUDIT PERHITUNGAN

      if (extractedData.error || !extractedData.items || extractedData.items.length === 0) {
        const errKeyboard = { inline_keyboard: [[ { text: "🔄 Coba Lagi", callback_data: "retry_scan" } ]] };
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, `❌ Gagal memproses suara.`, errKeyboard);
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 3, "Mengecek duplikasi...");
      const isDuplicate = checkDuplicateInSheet(SPREADSHEET_ID, extractedData.items);
      if (isDuplicate) {
        if (msgId) editMessage(chatId, msgId, TELEGRAM_URL, `⚠️ **Double Input Terdeteksi!** Data suara ini sudah tercatat.`);
        return HtmlService.createHtmlOutput("OK");
      }

      if (msgId) updateProgress(chatId, msgId, TELEGRAM_URL, 4, "Menyimpan ke Sheets...");
      processExtractedDataWithLoading(extractedData, chatId, threadId, msgId, SPREADSHEET_ID, TELEGRAM_URL, msgLink);
    }

  } catch (error) { console.error(error); } 
  return HtmlService.createHtmlOutput("OK"); 
}

// ================= FUNGSI AUDIT PERHITUNGAN MATEMATIKA =================
function auditCalculations(extractedData) {
  if (extractedData && !extractedData.error && extractedData.items) {
    extractedData.items.forEach(item => {
      let qty = parseFloat(item.qty) || 1;
      let hargaSatuan = parseFloat(item.harga_satuan) || 0;
      let diskon = parseFloat(item.diskon) || 0;
      let tax = parseFloat(item.tax) || 0;
      
      // Paksa hasil perhitungan agar pasti akurat
      item.total_harga = (qty * hargaSatuan) - diskon + tax;
      item.qty = qty;
      item.harga_satuan = hargaSatuan;
    });
  }
  return extractedData;
}

// ================= SUMOPOD AI ROUTER =================
function callSumopodText(text, config) {
  const payload = { model: SUMOPOD_MODEL, messages: [{ role: "system", content: getSystemPrompt() }, { role: "user", content: `Input: "${text}"` }], temperature: 0.1 };
  return executeFetch(SUMOPOD_URL, JSON.stringify(payload), config.SPREADSHEET_ID);
}
function callSumopodImage(base64, caption, config) {
  const payload = { model: SUMOPOD_MODEL, messages: [{ role: "system", content: getSystemPrompt() }, { role: "user", content: [{ type: "text", text: `Caption: "${caption}"` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } } ] }], temperature: 0.1 };
  return executeFetch(SUMOPOD_URL, JSON.stringify(payload), config.SPREADSHEET_ID);
}
function callSumopodVoice(base64, config) {
  const payload = { model: SUMOPOD_MODEL, messages: [{ role: "system", content: getSystemPrompt() + "\nEkstrak data dr transkrip." }, { role: "user", content: [{ type: "input_audio", input_audio: { data: base64, format: "ogg" } }] }], temperature: 0.1 };
  return executeFetch(SUMOPOD_URL, JSON.stringify(payload), config.SPREADSHEET_ID);
}

function executeFetch(url, payload, spreadsheetId) { 
  const headers = { "Authorization": `Bearer ${SUMOPOD_API_KEY}`, "Content-Type": "application/json" };
  try { 
    const res = UrlFetchApp.fetch(url, { method: "post", headers: headers, payload: payload, muteHttpExceptions: true }); 
    const data = JSON.parse(res.getContentText()); 
    if (data.error) throw new Error(JSON.stringify(data.error));

    const raw = data.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*\}/);
    let parsed = JSON.parse(match ? match[0] : raw);

    if (!parsed.items) {
      if (Array.isArray(parsed)) parsed = { items: parsed }; else if (parsed.barang) parsed = { items: [parsed] };
    }
    return parsed;
  } catch (e) { 
    logToSheet(spreadsheetId, "ERROR", "Sumopod Fetch Error", e.toString()); 
    return { error: true, message: e.toString() }; 
  } 
}

// ================= SYSTEM PROMPT =================
function getSystemPrompt() { 
  const currentDate = new Date().toISOString().split('T')[0];
  const categoryList = VALID_CATEGORIES.map(c => `- ${c}`).join('\n');
  return `Anda asisten keuangan pintar. Ekstrak data belanja/mutasi ke JSON murni.
Tanggal hari ini: ${currentDate}.

Perhatikan Aturan Khusus Klasifikasi Kategori:
1. Bunga, bunga artificial, cake base, tatakan kue, dan stiker WAJIB masuk kategori "Kemasan".
2. Light box dan poster WAJIB masuk kategori "Asset".
3. Iuran, sumbangan, kerja bakti, dan sejenisnya WAJIB masuk kategori "Iuran".
4. Jika caption mengandung "/tukercash", masukkan kategori "Tukar Cash".
5. KATEGORI WAJIB DIPILIH DARI SALAH SATU DAFTAR BERIKUT (Harus sama persis):
${categoryList}

Instruksi Tambahan:
- Pisahkan transaksi beda entitas menjadi bbrp objek di array "items".
- Status Pembayaran asumsikan "Lunas" kecuali disebut sebaliknya.
WAJIB HANYA KELUARKAN JSON VALID. Format Wajib:
{ "items": [ { "tanggal": "YYYY-MM-DD", "barang": "Nama", "qty": 1, "kategori": "Bahan Kue", "harga_satuan": 0, "tax": 0, "diskon": 0, "total_harga": 0, "toko_supplier": "Toko", "metode_bayar": "Tunai", "status_pembayaran": "Lunas", "jatuh_tempo": "-", "keterangan": "-" } ] }`; 
}

// ================= FITUR AUDIT & AUTO FIX (KATEGORI) =================
function auditKategori(chatId, threadId, spreadsheetId, telegramUrl) {
  const sentMsg = sendMessage(chatId, threadId, telegramUrl, "⏳ Memeriksa konsistensi kategori di Google Sheets...");
  const msgId = sentMsg ? sentMsg.result.message_id : null;

  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran');
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "ℹ️ Belum ada data untuk diaudit."); return;
    }

    let invalidItems = [];
    const validLower = VALID_CATEGORIES.map(c => c.toLowerCase());

    for (let i = 1; i < data.length; i++) {
      let cat = (data[i][5] || "").toString().trim(); // Kolom F (index 5)
      if (!validLower.includes(cat.toLowerCase())) {
        invalidItems.push(`Baris ${i + 1}: ${data[i][3]} (${cat || "Kosong"})`);
      }
    }

    if (invalidItems.length === 0) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "✅ **Audit Selesai!**\nSemua data sudah menggunakan kategori baku yang baru.");
    } else {
      let report = `⚠️ **Ditemukan ${invalidItems.length} Data Kategori Tidak Baku:**\n\n`;
      let limit = Math.min(invalidItems.length, 15);
      for (let i = 0; i < limit; i++) report += `- ${invalidItems[i]}\n`;
      if (invalidItems.length > limit) report += `\n_...dan ${invalidItems.length - limit} baris lainnya._`;
      
      const keyboard = { 
        inline_keyboard: [
          [ { text: "🛠️ Auto-Fix dengan AI", callback_data: "action_autofix" } ],
          [ { text: "📊 Buka Sheets Manual", url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` } ]
        ] 
      };
      if (msgId) editMessage(chatId, msgId, telegramUrl, report, keyboard);
    }
  } catch (e) { if (msgId) editMessage(chatId, msgId, telegramUrl, "❌ Gagal audit: " + e.message); }
}

function auditHitungan(chatId, threadId, spreadsheetId, telegramUrl) {
  const sentMsg = sendMessage(chatId, threadId, telegramUrl, "⏳ **Memulai Audit & Auto-Fix...**\nSedang mengecek dan memperbaiki rumus (Qty x Harga) di database Anda.");
  const msgId = sentMsg ? sentMsg.result.message_id : null;
  
  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran');
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "ℹ️ Belum ada data untuk diaudit.");
      return;
    }
    
    let fixCount = 0;
    let fixedItems = [];
    
    for (let i = 1; i < data.length; i++) {
      let row = data[i];
      let barang = row[3]; 
      let qty = parseFloat(row[4]) || 1; 
      let hargaSatuan = parseFloat(row[6]) || 0; 
      let tax = parseFloat(row[7]) || 0; 
      let diskon = parseFloat(row[8]) || 0; 
      let totalTercatat = parseFloat(row[9]) || 0; 
      
      let totalSeharusnya = (qty * hargaSatuan) + tax - diskon;
      
      if (Math.abs(totalTercatat - totalSeharusnya) > 1) {
        sheet.getRange(i + 1, 10).setValue(totalSeharusnya);
        fixCount++;
        fixedItems.push(`- Baris ${i + 1}: ${barang} (Rp${totalTercatat} ➡️ Rp${totalSeharusnya})`);
      }
    }
    
    if (fixCount === 0) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "✅ **Audit Selesai!**\nDatabase aman. Tidak ada perhitungan (Qty x Harga) yang salah atau perlu diperbaiki.");
    } else {
      let reportMsg = `✅ **Auto-Fix Selesai!**\nBot berhasil mengoreksi **${fixCount} baris** perhitungan yang salah:\n\n`;
      let limit = Math.min(fixedItems.length, 15);
      for (let i = 0; i < limit; i++) reportMsg += fixedItems[i] + "\n";
      if (fixedItems.length > limit) reportMsg += `\n_...dan ${fixedItems.length - limit} data lainnya._`;
      
      const keyboard = { inline_keyboard: [[ { text: "📊 Cek Sheets", url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` } ]] };
      if (msgId) editMessage(chatId, msgId, telegramUrl, reportMsg, keyboard);
    }
    
  } catch (error) {
    if (msgId) editMessage(chatId, msgId, telegramUrl, `❌ **Terjadi Kesalahan:** ${error.toString()}`);
  }
}

function runAutoFix(chatId, threadId, spreadsheetId, telegramUrl) {
  const sentMsg = sendMessage(chatId, threadId, telegramUrl, "⏳ **Memulai Auto-Fix...**\n\`[□□□□] 0%\`\n_Status: Membaca data salah..._");
  const msgId = sentMsg ? sentMsg.result.message_id : null;

  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran');
    const data = sheet.getDataRange().getValues();
    let invalidItems = [];
    const validLower = VALID_CATEGORIES.map(c => c.toLowerCase());

    for (let i = 1; i < data.length; i++) {
      let cat = (data[i][5] || "").toString().trim();
      if (!validLower.includes(cat.toLowerCase())) {
        invalidItems.push({ row: i + 1, barang: data[i][3], kategori_lama: cat }); 
      }
    }

    if (invalidItems.length === 0) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "✅ Tidak ada kategori yang perlu diperbaiki."); return;
    }

    const itemsToFix = invalidItems.slice(0, 40);
    if (msgId) updateProgress(chatId, msgId, telegramUrl, 2, `Menganalisis ${itemsToFix.length} data via AI...`);

    const prompt = `Perbaiki kategori dari data belanja berikut. Patuhi aturan ini: Bunga/bunga artificial/cake base/tatakan kue/stiker -> "Kemasan". Light box/poster -> "Asset". Iuran/sumbangan/kerja bakti -> "Iuran". Selain itu, cocokkan dengan daftar ini: ${VALID_CATEGORIES.join(", ")}.\n\nData Salah:\n${JSON.stringify(itemsToFix)}\n\nWAJIB keluarkan HANYA JSON:\n{ "items": [ { "row": <angka_baris_dari_data>, "kategori_baru": "<Kategori_Valid>" } ] }`;
    
    const payload = { model: SUMOPOD_MODEL, messages: [{ role: "system", content: "Anda auditor data." }, { role: "user", content: prompt }], temperature: 0.1 };
    const fixedData = executeFetch(SUMOPOD_URL, JSON.stringify(payload), spreadsheetId);

    if (fixedData.error || !fixedData.items) {
      if (msgId) editMessage(chatId, msgId, telegramUrl, "❌ Auto-Fix gagal memproses respons AI. Coba lagi."); return;
    }

    if (msgId) updateProgress(chatId, msgId, telegramUrl, 4, "Menyimpan perbaikan ke Sheets...");
    
    let fixCount = 0;
    fixedData.items.forEach(fix => {
      if (fix.row && fix.kategori_baru && VALID_CATEGORIES.includes(fix.kategori_baru)) {
        sheet.getRange(fix.row, 6).setValue(fix.kategori_baru); // Kolom 6 = Kolom F (Kategori)
        fixCount++;
      }
    });

    let sisaMsg = invalidItems.length > 40 ? `\n_Masih tersisa ${invalidItems.length - 40} data, silakan klik Auto-Fix lagi._` : "";
    if (msgId) editMessage(chatId, msgId, telegramUrl, `✅ **Auto-Fix Selesai!**\nBerhasil memperbaiki ${fixCount} baris kategori.${sisaMsg}`);

  } catch (e) { if (msgId) editMessage(chatId, msgId, telegramUrl, "❌ Error Auto-Fix: " + e.message); }
}

// ================= LOGIKA CEK DUPLIKAT =================
function checkDuplicateInSheet(spreadsheetId, newItems) { 
  try { 
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran'); 
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;

    const numRowsToFetch = Math.min(lastRow - 1, 50); 
    const startRow = lastRow - numRowsToFetch + 1;
    const data = sheet.getRange(startRow, 1, numRowsToFetch, 10).getValues(); 

    for (let i = data.length - 1; i >= 0; i--) {
      let existingDate = data[i][1];
      if (existingDate instanceof Date) existingDate = existingDate.toISOString().split('T')[0];
      else existingDate = String(existingDate).split('T')[0];

      const existingToko = (data[i][2] || "").toString().trim().toLowerCase();
      const existingTotal = parseFloat(data[i][9]) || 0;

      for (let newItem of newItems) {
        let newDate = (newItem.tanggal || new Date().toISOString().split('T')[0]).toString().trim().split('T')[0];
        const newToko = (newItem.toko_supplier || "").toString().trim().toLowerCase();
        const newTotal = parseFloat(newItem.total_harga) || 0;

        if (existingToko === newToko && existingTotal === newTotal && existingDate === newDate && newTotal > 0) return true;
      }
    }
    return false;
  } catch (e) { return false; } 
}

// ================= PENYIMPANAN OTOMATIS =================
function processExtractedDataWithLoading(extractedData, chatId, threadId, messageId, spreadsheetId, telegramUrl, msgLink) { 
  if (extractedData.error || !extractedData.items || extractedData.items.length === 0) { 
    const errKeyboard = { inline_keyboard: [[ { text: "🔄 Coba Lagi", callback_data: "retry_scan" } ]] }; 
    if (messageId) editMessage(chatId, messageId, telegramUrl, `❌ Gagal memproses data oleh AI.`, errKeyboard); 
    logToSheet(spreadsheetId, "ERROR", "Ekstraksi Gagal", extractedData.message || "Kosong"); 
    return; 
  }

  // Menyematkan link referensi pesan
  extractedData.msgLink = msgLink;

  // LANGSUNG SIMPAN KE GOOGLE SHEETS
  saveDataToSheet(extractedData, spreadsheetId);

  let totalBelanja = 0, itemListStr = ""; 
  extractedData.items.forEach((item, index) => { 
    totalBelanja += item.total_harga; 
    itemListStr += `${index + 1}. ${item.barang} (${item.qty}x @Rp ${item.harga_satuan.toLocaleString('id-ID')}) - Rp ${item.total_harga.toLocaleString('id-ID')}\n`; 
  });

  const successMsg = `✅ **Berhasil Disimpan Otomatis! (${extractedData.items.length} Item)**\n\n📝 **Rincian:**\n${itemListStr}\n💰 **Total Tagihan: Rp ${totalBelanja.toLocaleString('id-ID')}**\n\n_Data telah masuk ke Google Sheets._`; 
  
  const keyboard = { 
    inline_keyboard: [
      [ { text: "📝 Cek Sheets", url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` } ]
    ] 
  };

  if (messageId) { 
    editMessage(chatId, messageId, telegramUrl, successMsg, keyboard); 
  } else { 
    sendMessage(chatId, threadId, telegramUrl, successMsg, keyboard); 
  } 
  logToSheet(spreadsheetId, "INFO", "Dicatat Otomatis", `Total: ${totalBelanja}`);
}

// Fungsi eksekutor final masuk ke Google Sheets
function saveDataToSheet(extractedData, spreadsheetId) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran'); 
  const timestamp = new Date(); 
  
  extractedData.items.forEach(item => { 
    sheet.appendRow([ 
      timestamp, 
      item.tanggal || timestamp, 
      item.toko_supplier || "-", 
      item.barang || "Barang", 
      item.qty || 1, 
      item.kategori || "Lainnya", 
      item.harga_satuan || 0, 
      item.tax || 0, 
      item.diskon || 0, 
      item.total_harga || 0, 
      item.metode_bayar || "Tunai", 
      item.status_pembayaran || "Lunas", 
      item.jatuh_tempo || "-", 
      item.keterangan || "-",
      extractedData.msgLink || "Private Chat"
    ]); 
  });
}

// ================= HELPER SHEET & FITUR BOT =================
function handleCallbackQuery(update, spreadsheetId, telegramUrl) { 
  const cb = update.callback_query; 
  const cbId = cb.id; 
  const chatId = cb.message.chat.id; 
  const threadId = cb.message.message_thread_id || null; 
  const data = cb.data;

  if (!telegramUrl) { 
    const config = getConfig(); 
    telegramUrl = 'https://api.telegram.org/bot' + config.TELEGRAM_TOKEN; 
  }

  const cache = CacheService.getScriptCache(); 
  if (cache.get(cbId)) return; 
  cache.put(cbId, "processing", 60);

  // Tombol Menu & Audit
  if (data === "menu_rekap") { generateReport(chatId, threadId, spreadsheetId, telegramUrl); } 
  else if (data === "menu_audit") { auditKategori(chatId, threadId, spreadsheetId, telegramUrl); } 
  else if (data === "action_autofix") { runAutoFix(chatId, threadId, spreadsheetId, telegramUrl); } 
  else if (data === "menu_config") { let msg = `⚙️ **Konfigurasi Aktif:**\n- Model: \`${SUMOPOD_MODEL}\``; sendMessage(chatId, threadId, telegramUrl, msg); } 
  else if (data === "menu_bantuan") { let helpMsg = "💡 **Panduan:**\n1. Kirim Foto / Voice.\n2. Jika ada salah input perjelas format harga/jumlah barangnya di inputan baru.\n3. Ketik `/audit` untuk cek kategori."; sendMessage(chatId, threadId, telegramUrl, helpMsg); } 
  else if (data === "retry_scan") { sendMessage(chatId, threadId, telegramUrl, "🔄 Silakan kirim ulang data yang diproses."); } 
}

function updateConfigInSheet(spreadsheetId, key, value) { const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Config'); const data = sheet.getDataRange().getValues(); for (let i = 1; i < data.length; i++) { if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(value); return; } } }
function logToSheet(spreadsheetId, level, message, detail = "") { try { const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('System Logs'); if (sheet) sheet.appendRow([new Date(), level, message, detail]); } catch (e) {} }

function cekHargaTerakhir(chatId, threadId, keyword, spreadsheetId, telegramUrl) { 
  if (!keyword) return sendMessage(chatId, threadId, telegramUrl, "⚠️ Masukkan nama bahan."); 
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran'); 
  const data = sheet.getDataRange().getValues(); 
  if (data.length <= 1) return sendMessage(chatId, threadId, telegramUrl, "ℹ️ Belum ada data.");

  let found = null; 
  for (let i = data.length - 1; i >= 1; i--) { 
    if ((data[i][3] || "").toString().toLowerCase().includes(keyword.toLowerCase())) { found = data[i]; break; } 
  } 
  
  if (found) { 
    const tgl = new Date(found[1]).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'}); 
    sendMessage(chatId, threadId, telegramUrl, `✅ **Ditemukan!**\n📦 ${found[3]}\n💰 Satuan: Rp ${(parseFloat(found[6])||0).toLocaleString('id-ID')}\n🏢 Toko: ${found[2]}\n📅 Tanggal: ${tgl}`); 
  } else { sendMessage(chatId, threadId, telegramUrl, `❌ Barang "${keyword}" belum pernah tercatat.`); } 
}

function generateReport(chatId, threadId, spreadsheetId, telegramUrl) { 
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Pengeluaran'); 
  const data = sheet.getDataRange().getValues(); 
  if (data.length <= 1) return sendMessage(chatId, threadId, telegramUrl, "ℹ️ Belum ada data.");

  let totalLunas = 0; let rekapKategori = {}; let listHutang = [];
  const now = new Date(); const currentMonth = now.getMonth(); const currentYear = now.getFullYear();

  for (let i = 1; i < data.length; i++) { 
    let row = data[i]; let d = new Date(row[1]); let status = (row[11] || "").toString().toLowerCase(); let nominal = parseFloat(row[9]) || 0;
    if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
      if (status === "lunas") { totalLunas += nominal; let kat = row[5] || "Lainnya"; rekapKategori[kat] = (rekapKategori[kat] || 0) + nominal; } 
      else if (status.includes("belum") || status === "hutang" || status === "tempo") { listHutang.push({ barang: row[3], nominal: nominal, tempo: row[12] || "-" }); }
    }
  }

  let reportMsg = `📊 **REKAP BULAN INI**\n\n💰 **Lunas: Rp ${totalLunas.toLocaleString('id-ID')}**\n\n📂 **Kategori:**\n`; 
  for (let kat in rekapKategori) { reportMsg += `▪️ ${kat}: Rp ${rekapKategori[kat].toLocaleString('id-ID')}\n`; }
  if (listHutang.length > 0) { reportMsg += `\n⚠️ **Tagihan (Belum Lunas):**\n`; listHutang.forEach((h, idx) => { reportMsg += `${idx + 1}. *${h.barang}* - Rp ${h.nominal.toLocaleString('id-ID')} (Tempo: ${h.tempo})\n`; }); }
  const keyboard = { inline_keyboard: [[ { text: "📊 Buka Sheets", url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` } ]] }; 
  sendMessage(chatId, threadId, telegramUrl, reportMsg, keyboard); 
}

function sendActionListMenu(chatId, threadId, telegramUrl) { 
  if (!telegramUrl) { const config = getConfig(); telegramUrl = 'https://api.telegram.org/bot' + config.TELEGRAM_TOKEN; }
  const menuText = "📋 **MENU UTAMA**\n\n📊 /rekap - Laporan\n🔍 /harga [nama] - Cari harga\n📝 /catat [detail] - Catat teks\n🔎 /audit - Cek Kategori Data";
  const keyboard = { inline_keyboard: [ [ { text: "📊 Rekap", callback_data: "menu_rekap" }, { text: "🔎 Audit", callback_data: "menu_audit" } ], [ { text: "💡 Bantuan", callback_data: "menu_bantuan" }, { text: "📝 Sheets", url: `https://docs.google.com/spreadsheets/d/${scriptSpreadsheetIdCheck()}/edit` } ] ] }; 
  sendMessage(chatId, threadId, telegramUrl, menuText, keyboard); 
}

function isUserAuthenticated(userId) { const props = PropertiesService.getScriptProperties(); return JSON.parse(props.getProperty('AUTH_USERS') || '[]').includes(userId); }
function authenticateUser(userId) { const props = PropertiesService.getScriptProperties(); let users = JSON.parse(props.getProperty('AUTH_USERS') || '[]'); if (!users.includes(userId)) { users.push(userId); props.setProperty('AUTH_USERS', JSON.stringify(users)); } }
function getTelegramImageBase64(fileId, telegramUrl) { const res = UrlFetchApp.fetch(`${telegramUrl}/getFile?file_id=${fileId}`); const path = JSON.parse(res.getContentText()).result.file_path; const tokenBot = telegramUrl.split('/bot')[1]; const blob = UrlFetchApp.fetch(`https://api.telegram.org/file/bot${tokenBot}/${path}`).getBlob(); return Utilities.base64Encode(blob.getBytes()); }
function getTelegramVoiceBase64(fileId, telegramUrl) { const res = UrlFetchApp.fetch(`${telegramUrl}/getFile?file_id=${fileId}`); const path = JSON.parse(res.getContentText()).result.file_path; const tokenBot = telegramUrl.split('/bot')[1]; const blob = UrlFetchApp.fetch(`https://api.telegram.org/file/bot${tokenBot}/${path}`).getBlob(); return Utilities.base64Encode(blob.getBytes()); }

function sendMessage(chatId, threadId, telegramUrl, text, replyMarkup = null) { 
  if (!telegramUrl) { const config = getConfig(); telegramUrl = 'https://api.telegram.org/bot' + config.TELEGRAM_TOKEN; }
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' }; 
  if (threadId) payload.message_thread_id = threadId; 
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try { const res = UrlFetchApp.fetch(`${telegramUrl}/sendMessage`, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }); return JSON.parse(res.getContentText()); } catch (e) { return null; } 
}

function editMessage(chatId, messageId, telegramUrl, text, replyMarkup = null) { 
  const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' }; 
  if (replyMarkup) payload.reply_markup = replyMarkup; 
  try { UrlFetchApp.fetch(`${telegramUrl}/editMessageText`, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload) }); } catch (e) {} 
}

// --- FITUR: MENGUPDATE PROGRESS BAR ---
function updateProgress(chatId, msgId, telegramUrl, step, text) {
  const totalSteps = 4; const filled = "■".repeat(step); const empty = "□".repeat(totalSteps - step); const percentage = Math.round((step / totalSteps) * 100);
  const progressText = `⏳ **Memproses Data...**\n\`[${filled}${empty}] ${percentage}%\`\n_Status: ${text}_`;
  editMessage(chatId, msgId, telegramUrl, progressText);
}
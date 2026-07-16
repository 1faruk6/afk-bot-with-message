const mineflayer = require('mineflayer');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const https = require('https'); // Yerleşik HTTPS modülü

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// --- GİZLİ ŞİFRE VE BOT AYARLARI ---
const botUsername = process.env.BOT_USERNAME || "RaNdOmBrOs_afk";
const accountPassword = process.env.BOT_PASSWORD || "123456"; // Panel ve oyun giriş şifresi

const botOptions = {
  host: 'oyna.melonya.net',
  username: botUsername,
  version: '1.20.4'
};

let bot;
let townyTimer;
let isConnected = false;
let chatLog = []; // Maksimum 100 mesajlık geçmiş

// --- AYAR DOSYASI KONTROLÜ (RAILWAY KALICI DISK DESTEKLİ VE BOŞ BAŞLANGIÇ) ---
const STORAGE_DIR = path.join(__dirname, 'storage');

// Eğer klasör yoksa (ilk kurulumda veya lokalde) otomatik oluşturur
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const SETTINGS_PATH = path.join(STORAGE_DIR, 'settings.json');

let settings = {
  intervalMessages: [], // Tamamen temiz başlangıç
  autoReplies: [],      // Tamamen temiz başlangıç
  notifications: {
    enabled: true,
    ntfyTopic: "randombros_afk_notification", // İstediğin sabit kanal adı
    ntfyToken: "", // Railway kota engeli aşımı için Token alanı
    triggers: []   // Boş başlangıç
  },
  shortcuts: []         // Tamamen temiz başlangıç
};

if (fs.existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    // Geriye dönük uyumluluk kontrolleri
    if (!settings.notifications) {
      settings.notifications = { enabled: true, ntfyTopic: "randombros_afk_notification", ntfyToken: "", triggers: [] };
    }
    if (settings.notifications && !settings.notifications.hasOwnProperty('ntfyToken')) {
      settings.notifications.ntfyToken = "";
    }
    if (!settings.notifications.ntfyTopic) {
      settings.notifications.ntfyTopic = "randombros_afk_notification";
    }
  } catch (e) {
    console.log("Ayarlar dosyası okunamadı, varsayılanlar yükleniyor.");
  }
} else {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// --- PERİYODİK MESAJ DÖNGÜSÜ ---
let intervalIndex = 0;
let intervalTimeout = null;

function startIntervalLoop() {
  if (intervalTimeout) clearTimeout(intervalTimeout);

  function run() {
    if (!bot || !isConnected || settings.intervalMessages.length === 0) {
      intervalTimeout = setTimeout(run, 10000);
      return;
    }

    const current = settings.intervalMessages[intervalIndex];
    if (current) {
      bot.chat(current.text);
      addChatToLog("SİSTEM", `[Zamanlayıcı] Gönderildi: "${current.text}"`);
      
      intervalIndex = (intervalIndex + 1) % settings.intervalMessages.length;
      intervalTimeout = setTimeout(run, current.waitMinutes * 60 * 1000);
    } else {
      intervalIndex = 0;
      intervalTimeout = setTimeout(run, 5000);
    }
  }
  run();
}

function addChatToLog(sender, message) {
  const timestamp = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  chatLog.push({ timestamp, sender, message });
  if (chatLog.length > 100) chatLog.shift();
}

function isAuthenticated(req) {
  return req.cookies && req.cookies.panel_token === accountPassword;
}

// --- WEB PANEL ARAYÜZÜ ---
app.get('/', (req, res) => {
  if (!isAuthenticated(req)) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Melonya Bot Panel Girişi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-box { background: #1e1e1e; padding: 35px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); width: 100%; max-width: 320px; text-align: center; }
          h2 { color: #4caf50; margin-bottom: 20px; }
          input[type="password"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #333; background: #2a2a2a; color: #fff; border-radius: 6px; box-sizing: border-box; }
          button { width: 100%; padding: 12px; background: #4caf50; border: none; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; transition: 0.2s; }
          button:hover { background: #45a049; }
          .error { color: #f44336; font-size: 13px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2>Panel Girişi</h2>
          <form action="/login" method="POST">
            <input type="password" name="pin" placeholder="Panel Giriş Şifresi" required>
            <button type="submit">Giriş Yap</button>
          </form>
          ${req.query.error ? '<p class="error">Geçersiz şifre girdiniz!</p>' : ''}
        </div>
      </body>
      </html>
    `);
  }

  const statusText = isConnected 
    ? "<span style='color:#4caf50;'>● Çevrimiçi (Oyunda)</span>" 
    : "<span style='color:#f44336;'>● Çevrimdışı (Bağlanıyor...)</span>";

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Melonya Bot Kontrol Paneli</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #121212; color: #fff; margin: 0; padding: 20px; display: flex; justify-content: center; }
        .dashboard { width: 100%; max-width: 1100px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 850px) { .dashboard { grid-template-columns: 1fr; } }
        .column { display: flex; flex-direction: column; gap: 20px; }
        .card { background: #1e1e1e; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        h2, h3 { margin-top: 0; color: #4caf50; }
        .status { font-size: 18px; font-weight: bold; margin-bottom: 15px; }
        
        .chat-box { background: #151515; border: 1px solid #2a2a2a; border-radius: 8px; height: 350px; overflow-y: auto; padding: 15px; font-family: 'Consolas', monospace; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
        .chat-msg { border-bottom: 1px solid #1f1f1f; padding-bottom: 4px; line-height: 1.4; }
        .chat-time { color: #666; margin-right: 5px; }
        .chat-sender { color: #ff9800; font-weight: bold; margin-right: 5px; }
        .chat-sender.system { color: #00bcd4; }
        .chat-text { color: #e0e0e0; }

        input[type="text"], input[type="number"] { width: 100%; padding: 10px; margin: 6px 0; border: 1px solid #333; background: #2a2a2a; color: #fff; border-radius: 6px; box-sizing: border-box; }
        button { padding: 10px 15px; background: #4caf50; border: none; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.2s; }
        button:hover { background: #45a049; }
        .btn-danger { background: #f44336; padding: 5px 10px; font-size: 12px; }
        .btn-danger:hover { background: #da190b; }
        .badge { background: #444; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px; color: #ffeb3b; }
        .toast { position: fixed; bottom: 20px; right: 20px; background: #4caf50; color: white; padding: 12px 24px; border-radius: 6px; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 999; }
        .shortcut-btn { background: #2196f3; margin-right: 8px; margin-bottom: 8px; display: inline-flex; align-items: center; }
        .shortcut-btn:hover { background: #0b7dda; }
        .list-item { display: flex; justify-content: space-between; align-items: center; background: #2a2a2a; padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; font-size: 14px; }
        .empty-placeholder { font-size: 13px; color: #777; font-style: italic; margin: 5px 0; }
      </style>
    </head>
    <body>
      <div class="dashboard">
        
        <!-- SOL SÜTUN -->
        <div class="column">
          <div class="card" style="flex: 1; display: flex; flex-direction: column;">
            <h2>Melonya Canlı Sohbet</h2>
            <div class="status">Sistem: ${statusText}</div>
            <div id="chatBox" class="chat-box"></div>
            <div style="margin-top: 15px; display: flex; gap: 8px;">
              <input type="text" id="manualMessage" placeholder="Oyuna hızlı mesaj veya komut gönderin... (Örn: /towny spawn)" style="margin:0; flex: 1;">
              <button onclick="sendManualMessage()">Gönder</button>
            </div>
          </div>

          <!-- KISAYOL KARTI -->
          <div class="card">
            <h3>Klavye Kısayolları</h3>
            <p style="font-size: 12px; color: #aaa; margin-top: -8px;">Panel açıkken klavyenizden belirlenen tuşa basarak hızlıca komut gönderebilirsiniz.</p>
            
            <div id="shortcutsContainer" style="margin-bottom: 15px;">
              ${settings.shortcuts.length > 0 ? settings.shortcuts.map(s => `
                <button class="shortcut-btn" onclick="sendCustomMessage('${s.command}')">
                  <span class="badge">${s.key.toUpperCase()}</span> ${s.label}
                </button>
              `).join('') : '<p class="empty-placeholder">Henüz hiç kısayol eklenmedi. Aşağıdan yeni bir tane oluşturabilirsiniz.</p>'}
            </div>
            
            <hr style="border-color: #2a2a2a; margin: 15px 0;">
            <h4>Kısayol Düzenleme:</h4>
            <div id="shortcutList" style="margin-bottom:15px;">
              ${settings.shortcuts.length > 0 ? settings.shortcuts.map((s, index) => `
                <div class="list-item">
                  <span><b style="color:#2196f3;">[${s.key.toUpperCase()}]</b> ${s.label} <small style="color:#aaa;">(${s.command})</small></span>
                  <button class="btn-danger" onclick="deleteShortcut(${index})">Sil</button>
                </div>
              `).join('') : '<p class="empty-placeholder">Düzenlenecek kısayol bulunmuyor.</p>'}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 2fr 2fr; gap: 5px;">
              <input type="text" id="newShortKey" placeholder="Klavye Tuşu (Örn: g)" maxlength="1">
              <input type="text" id="newShortLabel" placeholder="Kısayol Başlığı (Örn: Towny'ye Git)">
              <input type="text" id="newShortCmd" placeholder="Çalışacak Komut (Örn: /towny)">
            </div>
            <button onclick="addShortcut()" style="width: 100%; margin-top: 8px;">Yeni Kısayol Ekle</button>
          </div>
        </div>

        <!-- SAĞ SÜTUN -->
        <div class="column">
          <div class="card">
            <h3>⏰ Periyodik Mesaj Döngüsü</h3>
            <div id="intervalList" style="margin-bottom: 15px;">
              ${settings.intervalMessages.length > 0 ? settings.intervalMessages.map((m, index) => `
                <div class="list-item">
                  <span>"${m.text}" <small style="color:#aaa;">(${m.waitMinutes} dk)</small></span>
                  <button class="btn-danger" onclick="deleteInterval(${index})">Sil</button>
                </div>
              `).join('') : '<p class="empty-placeholder">Aktif bir döngü mesajı yok. Aşağıdan süreli mesaj tanımlayabilirsiniz.</p>'}
            </div>
            <h4>Yeni Zaman Ayarlı Mesaj:</h4>
            <input type="text" id="newIntervalText" placeholder="Sohbete otomatik atılacak mesaj... (Örn: Bot aktif durumdadır.)">
            <input type="number" id="newIntervalMinutes" placeholder="Kaç dakikada bir gönderilsin? (Örn: 5)">
            <button onclick="addInterval()" style="width:100%;">Mesajı Döngüye Ekle</button>
          </div>

          <!-- OTO CEVAPLAR -->
          <div class="card">
            <h3>🤖 Otomatik Cevaplar</h3>
            <p style="font-size: 12px; color: #aaa; margin-top: -8px;">Sohbette tetikleyici kelime geçtiğinde botun vereceği otomatik cevaplar.</p>
            <div id="autoReplyList" style="margin-bottom: 15px;">
              ${settings.autoReplies.length > 0 ? settings.autoReplies.map((r, index) => `
                <div class="list-item">
                  <span><b style="color:#ff9800;">"${r.trigger}"</b> ➜ "${r.reply}"</span>
                  <button class="btn-danger" onclick="deleteAutoReply(${index})">Sil</button>
                </div>
              `).join('') : '<p class="empty-placeholder">Kayıtlı otomatik cevap bulunmuyor.</p>'}
            </div>
            <hr style="border-color: #2a2a2a; margin: 15px 0;">
            <h4>Yeni Otomatik Cevap Ekle:</h4>
            <input type="text" id="newTrigger" placeholder="Tetikleyecek kelime... (Örn: selam)">
            <input type="text" id="newReply" placeholder="Botun vereceği otomatik yanıt... (Örn: Aleyküm selam!)">
            <button onclick="addAutoReply()" style="width:100%;">Oto-Cevap Ekle</button>
          </div>

          <!-- BİLDİRİM AYARLARI -->
          <div class="card">
            <h3>🔔 Telefona Bildirim (ntfy.sh)</h3>
            <label style="font-size:12px; color:#aaa;">Kanal Adı (ntfy.sh Topic):</label>
            <input type="text" id="ntfyTopic" value="${settings.notifications.ntfyTopic || ''}" placeholder="ntfy.sh kanal adınız (Örn: randombros_afk_notification)">
            
            <label style="font-size:12px; color:#aaa; display:block; margin-top:8px;">ntfy.sh Erişim Anahtarı (Kota Sorununu Çözer):</label>
            <input type="text" id="ntfyToken" value="${settings.notifications.ntfyToken || ''}" placeholder="ntfy.sh sitesinden aldığınız tk_ ile başlayan token (Gerekliyse)">
            
            <label style="font-size:12px; color:#aaa; display:block; margin-top:8px;">Tetikleyici Kelimeler (virgülle ayırın):</label>
            <input type="text" id="ntfyTriggers" value="${settings.notifications.triggers ? settings.notifications.triggers.join(', ') : ''}" placeholder="Hangi kelimeler geçince telefona bildirim gelsin? (Örn: acil, yardim, baksana)">
            
            <div style="display: flex; gap: 8px; margin-top: 15px;">
              <button onclick="saveNotificationSettings()" style="flex: 1;">Ayarları Kaydet</button>
              <button onclick="sendTestNotification()" style="background: #2196f3; flex: 1;">Test Bildirimi Gönder</button>
            </div>
          </div>
        </div>

      </div>

      <div id="toast" class="toast">İşlem başarıyla tamamlandı!</div>

      <script>
        function showToast(msg) {
          const t = document.getElementById('toast');
          t.innerText = msg;
          t.style.display = 'block';
          setTimeout(() => { t.style.display = 'none'; }, 2500);
        }

        // --- ANLIK CANLI SOHBET SİSTEMİ ---
        function updateChat() {
          fetch('/api/chat')
            .then(res => res.json())
            .then(logs => {
              const chatBox = document.getElementById('chatBox');
              chatBox.innerHTML = ''; 
              logs.forEach(log => {
                const isSystem = log.sender === 'SİSTEM';
                const div = document.createElement('div');
                div.className = 'chat-msg';
                div.innerHTML = \`
                  <span class="chat-time">[\${log.timestamp}]</span>
                  <span class="chat-sender \${isSystem ? 'system' : ''}">\${log.sender}:</span>
                  <span class="chat-text">\--- \${log.message}</span>
                \`;
                chatBox.appendChild(div);
              });
              chatBox.scrollTop = chatBox.scrollHeight;
            });
        }
        setInterval(updateChat, 1000);

        function sendManualMessage() {
          const msgInput = document.getElementById('manualMessage');
          sendCustomMessage(msgInput.value);
          msgInput.value = '';
        }

        function sendCustomMessage(msg) {
          if(!msg) return;
          fetch('/send-message-ajax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
          })
          .then(r => r.json())
          .then(data => {
            if(data.success) {
              showToast("Mesaj gönderildi!");
              updateChat();
            } else {
              showToast("Hata: " + data.message);
            }
          });
        }

        // Global Klavye Kısayolları Dinleme
        document.addEventListener('keydown', function(e) {
          if(document.activeElement.tagName === 'INPUT') return;
          const shortcuts = ${JSON.stringify(settings.shortcuts)};
          const pressedKey = e.key.toLowerCase();
          const match = shortcuts.find(s => s.key.toLowerCase() === pressedKey);
          
          if(match) {
            e.preventDefault();
            sendCustomMessage(match.command);
          }
        });

        // --- ZAMANLAYICI AYARLARI ---
        function addInterval() {
          const text = document.getElementById('newIntervalText').value;
          const waitMinutes = parseFloat(document.getElementById('newIntervalMinutes').value);
          if(!text || isNaN(waitMinutes)) return alert("Lütfen alanları doğru doldurun.");

          fetch('/settings/add-interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, waitMinutes })
          }).then(() => location.reload());
        }

        function deleteInterval(index) {
          fetch('/settings/delete-interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
          }).then(() => location.reload());
        }

        // --- OTO CEVAP AYARLARI ---
        function addAutoReply() {
          const trigger = document.getElementById('newTrigger').value.trim();
          const reply = document.getElementById('newReply').value.trim();
          if(!trigger || !reply) return alert("Lütfen alanları doldurun.");

          fetch('/settings/add-autoreply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger, reply })
          }).then(() => location.reload());
        }

        function deleteAutoReply(index) {
          fetch('/settings/delete-autoreply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
          }).then(() => location.reload());
        }

        // --- KISAYOL AYARLARI ---
        function addShortcut() {
          const key = document.getElementById('newShortKey').value.trim().toLowerCase();
          const label = document.getElementById('newShortLabel').value.trim();
          const command = document.getElementById('newShortCmd').value.trim();
          if(!key || !label || !command) return alert("Lütfen tüm alanları doldurun.");

          fetch('/settings/add-shortcut', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, label, command })
          }).then(() => location.reload());
        }

        function deleteShortcut(index) {
          fetch('/settings/delete-shortcut', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
          }).then(() => location.reload());
        }

        // --- BİLDİRİM AYARLARI ---
        function saveNotificationSettings() {
          const ntfyTopic = document.getElementById('ntfyTopic').value.trim();
          const ntfyToken = document.getElementById('ntfyToken').value.trim();
          const triggers = document.getElementById('ntfyTriggers').value.split(',').map(x => x.trim()).filter(x => x !== "");

          fetch('/settings/save-notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ntfyTopic, ntfyToken, triggers })
          })
          .then(r => r.json())
          .then(data => {
            if(data.success) showToast("Bildirim ayarları kaydedildi!");
          });
        }

        // TEST BİLDİRİMİ TETİKLEYİCİSİ
        function sendTestNotification() {
          fetch('/settings/test-notification', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
              if(data.success) {
                showToast("Test bildirimi ntfy'ye gönderildi!");
              } else {
                showToast("Hata: " + data.message);
              }
            });
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/api/chat', (req, res) => {
  res.json(chatLog);
});

app.post('/login', (req, res) => {
  const { pin, remember } = req.body;
  if (pin === accountPassword) {
    if (remember === 'on') {
      res.cookie('panel_token', pin, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    } else {
      res.cookie('panel_token', pin, { httpOnly: true });
    }
    return res.redirect('/');
  }
  res.redirect('/?error=1');
});

app.post('/send-message-ajax', (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ success: false, message: "Yetkisiz erişim" });
  
  const { message } = req.body;
  if (!bot || !isConnected) {
    return res.json({ success: false, message: "Bot oyuna bağlı değil!" });
  }

  bot.chat(message);
  addChatToLog("SEN (Panel)", message);
  res.json({ success: true });
});

// --- AYAR DEĞİŞTİRME API'LERİ ---
app.post('/settings/add-interval', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { text, waitMinutes } = req.body;
  settings.intervalMessages.push({ text, waitMinutes });
  saveSettings();
  startIntervalLoop();
  res.json({ success: true });
});

app.post('/settings/delete-interval', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { index } = req.body;
  if (index >= 0 && index < settings.intervalMessages.length) {
    settings.intervalMessages.splice(index, 1);
    saveSettings();
    startIntervalLoop();
  }
  res.json({ success: true });
});

app.post('/settings/add-autoreply', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { trigger, reply } = req.body;
  settings.autoReplies.push({ trigger, reply });
  saveSettings();
  res.json({ success: true });
});

app.post('/settings/delete-autoreply', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { index } = req.body;
  if (index >= 0 && index < settings.autoReplies.length) {
    settings.autoReplies.splice(index, 1);
    saveSettings();
  }
  res.json({ success: true });
});

app.post('/settings/add-shortcut', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { key, label, command } = req.body;
  settings.shortcuts.push({ key, label, command });
  saveSettings();
  res.json({ success: true });
});

app.post('/settings/delete-shortcut', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { index } = req.body;
  if (index >= 0 && index < settings.shortcuts.length) {
    settings.shortcuts.splice(index, 1);
    saveSettings();
  }
  res.json({ success: true });
});

app.post('/settings/save-notifications', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { ntfyTopic, ntfyToken, triggers } = req.body;
  settings.notifications.ntfyTopic = ntfyTopic;
  settings.notifications.ntfyToken = ntfyToken;
  settings.notifications.triggers = triggers;
  saveSettings();
  res.json({ success: true });
});

// TEST BİLDİRİMİ API'Sİ
app.post('/settings/test-notification', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  sendPushNotification(
    "Melonya Bot - Test",
    "Melonya botundan test bildirimi başarıyla telefona ulaştı! 🎉"
  );
  res.json({ success: true });
});

// --- PORT DİNLEME ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web sunucusu http://localhost:${PORT} adresinde başarıyla başlatıldı.`);
});


// --- TELEFONA ANLIK BİLDİRİM GÖNDERME (GÜVENLİ PLAIN TEXT / TOKEN DESTEKLİ) ---
function sendPushNotification(title, text) {
  if (!settings.notifications.enabled) return;
  
  const topic = settings.notifications.ntfyTopic.trim().replace(/\s+/g, '_');
  if (!topic) {
    console.error('[Bildirim] Hata: ntfy kanal adı boş!');
    return;
  }

  // Başlık ve mesajı doğrudan düz metin gövdesi yapıyoruz (curl -d simülasyonu)
  const fullMessage = `📢 ${title}\n\n${text}`;

  const headers = {
    'Content-Type': 'text/plain; charset=utf-8'
  };

  // Eğer kullanıcı panelden bir token kaydettiyse isteğe yetkilendirme ekle (Kota Çözümü)
  if (settings.notifications.ntfyToken && settings.notifications.ntfyToken.trim() !== "") {
    headers['Authorization'] = `Bearer ${settings.notifications.ntfyToken.trim()}`;
  }

  const options = {
    hostname: 'ntfy.sh',
    port: 443,
    path: `/${topic}`,
    method: 'POST',
    headers: headers
  };

  const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[Bildirim] Telefona bildirim başarıyla yollandı! Kanal: ${topic}`);
      } else {
        console.error(`[Bildirim] ntfy.sh Hatası (Kod: ${res.statusCode}):`, responseData);
      }
    });
  });

  req.on('error', (err) => {
    console.error('[Bildirim] HTTPS isteği başarısız oldu:', err.message);
  });

  req.write(Buffer.from(fullMessage, 'utf-8'));
  req.end();
}


// --- MINEFLAYER BOT MOTORU ---
function createBot() {
  console.log('Bot sunucuya bağlanıyor...');
  isConnected = false;
  bot = mineflayer.createBot(botOptions);

  bot.once('spawn', () => {
    isConnected = true;
    addChatToLog("SİSTEM", "Bot oyuna giriş yaptı!");
    console.log('Bot ilk lobiye adım attı. 4 saniye sonra şifre girilecek...');
    
    setTimeout(() => {
      if (isConnected) {
        bot.chat(`/giriş ${accountPassword}`);
        addChatToLog("SİSTEM", "Şifre girildi.");
        
        setTimeout(() => {
          if (isConnected) {
            bot.chat('/towny');
            addChatToLog("SİSTEM", "/towny komutu gönderildi.");
            startIntervalLoop();
          }
        }, 12000);
      }
    }, 4000);

    if (townyTimer) clearInterval(townyTimer);
    townyTimer = setInterval(() => {
      if (bot && isConnected) {
        bot.chat('/towny');
        addChatToLog("SİSTEM", "AFK koruma amacıyla /towny yenilendi.");
      }
    }, 30 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    if (!jsonMsg) return;
    const cleanMessage = jsonMsg.toString().trim();
    if (cleanMessage.length > 0) {
      console.log(`[Sohbet]: ${cleanMessage}`);
      
      let sender = "SUNUCU";
      let text = cleanMessage;

      if (cleanMessage.includes(' » ')) {
        const parts = cleanMessage.split(' » ');
        text = parts.slice(1).join(' » ');
        const senderPart = parts[0].trim();
        const words = senderPart.split(' ');
        sender = words[words.length - 1].replace(/[\[\]]/g, '');
      } else if (cleanMessage.includes(': ')) {
        const parts = cleanMessage.split(': ');
        text = parts.slice(1).join(': ');
        const senderPart = parts[0].trim();
        const words = senderPart.split(' ');
        sender = words[words.length - 1].replace(/[\[\]]/g, '');
      }

      if (sender === bot.username) return;

      addChatToLog(sender, text);

      // --- A. OTOMATİK CEVAP KONTROLÜ ---
      const cleanMessageLower = text.toLowerCase();
      for (const rule of settings.autoReplies) {
        if (cleanMessageLower.includes(rule.trigger.toLowerCase())) {
          addChatToLog("SİSTEM", `"${rule.trigger}" tetiklendi. Oto-cevap gönderiliyor.`);
          setTimeout(() => {
            if (bot && isConnected) {
              bot.chat(rule.reply);
              addChatToLog("SEN (Oto)", rule.reply);
            }
          }, 1500);
          break;
        }
      }

      // --- B. TELEFONA BİLDİRİM KONTROLÜ ---
      if (settings.notifications.enabled && settings.notifications.triggers.length > 0) {
        const hasTrigger = settings.notifications.triggers.some(trigger => 
          cleanMessageLower.includes(trigger.toLowerCase())
        );

        if (hasTrigger) {
          sendPushNotification(
            "Melonya AFK - Önemli Kelime!",
            `Oyuncu: ${sender}\nMesaj: ${text}`
          );
        }
      }
    }
  });

  bot.on('end', () => {
    isConnected = false;
    addChatToLog("SİSTEM", "Bağlantı kesildi! 15 saniye sonra tekrar denenecek.");
    if (townyTimer) clearInterval(townyTimer);
    if (intervalTimeout) clearTimeout(intervalTimeout);
    setTimeout(createBot, 15000);
  });

  bot.on('error', (err) => {
    isConnected = false;
    addChatToLog("SİSTEM", `HATA: ${err.message}`);
  });
}

process.on('uncaughtException', (err) => {
  console.error('Sistem Hatası:', err.message);
});

createBot();

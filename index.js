const mineflayer = require('mineflayer');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// --- GİZLİ ŞİFRE VE BOT AYARLARI ---
const botUsername = process.env.BOT_USERNAME || "RaNdOmBrOs_afk";
const accountPassword = process.env.BOT_PASSWORD || "123456"; // Panel Giriş Şifresi aynı zamanda oyundaki şifrenizdir.

const botOptions = {
  host: 'oyna.melonya.net',
  username: botUsername,
  version: '1.20.4'
};

let bot;
let townyTimer;
let isConnected = false;

// --- AYAR DOSYASI KONTROLÜ (PERSISTENCE) ---
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
let settings = {
  intervalMessages: [
    { text: "Aktif durumdayım! (Zaman Ayarlı)", waitMinutes: 3 },
    { text: "Melonya Towny AFK Botu devrede.", waitMinutes: 5 }
  ],
  autoReplies: {
    "selam": "Aleykum selam! Şu an AFK'yım, en kısa sürede döneceğim.",
    "aktif misin": "Evet, otomatik AFK botu aktif durumda."
  },
  notifications: {
    enabled: true,
    ntfyTopic: "melonya_afk_bot_ozel_kanal_" + Math.random().toString(36).substring(2, 8),
    triggers: ["acil", "neredesin", "baksana", "hey"]
  },
  shortcuts: [
    { key: "1", label: "Towny'ye Git", command: "/towny" },
    { key: "2", label: "Lobiye Dön", command: "/lobby" },
    { key: "3", label: "Aktiflik Kontrol", command: "Buradayım!" }
  ]
};

// Kayıtlı ayarları yükle
if (fs.existsSync(SETTINGS_PATH)) {
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    console.log("Ayarlar dosyası okunamadı, varsayılanlar yükleniyor.");
  }
} else {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// --- PERİYODİK MESAJ GÖNDERME DÖNGÜSÜ ---
let intervalIndex = 0;
let intervalTimeout = null;

function startIntervalLoop() {
  if (intervalTimeout) clearTimeout(intervalTimeout);

  function run() {
    if (!bot || !isConnected || settings.intervalMessages.length === 0) {
      intervalTimeout = setTimeout(run, 10000); // Bağlı değilse 10 sn sonra tekrar kontrol et
      return;
    }

    const current = settings.intervalMessages[intervalIndex];
    if (current) {
      bot.chat(current.text);
      console.log(`[Zamanlayıcı] Gönderilen: "${current.text}". ${current.waitMinutes} dk beklenecek.`);
      
      intervalIndex = (intervalIndex + 1) % settings.intervalMessages.length;
      intervalTimeout = setTimeout(run, current.waitMinutes * 60 * 1000);
    } else {
      intervalIndex = 0;
      intervalTimeout = setTimeout(run, 5000);
    }
  }
  run();
}

// --- OTOMATİK GİRİŞ VE PANEL DOĞRULAMA ---
function isAuthenticated(req) {
  return req.cookies && req.cookies.panel_token === accountPassword;
}

// --- WEB PANEL ARAYÜZÜ ---
app.get('/', (req, res) => {
  // 1. Cihaz hatırlama kontrolü: Eğer cookie yoksa Giriş Sayfasını göster
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
          .remember-container { display: flex; align-items: center; justify-content: start; font-size: 13px; color: #aaa; margin: 10px 0 20px 0; }
          .remember-container input { margin-right: 8px; }
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
            <div class="remember-container">
              <input type="checkbox" name="remember" id="remember" checked>
              <label for="remember">Cihazı Hatırla (30 Gün)</label>
            </div>
            <button type="submit">Giriş Yap</button>
          </form>
          ${req.query.error ? '<p class="error">Geçersiz şifre girdiniz!</p>' : ''}
        </div>
      </body>
      </html>
    `);
  }

  // 2. Başarılı Giriş Yapılmışsa Ana Paneli Göster
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
        .dashboard { width: 100%; max-width: 800px; }
        .card { background: #1e1e1e; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); margin-bottom: 20px; }
        h2, h3 { margin-top: 0; color: #4caf50; }
        .status { font-size: 18px; font-weight: bold; margin-bottom: 15px; }
        .flex-container { display: flex; gap: 15px; flex-wrap: wrap; }
        .flex-child { flex: 1; min-width: 280px; }
        input[type="text"], input[type="number"], textarea { width: 100%; padding: 10px; margin: 6px 0; border: 1px solid #333; background: #2a2a2a; color: #fff; border-radius: 6px; box-sizing: border-box; }
        button { padding: 10px 15px; background: #4caf50; border: none; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.2s; }
        button:hover { background: #45a049; }
        .btn-danger { background: #f44336; }
        .btn-danger:hover { background: #da190b; }
        .badge { background: #333; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px; }
        .toast { position: fixed; bottom: 20px; right: 20px; background: #4caf50; color: white; padding: 12px 24px; border-radius: 6px; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        .shortcut-btn { background: #2196f3; margin-right: 8px; margin-bottom: 8px; }
        .shortcut-btn:hover { background: #0b7dda; }
      </style>
    </head>
    <body>
      <div class="dashboard">
        <div class="card">
          <h2>Melonya AFK Yönetim Paneli</h2>
          <p>Aktif Bot: <strong>${botOptions.username}</strong></p>
          <div class="status">Sistem Durumu: ${statusText}</div>
          
          <div style="margin-top: 15px;">
            <input type="text" id="manualMessage" placeholder="Gönderilecek mesaj veya /komut..." style="width: 75%; display:inline-block;">
            <button onclick="sendManualMessage()" style="width: 22%; display:inline-block;">Gönder</button>
          </div>
        </div>

        <div class="card">
          <h3>Kullanıcı Kısayolları</h3>
          <p style="font-size: 12px; color: #aaa;">Panel açıkken klavyenizden aşağıdaki tuşlara basarak hızlıca komut gönderebilirsiniz:</p>
          <div id="shortcutsContainer">
            ${settings.shortcuts.map(s => `
              <button class="shortcut-btn" onclick="sendCustomMessage('${s.command}')">
                <span class="badge">[${s.key.toUpperCase()}]</span> ${s.label} (${s.command})
              </button>
            `).join('')}
          </div>
        </div>

        <div class="flex-container">
          <div class="card flex-child">
            <h3>⏰ Periyodik Mesaj Döngüsü</h3>
            <div id="intervalList" style="margin-bottom: 15px;">
              ${settings.intervalMessages.map((m, index) => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#2a2a2a; padding:8px; border-radius:6px; margin-bottom:5px;">
                  <span>"${m.text}" <small style="color:#aaa;">(${m.waitMinutes} dk)</small></span>
                  <button class="btn-danger" style="padding: 4px 8px; font-size:12px;" onclick="deleteInterval(${index})">Sil</button>
                </div>
              `).join('')}
            </div>
            <h4>Yeni Zaman Ayarlı Mesaj Ekle:</h4>
            <input type="text" id="newIntervalText" placeholder="Mesaj içeriği...">
            <input type="number" id="newIntervalMinutes" placeholder="Bekleme Süresi (Dakika)" value="3">
            <button onclick="addInterval()" style="width:100%;">Ekle ve Kaydet</button>
          </div>

          <div class="card flex-child">
            <h3>⚙️ Akıllı Dinleme & Bildirim</h3>
            
            <h4 style="margin-bottom:5px;">Telefona Bildirim (ntfy.sh)</h4>
            <p style="font-size:11px; color:#aaa; margin:0 0 10px 0;">Telefona ntfy uygulamasını kurup aşağıdaki kanala abone olursanız, tetikleyici kelimeler sohbette geçtiğinde telefonunuza anında bildirim düşer.</p>
            <label style="font-size:12px; color:#aaa;">Kanal Adı (ntfy.sh Topic):</label>
            <input type="text" id="ntfyTopic" value="${settings.notifications.ntfyTopic}">
            <input type="text" id="ntfyTriggers" value="${settings.notifications.triggers.join(', ')}" placeholder="Tetikleyiciler (virgülle ayırın)">
            
            <h4 style="margin-bottom:5px; margin-top:15px;">Otomatik Cevaplar</h4>
            <p style="font-size:11px; color:#aaa; margin:0 0 10px 0;">Sohbette anahtar kelime algılanınca botun vereceği otomatik cevapları JSON formatında düzenleyin:</p>
            <textarea id="autoRepliesText" rows="4" style="font-family:monospace; font-size:12px;">${JSON.stringify(settings.autoReplies, null, 2)}</textarea>
            
            <button onclick="saveAdvancedSettings()" style="width:100%; margin-top:10px;">Gelişmiş Ayarları Kaydet</button>
          </div>
        </div>
      </div>

      <div id="toast" class="toast">Mesaj başarıyla gönderildi!</div>

      <script>
        function showToast(msg) {
          const t = document.getElementById('toast');
          t.innerText = msg;
          t.style.display = 'block';
          setTimeout(() => { t.style.display = 'none'; }, 2500);
        }

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
              showToast("Mesaj gönderildi: " + msg);
            } else {
              showToast("Hata: " + data.message);
            }
          });
        }

        // Klavye Kısayolları Yakalama
        document.addEventListener('keydown', function(e) {
          // Eğer kullanıcı yazı kutularına bir şeyler yazıyorsa kısayol çalışmasın
          if(document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
          
          const shortcuts = ${JSON.stringify(settings.shortcuts)};
          const pressedKey = e.key.toLowerCase();
          const match = shortcuts.find(s => s.key.toLowerCase() === pressedKey);
          
          if(match) {
            e.preventDefault();
            sendCustomMessage(match.command);
          }
        });

        // Zaman Ayarlı Mesaj İşlemleri
        function addInterval() {
          const text = document.getElementById('newIntervalText').value;
          const waitMinutes = parseFloat(document.getElementById('newIntervalMinutes').value);
          if(!text || isNaN(waitMinutes)) return alert("Lütfen alanları doğru doldurun.");

          fetch('/settings/add-interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, waitMinutes })
          })
          .then(() => location.reload());
        }

        function deleteInterval(index) {
          fetch('/settings/delete-interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
          })
          .then(() => location.reload());
        }

        // Gelişmiş Ayarları Kaydetme
        function saveAdvancedSettings() {
          const ntfyTopic = document.getElementById('ntfyTopic').value;
          const triggers = document.getElementById('ntfyTriggers').value.split(',').map(x => x.trim());
          let autoReplies;
          try {
            autoReplies = JSON.parse(document.getElementById('autoRepliesText').value);
          } catch(e) {
            return alert("Otomatik Cevaplar geçerli bir JSON formatında olmalıdır!");
          }

          fetch('/settings/save-advanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ntfyTopic, triggers, autoReplies })
          })
          .then(r => r.json())
          .then(data => {
            if(data.success) {
              showToast("Ayarlar başarıyla kaydedildi!");
            }
          });
        }
      </script>
    </body>
    </html>
  `);
});

// --- GİRİŞ POST ROUTE ---
app.post('/login', (req, res) => {
  const { pin, remember } = req.body;
  if (pin === accountPassword) {
    if (remember === 'on') {
      // 30 günlük çerez tanımla
      res.cookie('panel_token', pin, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    } else {
      // Tarayıcı kapatılınca silinen çerez
      res.cookie('panel_token', pin, { httpOnly: true });
    }
    return res.redirect('/');
  }
  res.redirect('/?error=1');
});

// --- GÜVENLİ AJAX MESAJ GÖNDERME SİSTEMİ ---
app.post('/send-message-ajax', (req, res) => {
  if (!isAuthenticated(req)) return res.status(403).json({ success: false, message: "Yetkisiz erişim" });
  
  const { message } = req.body;
  if (!bot || !isConnected) {
    return res.json({ success: false, message: "Bot oyuna bağlı değil!" });
  }

  bot.chat(message);
  console.log(`[Web Panel] Gönderilen Komut: ${message}`);
  res.json({ success: true });
});

// --- AYAR DEĞİŞTİRME API'LERİ ---
app.post('/settings/add-interval', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { text, waitMinutes } = req.body;
  settings.intervalMessages.push({ text, waitMinutes });
  saveSettings();
  startIntervalLoop(); // Döngüyü yeni ayarlara göre tazele
  res.json({ success: true });
});

app.post('/settings/delete-interval', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { index } = req.body;
  if (index >= 0 && index < settings.intervalMessages.length) {
    settings.intervalMessages.splice(index, 1);
    saveSettings();
    startIntervalLoop(); // Döngüyü tazele
  }
  res.json({ success: true });
});

app.post('/settings/save-advanced', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { ntfyTopic, triggers, autoReplies } = req.body;
  
  settings.notifications.ntfyTopic = ntfyTopic;
  settings.notifications.triggers = triggers;
  settings.autoReplies = autoReplies;
  
  saveSettings();
  res.json({ success: true });
});


// --- PORT DİNLEME ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web sunucusu http://localhost:${PORT} adresinde başarıyla başlatıldı.`);
});


// --- TELEFONA ANLIK BİLDİRİM GÖNDERME (NTFY.SH) ---
async function sendPushNotification(title, text) {
  if (!settings.notifications.enabled) return;
  const topic = settings.notifications.ntfyTopic;
  const url = `https://ntfy.sh/${topic}`;

  try {
    await fetch(url, {
      method: 'POST',
      body: text,
      headers: {
        'Title': title,
        'Priority': 'high',
        'Tags': 'warning,bell'
      }
    });
    console.log(`[Bildirim] Telefona bildirim yollandı. Kanal (Topic): ${topic}`);
  } catch (err) {
    console.error('[Bildirim] Bildirim gönderilirken hata oluştu:', err.message);
  }
}


// --- MINEFLAYER BOT MOTORU ---
function createBot() {
  console.log('Bot sunucuya bağlanıyor...');
  isConnected = false;
  bot = mineflayer.createBot(botOptions);

  bot.once('spawn', () => {
    isConnected = true;
    console.log('Bot ilk lobiye adım attı. 4 saniye sonra şifre girilecek...');
    
    setTimeout(() => {
      if (isConnected) {
        bot.chat(`/giriş ${accountPassword}`);
        console.log('Giriş komutu gönderildi. Ana lobinin yüklenmesi bekleniyor...');
        
        setTimeout(() => {
          if (isConnected) {
            bot.chat('/towny');
            console.log('Bekleme süresi bitti. Ana lobiden geçiş için /towny komutu gönderildi.');
            startIntervalLoop(); // Lobi geçişinden sonra periyodik mesajları başlat
          }
        }, 12000);
      }
    }, 4000);

    if (townyTimer) clearInterval(townyTimer);
    townyTimer = setInterval(() => {
      if (bot && isConnected) {
        bot.chat('/towny');
        console.log('Zamanlayıcı: AFK kalmamak için /towny tekrarlandı.');
      }
    }, 30 * 60 * 1000);
  });

  // --- SOHBETİ VE TETİKLEYİCİLERİ DİNLEME ---
  bot.on('chat', (username, message) => {
    if (username === bot.username) return; // Botun kendi attığı mesajları yok say

    const cleanMessage = message.trim();
    const cleanMessageLower = cleanMessage.toLowerCase();
    console.log(`[Sunucu Sohbeti] ${username}: ${cleanMessage}`);

    // A. Otomatik Cevap Kontrolü
    for (const [trigger, reply] of Object.entries(settings.autoReplies)) {
      if (cleanMessageLower.includes(trigger.toLowerCase())) {
        console.log(`[Oto-Cevap] Tetikleyici algılandı: "${trigger}". Yanıt gönderiliyor...`);
        setTimeout(() => {
          if (bot && isConnected) {
            bot.chat(reply);
          }
        }, 1500); // İnsan taklidi için ufak bir gecikme süresi
        break;
      }
    }

    // B. Telefona Bildirim Gönderme Kontrolü
    if (settings.notifications.enabled) {
      const hasTrigger = settings.notifications.triggers.some(trigger => 
        cleanMessageLower.includes(trigger.toLowerCase())
      );

      if (hasTrigger) {
        sendPushNotification(
          "Melonya AFK - Önemli Kelime!",
          `Oyuncu: ${username}\nMesaj: ${cleanMessage}`
        );
      }
    }
  });

  bot.on('end', () => {
    isConnected = false;
    console.log('Botun sunucuyla bağlantısı kesildi. 15 saniye sonra tekrar denenecek...');
    if (townyTimer) clearInterval(townyTimer);
    if (intervalTimeout) clearTimeout(intervalTimeout);
    setTimeout(createBot, 15000);
  });

  bot.on('error', (err) => {
    isConnected = false;
    console.log('Mineflayer Hatası: ', err.message);
  });
}

process.on('uncaughtException', (err) => {
  console.error('Sistem Hatası:', err.message);
});

createBot();

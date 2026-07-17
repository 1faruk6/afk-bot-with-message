const mineflayer = require('mineflayer');
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// --- GİZLİ ŞİFRE VE BOT AYARLARI ---
const botUsername = process.env.BOT_USERNAME || "RaNdOmBrOs_afk";
const accountPassword = process.env.BOT_PASSWORD || "123456";

const botOptions = {
  host: 'oyna.melonya.net',
  username: botUsername,
  version: '1.20.4',
  checkTimeoutInterval: 60000,
  respawn: true
};

let bot;
let townyTimer;
let isConnected = false;
let chatLog = []; 
let reconnectTimeout = null; 

// --- AYAR DOSYASI KONTROLÜ ---
const STORAGE_DIR = path.join(__dirname, 'storage');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
const SETTINGS_PATH = path.join(STORAGE_DIR, 'settings.json');

let settings = { intervalMessages: [], autoReplies: [], shortcuts: [] };

if (fs.existsSync(SETTINGS_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    settings.intervalMessages = raw.intervalMessages || [];
    settings.autoReplies = raw.autoReplies || [];
    settings.shortcuts = raw.shortcuts || [];
  } catch (e) { console.log("Ayarlar dosyası okunamadı."); }
} else {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function saveSettings() { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); }

// --- SOCKET.IO GÜVENLİK (Cookie Kontrolü) ---
io.use((socket, next) => {
  const cookieHeader = socket.request.headers.cookie || '';
  if (cookieHeader.includes(`panel_token=${accountPassword}`)) {
    next();
  } else {
    next(new Error('Yetkisiz Socket Erişimi'));
  }
});

// --- PERİYODİK MESAJ ---
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
  const logData = { timestamp, sender, message };
  chatLog.push(logData);
  if (chatLog.length > 100) chatLog.shift();
  io.emit('newChat', logData); // Tüm panellere canlı olarak gönder
}

function isAuthenticated(req) {
  return req.cookies && req.cookies.panel_token === accountPassword;
}

// --- ENVANTERİ YAYINLA ---
function broadcastInventory() {
  if (!bot || !bot.inventory) return;
  // Minecraft'ta ana envanter slotları genelde 9 ile 44 arasındadır.
  const items = bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count,
    slot: item.slot
  }));
  io.emit('inventoryUpdate', items);
}

// --- WEB PANEL ARAYÜZÜ ---
app.get('/', (req, res) => {
  if (!isAuthenticated(req)) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Melonya Bot Panel Girişi</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-box { background: #1e1e1e; padding: 35px; border-radius: 12px; text-align: center; }
          input { width: 100%; padding: 12px; margin: 10px 0; background: #2a2a2a; color: #fff; border: 1px solid #333; }
          button { width: 100%; padding: 12px; background: #4caf50; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2>Panel Girişi</h2>
          <form action="/login" method="POST">
            <input type="password" name="pin" placeholder="Panel Şifresi" required>
            <button type="submit">Giriş Yap</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Melonya Bot Kontrol Paneli</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <script src="/socket.io/socket.io.js"></script>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #121212; color: #fff; margin: 0; padding: 20px; display: flex; justify-content: center; }
        .dashboard { width: 100%; max-width: 1200px; display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; }
        .column { display: flex; flex-direction: column; gap: 20px; }
        .card { background: #1e1e1e; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); position: relative; }
        h2, h3 { margin-top: 0; color: #4caf50; }
        
        /* Chat Stilleri */
        .chat-box { background: #151515; border: 1px solid #2a2a2a; border-radius: 8px; height: 300px; overflow-y: auto; padding: 15px; font-family: 'Consolas', monospace; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
        .chat-msg { border-bottom: 1px solid #1f1f1f; padding-bottom: 4px; line-height: 1.4; }
        .chat-sender { color: #ff9800; font-weight: bold; margin-right: 5px; }
        .chat-sender.system { color: #00bcd4; }
        
        /* Etkileşimli Chat Butonu Stili */
        .interactive-cmd { color: #00e5ff; background: rgba(0, 229, 255, 0.1); padding: 2px 5px; border-radius: 4px; cursor: pointer; text-decoration: underline; display: inline-block; transition: 0.2s;}
        .interactive-cmd:hover { background: rgba(0, 229, 255, 0.3); color: #fff; }

        input, button { padding: 10px; margin: 6px 0; border: 1px solid #333; background: #2a2a2a; color: #fff; border-radius: 6px; }
        button { background: #4caf50; cursor: pointer; border: none; font-weight: bold; }
        button:hover { background: #45a049; }
        .btn-danger { background: #f44336; }
        .btn-danger:hover { background: #da190b; }
        
        /* Envanter Sistemi Stilleri */
        .inv-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; margin-top: 15px; }
        .inv-slot { background: #2a2a2a; border: 2px solid #333; height: 45px; display: flex; justify-content: center; align-items: center; cursor: pointer; position: relative; font-size: 11px; text-align: center; border-radius: 4px; transition: 0.2s;}
        .inv-slot:hover { border-color: #4caf50; background: #333;}
        .inv-slot.empty { opacity: 0.3; cursor: default; }
        .inv-count { position: absolute; bottom: 2px; right: 4px; color: #ffeb3b; font-weight: bold; font-size: 12px;}
        
        .action-menu { display: none; background: #2a2a2a; border: 1px solid #444; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        .action-menu h4 { margin: 0 0 10px 0; color: #ff9800; }
        .action-menu button { width: 48%; margin: 1%; }

        @media (max-width: 850px) { .dashboard { grid-template-columns: 1fr; } }
      </style>
    </head>
    <body>
      <div class="dashboard">
        
        <div class="column">
          <!-- Chat Kartı -->
          <div class="card" style="flex: 1; display: flex; flex-direction: column;">
            <h2>Melonya Canlı Sohbet</h2>
            <div id="chatBox" class="chat-box"></div>
            <div style="margin-top: 15px; display: flex; gap: 8px;">
              <input type="text" id="manualMessage" placeholder="Mesaj veya komut (Örn: /towny)" style="margin:0; flex: 1;">
              <button onclick="sendManualMessage()">Gönder</button>
            </div>
          </div>

          <!-- Canlı Envanter Kartı -->
          <div class="card">
            <h3>🎒 Canlı Envanter</h3>
            <p style="font-size: 12px; color: #aaa; margin-top: -8px;">İşlem yapmak istediğiniz eşyanın üzerine tıklayın.</p>
            
            <div id="inventoryGrid" class="inv-grid"></div>
            
            <div id="actionMenu" class="action-menu">
              <h4 id="selectedItemName">Seçili Eşya</h4>
              <button onclick="executeInvAction('equip')" style="background: #2196f3;">Eline Al</button>
              <button onclick="executeInvAction('drop')" class="btn-danger">Yere At</button>
              <button onclick="document.getElementById('actionMenu').style.display='none'" style="background: #555; width: 98%;">İptal</button>
            </div>
          </div>
        </div>

        <div class="column">
          <!-- Ayarlar / Döngüler Kartı -->
          <div class="card">
            <h3>⏰ Periyodik Mesajlar</h3>
            <input type="text" id="newIntervalText" placeholder="Mesaj...">
            <input type="number" id="newIntervalMinutes" placeholder="Dakika?">
            <button onclick="addInterval()" style="width:100%;">Ekle</button>
          </div>
          
          <div class="card">
            <h3>🤖 Otomatik Cevaplar</h3>
            <input type="text" id="newTrigger" placeholder="Tetikleyici...">
            <input type="text" id="newReply" placeholder="Cevap...">
            <button onclick="addAutoReply()" style="width:100%;">Ekle</button>
          </div>
        </div>

      </div>

      <script>
        const socket = io();
        let selectedSlot = null;

        // --- CANLI SOHBET SİSTEMİ (SOCKET) ---
        const chatBox = document.getElementById('chatBox');
        
        function formatInteractive(msg) {
          // "/" ile başlayan metinleri (komutları) tıklanabilir bir butona çevirir
          return msg.replace(/(\\/\\S+)/g, '<span class="interactive-cmd" title="Bu komutu oyunda çalıştırmak için tıkla" onclick="sendCustomMessage(\\'$1\\')">$1</span>');
        }

        function appendChat(log) {
          const isSystem = log.sender === 'SİSTEM';
          const div = document.createElement('div');
          div.className = 'chat-msg';
          
          const formattedMessage = formatInteractive(log.message);
          
          div.innerHTML = \`
            <span style="color:#666">[\${log.timestamp}]</span>
            <span class="chat-sender \${isSystem ? 'system' : ''}">\${log.sender}:</span>
            <span style="color:#e0e0e0">\${formattedMessage}</span>
          \`;
          chatBox.appendChild(div);
          chatBox.scrollTop = chatBox.scrollHeight;
        }

        // Geçmişi yükle ve yeni mesajları dinle
        fetch('/api/chat').then(r => r.json()).then(logs => {
          chatBox.innerHTML = '';
          logs.forEach(appendChat);
        });

        socket.on('newChat', (log) => {
          appendChat(log);
        });

        // --- ENVANTER SİSTEMİ (SOCKET) ---
        socket.on('inventoryUpdate', (items) => {
          const grid = document.getElementById('inventoryGrid');
          grid.innerHTML = '';
          
          // Minecraft çantası 36 slottur (9'dan 44'e kadar indekslenir)
          for(let i = 9; i <= 44; i++) {
            const item = items.find(it => it.slot === i);
            const slotDiv = document.createElement('div');
            
            if(item) {
              slotDiv.className = 'inv-slot';
              // Eşya ismini kısaltarak göster
              const shortName = item.name.replace('minecraft:', '').replace(/_/g, ' ');
              slotDiv.innerHTML = \`<span style="word-break: break-all;">\${shortName}</span><span class="inv-count">\${item.count}</span>\`;
              slotDiv.onclick = () => openActionMenu(item.slot, shortName, item.count);
            } else {
              slotDiv.className = 'inv-slot empty';
            }
            grid.appendChild(slotDiv);
          }
        });

        function openActionMenu(slot, name, count) {
          selectedSlot = slot;
          document.getElementById('selectedItemName').innerText = \`\${count}x \${name.toUpperCase()}\`;
          document.getElementById('actionMenu').style.display = 'block';
        }

        function executeInvAction(action) {
          if (selectedSlot !== null) {
            socket.emit('inventoryAction', { action: action, slot: selectedSlot });
            document.getElementById('actionMenu').style.display = 'none';
          }
        }

        // --- MESAJ GÖNDERME ---
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
          });
        }

        // Diğer ayar API fonksiyonları (Kısaltıldı, eski sistemin aynısı eklenebilir)
        function addInterval() { /* ... Eski kodundaki gibi ... */ }
        function addAutoReply() { /* ... Eski kodundaki gibi ... */ }
      </script>
    </body>
    </html>
  `);
});

app.get('/api/chat', (req, res) => res.json(chatLog));

app.post('/login', (req, res) => {
  const { pin } = req.body;
  if (pin === accountPassword) {
    res.cookie('panel_token', pin, { maxAge: 30*24*60*60*1000, httpOnly: true });
    return res.redirect('/');
  }
  res.redirect('/?error=1');
});

app.post('/send-message-ajax', (req, res) => {
  if (!isAuthenticated(req)) return res.sendStatus(403);
  const { message } = req.body;
  if (bot && isConnected) {
    bot.chat(message);
    addChatToLog("SEN (Panel)", message);
  }
  res.json({ success: true });
});

// --- SOCKET.IO ENVANTER DİNLEME ---
io.on('connection', (socket) => {
  socket.on('inventoryAction', async (data) => {
    if (!bot || !isConnected) return;
    try {
      const item = bot.inventory.slots[data.slot];
      if (!item) return;

      if (data.action === 'drop') {
        await bot.toss(item.type, item.metadata, item.count);
        addChatToLog("SİSTEM", `Envanterden atıldı: ${item.name}`);
      } else if (data.action === 'equip') {
        await bot.equip(item, 'hand');
        addChatToLog("SİSTEM", `Ele alındı: ${item.name}`);
      }
    } catch (e) {
      console.log("Envanter işlem hatası:", e);
    }
  });
});

function triggerReconnect() {
  if (reconnectTimeout) return;
  isConnected = false;
  addChatToLog("SİSTEM", "Bağlantı koptu. 10 sn sonra yeniden denenecek.");
  if (townyTimer) clearInterval(townyTimer);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    createBot();
  }, 10000);
}

function createBot() {
  isConnected = false;
  bot = mineflayer.createBot(botOptions);

  bot.once('spawn', () => {
    isConnected = true;
    addChatToLog("SİSTEM", "Bot oyuna girdi!");
    
    // Envanter her değiştiğinde (eşya geldiğinde/gittiğinde) siteyi güncelle
    bot.inventory.on('updateSlot', () => {
      broadcastInventory();
    });
    // İlk girişte envanteri yolla
    setTimeout(broadcastInventory, 2000);
    
    setTimeout(() => {
      if (isConnected) {
        bot.chat(`/giriş ${accountPassword}`);
        setTimeout(() => { if (isConnected) { bot.chat('/towny'); startIntervalLoop(); } }, 12000);
      }
    }, 4000);

    if (townyTimer) clearInterval(townyTimer);
    townyTimer = setInterval(() => {
      if (bot && isConnected) bot.chat('/towny');
    }, 30 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    if (!jsonMsg) return;
    const cleanMessage = jsonMsg.toString().trim();
    if (cleanMessage.length > 0) {
      let sender = "SUNUCU";
      let text = cleanMessage;

      if (cleanMessage.includes(' » ')) {
        const parts = cleanMessage.split(' » ');
        text = parts.slice(1).join(' » ');
        sender = parts[0].trim().split(' ').pop().replace(/[\[\]]/g, '');
      } else if (cleanMessage.includes(': ')) {
        const parts = cleanMessage.split(': ');
        text = parts.slice(1).join(': ');
        sender = parts[0].trim().split(' ').pop().replace(/[\[\]]/g, '');
      }

      if (sender === bot.username) return;
      addChatToLog(sender, text);

      for (const rule of settings.autoReplies) {
        if (text.toLowerCase().includes(rule.trigger.toLowerCase())) {
          setTimeout(() => { if (bot && isConnected) { bot.chat(rule.reply); addChatToLog("SEN (Oto)", rule.reply); } }, 1500);
          break;
        }
      }
    }
  });

  bot.on('end', triggerReconnect);
  bot.on('error', triggerReconnect);
}

const PORT = process.env.PORT || 3000;
// HTTP Sunucusunu (Socket destekli) başlatıyoruz:
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} başlatıldı.`));

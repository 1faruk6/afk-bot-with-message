const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: true }));

// --- MINECRAFT BOT AYARLARI ---
// Kullanıcı adı ve şifre artık tamamen gizli (Environment Variables) olarak çekiliyor.
const botUsername = process.env.BOT_USERNAME || "RaNdOmBrOs_afk";
const accountPassword = process.env.BOT_PASSWORD || "123456"; 

const botOptions = {
  host: 'oyna.melonya.net',
  username: botUsername,
  version: '1.20.4'
};

let bot;
let townyTimer;
let isConnected = false;

// --- WEB KONTROL PANELI ARAYÜZÜ ---
app.get('/', (req, res) => {
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { background: #1e1e1e; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); width: 100%; max-width: 360px; text-align: center; }
        h2 { margin-top: 0; color: #4caf50; font-size: 24px; }
        p { color: #aaa; font-size: 14px; margin-bottom: 15px; }
        .status { font-size: 16px; font-weight: bold; margin-bottom: 20px; }
        input[type="text"], input[type="password"] { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #333; background: #2a2a2a; color: #fff; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
        input:focus { border-color: #4caf50; outline: none; }
        button { width: 100%; padding: 12px; background: #4caf50; border: none; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 10px; transition: background 0.2s; }
        button:hover { background: #45a049; }
        .btn-towny { background: #ff9800; margin-top: 15px; }
        .btn-towny:hover { background: #e68a00; }
        .footer { font-size: 11px; color: #555; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Melonya AFK Paneli</h2>
        <p>Bot Adı: <strong>${botOptions.username}</strong></p>
        <div class="status">Durum: ${statusText}</div>
        
        <form action="/send-message" method="POST">
          <input type="text" name="message" placeholder="Gönderilecek mesaj veya /komut..." required autocomplete="off">
          <input type="password" name="pin" placeholder="Panel Giriş Şifresi" required>
          <button type="submit">Oyuna Gönder</button>
        </form>

        <form action="/send-message" method="POST">
          <input type="hidden" name="message" value="/towny">
          <input type="password" name="pin" placeholder="Panel Şifresi ile Doğrula" required>
          <button type="submit" class="btn-towny">⚡ Botu Towny'ye Işınla (/towny)</button>
        </form>

        <div class="footer">${botOptions.username} Uzaktan Yönetim Sistemi</div>
      </div>
    </body>
    </html>
  `);
});

app.post('/send-message', (req, res) => {
  const { message, pin } = req.body;

  if (pin !== accountPassword) {
    return res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px; background:#121212; color:#fff; height:100vh; padding-top:50px;"><h3 style="color:red;">Hata: Yanlış Panel Şifresi!</h3><a href="/" style="color:#4caf50; text-decoration:none; font-weight:bold;">Geri Dön</a></div>`);
  }

  if (!bot || !isConnected) {
    return res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px; background:#121212; color:#fff; height:100vh; padding-top:50px;"><h3 style="color:orange;">Hata: Bot şu anda oyuna bağlı değil!</h3><a href="/" style="color:#4caf50; text-decoration:none; font-weight:bold;">Geri Dön</a></div>`);
  }

  bot.chat(message);
  console.log(`[Web Panel] Gönderilen Komut: ${message}`);

  res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px; background:#121212; color:#fff; height:100vh; padding-top:50px;"><h3 style="color:#4caf50;">Başarıyla Gönderildi!</h3><p>Komut: <b>${message}</b></p><a href="/" style="color:#4caf50; text-decoration:none; font-weight:bold;">Geri Dön</a></div>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`);
});

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

  bot.on('message', (jsonMsg) => {
    const cleanMessage = jsonMsg.toString().trim();
    if (cleanMessage.length > 0) {
      console.log(`[Sunucu Sohbeti]: ${cleanMessage}`);
    }
  });

  bot.on('end', () => {
    isConnected = false;
    console.log('Botun sunucuyla bağlantısı kesildi. 15 saniye sonra tekrar denenecek...');
    if (townyTimer) clearInterval(townyTimer);
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

const mineflayer = require('mineflayer');
const firebase = require('firebase/app');
require('firebase/database');

// Firebase Bağlantı Kurulumu
const firebaseConfig = {
    databaseURL: process.env.FIREBASE_URL // Termux'tan göndereceğimiz adres
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Minecraft Sunucu Ayarları
const MC_HOST = process.env.MC_HOST || 'play.melonya.net';
const MC_PORT = parseInt(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.20.4';
const MC_AUTH = process.env.MC_AUTH || 'offline'; 

let bot;

function createMcBot() {
    console.log('🔄 Minecraft botu başlatılıyor...');
    sendToApp('🔄 **Minecraft botu başlatılıyor...**');

    bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: process.env.BOT_USERNAME,
        auth: MC_AUTH,
        version: MC_VERSION
    });

    bot.on('spawn', () => {
        console.log('✅ Bot sunucuya giriş yaptı!');
        sendToApp('✅ **Minecraft botu sunucuya girdi!**');

        // Otomatik Giriş Şifresi
        if (process.env.BOT_PASSWORD) {
            setTimeout(() => {
                bot.chat(`/login ${process.env.BOT_PASSWORD}`);
                sendToApp('🔑 **Otomatik giriş yapıldı (/login [şifre]).**');
            }, 2000);
        }
    });

    // Oyundaki chat mesajlarını Firebase veritabanına gönderir (Uygulamaya akması için)
    bot.on('chat', (username, message) => {
        if (username === bot.username) return; // Kendi yazdıklarını göndermesin
        sendToApp(`💬 [${username}]: ${message}`);
    });

    bot.on('kick', (reason) => {
        sendToApp(`⚠️ **Bot oyundan atıldı!** Sebep: ${reason}`);
    });

    bot.on('end', () => {
        sendToApp('❌ **Bağlantı kesildi.** 15 saniye sonra tekrar bağlanacak...');
        setTimeout(createMcBot, 15000);
    });

    bot.on('error', (err) => {
        console.error('Bot hatası:', err);
    });
}

// Uygulamaya (Firebase'e) Veri Gönderme Fonksiyonu
function sendToApp(message) {
    db.ref('chat').set(message);
}

// Uygulamadan (Firebase'den) Gelen Komutları Dinleme
let firstLoad = true;
db.ref('command').on('value', (snapshot) => {
    if (firstLoad) {
        firstLoad = false;
        return; // İlk açılıştaki eski komutları göndermemesi için pas geçiyoruz
    }

    const cmd = snapshot.val();
    if (cmd && cmd !== '') {
        if (bot && bot.entity) {
            bot.chat(cmd); // Komutu oyuna gönderir
            console.log(`📤 Uygulamadan gelen mesaj oyuna gönderildi: ${cmd}`);
        }
        // Komut çalıştıktan sonra Firebase'deki komut kutusunu temizler
        db.ref('command').set('');
    }
});

// Botu Tetikle
createMcBot();

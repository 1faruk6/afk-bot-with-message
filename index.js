const mineflayer = require('mineflayer');

// Sunucu Bilgileri
const MC_HOST = 'play.melonya.net';
const MC_PORT = 25565;
const MC_VERSION = '1.20.4';
const MC_USERNAME = process.env.BOT_USERNAME;
const MC_PASSWORD = process.env.BOT_PASSWORD;

let bot;

function createBot() {
    console.log('🔄 Minecraft botu sunucuya bağlanıyor...');
    
    bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: MC_USERNAME,
        auth: 'offline', // Cracked (orijinal olmayan) giriş modu
        version: MC_VERSION
    });

    bot.on('spawn', () => {
        console.log('✅ Bot sunucuya başarıyla giriş yaptı!');
        
        // Sunucu içi otomatik giriş şifresi (/login [şifreniz])
        if (MC_PASSWORD) {
            setTimeout(() => {
                bot.chat(`/login ${MC_PASSWORD}`);
                console.log('🔑 Giriş şifresi otomatik olarak girildi.');
            }, 3000); // Oyuna girdikten 3 saniye sonra yazar
        }

        // Anti-AFK: Sunucudan hareketsizlik nedeniyle atılmamak için her 30 saniyede bir hafifçe kafasını oynatır
        setInterval(() => {
            if (bot && bot.entity) {
                const currentYaw = bot.entity.yaw;
                const currentPitch = bot.entity.pitch;
                // Kafayı hafifçe sağa çevir
                bot.look(currentYaw + 0.3, currentPitch);
            }
        }, 30000);
    });

    bot.on('kick', (reason) => {
        console.log(`⚠️ Bot oyundan atıldı! Sebep:\n${reason}`);
    });

    bot.on('end', () => {
        console.log('❌ Bağlantı kesildi. 15 saniye sonra otomatik olarak tekrar bağlanmayı deneyeceğim...');
        setTimeout(createBot, 15000);
    });

    bot.on('error', (err) => {
        console.error('🔴 Bot hatası:', err);
    });
}

// Sistemi Başlat
createBot();

const mineflayer = require('mineflayer');

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
        auth: 'offline', 
        version: MC_VERSION
    });

    bot.on('spawn', () => {
        console.log('✅ Bot sunucuya giriş yaptı!');

        // 1. Giriş yapma (3. saniye)
        if (MC_PASSWORD) {
            setTimeout(() => {
                bot.chat(`/login ${MC_PASSWORD}`);
                console.log('🔑 Giriş şifresi yazıldı.');
            }, 3000);
        }

        // 2. 15 saniye sonra ilk /towny komutu (3sn login + 15sn = 18. saniye)
        setTimeout(() => {
            bot.chat('/towny');
            console.log('📍 İlk /towny komutu gönderildi.');
        }, 18000);

        // 3. Her 10 dakikada bir /towny komutu (10 dakika = 600.000 ms)
        setInterval(() => {
            bot.chat('/towny');
            console.log('⏲️ 10 dakika doldu, /towny yazıldı.');
        }, 600000);

        // Anti-AFK (Sunucudan atılmamak için 5 dakikada bir kafayı oynat)
        setInterval(() => {
            if (bot && bot.entity) {
                bot.look(bot.entity.yaw + 0.5, bot.entity.pitch);
            }
        }, 300000);
    });

    bot.on('kick', (reason) => {
        console.log(`⚠️ Bot atıldı! Sebep: ${reason}`);
    });

    bot.on('end', () => {
        console.log('❌ Bağlantı kesildi. 15 saniye sonra tekrar denenecek...');
        setTimeout(createBot, 15000);
    });

    bot.on('error', (err) => {
        console.error('🔴 Bot hatası:', err);
    });
}

createBot();

const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// Discord İstemcisi ve Yetkileri
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Ayarlar (Environment Variables)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const MC_HOST = process.env.MC_HOST || 'melonya.net';
const MC_PORT = parseInt(process.env.MC_PORT) || 25565;
const MC_VERSION = process.env.MC_VERSION || '1.20.4';
const MC_AUTH = process.env.MC_AUTH || 'offline'; // VARSAYILAN ARTIK OFFLINE (CRACKED)

let bot;

// Discord Botunun Durumunu Güncelleyen Yardımcı Fonksiyon
function setBotPresence(statusText, isOnline = true) {
    if (!client.user) return;
    
    client.user.setPresence({
        activities: [{
            name: statusText,
            type: ActivityType.Playing
        }],
        status: isOnline ? 'online' : 'dnd'
    });
}

// Minecraft Botunu Başlatma Fonksiyonu
function createMcBot() {
    setBotPresence('Bağlanıyor... 🔄', false);
    sendToDiscord('🔄 **Minecraft botu başlatılıyor...**');

    bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: process.env.BOT_USERNAME,
        auth: MC_AUTH, // Şifreyi sunucu içinde chatten göndereceğimiz için burası artık boş
        version: MC_VERSION
    });

    bot.on('spawn', () => {
        sendToDiscord('✅ **Minecraft botu sunucuya başarıyla giriş yaptı!**');
        setBotPresence('Melonya.net | Oyunda 🟢', true);

        // Sunucu içi otomatik şifre girme (/login [şifreniz])
        if (process.env.BOT_PASSWORD) {
            setTimeout(() => {
                bot.chat(`/login ${process.env.BOT_PASSWORD}`);
                sendToDiscord('🔑 **Sunucu içi otomatik giriş yapıldı (/login [şifre]).**');
            }, 2000); // Girdikten 2 saniye sonra şifreyi otomatik yazar
        }
    });

    // Oyundaki sohbeti (Chat) Discord kanalına yönlendirir
    bot.on('chat', (username, message) => {
        if (username === bot.username) return; // Kendi yazdığı mesajları Discord'a tekrar atmasın
        sendToDiscord(`💬 **[MC] ${username}:** ${message}`);
    });

    bot.on('kick', (reason) => {
        sendToDiscord(`⚠️ **Bot oyundan atıldı!** Sebep:\n\`\`\`${reason}\`\`\``);
        setBotPresence('Oyundan Atıldı ⚠️', false);
    });

    bot.on('end', () => {
        sendToDiscord('❌ **Bağlantı kesildi.** 15 saniye sonra otomatik olarak tekrar bağlanmayı deneyeceğim...');
        setBotPresence('Bağlantı Kesildi 🔴', false);
        setTimeout(createMcBot, 15000);
    });

    bot.on('error', (err) => {
        console.error('Bot hatası:', err);
    });
}

// Belirlenen Kanala Mesaj Gönderme
function sendToDiscord(message) {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
        channel.send(message).catch(err => console.error('Discord mesaj hatası:', err));
    }
}

// Discord Botu Hazır Olduğunda Minecraft'a Bağlan
client.on('ready', () => {
    console.log(`Discord Botu aktif: ${client.user.tag}`);
    createMcBot();
});

// Discord'dan Gelen Komutları Dinleme
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;

    // !yaz [mesaj] komutu: Oyunda sohbetten yazı gönderir
    if (message.content.startsWith('!yaz ')) {
        const mcMessage = message.content.slice(5);
        if (bot && bot.entity) {
            bot.chat(mcMessage);
            message.reply(`📤 Oyunda yazıldı: *"${mcMessage}"*`);
        } else {
            message.reply('❌ Minecraft botu şu an oyuna bağlı değil!');
        }
    }
});

client.login(DISCORD_TOKEN);

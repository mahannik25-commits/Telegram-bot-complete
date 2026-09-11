require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const qr = require('qrcode');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const fs = require('fs');
const path = require('path');

// ==================== تنظیمات ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    throw new Error('❌ توکن ربات پیدا نشد!');
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 10000;

ffmpeg.setFfmpegPath(ffmpegStatic);

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

const SUPPORT_ID = '@botboshtibani';
const userSessions = new Map();

// ==================== وب‌سرور برای Render ====================
app.get('/', (req, res) => {
    res.send('🤖 ربات فعال است!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 وب‌سرور روی پورت ${PORT} روشن شد.`);
});

// ==================== منوی اصلی ====================
function mainMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🎬 دانلود ویدیو', 'video'), Markup.button.callback('🎵 دانلود صدا', 'audio')],
        [Markup.button.callback('🔄 تبدیل فرمت', 'convert_format')],
        [Markup.button.callback('🖼️ حذف لوکیشن عکس', 'remove_metadata')],
        [Markup.button.callback('📱 ساخت QR', 'create_qr'), Markup.button.callback('📷 خواندن QR', 'read_qr')],
        [Markup.button.callback('📊 تبدیل واحد', 'convert_units')],
        [Markup.button.callback('💬 پشتیبانی', 'support'), Markup.button.callback('📝 بازخورد', 'feedback'), Markup.button.callback('🐛 گزارش خطا', 'report_bug')]
    ]);
}

// ==================== شروع ====================
bot.start((ctx) => {
    ctx.reply('🎯 به ربات همه‌کاره خوش اومدی!\n\n📌 (برای استفاده از مینی اپ به فیلترشکن وصل شو وگرنه کار نمیکنه)یکی از گزینه‌ها رو انتخاب کن:', mainMenu());
});

// ==================== مدیریت دکمه‌ها ====================
bot.action('video', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'video' });
    ctx.reply('📎 لینک یوتیوب رو بفرست:');
});

bot.action('audio', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'audio' });
    ctx.reply('📎 لینک یوتیوب رو بفرست:');
});

bot.action('convert_format', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert_format' });
    ctx.reply('🔄 فایل رو بفرست.');
});

bot.action('remove_metadata', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'remove_metadata' });
    ctx.reply('🖼️ عکس رو بفرست تا لوکیشنش رو پاک کنم.');
});

bot.action('create_qr', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'create_qr' });
    ctx.reply('📱 لینک یا متنی که می‌خوای QR بشه رو بفرست.');
});

bot.action('read_qr', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'read_qr' });
    ctx.reply('📷 عکس QR کد رو بفرست.');
});

bot.action('convert_units', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert_units' });
    ctx.reply('📊 مثال: 10 کیلوگرم به گرم');
});

bot.action(['support', 'feedback', 'report_bug'], (ctx) => {
    ctx.reply(`💬 آیدی پشتیبانی:\n${SUPPORT_ID}`);
    userSessions.delete(ctx.from.id);
});

// ==================== دانلود از یوتیوب ====================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    if (text.startsWith('http') && (session.mode === 'video' || session.mode === 'audio')) {
        const isAudio = session.mode === 'audio';
        const statusMsg = await ctx.reply(`⏳ در حال دریافت ${isAudio ? 'صدا' : 'ویدیو'}...`);

        try {
            const outputPath = path.join(DOWNLOAD_DIR, `${isAudio ? 'audio' : 'video'}_${userId}.${isAudio ? 'mp3' : 'mp4'}`);

            if (isAudio) {
                const audioStream = ytdl(text, { filter: 'audioonly', quality: 'highestaudio' });
                await new Promise((resolve, reject) => {
                    ffmpeg(audioStream)
                        .audioBitrate(192)
                        .toFormat('mp3')
                        .on('end', resolve)
                        .on('error', reject)
                        .save(outputPath);
                });
                await ctx.replyWithAudio({ source: outputPath });
            } else {
                const videoPath = path.join(DOWNLOAD_DIR, `video_temp_${userId}.mp4`);
                const audioPath = path.join(DOWNLOAD_DIR, `audio_temp_${userId}.mp4`);

                const videoStream = ytdl(text, { filter: 'videoonly', quality: 'highestvideo' });
                const audioStream = ytdl(text, { filter: 'audioonly', quality: 'highestaudio' });

                await new Promise((resolve, reject) => {
                    videoStream.pipe(fs.createWriteStream(videoPath)).on('finish', resolve).on('error', reject);
                });
                await new Promise((resolve, reject) => {
                    audioStream.pipe(fs.createWriteStream(audioPath)).on('finish', resolve).on('error', reject);
                });

                await new Promise((resolve, reject) => {
                    ffmpeg()
                        .input(videoPath)
                        .input(audioPath)
                        .outputOptions(['-c:v copy', '-c:a aac'])
                        .on('end', resolve)
                        .on('error', reject)
                        .save(outputPath);
                });

                fs.unlinkSync(videoPath);
                fs.unlinkSync(audioPath);
                await ctx.replyWithVideo({ source: outputPath });
            }

            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            userSessions.delete(userId);
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

        } catch (error) {
            console.error('Download Error:', error);
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ خطا: ${error.message.substring(0, 200)}`);
            userSessions.delete(userId);
        }
        return;
    }

    // --- ساخت QR ---
    if (session.mode === 'create_qr') {
        try {
            const buffer = await qr.toBuffer(text);
            await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ QR کد ساخته شد!' });
        } catch (error) {
            await ctx.reply('❌ خطا در ساخت QR.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- تبدیل واحد ---
    if (session.mode === 'convert_units') {
        const lower = text.toLowerCase();
        try {
            const match = lower.match(/(\d+(\.\d+)?)/);
            if (!match) throw new Error('عدد پیدا نشد');
            const num = parseFloat(match[1]);

            if (lower.includes('کیلوگرم') && lower.includes('گرم')) {
                await ctx.reply(`📊 ${num} کیلوگرم = ${num * 1000} گرم`);
            } else if (lower.includes('متر') && lower.includes('سانتی‌متر')) {
                await ctx.reply(`📊 ${num} متر = ${num * 100} سانتی‌متر`);
            } else if (lower.includes('کیلومتر') && lower.includes('متر')) {
                await ctx.reply(`📊 ${num} کیلومتر = ${num * 1000} متر`);
            } else {
                await ctx.reply('📊 مثال: 10 کیلوگرم به گرم');
            }
        } catch {
            await ctx.reply('📊 فرمت رو درست وارد کن.');
        }
        userSessions.delete(userId);
        return;
    }
});

// ==================== مدیریت فایل‌ها و عکس‌ها ====================
bot.on(['photo', 'document', 'video', 'audio'], async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    // --- حذف لوکیشن عکس ---
    if (session.mode === 'remove_metadata' && ctx.message.photo) {
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const image = await Jimp.read(fileLink.href);
            const buffer = await image.quality(95).getBufferAsync(Jimp.MIME_JPEG);
            await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ لوکیشن و اطلاعات عکس حذف شد!' });
        } catch (error) {
            console.error(error);
            await ctx.reply('❌ خطا در پردازش عکس.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- خواندن QR ---
    if (session.mode === 'read_qr' && ctx.message.photo) {
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const image = await Jimp.read(fileLink.href);
            const imageData = {
                data: new Uint8ClampedArray(image.bitmap.data),
                width: image.bitmap.width,
                height: image.bitmap.height
            };
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code) {
                await ctx.reply(`📷 متن QR:\n${code.data}`);
            } else {
                await ctx.reply('❌ QR کد تشخیص داده نشد.');
            }
        } catch (error) {
            console.error(error);
            await ctx.reply('❌ خطا در خواندن QR.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- تبدیل فرمت (دریافت فایل) ---
    if (session.mode === 'convert_format') {
        const fileId = ctx.message.document?.file_id || ctx.message.video?.file_id || ctx.message.audio?.file_id || (ctx.message.photo && ctx.message.photo[ctx.message.photo.length - 1].file_id);
        if (!fileId) {
            return ctx.reply('❌ فایل پشتیبانی نمی‌شه.');
        }
        userSessions.set(userId, { ...session, fileId: fileId });
        await ctx.reply('✅ فایل دریافت شد. فرمت مورد نظر رو انتخاب کن:', Markup.inlineKeyboard([
            [Markup.button.callback('🎬 ویدیو', 'convert_mp4'), Markup.button.callback('🖼️ عکس', 'convert_jpg')],
            [Markup.button.callback('🎵 صدا', 'convert_mp3'), Markup.button.callback('📄 PDF', 'convert_pdf')],
            [Markup.button.callback('📝 Word', 'convert_docx'), Markup.button.callback('📊 پاورپوینت', 'convert_pptx')]
        ]));
        return;
    }
});

// ==================== تبدیل فرمت ====================
bot.action(/convert_(.+)/, async (ctx) => {
    const targetFormat = ctx.match[1];
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session || !session.fileId) {
        return ctx.answerCbQuery('❌ اول فایل رو بفرست.');
    }

    await ctx.answerCbQuery();
    const statusMsg = await ctx.reply(`⏳ در حال تبدیل به ${targetFormat.toUpperCase()}...`);

    try {
        const fileLink = await ctx.telegram.getFileLink(session.fileId);
        const inputPath = path.join(DOWNLOAD_DIR, `input_${userId}`);
        const outputPath = path.join(DOWNLOAD_DIR, `output_${userId}.${targetFormat}`);

        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat(targetFormat)
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });

        await ctx.replyWithDocument({ source: outputPath }, { caption: '✅ تبدیل شد!' });

        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        userSessions.delete(userId);
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Convert Error:', error);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ خطا: ${error.message.substring(0, 200)}`);
        userSessions.delete(userId);
    }
});

// ==================== اجرا ====================
bot.launch().then(() => {
    console.log('🤖 ربات با موفقیت روشن شد...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

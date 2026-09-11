require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const qr = require('qrcode');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('❌ توکن ربات پیدا نشد!');

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_URL = process.env.PUBLIC_URL || `https://your-app.onrender.com`;

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const PUBLIC_DIR = path.join(__dirname, 'public_files');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);

const SUPPORT_ID = '@botboshtibani';
const SUPER_ADMIN_ID = 7104735364;

// ==================== اطلاعات پرداخت کارت‌به‌کارت ====================
const CARD_NUMBER = '6104 3377 6565 6952';
const CARD_OWNER = 'ماهان نیک افروز'; // اسم صاحب کارت رو بذار
const PREMIUM_PRICE = 25000; // ۲۵,۰۰۰ تومان

// ==================== ذخیره‌سازی ====================
const PREMIUM_FILE = path.join(__dirname, 'premium_users.json');
const PENDING_FILE = path.join(__dirname, 'pending_payments.json');

function loadJSON(file) {
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { return {}; }
    }
    return {};
}

function saveJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('خطا در ذخیره‌سازی:', e); }
}

let premiumUsers = new Map(Object.entries(loadJSON(PREMIUM_FILE)));
let pendingPayments = loadJSON(PENDING_FILE); // { userId: { name, receiptFileId, status } }

function isPremium(userId) {
    return userId === SUPER_ADMIN_ID || premiumUsers.has(String(userId));
}

function isSuperAdmin(userId) {
    return userId === SUPER_ADMIN_ID;
}

const userSessions = new Map();

// ==================== وب‌سرور ====================
app.get('/', (req, res) => res.send('🤖 ربات فعال است!'));
app.use('/files', express.static(PUBLIC_DIR));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 وب‌سرور روی پورت ${PORT} روشن شد.`));

// ==================== منوی اصلی ====================
function mainMenu(userId) {
    const keyboard = [
        [Markup.button.callback('🔄 تبدیل فرمت', 'convert_format')],
        [Markup.button.callback('🖼️ حذف لوکیشن عکس', 'remove_metadata')],
        [
            Markup.button.callback('📱 ساخت QR ' + (isPremium(userId) ? '✅' : '🔒'), 'create_qr'),
            Markup.button.callback('📷 خواندن QR ' + (isPremium(userId) ? '✅' : '🔒'), 'read_qr')
        ],
        [Markup.button.callback('🔗 فایل به QR (لینک)', 'file_to_qr')],
        [Markup.button.callback('📊 تبدیل واحد', 'convert_units')],
    ];

    if (!isPremium(userId)) {
        keyboard.push([Markup.button.callback('💎 خرید اشتراک پرمیوم', 'buy_premium')]);
    }

    keyboard.push([
        Markup.button.callback('💬 پشتیبانی', 'support'),
        Markup.button.callback('📝 بازخورد', 'feedback'),
        Markup.button.callback('🐛 گزارش خطا', 'report_bug')
    ]);

    if (isSuperAdmin(userId)) {
        keyboard.push([Markup.button.callback('👑 پنل مدیریت (مخفی)', 'admin_panel')]);
    }

    return Markup.inlineKeyboard(keyboard);
}

bot.start((ctx) => {
    ctx.reply('🎯 به ربات همه‌کاره خوش اومدی!\n\n📌 یکی از گزینه‌ها رو انتخاب کن:', mainMenu(ctx.from.id));
});

// ==================== خرید پرمیوم (کارت به کارت) ====================
bot.action('buy_premium', async (ctx) => {
    const userId = ctx.from.id;
    
    if (isPremium(userId)) {
        return ctx.answerCbQuery('✅ شما از قبل پرمیوم هستید!', { show_alert: true });
    }

    await ctx.reply(
        `💎 **خرید اشتراک پرمیوم**\n\n` +
        `💰 مبلغ: **${PREMIUM_PRICE.toLocaleString()} تومان**\n\n` +
        `💳 شماره کارت:\n\`${CARD_NUMBER}\`\n` +
        `👤 به نام: **${CARD_OWNER}**\n\n` +
        `📌 **مراحل:**\n` +
        `۱. مبلغ رو به شماره کارت بالا واریز کن.\n` +
        `۲. عکس **رسید پرداخت** رو برام بفرست.\n` +
        `۳. بعد از تأیید توسط ادمین، اشتراکت فعال می‌شه.\n\n` +
        `⚠️ بعد از واریز، روی دکمه زیر بزن و رسید رو بفرست.`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📤 ارسال رسید پرداخت', 'send_receipt')]
            ])
        }
    );
});

bot.action('send_receipt', (ctx) => {
    const userId = ctx.from.id;
    if (isPremium(userId)) {
        return ctx.answerCbQuery('✅ شما از قبل پرمیوم هستید!', { show_alert: true });
    }
    userSessions.set(userId, { mode: 'awaiting_receipt' });
    ctx.reply('📸 لطفاً **عکس رسید پرداخت** رو بفرست:');
});

// ==================== دریافت رسید ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    // --- دریافت رسید پرداخت ---
    if (session.mode === 'awaiting_receipt') {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
        
        // ذخیره در pending
        pendingPayments[String(userId)] = {
            name: userName,
            username: ctx.from.username || 'ندارد',
            receiptFileId: photo.file_id,
            date: new Date().toISOString(),
            status: 'pending'
        };
        saveJSON(PENDING_FILE, pendingPayments);

        await ctx.reply('✅ رسید شما دریافت شد و برای بررسی به ادمین ارسال شد.\n\n⏳ لطفاً منتظر تأیید باشید.');

        // ارسال به ادمین
        try {
            await bot.telegram.sendPhoto(SUPER_ADMIN_ID, photo.file_id, {
                caption: 
                    `🔔 **درخواست پرمیوم جدید**\n\n` +
                    `👤 اسم: **${userName}**\n` +
                    `🆔 آیدی: \`${userId}\`\n` +
                    `📎 یوزرنیم: @${ctx.from.username || 'ندارد'}\n` +
                    `💰 مبلغ: ${PREMIUM_PRICE.toLocaleString()} تومان\n\n` +
                    `آیا تأیید می‌کنی؟`,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ تأیید', `admin_approve_${userId}`),
                        Markup.button.callback('❌ رد', `admin_reject_${userId}`)
                    ]
                ])
            });
        } catch (e) {
            console.error('خطا در ارسال به ادمین:', e);
        }

        userSessions.delete(userId);
        return;
    }

    // --- حذف لوکیشن عکس ---
    if (session.mode === 'remove_metadata') {
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const image = await Jimp.read(fileLink.href);
            const buffer = await image.quality(95).getBufferAsync(Jimp.MIME_JPEG);
            await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ لوکیشن و اطلاعات عکس حذف شد!' });
        } catch { await ctx.reply('❌ خطا در پردازش عکس.'); }
        userSessions.delete(userId);
        return;
    }

    // --- خواندن QR ---
    if (session.mode === 'read_qr') {
        if (!isPremium(userId)) return ctx.reply('❌ این قابلیت پولی است!');
        try {
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const image = await Jimp.read(fileLink.href);
            const imageData = { data: new Uint8ClampedArray(image.bitmap.data), width: image.bitmap.width, height: image.bitmap.height };
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code) await ctx.reply(`📷 متن QR:\n${code.data}`);
            else await ctx.reply('❌ QR کد تشخیص داده نشد.');
        } catch { await ctx.reply('❌ خطا در خواندن QR.'); }
        userSessions.delete(userId);
        return;
    }

    // --- فایل به QR ---
    if (session.mode === 'file_to_qr') {
        try {
            const statusMsg = await ctx.reply('⏳ در حال آپلود فایل و ساخت لینک دائمی...');
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            const response = await axios({ url: fileLink.href, method: 'GET', responseType: 'stream' });
            const fileName = `file_${userId}_${Date.now()}.jpg`;
            const filePath = path.join(PUBLIC_DIR, fileName);
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

            const permanentUrl = `${PUBLIC_URL}/files/${fileName}`;
            const qrBuffer = await qr.toBuffer(permanentUrl);
            await ctx.replyWithPhoto({ source: qrBuffer }, { caption: `✅ لینک دائمی:\n${permanentUrl}`, parse_mode: 'Markdown' });
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (e) {
            await ctx.reply('❌ خطا در ساخت QR.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- تبدیل فرمت (دریافت فایل) ---
    if (session.mode === 'convert_format') {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        userSessions.set(userId, { ...session, fileId });
        await ctx.reply('✅ فایل دریافت شد. فرمت مورد نظر رو انتخاب کن:', Markup.inlineKeyboard([
            [Markup.button.callback('🎬 ویدیو', 'convert_mp4'), Markup.button.callback('🖼️ عکس', 'convert_jpg')],
            [Markup.button.callback('🎵 صدا', 'convert_mp3'), Markup.button.callback('📄 PDF', 'convert_pdf')],
            [Markup.button.callback('📝 Word', 'convert_docx'), Markup.button.callback('📊 پاورپوینت', 'convert_pptx')]
        ]));
        return;
    }
});

// ==================== تأیید/رد توسط ادمین ====================
bot.action(/admin_approve_(\d+)/, async (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ شما ادمین نیستید!');

    const targetId = ctx.match[1];
    const pending = pendingPayments[targetId];

    if (!pending) {
        return ctx.answerCbQuery('❌ این درخواست پیدا نشد.', { show_alert: true });
    }

    premiumUsers.set(targetId, pending.name);
    saveJSON(PREMIUM_FILE, Object.fromEntries(premiumUsers));
    delete pendingPayments[targetId];
    saveJSON(PENDING_FILE, pendingPayments);

    await ctx.answerCbQuery('✅ تأیید شد!');
    await ctx.editMessageCaption(
        `✅ **تأیید شد**\n\n👤 ${pending.name}\n🆔 \`${targetId}\``,
        { parse_mode: 'Markdown' }
    );

    // اطلاع به کاربر
    try {
        await bot.telegram.sendMessage(targetId, '🎉 **تبریک!**\n\nاشتراک پرمیوم شما فعال شد. حالا به قابلیت‌های QR دسترسی داری.');
    } catch (e) {}
});

bot.action(/admin_reject_(\d+)/, async (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ شما ادمین نیستید!');

    const targetId = ctx.match[1];
    const pending = pendingPayments[targetId];

    if (!pending) {
        return ctx.answerCbQuery('❌ این درخواست پیدا نشد.', { show_alert: true });
    }

    delete pendingPayments[targetId];
    saveJSON(PENDING_FILE, pendingPayments);

    await ctx.answerCbQuery('❌ رد شد!');
    await ctx.editMessageCaption(
        `❌ **رد شد**\n\n👤 ${pending.name}\n🆔 \`${targetId}\``,
        { parse_mode: 'Markdown' }
    );

    try {
        await bot.telegram.sendMessage(targetId, '❌ متأسفانه رسید شما تأیید نشد. برای پیگیری با پشتیبانی تماس بگیر.');
    } catch (e) {}
});

// ==================== پنل ادمین ====================
bot.action('admin_panel', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ این بخش برای شما در دسترس نیست.');
    const pendingCount = Object.keys(pendingPayments).length;
    ctx.reply(
        `👑 **پنل مدیریت مخفی**\n\n` +
        `🆔 آیدی شما: \`${ctx.from.id}\`\n` +
        `👥 کاربران پرمیوم: **${premiumUsers.size}**\n` +
        `⏳ درخواست‌های در انتظار: **${pendingCount}**\n\n` +
        `از دکمه‌های زیر استفاده کن:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ افزودن کاربر پرمیوم', 'admin_add_premium')],
                [Markup.button.callback('➖ حذف کاربر پرمیوم', 'admin_remove_premium')],
                [Markup.button.callback('📋 لیست کاربران پرمیوم', 'admin_list_premium')],
                [Markup.button.callback('⏳ درخواست‌های در انتظار', 'admin_pending_list')],
                [Markup.button.callback('🔙 بازگشت به منو', 'admin_back')]
            ])
        }
    );
});

bot.action('admin_add_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    userSessions.set(ctx.from.id, { mode: 'admin_add_premium' });
    ctx.reply('🆔 آیدی عددی کاربر رو بفرست:');
});

bot.action('admin_remove_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    userSessions.set(ctx.from.id, { mode: 'admin_remove_premium' });
    ctx.reply('🆔 آیدی عددی کاربری که می‌خوای حذف بشه رو بفرست:');
});

bot.action('admin_list_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    if (premiumUsers.size === 0) return ctx.reply('📋 هنوز هیچ کاربر پرمیومی ثبت نشده.');
    let list = `📋 **لیست کاربران پرمیوم (${premiumUsers.size} نفر):**\n\n`;
    let index = 1;
    for (const [userId, userName] of premiumUsers) {
        list += `${index}. 👤 **${userName}**\n   🆔 \`${userId}\`\n\n`;
        index++;
    }
    ctx.reply(list, { parse_mode: 'Markdown' });
});

bot.action('admin_pending_list', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    const pending = Object.entries(pendingPayments);
    if (pending.length === 0) return ctx.reply('⏳ هیچ درخواست در انتظاری وجود نداره.');
    
    let list = `⏳ **درخواست‌های در انتظار (${pending.length}):**\n\n`;
    for (const [userId, data] of pending) {
        list += `👤 **${data.name}**\n🆔 \`${userId}\`\n📅 ${new Date(data.date).toLocaleDateString('fa-IR')}\n\n`;
    }
    list += `📌 برای تأیید یا رد، به رسید ارسال‌شده در چت ادمین مراجعه کن.`;
    ctx.reply(list, { parse_mode: 'Markdown' });
});

bot.action('admin_back', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    ctx.reply('🏠 به منوی اصلی برگشتی.', mainMenu(ctx.from.id));
});

// ==================== سایر دکمه‌ها ====================
bot.action('convert_format', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert_format' });
    ctx.reply('🔄 فایل رو بفرست.');
});

bot.action('remove_metadata', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'remove_metadata' });
    ctx.reply('🖼️ عکس رو بفرست تا لوکیشنش رو پاک کنم.');
});

bot.action('create_qr', (ctx) => {
    if (!isPremium(ctx.from.id)) return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
    userSessions.set(ctx.from.id, { mode: 'create_qr' });
    ctx.reply('📱 لینک یا متنی که می‌خوای QR بشه رو بفرست.');
});

bot.action('read_qr', (ctx) => {
    if (!isPremium(ctx.from.id)) return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
    userSessions.set(ctx.from.id, { mode: 'read_qr' });
    ctx.reply('📷 عکس QR کد رو بفرست.');
});

bot.action('file_to_qr', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'file_to_qr' });
    ctx.reply('📎 فایلی که می‌خوای لینکش QR بشه رو بفرست.');
});

bot.action('convert_units', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert_units' });
    ctx.reply('📊 مثال: 10 کیلوگرم به گرم');
});

bot.action(['support', 'feedback', 'report_bug'], (ctx) => {
    ctx.reply(`💬 آیدی پشتیبانی:\n${SUPPORT_ID}`);
    userSessions.delete(ctx.from.id);
});

// ==================== مدیریت متن‌ها ====================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    if (session.mode === 'admin_add_premium' && isSuperAdmin(userId)) {
        if (!/^\d+$/.test(text.trim())) return ctx.reply('❌ آیدی عددی معتبر نیست.');
        userSessions.set(userId, { mode: 'admin_add_premium_name', targetId: text.trim() });
        await ctx.reply('👤 حالا اسم این کاربر رو بفرست:');
        return;
    }

    if (session.mode === 'admin_add_premium_name' && isSuperAdmin(userId)) {
        premiumUsers.set(session.targetId, text.trim());
        saveJSON(PREMIUM_FILE, Object.fromEntries(premiumUsers));
        await ctx.reply(`✅ کاربر **${text.trim()}** اضافه شد.\n👥 تعداد: **${premiumUsers.size}**`, { parse_mode: 'Markdown' });
        userSessions.delete(userId);
        return;
    }

    if (session.mode === 'admin_remove_premium' && isSuperAdmin(userId)) {
        const targetId = text.trim();
        if (premiumUsers.has(targetId)) {
            const name = premiumUsers.get(targetId);
            premiumUsers.delete(targetId);
            saveJSON(PREMIUM_FILE, Object.fromEntries(premiumUsers));
            await ctx.reply(`✅ کاربر **${name}** حذف شد.`);
        } else {
            await ctx.reply('❌ این کاربر توی لیست نیست.');
        }
        userSessions.delete(userId);
        return;
    }

    if (session.mode === 'create_qr') {
        if (!isPremium(userId)) return ctx.reply('❌ این قابلیت پولی است!');
        try {
            const buffer = await qr.toBuffer(text);
            await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ QR کد ساخته شد!' });
        } catch { await ctx.reply('❌ خطا در ساخت QR.'); }
        userSessions.delete(userId);
        return;
    }

    if (session.mode === 'convert_units') {
        const lower = text.toLowerCase();
        try {
            const match = lower.match(/(\d+(\.\d+)?)/);
            if (!match) throw new Error();
            const num = parseFloat(match[1]);
            if (lower.includes('کیلوگرم') && lower.includes('گرم')) await ctx.reply(`📊 ${num} کیلوگرم = ${num * 1000} گرم`);
            else if (lower.includes('متر') && lower.includes('سانتی‌متر')) await ctx.reply(`📊 ${num} متر = ${num * 100} سانتی‌متر`);
            else if (lower.includes('کیلومتر') && lower.includes('متر')) await ctx.reply(`📊 ${num} کیلومتر = ${num * 1000} متر`);
            else await ctx.reply('📊 مثال: 10 کیلوگرم به گرم');
        } catch { await ctx.reply('📊 فرمت رو درست وارد کن.'); }
        userSessions.delete(userId);
        return;
    }
});

// ==================== تبدیل فرمت ====================
bot.action(/convert_(.+)/, async (ctx) => {
    const targetFormat = ctx.match[1];
    const userId = ctx.from.id;
    const session = userSessions.get(userId);
    if (!session || !session.fileId) return ctx.answerCbQuery('❌ اول فایل رو بفرست.');

    await ctx.answerCbQuery();
    const statusMsg = await ctx.reply(`⏳ در حال تبدیل به ${targetFormat.toUpperCase()}...`);

    try {
        const fileLink = await ctx.telegram.getFileLink(session.fileId);
        const inputPath = path.join(DOWNLOAD_DIR, `input_${userId}`);
        const outputPath = path.join(DOWNLOAD_DIR, `output_${userId}.${targetFormat}`);

        const response = await axios({ url: fileLink.href, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(inputPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegStatic = require('ffmpeg-static');
        ffmpeg.setFfmpegPath(ffmpegStatic);

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath).toFormat(targetFormat).on('end', resolve).on('error', reject).save(outputPath);
        });

        await ctx.replyWithDocument({ source: outputPath }, { caption: '✅ تبدیل شد!' });
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        userSessions.delete(userId);
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (error) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ خطا: ${error.message.substring(0, 200)}`);
        userSessions.delete(userId);
    }
});

// ==================== اجرا ====================
bot.launch().then(() => console.log('🤖 ربات روشن شد...'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

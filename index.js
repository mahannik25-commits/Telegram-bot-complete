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

// آدرس عمومی ربات روی Render
const PUBLIC_URL = process.env.PUBLIC_URL || `https://your-app.onrender.com`;

// ==================== تنظیمات زرین‌پال ====================
const ZARINPAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID || 'YOUR_MERCHANT_ID';
const ZARINPAL_SANDBOX = process.env.ZARINPAL_SANDBOX === 'true' || true;
const ZARINPAL_CALLBACK_URL = process.env.ZARINPAL_CALLBACK_URL || `${PUBLIC_URL}/zarinpal/callback`;
const PREMIUM_PRICE = 50000;

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// پوشه‌ی فایل‌های عمومی برای لینک دائمی
const PUBLIC_DIR = path.join(__dirname, 'public_files');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);

const SUPPORT_ID = '@botboshtibani';
const SUPER_ADMIN_ID = 7104735364;

// ==================== ذخیره‌سازی کاربران پرمیوم ====================
const PREMIUM_FILE = path.join(__dirname, 'premium_users.json');

function loadPremiumUsers() {
    if (fs.existsSync(PREMIUM_FILE)) {
        try {
            const data = fs.readFileSync(PREMIUM_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // تبدیل به Map برای ذخیره اسم و آیدی
            return new Map(Object.entries(parsed));
        } catch (e) {
            return new Map();
        }
    }
    return new Map();
}

function savePremiumUsers(usersMap) {
    try {
        const obj = Object.fromEntries(usersMap);
        fs.writeFileSync(PREMIUM_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.error('خطا در ذخیره‌سازی:', e);
    }
}

let premiumUsers = loadPremiumUsers();

function isPremium(userId) {
    return userId === SUPER_ADMIN_ID || premiumUsers.has(String(userId));
}

function isSuperAdmin(userId) {
    return userId === SUPER_ADMIN_ID;
}

const userSessions = new Map();

// ==================== وب‌سرور ====================
app.get('/', (req, res) => res.send('🤖 ربات فعال است!'));

// سرو کردن فایل‌های عمومی برای لینک دائمی
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

// ==================== شروع ====================
bot.start((ctx) => {
    ctx.reply('🎯 به ربات همه‌کاره خوش اومدی!\n\n📌 یکی از گزینه‌ها رو انتخاب کن:', mainMenu(ctx.from.id));
});

// ==================== پنل ادمین ====================
bot.action('admin_panel', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) {
        return ctx.answerCbQuery('❌ این بخش برای شما در دسترس نیست.');
    }
    ctx.reply(
        `👑 **پنل مدیریت مخفی**\n\n` +
        `🆔 آیدی عددی شما: \`${ctx.from.id}\`\n` +
        `👥 تعداد کاربران پرمیوم: **${premiumUsers.size}**\n\n` +
        `از دکمه‌های زیر استفاده کن:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ افزودن کاربر پرمیوم', 'admin_add_premium')],
                [Markup.button.callback('➖ حذف کاربر پرمیوم', 'admin_remove_premium')],
                [Markup.button.callback('📋 لیست کاربران پرمیوم', 'admin_list_premium')],
                [Markup.button.callback('🔙 بازگشت به منو', 'admin_back')]
            ])
        }
    );
});

bot.action('admin_add_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    userSessions.set(ctx.from.id, { mode: 'admin_add_premium' });
    ctx.reply(
        '🆔 **آیدی عددی کاربر رو بفرست.**\n\n' +
        'مثال: `7104735364`\n\n' +
        '📌 نکته: بعد از فرستادن آیدی، ازش می‌خوام اسمش رو هم بفرسته.',
        { parse_mode: 'Markdown' }
    );
});

bot.action('admin_remove_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    userSessions.set(ctx.from.id, { mode: 'admin_remove_premium' });
    ctx.reply('🆔 آیدی عددی کاربری که می‌خوای از پرمیوم حذف بشه رو بفرست:');
});

bot.action('admin_list_premium', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    if (premiumUsers.size === 0) {
        return ctx.reply('📋 هنوز هیچ کاربر پرمیومی ثبت نشده.');
    }
    
    let list = `📋 **لیست کاربران پرمیوم (${premiumUsers.size} نفر):**\n\n`;
    let index = 1;
    for (const [userId, userName] of premiumUsers) {
        list += `${index}. 👤 **${userName}**\n   🆔 \`${userId}\`\n\n`;
        index++;
    }
    
    ctx.reply(list, { parse_mode: 'Markdown' });
});

bot.action('admin_back', (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return;
    ctx.reply('🏠 به منوی اصلی برگشتی.', mainMenu(ctx.from.id));
});

// ==================== دکمه‌های عادی ====================
bot.action('convert_format', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'convert_format' });
    ctx.reply('🔄 فایل رو بفرست.');
});

bot.action('remove_metadata', (ctx) => {
    userSessions.set(ctx.from.id, { mode: 'remove_metadata' });
    ctx.reply('🖼️ عکس رو بفرست تا لوکیشنش رو پاک کنم.');
});

bot.action('create_qr', (ctx) => {
    if (!isPremium(ctx.from.id)) {
        return ctx.answerCbQuery('❌ این قابلیت پولی است! برای خرید اشتراک دکمه «خرید اشتراک پرمیوم» رو بزن.', { show_alert: true });
    }
    userSessions.set(ctx.from.id, { mode: 'create_qr' });
    ctx.reply('📱 لینک یا متنی که می‌خوای QR بشه رو بفرست.');
});

bot.action('read_qr', (ctx) => {
    if (!isPremium(ctx.from.id)) {
        return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
    }
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

bot.action('buy_premium', async (ctx) => {
    try {
        const payUrl = await createPayment(PREMIUM_PRICE, 'خرید اشتراک پرمیوم ربات', ctx.from.id);
        await ctx.reply(
            `💎 **خرید اشتراک پرمیوم**\n\n` +
            `💰 مبلغ: ${PREMIUM_PRICE.toLocaleString()} تومان\n` +
            `🔗 برای پرداخت روی لینک زیر کلیک کن:\n${payUrl}\n\n` +
            `⚠️ بعد از پرداخت، به ربات برگرد و دکمه «بررسی پرداخت» رو بزن.`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('Payment Error:', error);
        await ctx.reply('❌ خطا در ایجاد لینک پرداخت. لطفاً بعداً تلاش کن.');
    }
});

bot.action('verify_payment', async (ctx) => {
    const authority = userSessions.get(ctx.from.id)?.payment_authority;
    if (!authority) return ctx.reply('❌ ابتدا پرداخت رو انجام بده.');

    try {
        const verified = await verifyPayment(authority, PREMIUM_PRICE);
        if (verified) {
            // ذخیره با اسم کاربر
            const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
            premiumUsers.set(String(ctx.from.id), userName);
            savePremiumUsers(premiumUsers);
            await ctx.reply('✅ پرداخت با موفقیت تأیید شد! حالا به قابلیت‌های پولی دسترسی داری.');
        } else {
            await ctx.reply('❌ پرداخت تأیید نشد. لطفاً دوباره تلاش کن.');
        }
    } catch (error) {
        await ctx.reply('❌ خطا در تأیید پرداخت.');
    }
});

bot.action(['support', 'feedback', 'report_bug'], (ctx) => {
    ctx.reply(`💬 آیدی پشتیبانی:\n${SUPPORT_ID}`);
    userSessions.delete(ctx.from.id);
});

// ==================== توابع زرین‌پال ====================
async function createPayment(amount, description, userId) {
    const url = ZARINPAL_SANDBOX
        ? 'https://sandbox.zarinpal.com/pg/v4/payment/request.json'
        : 'https://payment.zarinpal.com/pg/v4/payment/request.json';

    const data = {
        merchant_id: ZARINPAL_MERCHANT_ID,
        amount: amount,
        description: description,
        callback_url: ZARINPAL_CALLBACK_URL,
        metadata: { user_id: String(userId) }
    };

    const response = await axios.post(url, data);
    if (response.data.data && response.data.data.code === 100) {
        const authority = response.data.data.authority;
        userSessions.set(userId, { ...userSessions.get(userId), payment_authority: authority });
        return ZARINPAL_SANDBOX
            ? `https://sandbox.zarinpal.com/pg/StartPay/${authority}`
            : `https://payment.zarinpal.com/pg/StartPay/${authority}`;
    }
    throw new Error('خطا در ساخت درخواست پرداخت');
}

async function verifyPayment(authority, amount) {
    const url = ZARINPAL_SANDBOX
        ? 'https://sandbox.zarinpal.com/pg/v4/payment/verify.json'
        : 'https://payment.zarinpal.com/pg/v4/payment/verify.json';

    const data = { merchant_id: ZARINPAL_MERCHANT_ID, amount: amount, authority: authority };
    const response = await axios.post(url, data);
    return response.data.data && response.data.data.code === 100;
}

// ==================== مدیریت متن‌ها ====================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    // --- ادمین: دریافت آیدی برای افزودن پرمیوم ---
    if (session.mode === 'admin_add_premium' && isSuperAdmin(userId)) {
        const targetId = text.trim();
        if (!/^\d+$/.test(targetId)) return ctx.reply('❌ آیدی عددی معتبر نیست. فقط عدد بفرست.');
        
        // مرحله بعد: دریافت اسم
        userSessions.set(userId, { mode: 'admin_add_premium_name', targetId });
        await ctx.reply(`✅ آیدی \`${targetId}\` دریافت شد.\n\n👤 حالا **اسم** این کاربر رو بفرست:`, { parse_mode: 'Markdown' });
        return;
    }

    // --- ادمین: دریافت اسم برای افزودن پرمیوم ---
    if (session.mode === 'admin_add_premium_name' && isSuperAdmin(userId)) {
        const userName = text.trim();
        const targetId = session.targetId;
        
        premiumUsers.set(targetId, userName);
        savePremiumUsers(premiumUsers);
        
        await ctx.reply(
            `✅ کاربر با موفقیت اضافه شد:\n\n` +
            `👤 اسم: **${userName}**\n` +
            `🆔 آیدی: \`${targetId}\`\n\n` +
            `👥 تعداد کل کاربران پرمیوم: **${premiumUsers.size}**`,
            { parse_mode: 'Markdown' }
        );
        userSessions.delete(userId);
        return;
    }

    // --- ادمین: حذف پرمیوم ---
    if (session.mode === 'admin_remove_premium' && isSuperAdmin(userId)) {
        const targetId = text.trim();
        if (!/^\d+$/.test(targetId)) return ctx.reply('❌ آیدی عددی معتبر نیست.');
        
        if (premiumUsers.has(targetId)) {
            const userName = premiumUsers.get(targetId);
            premiumUsers.delete(targetId);
            savePremiumUsers(premiumUsers);
            await ctx.reply(`✅ کاربر **${userName}** با آیدی \`${targetId}\` از لیست پرمیوم حذف شد.`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('❌ این کاربر توی لیست پرمیوم نیست.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- ساخت QR ---
    if (session.mode === 'create_qr') {
        if (!isPremium(userId)) return ctx.reply('❌ این قابلیت پولی است!');
        try {
            const buffer = await qr.toBuffer(text);
            await ctx.replyWithPhoto({ source: buffer }, { caption: '✅ QR کد ساخته شد!' });
        } catch { await ctx.reply('❌ خطا در ساخت QR.'); }
        userSessions.delete(userId);
        return;
    }

    // --- تبدیل واحد ---
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

// ==================== مدیریت فایل‌ها ====================
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
        } catch { await ctx.reply('❌ خطا در پردازش عکس.'); }
        userSessions.delete(userId);
        return;
    }

    // --- خواندن QR ---
    if (session.mode === 'read_qr' && ctx.message.photo) {
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

    // --- فایل به QR (با لینک دائمی) ---
    if (session.mode === 'file_to_qr') {
        const fileId = ctx.message.document?.file_id || ctx.message.video?.file_id || ctx.message.audio?.file_id || (ctx.message.photo && ctx.message.photo[ctx.message.photo.length - 1].file_id);
        if (!fileId) return ctx.reply('❌ فایل پشتیبانی نمی‌شه.');

        try {
            const statusMsg = await ctx.reply('⏳ در حال آپلود فایل و ساخت لینک دائمی...');
            
            // دریافت لینک فایل از تلگرام
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            // دانلود فایل از تلگرام
            const response = await fetch(fileLink.href);
            const buffer = Buffer.from(await response.arrayBuffer());
            
            // ساخت اسم یکتا برای فایل
            const ext = fileLink.href.split('.').pop().split('?')[0] || 'bin';
            const fileName = `file_${userId}_${Date.now()}.${ext}`;
            const filePath = path.join(PUBLIC_DIR, fileName);
            
            // ذخیره فایل در سرور
            fs.writeFileSync(filePath, buffer);
            
            // ساخت لینک دائمی
            const permanentUrl = `${PUBLIC_URL}/files/${fileName}`;
            
            // ساخت QR از لینک دائمی
            const qrBuffer = await qr.toBuffer(permanentUrl);
            
            await ctx.replyWithPhoto(
                { source: qrBuffer },
                { 
                    caption: `✅ **لینک دائمی فایل ساخته شد!**\n\n` +
                             `🔗 لینک:\n${permanentUrl}\n\n` +
                             `📌 این لینک دائمی است و منقضی نمی‌شه.`,
                    parse_mode: 'Markdown'
                }
            );
            
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (error) {
            console.error(error);
            await ctx.reply('❌ خطا در ساخت QR برای فایل.');
        }
        userSessions.delete(userId);
        return;
    }

    // --- تبدیل فرمت ---
    if (session.mode === 'convert_format') {
        const fileId = ctx.message.document?.file_id || ctx.message.video?.file_id || ctx.message.audio?.file_id || (ctx.message.photo && ctx.message.photo[ctx.message.photo.length - 1].file_id);
        if (!fileId) return ctx.reply('❌ فایل پشتیبانی نمی‌شه.');
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
    if (!session || !session.fileId) return ctx.answerCbQuery('❌ اول فایل رو بفرست.');

    await ctx.answerCbQuery();
    const statusMsg = await ctx.reply(`⏳ در حال تبدیل به ${targetFormat.toUpperCase()}...`);

    try {
        const fileLink = await ctx.telegram.getFileLink(session.fileId);
        const inputPath = path.join(DOWNLOAD_DIR, `input_${userId}`);
        const outputPath = path.join(DOWNLOAD_DIR, `output_${userId}.${targetFormat}`);

        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);

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

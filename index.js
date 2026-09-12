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

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const SUPPORT_ID = '@botboshtibani';
const SUPER_ADMIN_ID = 7104735364;

// ==================== اطلاعات پرداخت ====================
const CARD_NUMBER = '6104 3377 6565 6952';
const CARD_OWNER = 'ماهان نیک افروز';
const PREMIUM_PRICE = 25000;

// ==================== فیلتر اخلاقی ====================
const FORBIDDEN_WORDS = [
    'sex', 'porn', 'nude', 'naked', 'xxx', 'nsfw', 'erotic', 'hentai',
    'boobs', 'breast', 'penis', 'vagina', 'dick', 'pussy', 'ass', 'anal',
    'kill', 'murder', 'blood', 'gore', 'torture', 'beheading', 'suicide',
    'weapon', 'gun', 'rifle', 'bomb', 'explosion',
    'racist', 'nazi', 'hitler', 'terrorist', 'isis', 'jihad',
    'child porn', 'pedo', 'abuse', 'drugs', 'cocaine', 'heroin', 'meth',
    'khamenei', 'khomeini', 'iranian leader', 'dictator',
];

function isPromptSafe(prompt, userId = null) {
    // چک‌های عمومی که برای همه اعمال میشه
    if (prompt.length > 500) {
        return { safe: false, reason: 'پرامپت خیلی طولانیه (حداکثر ۵۰۰ کاراکتر).' };
    }
    if (prompt.trim().length < 3) {
        return { safe: false, reason: 'پرامپت خیلی کوتاهه.' };
    }

    // ✅ ادمین کل فیلتر کلمات رو دور می‌زنه
    if (userId === SUPER_ADMIN_ID) {
        return { safe: true };
    }

    const lowerPrompt = prompt.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
        if (word.includes(' ')) {
            if (lowerPrompt.includes(word)) {
                return { safe: false, reason: 'محتوای نامناسب تشخیص داده شد.' };
            }
        } else {
            const regex = new RegExp(`\\b${word}\\b`, 'i');
            if (regex.test(lowerPrompt)) {
                return { safe: false, reason: `کلمه «${word}» مجاز نیست.` };
            }
        }
    }
    return { safe: true };
}

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
let pendingPayments = loadJSON(PENDING_FILE);

function isPremium(userId) {
    return userId === SUPER_ADMIN_ID || premiumUsers.has(String(userId));
}

function isSuperAdmin(userId) {
    return userId === SUPER_ADMIN_ID;
}

const userSessions = new Map();

// ==================== وب‌سرور ====================
app.get('/', (req, res) => res.send('🤖 ربات فعال است!'));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 وب‌سرور روی پورت ${PORT} روشن شد.`));

// ==================== منوی اصلی ====================
function mainMenu(userId) {
    const keyboard = [
        [Markup.button.callback('🔄 تبدیل فرمت', 'convert_format')],
        [Markup.button.callback('🖼️ حذف لوکیشن عکس ' + (isPremium(userId) ? '✅' : '🔒'), 'remove_metadata')],
        [
            Markup.button.callback('📱 ساخت QR ' + (isPremium(userId) ? '✅' : '🔒'), 'create_qr'),
            Markup.button.callback('📷 خواندن QR ' + (isPremium(userId) ? '✅' : '🔒'), 'read_qr')
        ],
        [Markup.button.callback('🎨 تولید عکس با AI ' + (isPremium(userId) ? '✅' : '🔒'), 'ai_image')],
        [Markup.button.callback('🎬 تولید ویدیو با AI ' + (isPremium(userId) ? '✅' : '🔒'), 'ai_video')],
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

// ==================== خرید پرمیوم ====================
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
                [Markup.button.callback('📋 کپی شماره کارت', 'copy_card')],
                [Markup.button.callback('📤 ارسال رسید پرداخت', 'send_receipt')]
            ])
        }
    );
});

// ==================== کپی شماره کارت ====================
bot.action('copy_card', async (ctx) => {
    await ctx.answerCbQuery(
        `شماره کارت:\n${CARD_NUMBER}\n\n👆 برای کپی، انگشتت رو روی شماره نگه دار.`,
        { show_alert: true }
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

// ==================== مدیریت عکس‌ها ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    // --- دریافت رسید پرداخت ---
    if (session.mode === 'awaiting_receipt') {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
        
        pendingPayments[String(userId)] = {
            name: userName,
            username: ctx.from.username || 'ندارد',
            receiptFileId: photo.file_id,
            date: new Date().toISOString(),
            status: 'pending'
        };
        saveJSON(PENDING_FILE, pendingPayments);

        await ctx.reply('✅ رسید شما دریافت شد و برای بررسی به ادمین ارسال شد.\n\n⏳ لطفاً منتظر تأیید باشید.');

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

    // --- حذف لوکیشن عکس (پولی) ---
    if (session.mode === 'remove_metadata') {
        if (!isPremium(userId)) {
            await ctx.reply('❌ این قابلیت پولی است! برای خرید اشتراک از منو استفاده کن.');
            userSessions.delete(userId);
            return;
        }
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

    // --- خواندن QR (پولی) ---
    if (session.mode === 'read_qr') {
        if (!isPremium(userId)) {
            await ctx.reply('❌ این قابلیت پولی است!');
            userSessions.delete(userId);
            return;
        }
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

// ==================== مدیریت فایل‌ها ====================
bot.on(['document', 'video', 'audio'], async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId) || {};

    if (session.mode === 'convert_format') {
        const fileId = ctx.message.document?.file_id || ctx.message.video?.file_id || ctx.message.audio?.file_id;
        if (!fileId) return ctx.reply('❌ فایل پشتیبانی نمی‌شه.');
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

    if (!pending) return ctx.answerCbQuery('❌ این درخواست پیدا نشد.', { show_alert: true });

    premiumUsers.set(targetId, pending.name);
    saveJSON(PREMIUM_FILE, Object.fromEntries(premiumUsers));
    delete pendingPayments[targetId];
    saveJSON(PENDING_FILE, pendingPayments);

    await ctx.answerCbQuery('✅ تأیید شد!');
    await ctx.editMessageCaption(
        `✅ **تأیید شد**\n\n👤 ${pending.name}\n🆔 \`${targetId}\``,
        { parse_mode: 'Markdown' }
    );

    try {
        await bot.telegram.sendMessage(targetId, '🎉 **تبریک!**\n\nاشتراک پرمیوم شما فعال شد. حالا به همه قابلیت‌ها دسترسی داری.');
    } catch (e) {}
});

bot.action(/admin_reject_(\d+)/, async (ctx) => {
    if (!isSuperAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ شما ادمین نیستید!');

    const targetId = ctx.match[1];
    const pending = pendingPayments[targetId];

    if (!pending) return ctx.answerCbQuery('❌ این درخواست پیدا نشد.', { show_alert: true });

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
    if (!isPremium(ctx.from.id)) return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
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

bot.action('ai_image', (ctx) => {
    if (!isPremium(ctx.from.id)) return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
    userSessions.set(ctx.from.id, { mode: 'ai_image' });
    ctx.reply(
        '🎨 **پرامپت انگلیسی خود را وارد کنید.**\n\n' +
        '⚠️ این سرویس فقط از پرامپت انگلیسی پشتیبانی می‌کند.\n' +
        '🚫 محتوای نامناسب رد خواهد شد.\n\n' +
        '📝 مثال:\n' +
        '`A dog astronaut on the moon`'
    );
});

bot.action('ai_video', (ctx) => {
    if (!isPremium(ctx.from.id)) return ctx.answerCbQuery('❌ این قابلیت پولی است!', { show_alert: true });
    userSessions.set(ctx.from.id, { mode: 'ai_video' });
    ctx.reply(
        '🎬 **پرامپت انگلیسی خود را برای ساخت ویدیو وارد کنید.**\n\n' +
        '⚠️ فقط پرامپت انگلیسی پشتیبانی می‌شود.\n' +
        '🚫 محتوای نامناسب رد خواهد شد.\n' +
        '⏳ ساخت ویدیو ممکن است چند دقیقه طول بکشد.\n\n' +
        '📝 مثال:\n' +
        '`A majestic dragon soaring through clouds`'
    );
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

// --- تولید ویدیو با AI (اصلاح‌شده) ---
if (session.mode === 'ai_video') {
    if (!isPremium(userId)) return ctx.reply('❌ این قابلیت پولی است!');
    
    const prompt = text.trim();
    if (!prompt) return ctx.reply('❌ لطفاً یک پرامپت بنویس.');
    
    if (/[\u0600-\u06FF]/.test(prompt)) {
        return ctx.reply(
            '⚠️ **پرامپت باید انگلیسی باشد!**\n\n' +
            '❌ پرامپت فارسی پشتیبانی نمی‌شود.\n' +
            '✅ لطفاً توضیح ویدیو را به انگلیسی بنویسید.\n\n' +
            '📝 مثال:\n' +
            '`A majestic dragon soaring through clouds`'
        );
    }
    
    const safetyCheck = isPromptSafe(prompt);
    if (!safetyCheck.safe) {
        return ctx.reply(
            `🚫 **پرامپت شما رد شد!**\n\n` +
            `❌ دلیل: ${safetyCheck.reason}\n\n` +
            `📌 لطفاً پرامپت مناسب‌تری بنویسید.`
        );
    }
    
    const statusMsg = await ctx.reply('🎬 در حال ساخت ویدیو... (ممکنه چند دقیقه طول بکشه)');
    
    try {
        // اضافه کردن پارامتر duration برای زمان ویدیو (۲ تا ۱۰ ثانیه)
        const videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=seedance&duration=6&nologo=true`;
        
        await ctx.replyWithVideo(
            { url: videoUrl },
            { caption: `🎬 **ویدیو ساخته شد!**\n\n📝 پرامپت: ${prompt}`, parse_mode: 'Markdown' }
        );
        
        userSessions.delete(userId);
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (error) {
        console.error('AI Video Error:', error);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ خطا در ساخت ویدیو. لطفاً دوباره تلاش کن.');
        userSessions.delete(userId);
    }
    return;
        }
        const safetyCheck = isPromptSafe(prompt, userId);
        if (!safetyCheck.safe) {
            return ctx.reply(
                `🚫 **پرامپت شما رد شد!**\n\n` +
                `❌ دلیل: ${safetyCheck.reason}\n\n` +
                `📌 لطفاً پرامپت مناسب‌تری بنویسید.`
            );
        }
        
        const statusMsg = await ctx.reply('🎨 در حال خلق تصویر...');
        
        try {
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;
            
            await ctx.replyWithPhoto(
                { url: imageUrl },
                { caption: `🎨 **تصویر ساخته شد!**\n\n📝 پرامپت: ${prompt}`, parse_mode: 'Markdown' }
            );
            
            userSessions.delete(userId);
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (error) {
            console.error('AI Image Error:', error);
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ خطا در ساخت تصویر. لطفاً دوباره تلاش کن.');
            userSessions.delete(userId);
        }
        return;
    }

    // --- تولید ویدیو با AI ---
    if (session.mode === 'ai_video') {
        if (!isPremium(userId)) return ctx.reply('❌ این قابلیت پولی است!');
        
        const prompt = text.trim();
        if (!prompt) return ctx.reply('❌ لطفاً یک پرامپت بنویس.');
        
        if (/[\u0600-\u06FF]/.test(prompt)) {
            return ctx.reply(
                '⚠️ **پرامپت باید انگلیسی باشد!**\n\n' +
                '❌ پرامپت فارسی پشتیبانی نمی‌شود.\n' +
                '✅ لطفاً توضیح ویدیو را به انگلیسی بنویسید.\n\n' +
                '📝 مثال:\n' +
                '`A majestic dragon soaring through clouds`'
            );
        }
        
        const safetyCheck = isPromptSafe(prompt, userId);
        if (!safetyCheck.safe) {
            return ctx.reply(
                `🚫 **پرامپت شما رد شد!**\n\n` +
                `❌ دلیل: ${safetyCheck.reason}\n\n` +
                `📌 لطفاً پرامپت مناسب‌تری بنویسید.`
            );
        }
        
        const statusMsg = await ctx.reply('🎬 در حال ساخت ویدیو... (ممکنه چند دقیقه طول بکشه)');
        
        try {
            const videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=seedance&nologo=true`;
            
            await ctx.replyWithVideo(
                { url: videoUrl },
                { caption: `🎬 **ویدیو ساخته شد!**\n\n📝 پرامپت: ${prompt}`, parse_mode: 'Markdown' }
            );
            
            userSessions.delete(userId);
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (error) {
            console.error('AI Video Error:', error);
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ خطا در ساخت ویدیو. لطفاً دوباره تلاش کن.');
            userSessions.delete(userId);
        }
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

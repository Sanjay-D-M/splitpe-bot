const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');

// ─── GOOGLE SHEETS SETUP ───────────────────────────────────

const SPREADSHEET_ID = '1UA_hZoPHq_b088mgIKKwoO9sQEWDTULfBMuaIzpBmug';
const EXPENSE_SHEET = 'Sheet1';
const UPI_SHEET = 'UPIIds';

async function getSheetClient() {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// ─── UPI ID FUNCTIONS ──────────────────────────────────────

async function saveUPIId(name, upiId) {
    try {
        const sheets = await getSheetClient();

        // First check if name already exists
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${UPI_SHEET}!A:B`,
        });

        const rows = res.data.values || [];
        const existingRow = rows.findIndex(r => r[0]?.toLowerCase() === name.toLowerCase());

        if (existingRow > 0) {
            // Update existing row
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${UPI_SHEET}!B${existingRow + 1}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[upiId]] }
            });
        } else {
            // Append new row
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${UPI_SHEET}!A:B`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[name, upiId]] }
            });
        }
        return true;
    } catch (err) {
        console.error('❌ UPI save error:', err.message);
        return false;
    }
}

async function getUPIId(name) {
    try {
        const sheets = await getSheetClient();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${UPI_SHEET}!A:B`,
        });

        const rows = res.data.values || [];
        const row = rows.find(r => r[0]?.toLowerCase() === name.toLowerCase());
        return row ? row[1] : null;
    } catch (err) {
        console.error('❌ UPI fetch error:', err.message);
        return null;
    }
}

// ─── EXPENSE FUNCTIONS ─────────────────────────────────────

async function logExpense(group, paidBy, amount, reason, perPerson) {
    try {
        const sheets = await getSheetClient();
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${EXPENSE_SHEET}!A:F`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[
                    new Date().toLocaleString('en-IN'),
                    group,
                    paidBy,
                    amount,
                    reason,
                    perPerson
                ]]
            }
        });
        console.log(`✅ Logged: ${paidBy} paid ₹${amount} for ${reason}`);
    } catch (err) {
        console.error('❌ Sheets error:', err.message);
    }
}

async function getGroupBalances(group) {
    try {
        const sheets = await getSheetClient();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${EXPENSE_SHEET}!A:F`,
        });

        const rows = res.data.values || [];
        const groupRows = rows.slice(1).filter(r => r[1] === group);
        if (groupRows.length === 0) return null;

        const balances = {};
        groupRows.forEach(row => {
            const paidBy = row[2];
            const amount = parseInt(row[3]);
            const perPerson = parseInt(row[5]);
            balances[paidBy] = (balances[paidBy] || 0) + (amount - perPerson);
        });

        return balances;
    } catch (err) {
        console.error('❌ Sheets read error:', err.message);
        return null;
    }
}

// ─── WHATSAPP CLIENT ───────────────────────────────────────

const { execSync } = require('child_process');

function findChromium() {
    const paths = [
        '/run/current-system/sw/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/nix/var/nix/profiles/default/bin/chromium',
    ];

    for (const p of paths) {
        try {
            execSync(`test -f ${p}`);
            return p;
        } catch {}
    }

    try {
        return execSync('which chromium').toString().trim();
    } catch {}

    try {
        return execSync('which chromium-browser').toString().trim();
    } catch {}

    return null;
}

const chromiumPath = findChromium();
console.log('🔍 Chromium found at:', chromiumPath);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: chromiumPath || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('📱 Scan QR code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ SplitPe bot is live!');
});

// ─── COMMAND HANDLERS ──────────────────────────────────────

// HELP
async function handleHelp(msg) {
    let reply = `👋 *Welcome to SplitPe!*\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `Here's what I can do:\n\n`;
    reply += `💸 *Split a bill:*\n`;
    reply += `@splitpe ₹1240 Rahul paid dinner\n\n`;
    reply += `📊 *Check balances:*\n`;
    reply += `@splitpe balance\n\n`;
    reply += `📲 *Register your UPI ID:*\n`;
    reply += `@splitpe register Rahul rahul@okaxis\n\n`;
    reply += `❓ *Show this help:*\n`;
    reply += `@splitpe help\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `_Tip: Register your UPI ID once so others can pay you with one tap_ ✌️`;

    await msg.reply(reply);
}

// REGISTER UPI
async function handleRegister(msg, parts) {
    // Format: @splitpe register Rahul rahul@okaxis
    if (parts.length < 4) {
        await msg.reply(
            `❌ Wrong format.\n\nTry:\n@splitpe register Rahul rahul@okaxis`
        );
        return;
    }

    const name = parts[2];
    const upiId = parts[3];

    // Basic UPI validation
    if (!upiId.includes('@')) {
        await msg.reply(`❌ That doesn't look like a valid UPI ID.\n\nExample: rahul@okaxis, sneha@paytm`);
        return;
    }

    const saved = await saveUPIId(name, upiId);

    if (saved) {
        await msg.reply(
            `✅ *Registered!*\n\n*${name}* → \`${upiId}\`\n\nNow when ${name} pays, everyone gets a real UPI link to pay them back instantly. 🎉`
        );
    } else {
        await msg.reply(`❌ Something went wrong. Try again.`);
    }
}

// SPLIT
async function handleSplit(msg) {
    const chat = await msg.getChat();
    const groupName = chat.name || 'private';
    const participants = chat.participants;
    const count = participants?.length || 2;

    const body = msg.body.trim();
    const amountMatch = body.match(/₹?(\d+)/);
    const paidMatch = body.match(/(\w+)\s+paid/i);
    const reasonMatch = body.match(/paid\s+(.+)/i);

    if (!amountMatch || !paidMatch) {
        await msg.reply(`❌ Couldn't understand that.\n\nTry:\n@splitpe ₹1240 Rahul paid dinner\n\nOr type *@splitpe help* to see all commands.`);
        return;
    }

    const amount = parseInt(amountMatch[1]);
    const paidBy = paidMatch[1];
    const reason = reasonMatch ? reasonMatch[1].trim() : 'expense';
    const perPerson = Math.ceil(amount / count);

    // Try to get real UPI ID
    const upiId = await getUPIId(paidBy);
    const upiLink = upiId
        ? `upi://pay?pa=${upiId}&pn=${paidBy}&am=${perPerson}&cu=INR`
        : null;

    // Log to sheets
    await logExpense(groupName, paidBy, amount, reason, perPerson);

    // Build reply
    let reply = `⚡ *SplitPe*\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `📋 *${reason.toUpperCase()}* — ₹${amount}\n`;
    reply += `👥 Split ${count} ways = *₹${perPerson} each*\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `✅ *${paidBy}* paid — collects ₹${amount - perPerson}\n\n`;
    reply += `💸 *Everyone owes ₹${perPerson}:*\n`;

    if (upiLink) {
        reply += `👉 *Pay ${paidBy}:* ${upiLink}\n`;
    } else {
        reply += `⚠️ ${paidBy} hasn't registered a UPI ID yet.\n`;
        reply += `Ask them to run: @splitpe register ${paidBy} their@upi\n`;
    }

    reply += `━━━━━━━━━━━━━━\n`;
    reply += `_Powered by SplitPe_ ✌️`;

    await msg.reply(reply);
}

// BALANCE
async function handleBalance(msg) {
    const chat = await msg.getChat();
    const groupName = chat.name || 'private';
    const balances = await getGroupBalances(groupName);

    if (!balances || Object.keys(balances).length === 0) {
        await msg.reply(`📊 No expenses recorded for this group yet.\n\nTry:\n@splitpe ₹500 Rahul paid lunch`);
        return;
    }

    let reply = `📊 *SplitPe — Running Balances*\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    Object.entries(balances).forEach(([name, amount]) => {
        const emoji = amount > 0 ? '🟢' : '🔴';
        const label = amount > 0 ? `to collect ₹${amount}` : `owes ₹${Math.abs(amount)}`;
        reply += `${emoji} *${name}* — ${label}\n`;
    });
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `_Powered by SplitPe_ ✌️`;

    await msg.reply(reply);
}

// ─── MESSAGE ROUTER ────────────────────────────────────────

client.on('message', async (msg) => {
    const body = msg.body.trim();
    if (!body.toLowerCase().startsWith('@splitpe')) return;

    console.log(`📨 Command: ${body}`);

    const parts = body.split(/\s+/);
    const command = parts[1]?.toLowerCase();

    if (command === 'help') {
        await handleHelp(msg);
    } else if (command === 'register') {
        await handleRegister(msg, parts);
    } else if (command === 'balance') {
        await handleBalance(msg);
    } else {
        await handleSplit(msg);
    }
});

client.initialize();
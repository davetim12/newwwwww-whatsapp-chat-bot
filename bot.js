const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// ---------- Pabbly webhook ----------
const PABBLY_WEBHOOK_URL = "https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTY1MDYzMTA0MzM1MjZjNTUzNjUxM2Ii_pc";

async function sendToPabbly(data) {
    try {
        await axios.post(PABBLY_WEBHOOK_URL, data);
        console.log("✅ Data sent to Pabbly successfully!");
    } catch (error) {
        console.error("❌ Error sending data to Pabbly:", error.message);
    }
}

// ---------- WhatsApp client ----------
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }
});

// ---------- Questions ----------
const questions = [
    "✅ Great! First, may I know your Full Name?",
    "What's your Phone Number?",
    "What's your Email?",
    "What's your Street Address?",
    "What's your Postal Code?"
];

// ---------- Track user progress ----------
let userProgress = {};

// ---------- Events ----------
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log("📌 Scan the QR code above to connect your WhatsApp.");
});

client.on('ready', () => {
    console.log("✅ WhatsApp bot is ready and connected!");
});

client.on('message', async (message) => {
    try {
        const from = message.from;
        const msg = message.body.trim();

        // Start conversation
        if (msg.toLowerCase().includes("hello") && !userProgress[from]) {
            userProgress[from] = { step: 0, answers: {} };
            await message.reply(questions[0]);
            console.log(`💬 Started chat with ${from}`);
            return;
        }

        // Continue conversation
        if (userProgress[from]) {
            const step = userProgress[from].step;
            userProgress[from].answers[`answer${step}`] = msg;

            if (step < questions.length - 1) {
                userProgress[from].step++;
                await message.reply(questions[userProgress[from].step]);
            } else {
                await message.reply("✅ Thank you! Your details have been received.");

                // Prepare data to send to Pabbly
                const dataToSend = {
                    name: userProgress[from].answers.answer0,
                    phone: userProgress[from].answers.answer1,
                    email: userProgress[from].answers.answer2,
                    address: userProgress[from].answers.answer3,
                    postalCode: userProgress[from].answers.answer4,
                    whatsappNumber: from
                };

                // Send to Pabbly
                await sendToPabbly(dataToSend);

                // Clear user progress
                delete userProgress[from];
            }
        }
    } catch (err) {
        console.error('❌ Message handler error:', err.message);
    }
});

// ---------- Handle crashes gracefully ----------
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message);
    // Optionally restart client after delay
    setTimeout(() => {
        console.log("🔄 Restarting WhatsApp client...");
        client.initialize();
    }, 5000);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection:', reason);
});

// ---------- Start client ----------
client.initialize();

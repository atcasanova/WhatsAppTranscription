const wa = require('@open-wa/wa-automate');
const mime = require('mime-types');
const fs = require('fs');
const { Configuration, OpenAIApi } = require("openai");

require('dotenv').config();
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const path_mp3 = process.env.PATH_MP3 ? process.env.PATH_MP3 : '.' ;
const sessionDataPath = process.env.PATH_SESSION ? process.env.PATH_SESSION : './' ;
const groups = process.env.GROUPS ? process.env.GROUPS : 'xxxx,yyyy' ;
const allowedGroups = groups.split(',');
const user_phone = process.env.USER_PHONE ? process.env.USER_PHONE + '@c.us' : 'NA' ;
const MODEL = process.env.MODEL ? process.env.MODEL : 'gpt-4o-mini' ;
const PROMPT = process.env.PROMPT ? process.env.PROMPT : 'Faça um resumo das seguintes mensagens, deixando claro o que foi dito e os participantes da conversa. Abuse do bom humor para descrever o que foi dito, e deixe claro caso algum participante tenha deixado de responder a alguma questão:' ;

let messageHistory = {};
let currentDay = new Date().getDate();

wa.create({
    useChrome: true,
    sessionId: "WhatsAppTranscription",
    multiDevice: true,
    authTimeout: 60,
    blockCrashLogs: true,
    disableSpins: true,
    headless: true,
    hostNotificationLang: 'PT_BR',
    logConsole: true,
    popup: true,
    qrTimeout: 0,
    sessionDataPath,
}).then(client => start(client));

function start(client) {
    client.onAnyMessage(async message => {
        const sender = message.sender.pushname || message.sender.verifiedName || message.sender.shortName;
        const isGroupMessage = message.isGroupMsg;
        const groupId = message.chatId;
        const fromUserId = message.sender.id;

        console.log(`Received message from ${sender} (${fromUserId}): ${message.body}`);

        // Clear old messages at the start of a new day
        const messageDay = new Date().getDate();
        if (messageDay !== currentDay) {
            console.log('New day detected. Clearing old messages.');
            messageHistory = {};
            currentDay = messageDay;
        }

        // Save messages from specified groups
        if (allowedGroups.includes(groupId)) {
            if (!messageHistory[groupId]) {
                messageHistory[groupId] = [];
            }

            let logMessage = {
                from: sender,
                body: message.body,
                timestamp: message.timestamp * 1000 // Convert to milliseconds
            };

            if (message.type === 'image') {
                logMessage.body = 'User sent an image';
            }

            messageHistory[groupId].push(logMessage);
            console.log(`Message saved from ${sender}`);
        }

        // Save voice messages
        if (message.type === "ptt" || message.type === "audio") {
            const filename = `${path_mp3}/${message.id}.${mime.extension(message.mimetype)}`;
            const mediaData = await wa.decryptMedia(message);

            fs.writeFile(filename, mediaData, err => {
                if (err) { return console.log(err); }
                console.log('Voice file saved:', filename);
            });
        }

        // Check for "!ler" reply and transcribe
        if (fromUserId === user_phone && message.body === "!ler" && message.quotedMsg && (message.quotedMsg.type === "ptt" || message.quotedMsg.type === "audio")) {
            console.log(`'!ler' command triggered by ${sender}`);
            const originalMessageId = message.quotedMsg.id;
            const filePath = `${path_mp3}/${originalMessageId}.${mime.extension(message.quotedMsg.mimetype)}`;

            if (fs.existsSync(filePath)) {
                console.log(`Transcribing file: ${filePath}`);
                const resp = await openai.createTranscription(fs.createReadStream(filePath), "whisper-1");
                console.log(`Transcribed text: ${resp.data.text}`);
                await client.reply(message.chatId, `🗣️ ${resp.data.text}`, message.id);
            } else {
                console.log('File not found for transcription:', filePath);
            }
        }

        // Check for "!resumo" command
        if (allowedGroups.includes(groupId) && message.body === "!resumo") {
            console.log(`'!resumo' command triggered by ${sender}`);
            const today = new Date().setHours(0, 0, 0, 0);
            const todayMessages = messageHistory[groupId].filter(msg => new Date(msg.timestamp).setHours(0, 0, 0, 0) === today);
            const messagesText = todayMessages.map(msg => `${new Date(msg.timestamp).toLocaleTimeString()} - ${msg.from}: ${msg.body}`).join('\n');

            if (messagesText) {
                console.log('Generating summary...');
                const summaryResp = await openai.createChatCompletion({
                    model: MODEL,
                    messages: [{ role: "user", content: `${PROMPT}\n${messagesText}` }],
                });
                const summary = summaryResp.data.choices[0].message.content;
                console.log('Summary generated:', summary);
                await client.reply(message.chatId, `📋 Resumo:\n${summary}`, message.id);
            } else {
                console.log('No messages to summarize for today.');
            }
        }
    });
}

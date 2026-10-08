// server.js - WhatsApp Bot Engine (Baileys + Branching Routes)
const { default: makeWASocket, useMultiFileAuthState, disconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");

// Bot Flow Configuration Data with Multi-Option Branching
const botFlow = [
  {
    "id": 1,
    "type": "start",
    "title": "Start Keyword",
    "trigger": "hi",
    "nextNodeId": 2
  },
  {
    "id": 2,
    "type": "message",
    "title": "Welcome Greeting",
    "content": "Hello! 👋 Wellcome to veloura.in . Ningall Udheshicha product offer I'll thanneh ippol available aahnu ",
    "nextNodeId": 3
  },
  {
    "id": 3,
    "type": "buttons",
    "title": "Main Options",
    "content": "Please select one of the quick options below:",
    "buttons": [
      {
        "text": "1. Free delivery, cash on delivery unddooh? 🗣️",
        "targetNodeId": 4
      },
      {
        "text": "2. Ordering form.! ",
        "targetNodeId": 6
      },
      {
        "text": "3. More about product. ",
        "targetNodeId": 7
      }
    ],
    "nextNodeId": 4
  },
  {
    "id": 4,
    "type": "question",
    "title": "About delivery",
    "content": "Free delivery available aahnu, (all Kerala) \n    Paksheeh ningall pakuthi paisa online ayyakanam enn aahnu ship akkkan pattolluh company policy aahnu. \nDetails daily ningaleeh update cheyyunnathayirikkum. \n\nBaakkki fund ningall product nallathahno quality check nokkitt ayachall mathi paksheeh box 📦open cheyyunna muthal oru video idukkanam.! \n",
    "variable": "user informed",
    "nextNodeId": 6
  },
  {
    "id": 6,
    "type": "question",
    "title": "Collect Lead",
    "content": "Name :\nPhone no1:\nPhone no2:   (optional) \nLand mark:       \nPincode :                 district:                       state:",
    "variable": "user_details",
    "nextNodeId": 8
  },
  {
    "id": 7,
    "type": "question",
    "title": "About product",
    "content": "Product high quality premium product annuu\nIppol high offers ahnu nadakkunathu miss cheyyandaah 🤗\n",
    "variable": "user_product_details",
    "nextNodeId": 6
  },
  {
    "id": 8,
    "type": "message",
    "title": "Text Message",
    "content": "Ningaleeh payments details nangaluddeh team  mange cheyyum ( ai ) thankyou😊",
    "nextNodeId": null
  },
  {
    "id": 9,
    "type": "ai",
    "title": "AI Assistant",
    "systemInstruction": "You are an AI support agent answering queries politely."
  }
];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.PHONE_NUMBER || "919000000000"; 
    setTimeout(async () => {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`\n=========================================`);
      console.log(`YOUR WHATSAPP PAIRING CODE: ${code}`);
      console.log(`Link via WhatsApp > Linked Devices > Link with Phone Number`);
      console.log(`=========================================\n`);
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== disconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ WhatsApp Bot Connected & Running 24/7!');
    }
  });

  // User session state to remember current button node
  const userSessions = {};

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();

    const startNode = botFlow.find(n => n.type === 'start');
    if (text === startNode.trigger.toLowerCase()) {
      userSessions[from] = startNode.id;
      await sendNodeResponse(sock, from, startNode.nextNodeId, userSessions);
      return;
    }

    // Check if user is replying to an options menu
    const currentSessionNodeId = userSessions[from];
    if (currentSessionNodeId) {
      const activeNode = botFlow.find(n => n.id === currentSessionNodeId);
      if (activeNode && activeNode.type === 'buttons') {
        // Find matching option by button index (1, 2, 3) or button text
        const matchedButton = activeNode.buttons.find((b, idx) => 
          text === String(idx + 1) || text.includes(b.text.toLowerCase())
        );

        if (matchedButton && matchedButton.targetNodeId) {
          await sendNodeResponse(sock, from, matchedButton.targetNodeId, userSessions);
          return;
        }
      }
    }
  });
}

async function sendNodeResponse(sock, from, nodeId, userSessions) {
  if (!nodeId) return;
  const node = botFlow.find(n => n.id === nodeId);
  if (!node) return;

  userSessions[from] = node.id;

  if (node.type === 'message' || node.type === 'question') {
    await sock.sendMessage(from, { text: node.content });
    if (node.nextNodeId) await sendNodeResponse(sock, from, node.nextNodeId, userSessions);
  } else if (node.type === 'buttons') {
    const btnText = node.content + '\n\n' + node.buttons.map((b, i) => `${i+1}. ${b.text}`).join('\n');
    await sock.sendMessage(from, { text: btnText });
  } else if (node.type === 'image') {
    await sock.sendMessage(from, { image: { url: node.imageUrl }, caption: node.caption });
    if (node.nextNodeId) await sendNodeResponse(sock, from, node.nextNodeId, userSessions);
  } else if (node.type === 'ai') {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent(`${node.systemInstruction}\nUser query: hello`);
      await sock.sendMessage(from, { text: result.response.text() });
    } catch (err) {
      await sock.sendMessage(from, { text: "AI Service temporarily busy." });
    }
  }
}

startBot();

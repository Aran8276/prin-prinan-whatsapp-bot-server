import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import {pino} from "pino";
import process from "node:process";

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./.auth/");
  const devId = process.env.DEV_MODE_ID;
  const isDevMode = process.env.DEV_MODE === "true";

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log("Scan the QR above");
    }

    if (connection === "close") {
      const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !==
          DisconnectReason.loggedOut;

      console.log("Connection closed. Reconnecting:", shouldReconnect);

      if (shouldReconnect) {
        start();
      }
    } else if (connection === "open") {
      console.log("Connected successfully");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const text =
        msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (text.toLowerCase() === ".getid") {
      await sock.sendMessage(msg.key.remoteJid!, {
        text: "Hi, *"+ msg.pushName+"*! \n Your user ID: `" + (msg.key.remoteJid ?? "unknown") +"` \n Alternative ID: `" + (msg.key.remoteJidAlt ?? "unknown") + "` \n" + isDevMode && "Development mode is currently on."
      });
    }
  });
}

start();

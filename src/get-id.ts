import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./.auth/");

  const sock = makeWASocket({
    auth: state,
    // printQRInTerminal: true,
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

    if (text.toLowerCase() === "ping") {
      await sock.sendMessage(msg.key.remoteJid!, {
        text: msg.id,
      });
    } else if(msg.message.imageMessage) {

      console.log(msg.message.imageMessage)
      await sock.sendMessage(msg.key.remoteJid!, {});
    }else {
      console.log(msg);
    }
  });
}

start();

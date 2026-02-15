import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import type {WASocket} from "@whiskeysockets/baileys";
import { pino } from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";

let sock: WASocket;
let qrCodeDataUrl: string | null = null;
let connectionStatus: string = "connecting";

export const getClient = () => sock;
export const getQrCode = () => qrCodeDataUrl;
export const getStatus = () => connectionStatus;

export async function initializeWhatsAppClient() {
  const { state, saveCreds } = await useMultiFileAuthState("./.auth/");

  sock = makeWASocket({
    auth: state,
    // printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    browser: ["PrinPrinan", "Chrome", "20.0.04"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCodeDataUrl = await QRCode.toDataURL(qr);
      connectionStatus = "qr";
      console.log("QR code available, scan with your phone.");
    }

    if (connection === "open") {
      connectionStatus = "connected";
      console.log("WhatsApp connected");
      return;
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 440 // conflict
      ) {
        console.error("Session replaced. Exiting process.");
        console.log("[INFO] If the process keep failing to start, check for exiting node process and try to stop it. Only one client is allowed to connect at the same time.");
        process.exit(1);
      }
    }

  });


  return sock;
}
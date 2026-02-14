import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,



} from "@whiskeysockets/baileys";
import type {WAMessageContent, WAMessageKey, downloadMediaMessage, WASocket} from "@whiskeysockets/baileys";
import { pino } from "pino";
import QRCode from "qrcode";
import * as fs from "node:fs/promises";
import path from "node:path";
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
    if (connection === "close") {
      const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;
      connectionStatus = `closed, reconnecting: ${shouldReconnect}`;
      console.log(
          "Connection closed due to ",
          lastDisconnect?.error,
          ", reconnecting ",
          shouldReconnect,
      );
      if (shouldReconnect) {
        await initializeWhatsAppClient();
      }
    } else if (connection === "open") {
      connectionStatus = "connected";
      console.log("Connection opened");
    }
  });

  return sock;
}
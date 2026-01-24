import fs from "fs";
import path, { dirname } from "path";
import qrcode from "qrcode-terminal";
import { fileURLToPath } from "url";
import Whatsapp from "whatsapp-web.js";

const { Client, LocalAuth } = Whatsapp;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = path.join(__dirname, "../.env");
const key = "DEV_MODE_ID";

let envContent = "";
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, "utf8");
}

export const client = new Client({
  authStrategy: new LocalAuth({ clientId: "your-client-id" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-popup-blocking",
    ],
  },
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("Menunggu Pesan Pertama");
});

client.on("message_create", async (msg) => {
  const payload = await msg.getChat();

  console.log(`Message received with the text: ${msg.body}`);
  console.warn(`YOUR ID IS: ${payload.id._serialized}`);

  const newEntry = `${key}="${payload.id._serialized}"`;
  const regex = new RegExp(`^${key}=.*`, "m");

  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, newEntry);
  } else {
    envContent += `\n${newEntry}`;
  }

  fs.writeFileSync(envPath, envContent.trim() + "\n");
  console.info(`Updated env ${key} to ${payload.id._serialized}`);

  process.exit(0);
});

client.initialize();

import "dotenv/config";
import cluster from "node:cluster";
import process from "node:process";
import qrcodeTerminal from "qrcode-terminal";
import { client } from "./core/client.ts";
import {
  askForCustomerName,
  checkConfigsAndProceed,
  generateSummaryAndQr,
  processMediaMessage,
  promptForUnsetConfig,
  calculateFilePrice // Import the helper
} from "./features/printFlow.ts";
import { fetchPricing } from "./services/api.ts";
import { deleteSession, getSession, setSession } from "./store/session.ts";
import { GREETINGS } from "./utils/constants.ts";
import { validateConfig } from "./utils/helpers.ts";

if (cluster.isPrimary) {
  console.log(`[Primary] Master process running (PID: ${process.pid})`);

  cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    console.log(
      `[Primary] Worker ${worker.process.pid} died with code: ${code}, signal: ${signal}`,
    );
    console.log("[Primary] Starting a new worker in 5 seconds...");

    setTimeout(() => {
      cluster.fork();
    }, 5000);
  });
} else {
  client.on("qr", (qr) => {
    console.log(
      `[Worker ${process.pid}] Scan QR Code di bawah ini untuk login WhatsApp Server:`,
    );
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log(
      `Server PrinPrinan Telah Jalan (PID: ${process.pid}) - Siap Melayani`,
    );
    fetchPricing();
  });

  client.on("disconnected", (reason) => {
    console.log(`[Worker ${process.pid}] Client disconnected:`, reason);
    process.exit(1);
  });

  client.on("message_create", async (msg) => {
    if (msg.fromMe) return;

    const devId = process.env.DEV_MODE_ID;
    const isDevMode = process.env.DEV_MODE === "true";
    const chatId = msg.from;

    const isDevTrigger = isDevMode && chatId === devId;
    const isProdTrigger = !isDevMode;
    if (!isDevTrigger && !isProdTrigger) return;

    const chat = await msg.getChat();
    const text = msg.body.trim();
    const lowerText = text.toLowerCase();

    if (text === "0") {
      if (getSession(chatId)) {
        deleteSession(chatId);
        await chat.unarchive();
        await client.sendMessage(
          chatId,
          "❌ Sesi dibatalkan. Data dihapus & Chat di-unarchive.",
        );
      } else {
        await client.sendMessage(chatId, "✅ Tidak ada sesi aktif.");
      }
      return;
    }

    if (lowerText === "!opsi" || lowerText === "!duplex") {
      await client.sendMessage(
        chatId,
        "*Opsi Cetak Lanjutan:*\n\n" +
          "Anda dapat menambahkan opsi berikut pada caption file Anda:\n" +
          "1. *Salinan*: `copies=2`\n" +
          "2. *Kertas*: `paper=A4`\n" +
          "3. *Skala*: `scale=fit`\n" +
          "4. *Bolak-balik*: `side=duplex`\n" +
          "5. *Halaman*: `pages=1-5`\n",
      );
      return;
    }

    let session = getSession(chatId);

    if (!session) {
      if (msg.hasMedia) {
        session = { step: "AWAITING_FILES", files: [] };
        setSession(chatId, session);
        await chat.archive();

        await processMediaMessage(msg, chatId, session);
        return;
      }

      if (lowerText === "print") {
        setSession(chatId, { step: "AWAITING_FILES", files: [] });
        await chat.archive();
        await fetchPricing();
        await client.sendMessage(
          chatId,
          "👋 Selamat Datang di PrinPrinan!\n\n" +
            "📄 Silakan *kirim file* dokumen/foto yang ingin diprint.\n" +
            "👉 Format: PDF, DOCX, DOC, JPG, PNG.\n\n" +
            "ℹ️ Anda juga bisa langsung kirim file tanpa ketik 'print' untuk order selanjutnya.",
        );
        return;
      }

      if (GREETINGS.some((g) => lowerText.startsWith(g))) {
        await chat.unarchive();
        await client.sendMessage(
          chatId,
          "Halo! 👋 Ini adalah nomor resmi *PrinPrinan Self-Service*.\n\n" +
            "Untuk nge-print, silakan ketik *print* atau *langsung kirim file* Anda di sini. 🖨️",
        );
        return;
      }

      return;
    }

    switch (session.step) {
      case "AWAITING_FILES":
        if (msg.hasMedia) {
          await processMediaMessage(msg, chatId, session);
        } else {
          if (["2", "selesai", "done", "lanjut"].includes(lowerText)) {
            if (session.files.length === 0) {
              await client.sendMessage(
                chatId,
                "⚠️ Belum ada file yang dikirim. Kirim file dulu atau ketik 0 untuk batal.",
              );
              return;
            }

            await checkConfigsAndProceed(chat, chatId, session);
          } else {
            await client.sendMessage(
              chatId,
              "⚠️ Pesan tidak dikenali.\n📥 Kirim file atau ketik *2* jika selesai.",
            );
          }
        }
        break;

      case "CONFIGURING_UNSET_FILES":
        if (session.configIndex === undefined) {
          session.step = "AWAITING_FILES";
          return;
        }

        const validConfig = validateConfig(text);
        if (!validConfig) {
          await client.sendMessage(
            chatId,
            `❌ Format salah. Ketik: \`warna\`, \`hitam\`, atau range halaman (cth: 1-5).`,
          );
          return;
        }

        const currentFile = session.files[session.configIndex];
        currentFile.config = validConfig;

        // Trigger price calculation (API call) here
        await calculateFilePrice(currentFile, chatId);

        const nextUnsetIndex = session.files.findIndex((f) => !f.config);
        if (nextUnsetIndex !== -1) {
          session.configIndex = nextUnsetIndex;
          await promptForUnsetConfig(chatId, session);
        } else {
          await askForCustomerName(chatId, session);
        }
        break;

      case "AWAITING_NAME":
        if (text.length < 2) {
          await client.sendMessage(
            chatId,
            "⚠️ Nama terlalu pendek. Silakan masukkan nama Anda untuk label pesanan.",
          );
          return;
        }
        session.customerName = text;
        await generateSummaryAndQr(chat, chatId, session);
        break;
    }
  });

  client.initialize();
}
import "dotenv/config";
import cluster from "node:cluster";
import process from "node:process";
import qrcodeTerminal from "qrcode-terminal";
import { client } from "./core/client.ts";
import {
  askForCopies,
  askForCustomerName,
  askForEdit,
  askForEditNotes,
  askForPages,
  calculateFilePrice,
  checkConfigsAndProceed,
  generateSummaryAndQr,
  processMediaMessage,
  promptForUnsetConfig,
} from "./features/printFlow.ts";
import { fetchPricing } from "./services/api.ts";
import { deleteSession, getSession, setSession } from "./store/session.ts";
import { GREETINGS } from "./utils/constants.ts";
import {
  calculatePageCountFromRange,
  validateColorSetting,
  validatePageRange,
} from "./utils/helpers.ts";

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
          `🔚 Order PrinPrinan telah dibatalkan.\n\n` +
            `Silakan kirim file lagi untuk mengajukan order baru. Terima Kasih 🙏`,
        );
      } else {
        await client.sendMessage(
          chatId,
          "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
            "Langsung kirim file print aja ya 🙏",
        );
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
          "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
            "Langsung kirim file print aja ya 🙏",
        );
        return;
      }

      if (GREETINGS.some((g) => lowerText.startsWith(g))) {
        await chat.unarchive();
        await client.sendMessage(
          chatId,
          "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
            "Langsung kirim file print aja ya 🙏",
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

        const validConfig = validateColorSetting(text);
        if (!validConfig) {
          await client.sendMessage(
            chatId,
            `⚠️ Input tidak valid. Mohon ketik *hitam* atau *warna*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.`,
          );
          return;
        }

        const currentFile = session.files[session.configIndex];
        currentFile.config = validConfig;

        await calculateFilePrice(currentFile, chatId);
        await askForPages(chatId, session);
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
      case "AWAITING_COPIES":
        if (session.configIndex !== undefined) {
          const copies = parseInt(text, 10);
          if (isNaN(copies) || copies < 1) {
            await client.sendMessage(
              chatId,
              "⚠️ Input tidak valid. Mohon masukkan jumlah lembar dalam bentuk angka (contoh: 1).\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.",
            );
            return;
          }
          session.files[session.configIndex].copies = copies;
          await askForEdit(chatId, session);
        }
        break;
      case "AWAITING_PAGES":
        if (session.configIndex !== undefined) {
          const file = session.files[session.configIndex];

          if (
            lowerText !== "semua" &&
            !validatePageRange(text, file.totalFilePages)
          ) {
            await client.sendMessage(
              chatId,
              `⚠️ Format halaman tidak valid. Mohon masukkan format yang benar (contoh: \`1-5,7\`) dan pastikan nomor halaman tidak melebihi total halaman file (${file.totalFilePages}).\n\nAtau ketik *semua*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.`,
            );
            return;
          }

          if (lowerText.toLowerCase() === "semua") {
            file.pagesToPrint = undefined;
          } else {
            file.pagesToPrint = text;
          }

          file.calculatedPages = calculatePageCountFromRange(
            file.pagesToPrint,
            file.totalFilePages,
          );

          if (file.config) {
            await calculateFilePrice(file, chatId);
          }

          await askForCopies(chatId, session);
        }
        break;

      case "AWAITING_EDIT":
        if (session.configIndex !== undefined) {
          if (lowerText !== "edit" && lowerText !== "otomatis") {
            await client.sendMessage(
              chatId,
              "⚠️ Input tidak valid. Mohon ketik *edit* atau *otomatis*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.",
            );
            return;
          }

          const file = session.files[session.configIndex];
          if (lowerText === "edit") {
            file.needsEdit = true;
            await askForEditNotes(chatId, session);
          } else {
            session.configIndex++;

            if (session.configIndex < session.files.length) {
              const nextFile = session.files[session.configIndex];
              if (!nextFile.config) {
                session.step = "CONFIGURING_UNSET_FILES";
                await promptForUnsetConfig(chatId, session);
              } else {
                session.step = "AWAITING_PAGES";
                await askForPages(chatId, session);
              }
            } else {
              await askForCustomerName(chatId, session);
            }
          }
        }
        break;
      case "AWAITING_EDIT_NOTES":
        if (session.configIndex !== undefined) {
          const file = session.files[session.configIndex];
          file.editNotes = text;
          session.configIndex++;

          if (session.configIndex < session.files.length) {
            const nextFile = session.files[session.configIndex];
            if (!nextFile.config) {
              session.step = "CONFIGURING_UNSET_FILES";
              await promptForUnsetConfig(chatId, session);
            } else {
              session.step = "AWAITING_PAGES";
              await askForPages(chatId, session);
            }
          } else {
            await askForCustomerName(chatId, session);
          }
        }
        break;
    }
  });

  client.initialize();
}

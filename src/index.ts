import "dotenv/config";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;

type FileData = {
  filename: string;
  mime: string;
  config: string;
  data: File;
};

type UserState = {
  step: "AWAITING_FILES";
  files: FileData[];
};

const userSessions: Record<string, UserState> = {};

const greetedUsers = new Set<string>();

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
  console.log("Scan QR Code di bawah ini untuk login WhatsApp Server:");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log(
    `Server PrinPrinan Telah Jalan - Siap Melayani ${
      process.env.DEV_MODE === "true"
        ? `\n(DEV MODE AKTIF) ID:${process.env.DEV_MODE_ID}`
        : ""
    }`,
  );
});

client.on("message_create", async (msg) => {
  if (msg.fromMe) return;

  const devId = process.env.DEV_MODE_ID;
  const isDevMode = process.env.DEV_MODE === "true";
  const chatId = (await msg.getChat()).id._serialized;

  const isDevTrigger = isDevMode && chatId === devId;
  const isProdTrigger = !isDevMode;

  if (!isDevTrigger && !isProdTrigger) return;

  const chat = await msg.getChat();
  const text = msg.body.trim();

  if (text === "0") {
    if (userSessions[chatId]) {
      delete userSessions[chatId];
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

  let session = userSessions[chatId];

  if (!session) {
    if (text === "1") {
      userSessions[chatId] = {
        step: "AWAITING_FILES",
        files: [],
      };

      await chat.archive();

      await client.sendMessage(
        chatId,
        "📄 Kirim file Anda dengan *teks/caption* untuk pengaturan cetak.\n" +
          "Format file yang didukung: *PDF, JPEG, JPG, PNG*\n\n" +
          "Contoh Teks Caption untuk PDF:\n" +
          "- `warna` (untuk cetak full color)\n" +
          "- `1-5` (halaman 1-5 Hitam Putih, sisanya warna)\n" +
          "- `1,3,5` (halaman 1 dan 3 dan 5 Hitam Putih, sisanya warna)\n\n" +
          "Contoh Teks untuk Gambar:\n" +
          "- `warna` (untuk cetak warna)\n" +
          "- `1` (untuk cetak Hitam Putih)\n\n" +
          "🔚 Ketik 0 batal",
      );
    } else {
      await chat.unarchive();

      if (!greetedUsers.has(chatId)) {
        greetedUsers.add(chatId);
        await client.sendMessage(
          chatId,
          `Halo, terima kasih sudah menghubungi Rantai Media Digital 👋\n` +
            `Ada yang bisa kami bantu hari ini? 😊\n\n` +
            `Untuk order PrinPrinan Self Service, ketik *1* ya 🖨️.`,
        );
      }
    }
    return;
  }

  switch (session.step) {
    case "AWAITING_FILES":
      if (msg.hasMedia) {
        const caption = msg.body.trim();

        if (!caption) {
          await client.sendMessage(
            chatId,
            "⚠️ File Ditolak! Anda harus menyertakan caption (teks) untuk pengaturan cetak.\n\n" +
              "Contoh: Kirim gambar dengan teks `warna` atau `1` untuk hitam putih.",
          );
          return;
        }

        const lowerInput = caption.toLowerCase();
        const isWarna = lowerInput === "warna";
        const isRange = /^[\d\s,-]+$/.test(caption);

        if (!isWarna && !isRange) {
          await client.sendMessage(
            chatId,
            `⚠️ Pengaturan di caption ('${caption}') tidak valid.\n\n` +
              "Gunakan `warna` untuk Full Color, atau range halaman (misal: `1-3`) untuk Hitam Putih.",
          );
          return;
        }

        const attachmentData = await msg.downloadMedia();
        const fileName = attachmentData.filename || `file-${Date.now()}`;
        const buffer = Buffer.from(attachmentData.data, "base64");
        const fileObject = new File([buffer], fileName, {
          type: attachmentData.mimetype,
        });

        session.files.push({
          filename: fileName,
          mime: attachmentData.mimetype,
          data: fileObject,
          config: isWarna ? "FULL_COLOR" : caption,
        });

        await client.sendMessage(
          chatId,
          `🗃️ File berhasil disimpan:\n\n` +
            `Nama File: *"${fileName} ${attachmentData.mimetype === "application/pdf" ? "📄" : "🖼️"}"*\n` +
            `Pilihan Warna: *"${caption === "warna" ? "Full Color 🌈" : `Hitam Putih ⬛⬜ (Halaman ${caption.includes("-") ? caption.split("-").join(" Sampai ") : caption})`}"*\n\n` +
            `Total: *${session.files.length} file.*\n\n` +
            `👉 Kirim file lainnya jika ada\n` +
            `👉 Ketik *2* untuk selesai.`,
        );
      } else {
        const lower = text.toLowerCase();
        if (
          text === "2" ||
          lower === "selesai" ||
          lower === "done" ||
          lower === "lanjut"
        ) {
          if (session.files.length === 0) {
            await client.sendMessage(
              chatId,
              "⚠️ Anda belum mengirim file apa-pun. Kirim file dulu atau ketik 0 untuk batal.",
            );
            return;
          }

          await client.sendMessage(
            chatId,
            "Siap ✅" +
              "\n\n🔃 Sedang Memproses Order Pesanan Anda. Ditunggu Yah...",
          );

          try {
            const qrDataUrl = await QRCode.toDataURL("Hello world", {
              errorCorrectionLevel: "M",
              margin: 2,
              width: 400,
            });

            const base64Data = qrDataUrl.split(",")[1];
            const media = new MessageMedia(
              "image/png",
              base64Data,
              "print-order.png",
            );

            await client.sendMessage(chatId, media, {
              caption:
                "✅ *Yeay Pesanan Siap!*\n\n" +
                "- 🏢  Kunjungi kios PrinPrinan di Ruang TEFA.\n" +
                "- 📱  Klik *Mulai* pada kios PrinPrinan.\n" +
                "- 📸  Scan & Tunjukkan QR Code berikut.\n" +
                "- 💵  Bayar dengan QRIS atau Manual.\n" +
                "- 👉  Pesananmu akan langsung di-print.",
            });

            console.log({
              event: "ORDER_GENERATED",
              timestamp: new Date().toISOString(),
              chatId: chatId,
              payload: {
                user: chatId.replace("@c.us", ""),
                items: session.files,
                expires: Date.now() + 48 * 60 * 60 * 1000,
              },
            });
          } catch (error) {
            console.error("Error generating QR:", error);
            await client.sendMessage(
              chatId,
              "❌ Gagal membuat QR. Silakan coba lagi.",
            );
          }

          delete userSessions[chatId];
        } else {
          await client.sendMessage(
            chatId,
            "⚠️ Pesan tidak dikenali.\n\n" +
              "📥 Silakan *kirim file dengan caption*.\n" +
              "➡️ Atau ketik *2* jika sudah selesai upload.\n" +
              "🔚 Ketik *0* untuk batal.",
          );
        }
      }
      break;
  }
});

client.initialize();

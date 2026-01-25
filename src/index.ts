import "dotenv/config";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;

type FileData = {
  filename: string;
  mime: string;
  config?: string;
  data: File;
};

type UserState = {
  step: "AWAITING_FILES" | "CONFIGURING_UNSET_FILES";
  files: FileData[];

  configIndex?: number;
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
  webVersionCache: {
    type: "remote",
    remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1031490220-alpha.html`,
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

const validateConfig = (text: string) => {
  const lower = text.toLowerCase();
  const isWarna = lower === "warna";
  const isHitam = lower === "hitam";
  const isAuto = lower === "auto" || lower === "otomatis";
  const isRange = /^[\d\s,-]+$/.test(text);

  if (!isWarna && !isHitam && !isRange && !isAuto) {
    return null;
  }

  if (isWarna) return "FULL_COLOR";
  if (isHitam) return "BLACK_WHITE";
  if (isAuto) return "AUTO_DETECT";
  return text;
};

const formatConfigDisplay = (config?: string) => {
  if (!config) return "Belum Diatur ⚠️";
  if (config === "FULL_COLOR") return "Full Color 🌈";
  if (config === "BLACK_WHITE") return "Full Hitam Putih ⬛⬜";
  if (config === "AUTO_DETECT") return "Deteksi Otomatis 🤖";
  return `Hitam Putih (Halaman: ${config}) 📄`;
};

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
  const lowerText = text.toLowerCase();

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
    if (lowerText === "!print" || lowerText === "!p") {
      userSessions[chatId] = { step: "AWAITING_FILES", files: [] };
      await chat.archive();
      await client.sendMessage(
        chatId,
        "📄 Kirim file Anda dengan *teks/caption* untuk pengaturan cetak.\n" +
          "👉 Format file yang didukung: *PDF, JPEG, JPG, PNG*\n\n" +
          "Contoh Teks Caption untuk PDF:\n" +
          "- `hitam` (cetak Hitam Putih ⬛⬜)\n" +
          "- `warna` (cetak Full Color 🌈)\n" +
          "- `1-5` (Halaman `1-5` Hitam Putih, sisanya warna 🔢)\n" +
          "- `1,3,5` (Halaman `1 dan 3 dan 5` Hitam Putih, sisanya Full Color)\n\n" +
          "Contoh Teks Gambar:\n" +
          "- `hitam` (cetak Hitam Putih ⬛⬜)\n" +
          "- `warna` (cetak Full Color 🌈)\n" +
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
            `Untuk memulai Self-Service Printing, ketik *!print* ya 🖨️.`,
        );
      }
    }
    return;
  }

  switch (session.step) {
    case "AWAITING_FILES":
      if (msg.hasMedia) {
        const attachmentData = await msg.downloadMedia();
        const fileName = attachmentData.filename || `file-${Date.now()}`;
        const buffer = Buffer.from(attachmentData.data, "base64");
        const fileObject = new File([buffer], fileName, {
          type: attachmentData.mimetype,
        });

        const caption = msg.body.trim();
        const validConfig = validateConfig(caption);

        session.files.push({
          filename: fileName,
          mime: attachmentData.mimetype,
          data: fileObject,
          config: validConfig || undefined,
        });

        const confirmationText = validConfig
          ? `Warna Dokumen: *${formatConfigDisplay(validConfig)}*`
          : `Warna Dokumen: Pilih Nanti ⌨️`;

        await client.sendMessage(
          chatId,
          `File ${attachmentData.mimetype === "application/pdf" ? "PDF Diterima 📄" : "Gambar Diterima 🖼️"}:\n\n\`${fileName}\`\n\n${confirmationText}\n` +
            `Total: *${session.files.length} file.*\n\n` +
            `👉 Silakan kirim file lain.\n👉 Ketik *2* jika selesai.`,
        );
      } else {
        const lower = text.toLowerCase();
        if (["2", "selesai", "done", "lanjut"].includes(lower)) {
          if (session.files.length === 0) {
            await client.sendMessage(
              chatId,
              "⚠️ Anda belum mengirim file apa-pun. Kirim file dulu atau ketik 0 untuk batal.",
            );
            return;
          }
          await finalizeOrder(chatId, session);
        } else {
          await client.sendMessage(
            chatId,
            "⚠️ Pesan tidak dikenali.\n" +
              "📥 Silakan *kirim file*.\n" +
              "➡️ Atau ketik *2* jika sudah selesai upload.\n" +
              "🔚 Ketik *0* untuk batal.",
          );
        }
      }
      break;

    case "CONFIGURING_UNSET_FILES":
      if (session.configIndex === undefined) {
        session.step = "AWAITING_FILES";
        await client.sendMessage(
          chatId,
          "❌ Terjadi kesalahan. Silakan coba lagi dengan mengetik '2'.",
        );
        return;
      }

      const validConfig = validateConfig(text);
      if (!validConfig) {
        await client.sendMessage(
          chatId,
          `❌ Format salah. Coba lagi untuk file *"${session.files[session.configIndex].filename}"*.\nKetik: \`warna\`, \`hitam\`, \`auto\`, atau range halaman.`,
        );
        return;
      }

      session.files[session.configIndex].config = validConfig;

      const nextUnsetIndex = session.files.findIndex((f) => !f.config);

      if (nextUnsetIndex !== -1) {
        session.configIndex = nextUnsetIndex;
        await promptForUnsetConfig(chatId, session);
      } else {
        await generateSummaryAndQr(chatId, session);
      }
      break;
  }
});

async function finalizeOrder(chatId: string, session: UserState) {
  const firstUnsetIndex = session.files.findIndex((f) => !f.config);

  if (firstUnsetIndex === -1) {
    await generateSummaryAndQr(chatId, session);
  } else {
    session.step = "CONFIGURING_UNSET_FILES";
    session.configIndex = firstUnsetIndex;
    await client.sendMessage(
      chatId,
      "👍 Oke, semua file diterima. Sekarang mari kita atur beberapa file yang belum ada pengaturannya.",
    );
    await promptForUnsetConfig(chatId, session);
  }
}

async function promptForUnsetConfig(chatId: string, session: UserState) {
  if (session.configIndex === undefined) return;
  const fileToConfig = session.files[session.configIndex];

  const colorOption =
    fileToConfig.filename.split(".").pop() === "pdf"
      ? "- `hitam` (cetak Hitam Putih ⬛⬜)\n" +
        "- `warna` (cetak Full Color 🌈)\n" +
        "- `1-5` (Halaman `1-5` Hitam Putih, sisanya warna 🔢)\n" +
        "- `1,3,5` (Halaman `1 dan 3 dan 5` Hitam Putih, sisanya Full Color)\n" +
        "🔚 Ketik 0 batal"
      : "- `hitam` (cetak Hitam Putih ⬛⬜)\n" +
        "- `warna` (cetak Full Color 🌈)\n" +
        "🔚 Ketik 0 batal";

  await client.sendMessage(
    chatId,
    `⚙️ Pilih Warna Cetakan (Tipe File: ${fileToConfig.filename.split(".").pop() === "pdf" ? "Dokumen PDF 📄" : "Gambar 🖼️"}):\n\n\`${fileToConfig.filename}\`\n\n` +
      `Ketik:\n` +
      colorOption,
  );
}

async function generateSummaryAndQr(chatId: string, session: UserState) {
  await client.sendMessage(
    chatId,
    "🔃 Sedang Memproses Order Pesanan Anda. Ditunggu Yah...",
  );

  const summaryMessage = session.files
    .map((file, index) => {
      return `${index + 1}. \`${file.filename}\`\n- Pengaturan: *${formatConfigDisplay(file.config)}*\n`;
    })
    .join("\n");

  await client.sendMessage(
    chatId,
    `*Ringkasan Pesanan Anda:*\n\n${summaryMessage}`,
  );

  try {
    const qrDataUrl = await QRCode.toDataURL("Hello world", {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 400,
    });

    const base64Data = qrDataUrl.split(",")[1];
    const media = new MessageMedia("image/png", base64Data, "print-order.png");

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
    await client.sendMessage(chatId, "❌ Gagal membuat QR. Silakan coba lagi.");
  }

  delete userSessions[chatId];
}

client.initialize();

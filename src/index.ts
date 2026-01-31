import "dotenv/config";
import cluster from "node:cluster";
import process from "node:process";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import pkg from "whatsapp-web.js";

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
  const { Client, LocalAuth, MessageMedia } = pkg;

  let PRICING = {
    COLOR: 1000,
    BLACK_WHITE: 500,
  };

  const fetchPricing = async () => {
    try {
      const url = process.env.LARAVEL_URL + "api/config";
      const response = await fetch(url);
      if (!response.ok) return;
      const apiResponse = await response.json();
      if (apiResponse.success && apiResponse.data.prices) {
        PRICING.COLOR = apiResponse.data.prices.color;
        PRICING.BLACK_WHITE = apiResponse.data.prices.bnw;
        console.log(`[Worker ${process.pid}] Pricing updated:`, PRICING);
      }
    } catch (error) {
      console.error(`[Worker ${process.pid}] Error fetching pricing:`, error);
    }
  };

  type FileData = {
    filename: string;
    mime: string;
    config?: string;
    data: File;
    copies?: number;
    paperSize?: string;
    scale?: "fit" | "noscale" | "shrink";
    side?: "duplex" | "duplexshort" | "duplexlong" | "simplex";
    pagesToPrint?: string;
    totalFilePages: number;
    calculatedPages: number;
  };

  type UserState = {
    step: "AWAITING_FILES" | "CONFIGURING_UNSET_FILES" | "AWAITING_NAME";
    files: FileData[];
    customerName?: string;
    configIndex?: number;
  };

  const userSessions: Record<string, UserState> = {};

  const GREETINGS = [
    "halo",
    "hai",
    "hi",
    "helo",
    "pagi",
    "siang",
    "sore",
    "malam",
    "assalamualaikum",
    "punten",
    "permisi",
    "tes",
    "test",
    "cek",
    "ping",
    "p",
  ];

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "prin-prinan-official-whatsapp" }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-popup-blocking",
        "--disable-dev-shm-usage",
      ],
    },
    webVersionCache: {
      type: "remote",
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1031490220-alpha.html`,
    },
  });

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

  const getPageCountFromPrinter = async (
    fileData: File,
    filename: string,
  ): Promise<number> => {
    try {
      const formData = new FormData();
      formData.append("file", fileData, filename);
      const response = await fetch(process.env.PAGE_CHECK_URL + "count-pages", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) return 1;
      const result = await response.json();
      return result.pages || 1;
    } catch (e) {
      return 1;
    }
  };

  const calculatePageCountFromRange = (
    rangeStr: string | undefined,
    totalFilePages: number,
  ): number => {
    if (!rangeStr) return totalFilePages;
    try {
      const parts = rangeStr.split(",");
      let count = 0;
      for (const part of parts) {
        if (part.includes("-")) {
          const [start, end] = part.split("-").map((x) => parseInt(x.trim()));
          if (!isNaN(start) && !isNaN(end) && end >= start) {
            count += end - start + 1;
          }
        } else {
          if (!isNaN(parseInt(part.trim()))) count++;
        }
      }
      return count > 0 ? count : totalFilePages;
    } catch {
      return totalFilePages;
    }
  };

  const validateConfig = (text: string) => {
    const lower = text.toLowerCase();
    const isWarna = lower === "warna";
    const isHitam = lower === "hitam";
    const isAuto = lower === "auto" || lower === "otomatis";
    const isRange = /^[\d\s,-]+$/.test(text);

    if (!isWarna && !isHitam && !isRange && !isAuto) return null;
    if (isWarna) return "FULL_COLOR";
    if (isHitam) return "BLACK_WHITE";
    if (isAuto) return "AUTO_DETECT";
    return text;
  };

  const parseCaption = (caption: string) => {
    const options: {
      colorConfig?: string;
      copies?: number;
      paperSize?: string;
      scale?: "fit" | "noscale" | "shrink";
      side?: "duplex" | "duplexshort" | "duplexlong" | "simplex";
      pagesToPrint?: string;
    } = {};

    const words = caption.trim().split(/\s+/);
    const keyValuePairs = words.filter((w) => w.includes("="));
    const colorWords = words.filter((w) => !w.includes("=")).join(" ");

    if (colorWords) {
      const validConfig = validateConfig(colorWords);
      if (validConfig) {
        if (/^[\d\s,-]+$/.test(validConfig)) {
          options.pagesToPrint = validConfig;
          options.colorConfig = "BLACK_WHITE";
        } else {
          options.colorConfig = validConfig;
        }
      }
    }

    for (const pair of keyValuePairs) {
      try {
        const [key, value] = pair.split("=", 2);
        switch (key.toLowerCase()) {
          case "copies":
            const copies = parseInt(value, 10);
            if (!isNaN(copies) && copies > 0) options.copies = copies;
            break;
          case "paper":
          case "papersize":
            options.paperSize = value;
            break;
          case "scale":
            if (["fit", "noscale", "shrink"].includes(value.toLowerCase()))
              options.scale = value.toLowerCase() as typeof options.scale;
            break;
          case "side":
            if (
              ["duplex", "duplexshort", "duplexlong", "simplex"].includes(
                value.toLowerCase(),
              )
            )
              options.side = value.toLowerCase() as typeof options.side;
            break;
          case "pages":
            options.pagesToPrint = value;
            break;
        }
      } catch (e) {}
    }
    return options;
  };

  const mapConfigToApiValue = (config?: string) => {
    switch (config) {
      case "FULL_COLOR":
        return "color";
      case "BLACK_WHITE":
        return "bnw";
      case "AUTO_DETECT":
        return "auto";
      default:
        return "bnw";
    }
  };

  const formatConfigDisplay = (config?: string) => {
    if (!config) return "Belum Diatur ⚠️";
    if (config === "FULL_COLOR") return "Full Color 🌈";
    if (config === "BLACK_WHITE") return "Full Hitam Putih ⬛⬜";
    if (config === "AUTO_DETECT") return "Deteksi Otomatis 🤖";
    return `Kustom (Halaman Hitam Putih: ${config}) 📄`;
  };

  const getItemPrice = (file: FileData) => {
    const price =
      file.config === "FULL_COLOR" ? PRICING.COLOR : PRICING.BLACK_WHITE;
    const copies = file.copies || 1;
    return price * file.calculatedPages * copies;
  };

  const generateInvoice = (session: UserState) => {
    const invoiceId = `INV-${Date.now()}`;
    const customerName = session.customerName || "Pelanggan";
    let totalPrice = 0;

    const items = session.files
      .map((file, index) => {
        const price = getItemPrice(file);
        totalPrice += price;
        const formattedPrice = `Rp${price.toLocaleString("id-ID")}`;

        const optionsSummary = [
          `Pengaturan: *${formatConfigDisplay(file.config)}*`,
          `Halaman: *${file.calculatedPages}* (Total: ${file.totalFilePages})`,
          file.copies && `Salinan: *${file.copies}*`,
          file.paperSize && `Kertas: *${file.paperSize}*`,
          file.scale && `Skala: *${file.scale}*`,
          file.side && `Sisi: *${file.side}*`,
        ]
          .filter(Boolean)
          .join("\n   - ");

        return `${index + 1}. \`${
          file.filename
        }\`\n   - ${optionsSummary}\n   - Biaya: *${formattedPrice}*`;
      })
      .join("\n\n");

    const totalFormatted = `Rp${totalPrice.toLocaleString("id-ID")}`;

    return (
      `🧾 *INVOICE PESANAN ANDA*\n\n` +
      `Nomor Invoice: *${invoiceId}*\n` +
      `Nama Pemesan: *${customerName}*\n` +
      `Tanggal: *${new Date().toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}*\n` +
      `-----------------------------------\n` +
      `${items}\n` +
      `-----------------------------------\n` +
      `*TOTAL BIAYA: ${totalFormatted}*`
    );
  };

  const processMediaMessage = async (
    msg: pkg.Message,
    chatId: string,
    session: UserState,
  ) => {
    const attachmentData = await msg.downloadMedia();
    const fileName = attachmentData.filename || `file-${Date.now()}`;
    const buffer = Buffer.from(attachmentData.data, "base64");
    const fileObject = new File([buffer], fileName, {
      type: attachmentData.mimetype,
    });

    const caption = msg.body.trim();
    const parsedOptions = parseCaption(caption);

    const rawPageCount = await getPageCountFromPrinter(fileObject, fileName);
    const actualPages = calculatePageCountFromRange(
      parsedOptions.pagesToPrint,
      rawPageCount,
    );

    const newFile: FileData = {
      filename: fileName,
      mime: attachmentData.mimetype,
      data: fileObject,
      config: parsedOptions.colorConfig,
      copies: parsedOptions.copies,
      paperSize: parsedOptions.paperSize,
      scale: parsedOptions.scale,
      side: parsedOptions.side,
      pagesToPrint: parsedOptions.pagesToPrint,
      totalFilePages: rawPageCount,
      calculatedPages: actualPages,
    };
    session.files.push(newFile);

    const generateFileSummary = (file: FileData) => {
      const summary = [
        `Warna Dokumen: *${formatConfigDisplay(file.config)}*`,
        `Halaman: *${file.calculatedPages}* (Total: ${file.totalFilePages})`,
      ];
      if (file.copies) summary.push(`Jumlah Salinan: *${file.copies}*`);
      if (file.paperSize) summary.push(`Ukuran Kertas: *${file.paperSize}*`);
      if (file.scale) summary.push(`Skala: *${file.scale}*`);
      if (file.side) summary.push(`Sisi Cetak: *${file.side}*`);
      return summary.join("\n");
    };

    const confirmationText = generateFileSummary(newFile);

    await client.sendMessage(
      chatId,
      `File Diterima:\n\n\`${fileName}\`\n\n${confirmationText}\n\n` +
        `Total: *${session.files.length} file.*\n\n` +
        `👉 Silakan kirim file lain.\n👉 Ketik *2* jika selesai.`,
    );
  };

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

    let session = userSessions[chatId];

    if (!session) {
      if (msg.hasMedia) {
        userSessions[chatId] = { step: "AWAITING_FILES", files: [] };
        await chat.archive();

        await processMediaMessage(msg, chatId, userSessions[chatId]);
        return;
      }

      if (lowerText === "print") {
        userSessions[chatId] = { step: "AWAITING_FILES", files: [] };
        await chat.archive();
        await fetchPricing();
        await client.sendMessage(
          chatId,
          "👋 Selamat Datang di PrinPrinan!\n\n" +
            "📄 Silakan *kirim file* dokumen/foto yang ingin diprint.\n" +
            "👉 Format: PDF, DOCX, JPG, PNG.\n\n" +
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
            `❌ Format salah. Ketik: \`warna\`, \`hitam\`, \`auto\`, atau range halaman (cth: 1-5).`,
          );
          return;
        }

        session.files[session.configIndex].config = validConfig;

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

  async function checkConfigsAndProceed(
    chat: pkg.Chat,
    chatId: string,
    session: UserState,
  ) {
    const firstUnsetIndex = session.files.findIndex((f) => !f.config);
    if (firstUnsetIndex === -1) {
      await askForCustomerName(chatId, session);
    } else {
      session.step = "CONFIGURING_UNSET_FILES";
      session.configIndex = firstUnsetIndex;
      await client.sendMessage(
        chatId,
        "👍 Oke, file diterima. Ada beberapa file yang belum diatur warnanya.",
      );
      await promptForUnsetConfig(chatId, session);
    }
  }

  async function promptForUnsetConfig(chatId: string, session: UserState) {
    if (session.configIndex === undefined) return;
    const fileToConfig = session.files[session.configIndex];

    const isDocument = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(fileToConfig.mime);

    const colorOption = isDocument
      ? "- `hitam`, `warna`, `auto`\n- Range halaman (cth: `1-5`) untuk hitam putih\n"
      : "- `hitam`, `warna`, `auto`\n";

    await client.sendMessage(
      chatId,
      `⚙️ Pilih Warna Cetakan untuk file:\n\n\`${fileToConfig.filename}\`\n\n` +
        `Ketik:\n` +
        colorOption,
    );
  }

  async function askForCustomerName(chatId: string, session: UserState) {
    session.step = "AWAITING_NAME";
    await client.sendMessage(
      chatId,
      "✅ Sip, pengaturan selesai!\n\n" +
        "Terakhir, boleh minta *Nama Anda*? (Untuk dicetak di struk/antrian)",
    );
  }

  async function createPrintJob(chat: pkg.Chat, session: UserState) {
    const formData = new FormData();
    const contact = await client.getContactById(chat.id._serialized);
    formData.append("customer_name", session.customerName || "N/A");
    formData.append("customer_number", contact.number);

    session.files.forEach((file, index) => {
      formData.append(`items[${index}][file]`, file.data, file.filename);
      formData.append(
        `items[${index}][color]`,
        mapConfigToApiValue(file.config),
      );
      if (file.copies)
        formData.append(`items[${index}][copies]`, String(file.copies));
      if (file.paperSize)
        formData.append(`items[${index}][paper_size]`, file.paperSize);
      if (file.scale) formData.append(`items[${index}][scale]`, file.scale);
      if (file.side) formData.append(`items[${index}][side]`, file.side);
      if (file.pagesToPrint)
        formData.append(`items[${index}][pages]`, file.pagesToPrint);
    });

    const url = process.env.LARAVEL_URL + "api/print-job/create";
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `API Error: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }
    return await response.json();
  }

  async function generateSummaryAndQr(
    chat: pkg.Chat,
    chatId: string,
    session: UserState,
  ) {
    await client.sendMessage(
      chatId,
      "🔃 Sedang Memproses Order Pesanan Anda. Ditunggu Yah...",
    );

    const invoiceMessage = generateInvoice(session);
    await client.sendMessage(chatId, invoiceMessage);

    try {
      const apiResponse = await createPrintJob(chat, session);

      const orderId = apiResponse.order_id;

      if (!orderId) {
        console.error("API Response missing order_id:", apiResponse);
        throw new Error("Order ID not found in API response.");
      }

      const qrDataUrl = await QRCode.toDataURL(orderId, {
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
          "- 🏢  Kunjungi kios PrinPrinan.\n" +
          "- 📱  Klik *Mulai* pada layar kios.\n" +
          "- 📸  Scan QR Code ini.\n" +
          "- 💵  Lakukan Pembayaran.\n" +
          "- 👉  File akan langsung ter-print.",
      });

      console.log({
        event: "ORDER_CREATED_VIA_API",
        timestamp: new Date().toISOString(),
        chatId: chatId,
        orderId: orderId,
        customerName: session.customerName,
        files: session.files.length,
      });
    } catch (error) {
      console.error(`[Worker ${process.pid}] Error creating print job:`, error);
      await client.sendMessage(
        chatId,
        "❌ Gagal membuat pesanan di sistem. Mohon coba lagi atau hubungi admin.",
      );
    }

    delete userSessions[chatId];
    await chat.unarchive();
  }

  client.initialize();
}

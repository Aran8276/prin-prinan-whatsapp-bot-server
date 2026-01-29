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

  const PRICING = {
    COLOR: 2000,
    BLACK_WHITE: 1000,
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
    step: "AWAITING_NAME" | "AWAITING_FILES" | "CONFIGURING_UNSET_FILES";
    files: FileData[];
    customerName?: string;
    configIndex?: number;
  };

  const userSessions: Record<string, UserState> = {};
  const greetedUsers = new Set<string>();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "your-client-id" }),
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
    console.log("Scan QR Code di bawah ini untuk login WhatsApp Server:");
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log(
      `Server PrinPrinan Telah Jalan (PID: ${process.pid}) - Siap Melayani ${
        process.env.DEV_MODE === "true"
          ? `\n(DEV MODE AKTIF) ID:${process.env.DEV_MODE_ID}`
          : ""
      }`,
    );
  });

  client.on("disconnected", (reason) => {
    console.log("Client was logged out or disconnected:", reason);
    process.exit(1);
  });

  const getPageCountFromPrinter = async (
    fileData: File,
    filename: string,
  ): Promise<number> => {
    try {
      const formData = new FormData();
      formData.append("file", fileData, filename);

      const response = await fetch(
        process.env.PAGE_CHECK_URL + "count-pages",
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        return 1;
      }

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
          if (!isNaN(parseInt(part.trim()))) {
            count++;
          }
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

    if (!isWarna && !isHitam && !isRange && !isAuto) {
      return null;
    }

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
        options.colorConfig = validConfig;
      }
    }

    for (const pair of keyValuePairs) {
      try {
        const [key, value] = pair.split("=", 2);
        switch (key.toLowerCase()) {
          case "copies":
            const copies = parseInt(value, 10);
            if (!isNaN(copies) && copies > 0) {
              options.copies = copies;
            }
            break;
          case "paper":
          case "papersize":
            options.paperSize = value;
            break;
          case "scale":
            if (["fit", "noscale", "shrink"].includes(value.toLowerCase())) {
              options.scale = value.toLowerCase() as typeof options.scale;
            }
            break;
          case "side":
            if (
              ["duplex", "duplexshort", "duplexlong", "simplex"].includes(
                value.toLowerCase(),
              )
            ) {
              options.side = value.toLowerCase() as typeof options.side;
            }
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
        return config || "bnw";
    }
  };

  const formatConfigDisplay = (config?: string) => {
    if (!config) return "Belum Diatur ⚠️";
    if (config === "FULL_COLOR") return "Full Color 🌈";
    if (config === "BLACK_WHITE") return "Full Hitam Putih ⬛⬜";
    if (config === "AUTO_DETECT") return "Deteksi Otomatis 🤖";
    return `Hitam Putih (Halaman: ${config}) 📄`;
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
          file.pagesToPrint && `Range: *${file.pagesToPrint}*`,
        ]
          .filter(Boolean)
          .join("\n   - ");

        return `${index + 1}. \`${file.filename}\`\n   - ${optionsSummary}\n   - Biaya: *${formattedPrice}*`;
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

    if (lowerText === "!opsi" || lowerText === "!duplex") {
      await client.sendMessage(
        chatId,
        "*Opsi Cetak Lanjutan:*\n\n" +
          "Anda dapat menambahkan opsi berikut pada caption file Anda, dipisahkan dengan spasi:\n\n" +
          "1. *Jumlah Salinan*:\n   `copies=[angka]`\n   Contoh: `warna copies=3`\n\n" +
          "2. *Ukuran Kertas*:\n   `paper=[ukuran]`\n   Contoh: `hitam paper=F4`\n\n" +
          "3. *Skala Cetak*:\n   `scale=[jenis]`\n   Pilihan: `fit`, `noscale`, `shrink`\n   Contoh: `warna scale=fit`\n\n" +
          "4. *Cetak Bolak-balik (Duplex)*:\n   `side=[jenis]`\n   Pilihan: `duplex`, `simplex`\n   Contoh: `hitam side=duplex`\n\n" +
          "5. *Halaman Tertentu*:\n   `pages=[halaman]`\n   Contoh: `warna pages=1,3-5`\n\n" +
          "Anda bisa menggabungkan beberapa opsi, contoh: `warna copies=2 side=duplex`",
      );
      return;
    }

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
        userSessions[chatId] = { step: "AWAITING_NAME", files: [] };
        await chat.archive();
        await client.sendMessage(
          chatId,
          "👋 Selamat datang di layanan PrinPrinan!\n\n" +
            "Untuk memulai, silakan ketik *nama Anda* untuk dicatat pada pesanan.",
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
      case "AWAITING_NAME":
        session.customerName = text;
        session.step = "AWAITING_FILES";
        await client.sendMessage(
          chatId,
          `Terima kasih, *${text}*!\n\n` +
            "📄 Sekarang, silakan kirim file Anda dengan *teks/caption* untuk pengaturan cetak.\n" +
            "👉 Format file yang didukung: *PDF, DOCX, JPEG, PNG, TIFF*\n\n" +
            `*Daftar Harga per Halaman:*\n` +
            `- Full Color: *Rp${PRICING.COLOR.toLocaleString("id-ID")}*\n` +
            `- Hitam Putih: *Rp${PRICING.BLACK_WHITE.toLocaleString(
              "id-ID",
            )}*\n\n` +
            "Contoh Teks Caption:\n" +
            "- `hitam` (cetak Hitam Putih ⬛⬜)\n" +
            "- `warna` (cetak Full Color 🌈)\n" +
            "- `1-5` (Halaman `1-5` Hitam Putih, sisanya warna 🔢)\n\n" +
            "ℹ️ Ketik *!opsi* untuk melihat pengaturan lanjutan (seperti cetak bolak-balik).\n\n" +
            "🔚 Ketik 0 batal",
        );
        break;

      case "AWAITING_FILES":
        if (msg.hasMedia) {
          const attachmentData = await msg.downloadMedia();
          const fileName = attachmentData.filename || `file-${Date.now()}`;
          const buffer = Buffer.from(attachmentData.data, "base64");
          const fileObject = new File([buffer], fileName, {
            type: attachmentData.mimetype,
          });

          const caption = msg.body.trim();
          const parsedOptions = parseCaption(caption);

          const rawPageCount = await getPageCountFromPrinter(
            fileObject,
            fileName,
          );

          const actualPages = calculatePageCountFromRange(
            parsedOptions.pagesToPrint,
            rawPageCount,
          );

          const newFile: FileData = {
            filename: fileName,
            mime: attachmentData.mimetype,
            data: fileObject,
            config: parsedOptions.colorConfig || undefined,
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
            if (file.paperSize)
              summary.push(`Ukuran Kertas: *${file.paperSize}*`);
            if (file.scale) summary.push(`Skala: *${file.scale}*`);
            if (file.side) summary.push(`Sisi Cetak: *${file.side}*`);
            if (file.pagesToPrint)
              summary.push(`Range Cetak: *${file.pagesToPrint}*`);
            return summary.join("\n");
          };

          const confirmationText = generateFileSummary(newFile);

          await client.sendMessage(
            chatId,
            `File Diterima:\n\n\`${fileName}\`\n\n${confirmationText}\n\n` +
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
            `❌ Format salah. Coba lagi untuk file *"${
              session.files[session.configIndex].filename
            }"*.\nKetik: \`warna\`, \`hitam\`, \`auto\`, atau range halaman.`,
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

  async function createPrintJob(session: UserState, chatId: string) {
    const formData = new FormData();
    formData.append("customer_name", session.customerName || "N/A");
    formData.append("customer_number", chatId.split("@")[0]);

    session.files.forEach((file, index) => {
      formData.append(`items[${index}][file]`, file.data);
      formData.append(
        `items[${index}][color]`,
        mapConfigToApiValue(file.config),
      );
      if (file.copies) {
        formData.append(`items[${index}][copies]`, String(file.copies));
      }
      if (file.paperSize) {
        formData.append(`items[${index}][paper_size]`, file.paperSize);
      }
      if (file.scale) {
        formData.append(`items[${index}][scale]`, file.scale);
      }
      if (file.side) {
        formData.append(`items[${index}][side]`, file.side);
      }
      if (file.pagesToPrint) {
        formData.append(`items[${index}][pages]`, file.pagesToPrint);
      }
    });

    const url = process.env.LARAVEL_URL + "api/print-job";
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `API Error: ${response.status} ${
          response.statusText
        } - ${JSON.stringify(errorData)}`,
      );
    }

    return await response.json();
  }

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

    const isDocument = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(fileToConfig.mime);

    const colorOption = isDocument
      ? "- `hitam`, `warna`, `auto`\n- atau range halaman (cth: `1-5`)\n"
      : "- `hitam`, `warna`, `auto`\n";

    await client.sendMessage(
      chatId,
      `⚙️ Pilih Warna Cetakan untuk file:\n\n\`${fileToConfig.filename}\`\n\n` +
        `Ketik:\n` +
        colorOption,
    );
  }

  async function generateSummaryAndQr(chatId: string, session: UserState) {
    await client.sendMessage(
      chatId,
      "🔃 Sedang Memproses Order Pesanan Anda. Ditunggu Yah...",
    );

    const invoiceMessage = generateInvoice(session);
    await client.sendMessage(chatId, invoiceMessage);

    try {
      const apiResponse = await createPrintJob(session, chatId);
      const orderId = apiResponse.order_id;

      if (!orderId) {
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
          "- 🏢  Kunjungi kios PrinPrinan di Ruang TEFA.\n" +
          "- 📱  Klik *Mulai* pada kios PrinPrinan.\n" +
          "- 📸  Scan & Tunjukkan QR Code berikut.\n" +
          "- 💵  Bayar dengan QRIS atau Manual.\n" +
          "- 👉  Pesananmu akan langsung di-print.",
      });

      console.log({
        event: "ORDER_CREATED_VIA_API",
        timestamp: new Date().toISOString(),
        chatId: chatId,
        orderId: orderId,
        payload: {
          user: chatId.replace("@c.us", ""),
          customerName: session.customerName,
          items: session.files.map((f) => ({
            filename: f.filename,
            config: f.config,
          })),
          expires: Date.now() + 48 * 60 * 60 * 1000,
        },
      });
    } catch (error) {
      console.error("Error creating print job:", error);
      await client.sendMessage(
        chatId,
        "❌ Gagal membuat pesanan di sistem. Mohon coba lagi atau hubungi admin.",
      );
    }

    delete userSessions[chatId];
  }

  client.initialize();
}
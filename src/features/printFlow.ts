import process from "node:process";
import QRCode from "qrcode";
import pkg from "whatsapp-web.js";
import { client } from "../core/client.ts";
import { createPrintJob, getPageCountFromPrinter, detectColorCosts } from "../services/api.ts";
import { generateInvoice } from "../services/invoice.ts";
import { deleteSession } from "../store/session.ts";
import type { FileData, UserState } from "../types.ts";
import {
  calculatePageCountFromRange,
  formatConfigDisplay,
  parseCaption,
  getEffectivePageNumbers,
  formatPageRanges
} from "../utils/helpers.ts";
import { PRICING } from "../store/pricing.ts";

const { MessageMedia } = pkg;

export const calculateFilePrice = async (file: FileData, chatId: string) => {
  if (file.config === "FULL_COLOR") {
    await client.sendMessage(chatId, `🔍 Sedang mendeteksi warna dan harga untuk file: *${file.filename}*...`);
    
    const apiResult = await detectColorCosts(
      file.data, 
      file.filename, 
      file.pagesToPrint, 
      file.totalFilePages
    );

    if (apiResult !== null) {
      file.customPrice = apiResult.price;
      
      if (file.totalFilePages !== apiResult.detectedPages) {
        file.totalFilePages = apiResult.detectedPages;
        file.calculatedPages = calculatePageCountFromRange(
          file.pagesToPrint, 
          file.totalFilePages
        );
      }

      // Display stats
      const bnwStr = formatPageRanges(apiResult.bnwPages);
      const colorStr = formatPageRanges(apiResult.colorPages);
      const formattedPrice = `Rp${apiResult.price.toLocaleString("id-ID")}`;

      await client.sendMessage(
        chatId, 
        `✅ *Hasil Deteksi Warna*\n` +
        `File: \`${file.filename}\`\n\n` +
        `📄 *Hitam Putih*: ${bnwStr}\n` +
        `🌈 *Berwarna*: ${colorStr}\n\n` +
        `💰 *Estimasi Harga Satuan*: ${formattedPrice}`
      );

    } else {
      await client.sendMessage(chatId, "⚠️ Gagal mendeteksi warna otomatis. Menggunakan harga standar.");
      file.customPrice = file.calculatedPages * PRICING.COLOR; 
    }
  } else if (file.config === "BLACK_WHITE") {
    file.customPrice = file.calculatedPages * PRICING.BLACK_WHITE;
  } else if (file.config) {
     // Custom range B&W logic
     const bnwRanges = getEffectivePageNumbers(file.config, file.totalFilePages);
     const effectivePages = getEffectivePageNumbers(file.pagesToPrint, file.totalFilePages);
     
     const actualBnwPages = effectivePages.filter(p => bnwRanges.includes(p));
     const numBnW = actualBnwPages.length;
     const numColor = effectivePages.length - numBnW;
     
     file.customPrice = (numBnW * PRICING.BLACK_WHITE) + (numColor * PRICING.COLOR);
  }
};

export const processMediaMessage = async (
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

  if (newFile.config) {
    await calculateFilePrice(newFile, chatId);
  }

  session.files.push(newFile);

  const generateFileSummary = (file: FileData) => {
    const summary = [
      `Warna Dokumen: *${formatConfigDisplay(file.config)}* `,
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

export async function askForCustomerName(chatId: string, session: UserState) {
  session.step = "AWAITING_NAME";
  await client.sendMessage(
    chatId,
    "✅ Sip, pengaturan selesai!\n\n" +
      "Terakhir, boleh minta *Nama Anda*? (Untuk dicetak di struk/antrian)",
  );
}

export async function promptForUnsetConfig(chatId: string, session: UserState) {
  if (session.configIndex === undefined) return;
  const fileToConfig = session.files[session.configIndex];

  const isDocument = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(fileToConfig.mime);

  const colorOption = isDocument
    ? "- `hitam`, `warna`\n- Range halaman (cth: `1-5`) untuk hitam putih\n"
    : "- `hitam`, `warna`\n";

  await client.sendMessage(
    chatId,
    `⚙️ Pilih Warna Cetakan untuk file:\n\n\`${fileToConfig.filename}\`\n\n` +
      `Ketik:\n` +
      colorOption,
  );
}

export async function checkConfigsAndProceed(
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

export async function generateSummaryAndQr(
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
    const media = new MessageMedia("image/png", base64Data, "print-order.png");

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

  deleteSession(chatId);
  await chat.unarchive();
}
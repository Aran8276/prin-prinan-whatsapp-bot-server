import * as fs from "node:fs/promises";
import process from "node:process";
import QRCode from "qrcode";
import pkg from "whatsapp-web.js";
import { client } from "../core/client.ts";
import {
  createPrintJob,
  detectColorCosts,
  getPageCountFromPrinter,
} from "../services/api.ts";
import { generateInvoice } from "../services/invoice.ts";
import { PRICING } from "../store/pricing.ts";
import { deleteSession } from "../store/session.ts";
import type { FileData, UserState } from "../types.ts";
import {
  calculatePageCountFromRange,
  getEffectivePageNumbers,
  parseCaption,
} from "../utils/helpers.ts";
import path from "node:path";
const { MessageMedia } = pkg;

export const calculateFilePrice = async (file: FileData, chatId: string) => {
  if (file.config === "FULL_COLOR") {
    await client.sendMessage(
      chatId,
      `🔍 Sedang mendeteksi warna dan harga untuk file: *${file.filename}*...`,
    );

    const apiResult = await detectColorCosts(
      file.data,
      file.filename,
      file.pagesToPrint,
      file.totalFilePages,
    );

    if (apiResult !== null) {
      file.customPrice = apiResult.price;

      if (file.totalFilePages !== apiResult.detectedPages) {
        file.totalFilePages = apiResult.detectedPages;
        file.calculatedPages = calculatePageCountFromRange(
          file.pagesToPrint,
          file.totalFilePages,
        );
      }

      const bnwCount = apiResult.bnwPages.length;
      const colorCount = apiResult.colorPages.length;
      const fullColorCount = apiResult.fullColorPages.length;

      const formattedPrice = `Rp${apiResult.price.toLocaleString("id-ID")}`;

      await client.sendMessage(
        chatId,
        `🤖 Hasil Deteksi Warna\n\n` +
        `\`${file.filename}\`\n\n` +
        `📄 Hitam Putih: ${bnwCount} halaman\n` +
        `🎨 Color: ${colorCount} halaman\n` +
        `🌈 Full Color: ${fullColorCount} halaman\n\n` +
        `Estimasi Harga: *${formattedPrice}*`,
      );
    } else {
      await client.sendMessage(
        chatId,
        "⚠️ Gagal mendeteksi warna otomatis. Menggunakan harga standar.",
      );
      file.customPrice = file.calculatedPages * PRICING.COLOR;
    }
  } else if (file.config === "BLACK_WHITE") {
    file.customPrice = file.calculatedPages * PRICING.BLACK_WHITE;
  } else if (file.config) {
    const bnwRanges = getEffectivePageNumbers(file.config, file.totalFilePages);
    const effectivePages = getEffectivePageNumbers(
      file.pagesToPrint,
      file.totalFilePages,
    );

    const actualBnwPages = effectivePages.filter((p) => bnwRanges.includes(p));
    const numBnW = actualBnwPages.length;
    const numColor = effectivePages.length - numBnW;

    file.customPrice = numBnW * PRICING.BLACK_WHITE + numColor * PRICING.COLOR;
  }
};

export async function askForCopies(chatId: string, session: UserState) {
  session.step = "AWAITING_COPIES";
  if (session.configIndex === undefined) return;
  const file = session.files[session.configIndex];
  const progress = `(${session.configIndex + 1} dari ${session.files.length
    })`;

  const copiesOption =
    `- \`1\` (*Satu salinan untuk setiap halaman*)\n` +
    `- \`2\` (Dua salinan untuk setiap halaman)\n` +
    `- \`5\`\n` +
    `- \`10\`\n` +
    `- \`...\`\n\n*Saran:* Jika ingin cetak sekali saja, ketik \`1\`\n`;
  await client.sendMessage(
    chatId,
    `📄 Pilih Salinan Dokumen ${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
    `Contoh:\n` +
    copiesOption +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );
}

export async function askForPages(chatId: string, session: UserState) {
  session.step = "AWAITING_PAGES";
  if (session.configIndex === undefined) return;
  const file = session.files[session.configIndex];
  const progress = `(${session.configIndex + 1} dari ${session.files.length
    })`;

  const selectPageOption =
    `- \`semua\` (*Semua Halaman*)\n` +
    `- \`1-5\` (Halaman 1 sampai 5)\n` +
    `- \`1,3,5\` (Halaman 1, 3 dan 5)\n` +
    `- \`1-5,10-15\` (Halaman 1 sampai 5, dan 10 sampai 15)\n` +
    `- \`12\` (Hanya Halaman 12 Saja)\n` +
    `- \`1,3,4-6\` (Halaman 1, 3, dan 4 sampai 6)\n\n*Saran:* Jika ingin cetak semua halaman, ketik \`semua\`\n`;
  await client.sendMessage(
    chatId,
    `📖 Pilih Halaman Yang Di Cetak ${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
    `Contoh:\n` +
    selectPageOption +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );
}

export async function askForEdit(chatId: string, session: UserState) {
  session.step = "AWAITING_EDIT";
  if (session.configIndex === undefined) return;
  const file = session.files[session.configIndex];
  const progress = `(${session.configIndex + 1} dari ${session.files.length
    })`;

  const editOption =
    `- \`edit\` (akan dikenakan biaya Rp500 jika halaman yang di edit lebih dari 10 halaman)\n` +
    `- \`otomatis\`\n\n` +
    `*PENTING*: Jika anda memilih mode otomatis, kami tidak bertanggung jawab jika hasil cetakan salah.\nMohon periksa file kembali atau ajukan edit.\n`;
  await client.sendMessage(
    chatId,
    `📝 Pilih Request Edit ${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
    `Contoh:\n` +
    editOption +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );
}

export async function askForEditNotes(chatId: string, session: UserState) {
  session.step = "AWAITING_EDIT_NOTES";
  if (session.configIndex === undefined) return;
  const file = session.files[session.configIndex];
  const progress = `(File ${session.configIndex + 1} dari ${session.files.length
    })`;
  await client.sendMessage(
    chatId,
    `📝 Mohon ketik catatan/request edit ${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
    `Contoh: "Tolong hapus halaman 3 dan perbesar logo di halaman 1"\n` +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );
}

export const processMediaMessage = async (
  msg: pkg.Message,
  chatId: string,
  session: UserState,
) => {
  let attachmentData = await msg.downloadMedia();
  
  if (!attachmentData || !attachmentData.data) {
    console.error("Failed to download media on first attempt");
  }

  let buffer = Buffer.from(attachmentData.data || "", "base64");
  let attempts = 0;
  const maxAttempts = 3;

  // compare the binary buffer length against the expected filesize from whatsapp
  while (
    attachmentData && 
    attachmentData.filesize && 
    buffer.length < attachmentData.filesize && 
    attempts < maxAttempts
  ) {
    attempts++;
    console.log(`[Retry ${attempts}] File truncated (${buffer.length}/${attachmentData.filesize}). Retrying in 2s...`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    // update the buffer with a new one
    attachmentData = await msg.downloadMedia();
    if (attachmentData && attachmentData.data) {
        buffer = Buffer.from(attachmentData.data, "base64");
    }
  }

  const fileName = attachmentData.filename || `file-${Date.now()}`;
  const blob = new Blob([buffer], { type: attachmentData.mimetype });

  const caption = msg.body.trim();
  const parsedOptions = parseCaption(caption);

  // TODO: DEBUG: Let the user know the final status
  if (attachmentData.filesize && buffer.length < attachmentData.filesize) {
     await msg.reply(`⚠️ Peringatan: Bot terkendala dalam mengunduh file. Mohon hubungi admin setelah menyelesaikan pesanan.\n\nOnly received ${buffer.length} of expected ${attachmentData.filesize} bytes.`);
  }

  const rawPageCount = await getPageCountFromPrinter(blob, fileName);
  const actualPages = calculatePageCountFromRange(parsedOptions.pagesToPrint, rawPageCount);

  const newFile: FileData = {
    filename: fileName,
    mime: attachmentData.mimetype,
    data: blob,
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

  // TODO: DEBUG: Write recieved file to storage
  const filePath = path.join(process.cwd(), fileName);
  await fs.writeFile(filePath, buffer);
  console.log(`File saved to: ${filePath} (${buffer.length} bytes)`);

   await client.sendMessage(
    chatId,
    `📩 File Diterima: \n\n\`${fileName}\`\n\n` +
    `Total: *${session.files.length} file.*\n\n` +
    `👉 Silakan kirim file lain.\n` +
    `👉 Ketik *2* jika selesai.\n` +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );

};

export async function askForCustomerName(chatId: string, session: UserState) {
  session.step = "AWAITING_NAME";
  await client.sendMessage(
    chatId,
    "✅ Sip, pengaturan selesai!\n\n" +
    "Terakhir, boleh minta nama Anda? (Akan dicetak di struk/antrian pembayaran manual)",
  );
}

export async function promptForUnsetConfig(chatId: string, session: UserState) {
  if (session.configIndex === undefined) return;
  const fileToConfig = session.files[session.configIndex];

  const progress = `(${session.configIndex + 1} dari ${session.files.length
    } file)`;

  const isDocument = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(fileToConfig.mime);

  const colorOption =
    `- \`hitam\` (Rp${PRICING.BLACK_WHITE.toLocaleString("id-ID")} / lembar)\n` +
    `- \`warna\` (Rp${PRICING.COLOR.toLocaleString("id-ID")} / lembar)\n`;
  await client.sendMessage(
    chatId,
    `🌈 Pilih Warna ${progress} untuk file:\n\n\`${fileToConfig.filename}\`\n\n` +
    `Contoh:\n` +
    colorOption +
    `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
  );
}

export async function checkConfigsAndProceed(
  chat: pkg.Chat,
  chatId: string,
  session: UserState,
) {
  session.configIndex = 0;
  await client.sendMessage(
    chatId,
    "👍 Oke, semua file diterima. Sekarang mari kita atur pengaturannya satu per satu untuk setiap file.",
  );

  const firstFile = session.files[0];
  if (!firstFile.config) {
    session.step = "CONFIGURING_UNSET_FILES";
    await promptForUnsetConfig(chatId, session);
  } else {
    session.step = "AWAITING_PAGES";
    await askForPages(chatId, session);
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
        "- 👉  File akan langsung ter-print.\n\n" +
        "Terima Kasih 🙏",
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
      `Gagal membuat pesanan di sistem. Mohon coba lagi atau hubungi Admin.`,
    );
  }

  deleteSession(chatId);
  await chat.unarchive();
}
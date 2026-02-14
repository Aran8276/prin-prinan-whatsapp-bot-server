import {deleteSession} from "../store/session.ts";
import type {FileData, UserState} from "../types.ts";
import {getClient} from "../core/client.ts";
import {createPrintJob, detectColorCosts, getPageCountFromPrinter} from "../services/api.ts";
import {calculatePageCountFromRange, getEffectivePageNumbers, parseCaption} from "../utils/helpers.ts";
import {PRICING} from "../store/pricing.ts";
import type {WAMessage} from "@whiskeysockets/baileys";
import {downloadMediaMessage} from "@whiskeysockets/baileys";
import {pino} from "pino";
import {generateInvoice} from "../services/invoice.ts";
import QRCode from "qrcode";

const getProgressText = (session: UserState): string => {
    if (session.files.length <= 1 || session.configIndex === undefined) return "";
    return ` (File ${session.configIndex + 1} dari ${session.files.length})`;
};

export const calculateFilePrice = async (file: FileData, chatId: string) => {
    const sock = getClient();
    if (file.config === "FULL_COLOR") {
        await sock.sendMessage(chatId, {
            text: `🔍 Sedang mendeteksi warna dan harga untuk file: *${file.filename}*...`,
        });

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
            // TODO : fetch correct price
            console.log("shit", apiResult);
            const bnwCount = apiResult.bnwPages.length;
            const colorCount = apiResult.colorPages.length;
            const fullColorCount = apiResult.fullColorPages.length;
            const formattedPrice = `Rp${apiResult.price.toLocaleString("id-ID")}`;

            await sock.sendMessage(chatId, {
                text:
                    `🤖 Hasil Deteksi Warna\n\n` +
                    `\`${file.filename}\`\n\n` +
                    `📄 Hitam Putih: ${bnwCount} halaman\n` +
                    `🎨 Color: ${colorCount} halaman\n` +
                    `🌈 Full Color: ${fullColorCount} halaman\n\n` +
                    `Estimasi Harga: *${formattedPrice}*`,
            });
        } else {
            await sock.sendMessage(chatId, {
                text: "⚠️ Gagal mendeteksi warna otomatis. Menggunakan harga standar.",
            });
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
    const sock = getClient();
    session.step = "AWAITING_COPIES";
    if (session.configIndex === undefined) return;
    const file = session.files[session.configIndex];
    const progress = getProgressText(session);
    const copiesOption =
        `- \`1\` (*Satu salinan untuk setiap halaman*)\n` +
        `- \`2\` (Dua salinan untuk setiap halaman)\n` +
        `- \`5\`\n` +
        `- \`10\`\n` +
        `- \`...\`\n\n*Saran:* Jika ingin cetak sekali saja, ketik \`1\`\n`;
    await sock.sendMessage(chatId, {
        text:
            `📄 Pilih Salinan Dokumen${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
            `Contoh:\n` +
            copiesOption +
            `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
    });
}

export async function askForPages(chatId: string, session: UserState) {
    const sock = getClient();
    session.step = "AWAITING_PAGES";
    if (session.configIndex === undefined) return;
    const file = session.files[session.configIndex];
    const progress = getProgressText(session);
    const selectPageOption =
        `- \`semua\` (*Semua Halaman*)\n` +
        `- \`1-5\` (Halaman 1 sampai 5)\n` +
        `- \`1,3,5\` (Halaman 1, 3 dan 5)\n` +
        `- \`1-5,10-15\` (Halaman 1 sampai 5, dan 10 sampai 15)\n` +
        `- \`12\` (Hanya Halaman 12 Saja)\n` +
        `- \`1,3,4-6\` (Halaman 1, 3, dan 4 sampai 6)\n\n*Saran:* Jika ingin cetak semua halaman, ketik \`semua\`\n`;
    await sock.sendMessage(chatId, {
        text:
            `📖 Pilih Halaman Yang Di Cetak${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
            `Contoh:\n` +
            selectPageOption +
            `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
    });
}

export async function askForEdit(chatId: string, session: UserState) {
    const sock = getClient();
    session.step = "AWAITING_EDIT";
    if (session.configIndex === undefined) return;
    const file = session.files[session.configIndex];
    const progress = getProgressText(session);
    const editOption =
        `- \`edit\` (akan dikenakan biaya Rp500 jika halaman yang di edit lebih dari 10 halaman)\n` +
        `- \`otomatis\`\n\n` +
        `*PENTING*: Jika anda memilih mode otomatis, kami tidak bertanggung jawab jika hasil cetakan salah.\nMohon periksa file kembali atau ajukan edit.\n`;
    await sock.sendMessage(chatId, {
        text:
            `📝 Pilih Request Edit${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
            `Contoh:\n` +
            editOption +
            `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
    });
}

export async function askForEditNotes(chatId: string, session: UserState) {
    const sock = getClient();
    session.step = "AWAITING_EDIT_NOTES";
    if (session.configIndex === undefined) return;
    const file = session.files[session.configIndex];
    const progress = getProgressText(session);
    await sock.sendMessage(chatId, {
        text:
            `📝 Mohon ketik catatan/request edit${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
            `Contoh: "Tolong hapus halaman 3 dan perbesar logo di halaman 1"\n` +
            `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
    });
}

export const processMediaMessage = async (
    msg: WAMessage,
    chatId: string,
    session: UserState,
) => {
    const sock = getClient();
    try {
        const buffer = (await downloadMediaMessage(
            msg,
            "buffer",
            {},
            {logger: pino({level: "silent"}), reuploadRequest: sock.updateMediaMessage},
        )) as Buffer;

        const messageType = Object.keys(msg.message!)[0];
        const mediaMessage = msg.message![
            messageType as keyof typeof msg.message
            ] as any;
        const fileName =
            mediaMessage.fileName ||
            mediaMessage.title ||
            `file-${Date.now()}`;
        const mimeType = mediaMessage.mimetype;
        const caption = mediaMessage.caption || "";

        const blob = new Blob([buffer], {type: mimeType});
        const parsedOptions = parseCaption(caption);

        const rawPageCount = await getPageCountFromPrinter(blob, fileName);
        const actualPages = calculatePageCountFromRange(
            parsedOptions.pagesToPrint,
            rawPageCount,
        );

        const newFile: FileData = {
            filename: fileName,
            mime: mimeType,
            data: blob,
            config: parsedOptions.colorConfig,
            copies: parsedOptions.copies,
            paperSize: parsedOptions.paperSize,
            scale: parsedOptions.scale,
            pagesToPrint: parsedOptions.pagesToPrint,
            totalFilePages: rawPageCount,
            calculatedPages: actualPages,
        };

        session.files.push(newFile);

        await sock.sendMessage(chatId, {
            text:
                `📩 File Diterima: \n\n\`${fileName}\`\n\n` +
                `Total: *${session.files.length} file.*\n\n` +
                `👉 Silakan kirim file lain.\n` +
                `👉 Ketik *2* jika selesai.\n` +
                `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
        });
    } catch (error) {
        console.error("Error processing media message:", error);
        await sock.sendMessage(chatId, {
            text: "⚠️ Maaf, terjadi kesalahan saat mengunduh file. Mohon coba lagi.",
        });
    }
};

export async function askForCustomerName(chatId: string, session: UserState) {
    const sock = getClient();
    session.step = "AWAITING_NAME";
    await sock.sendMessage(chatId, {
        text:
            "✅ Sip, pengaturan selesai!\n\n" +
            "Terakhir, boleh minta nama Anda? (Akan dicetak di struk/antrian pembayaran manual)",
    });
}

export async function promptForUnsetConfig(chatId: string, session: UserState) {
    const sock = getClient();
    if (session.configIndex === undefined) return;
    const fileToConfig = session.files[session.configIndex];
    const progress = getProgressText(session);
    const colorOption =
        `- \`hitam\` (Rp${PRICING.BLACK_WHITE.toLocaleString("id-ID")} / lembar)\n` +
        `- \`warna\` (Rp${PRICING.COLOR.toLocaleString("id-ID")} / lembar)\n`;
    await sock.sendMessage(chatId, {
        text:
            `🌈 Pilih Warna${progress} untuk file:\n\n\`${fileToConfig.filename}\`\n\n` +
            `Contoh:\n` +
            colorOption +
            `\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n`,
    });
}

export async function askForFilePrintMode(chatId: string, session: UserState) {
    const sock = getClient();
    session.step = "AWAITING_FILE_MODE";
    if (session.configIndex === undefined) return;
    const file = session.files[session.configIndex];
    const progress = getProgressText(session);
    const modeOptions =
        `- \`simpel\` (Hanya atur warna, jumlah salinan, dan permintaan edit)\n` +
        `- \`lanjut\` (Atur halaman, bolak-balik, dan opsi lainnya)\n`;
    await sock.sendMessage(chatId, {
        text:
            `🖨️ Pilih mode cetak${progress} untuk file:\n\n\`${file.filename}\`\n\n` +
            modeOptions +
            "\n🔚 Ketik *0* untuk keluar atau mulai ulang.\n",
    });
}

export async function advanceToNextFileOrFinish(
    chatId: string,
    session: UserState,
) {
    if (session.configIndex === undefined) return;
    session.configIndex++;
    if (session.configIndex < session.files.length) {
        const nextFile = session.files[session.configIndex];
        if (!nextFile.config) {
            session.step = "CONFIGURING_UNSET_FILES";
            await promptForUnsetConfig(chatId, session);
        } else {
            await askForFilePrintMode(chatId, session);
        }
    } else {
        await askForCustomerName(chatId, session);
    }
}

export async function checkConfigsAndProceed(
    chatId: string,
    session: UserState,
) {
    const sock = getClient();
    session.configIndex = 0;
    await sock.sendMessage(chatId, {
        text: "👍 Oke, semua file diterima. Sekarang mari kita atur pengaturannya satu per satu untuk setiap file.",
    });
    const firstFile = session.files[0];
    if (!firstFile.config) {
        session.step = "CONFIGURING_UNSET_FILES";
        await promptForUnsetConfig(chatId, session);
    } else {
        await askForFilePrintMode(chatId, session);
    }
}

export async function generateSummaryAndQr(
    chatId: string,
    session: UserState,
) {
    const sock = getClient();
    await sock.sendMessage(chatId, {
        text: "🔃 Sedang Memproses Order Pesanan Anda. Ditunggu Yah...",
    });
    const invoiceMessage = generateInvoice(session);
    try {
        const apiResponse = await createPrintJob(chatId, session);
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
        const buffer = Buffer.from(base64Data, "base64");

        await sock.sendMessage(chatId, {text: invoiceMessage});
        await sock.sendMessage(chatId, {
            image: buffer,
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
        console.error(`[Worker] Error creating print job:`, error);
        await sock.sendMessage(chatId, {
            text: `Gagal membuat pesanan di sistem. Mohon coba lagi atau hubungi Admin.`,
        });
    }
    deleteSession(chatId);
}

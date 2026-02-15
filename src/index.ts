import "dotenv/config";
import process from "node:process";
import qrcodeTerminal from "qrcode-terminal";
import {initializeWhatsAppClient} from "./core/client.ts";
import {fetchPricing} from "./services/api.ts";
import {deleteSession, getSession, setSession} from "./store/session.ts";
import {
    advanceToNextFileOrFinish,
    askForCopies, askForEdit, askForEditNotes,
    askForFilePrintMode,
    askForPages, calculateFilePrice,
    checkConfigsAndProceed, generateSummaryAndQr,
    processMediaMessage
} from "./features/printFlow.ts";
import {GREETINGS} from "./utils/constants.ts";
import {calculatePageCountFromRange, validateColorSetting, validatePageRange} from "./utils/helpers.ts";

async function main() {
    const sock = await initializeWhatsAppClient();
    fetchPricing();

    sock.ev.on("connection.update", (update) => {
        const {connection, qr} = update;
        if (qr) {
            console.log(
                `[Worker ${process.pid}] Scan QR Code di bawah ini untuk login WhatsApp Server:`,
            );
            qrcodeTerminal.generate(qr, {small: true});
        }
        if (connection === "open") {
            console.log(
                `Server PrinPrinan Telah Jalan (PID: ${process.pid}) - Siap Melayani`,
            );
        }
    });

    sock.ev.on("messages.upsert", async ({messages, type}) => {
        const msg = messages[0];
        if (!msg.key.remoteJid || msg.key.fromMe) {
            return;
        }
        if (type !== "notify") return;
        console.log(msg);

        const chatId = msg.key.remoteJid;
        const devId = process.env.DEV_MODE_ID;
        const isDevMode = process.env.DEV_MODE === "true";

        const isDevTrigger = isDevMode && chatId === devId;
        const isProdTrigger = !isDevMode;
        if (!isDevTrigger && !isProdTrigger) return;

        const messageType = Object.keys(msg.message!)[0];
        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            "";
        const lowerText = text.toLowerCase();
        const hasMedia =
            messageType === "imageMessage" ||
            messageType === "documentMessage" ||
            messageType === "videoMessage";

        if (text === "0") {
            if (getSession(chatId)) {
                deleteSession(chatId);
                await sock.sendMessage(chatId, {
                    text:
                        `🔚 Order PrinPrinan telah dibatalkan.\n\n` +
                        `Silakan kirim file lagi untuk mengajukan order baru. Terima Kasih 🙏`,
                });
            } else {
                await sock.sendMessage(chatId, {
                    text:
                        "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
                        "Untuk mengajukan order printer, mohon kirimkan filenya ya 🙏 🙏",
                });
            }
            return;
        }

        if (lowerText === "!opsi" || lowerText === "!duplex") {
            await sock.sendMessage(chatId, {
                text:
                    "*Opsi Cetak Lanjutan:*\n\n" +
                    "Anda dapat menambahkan opsi berikut pada caption file Anda:\n" +
                    "1. *Salinan*: `copies=2`\n" +
                    "2. *Kertas*: `paper=A4`\n" +
                    "3. *Skala*: `scale=fit`\n" +
                    "4. *Halaman*: `pages=1-5`\n",
            });
            return;
        }

        let session = getSession(chatId);

        if (!session) {
            if (hasMedia) {
                session = {step: "AWAITING_FILES", files: []};
                setSession(chatId, session);
                await processMediaMessage(msg, chatId, session);
                return;
            }

            if (lowerText === "print") {
                setSession(chatId, {step: "AWAITING_FILES", files: []});
                await fetchPricing();
                await sock.sendMessage(chatId, {
                    text:
                        "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
                        "Untuk mengajukan order printer, mohon kirimkan filenya ya 🙏 🙏",
                });
                return;
            }

            if (GREETINGS.some((g) => lowerText.startsWith(g))) {
                await sock.sendMessage(chatId, {
                    text:
                        "Selamat Datang di *PrinPrinan Self-Service* 🖨️\n\n" +
                        "Untuk mengajukan order printer, mohon kirimkan filenya ya 🙏 🙏",
                });
                return;
            }
            return;
        }

        switch (session.step) {
            case "AWAITING_FILES":
                if (hasMedia) {
                    await processMediaMessage(msg, chatId, session);
                } else {
                    if (["2", "selesai", "done", "lanjut"].includes(lowerText)) {
                        if (session.files.length === 0) {
                            await sock.sendMessage(chatId, {
                                text: "⚠️ Belum ada file yang dikirim. Kirim file dulu atau ketik 0 untuk batal.",
                            });
                            return;
                        }
                        await checkConfigsAndProceed(chatId, session);
                    } else {
                        await sock.sendMessage(chatId, {
                            text: "⚠️ Pesan tidak dikenali.\n📥 Kirim file atau ketik *2* jika selesai.",
                        });
                    }
                }
                break;

            case "AWAITING_FILE_MODE":
                if (session.configIndex !== undefined) {
                    const file = session.files[session.configIndex];
                    const mode = lowerText.toLowerCase();

                    if (mode === "simpel" || mode === "1") file.mode = "simple";
                    else if (mode === "lanjut" || mode === "2") file.mode = "advanced";
                    else {
                        await sock.sendMessage(chatId, {
                            text: `⚠️ Input tidak valid. Mohon ketik *simpel* atau *lanjut*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.`,
                        });
                        return;
                    }

                    if (file.mode === "simple") await askForCopies(chatId, session);
                    else await askForPages(chatId, session);
                }
                break;

            case "CONFIGURING_UNSET_FILES":
                if (session.configIndex === undefined) {
                    session.step = "AWAITING_FILES";
                    return;
                }
                const validConfig = validateColorSetting(text);
                if (!validConfig) {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ Input tidak valid. Mohon ketik *hitam* atau *warna*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.`,
                    });
                    return;
                }
                session.files[session.configIndex].config = validConfig;
                await askForFilePrintMode(chatId, session);
                break;

            case "AWAITING_NAME":
                if (text.length < 2) {
                    await sock.sendMessage(chatId, {
                        text: "⚠️ Nama terlalu pendek. Silakan masukkan nama Anda untuk label pesanan.",
                    });
                    return;
                }
                session.customerName = text;
                await generateSummaryAndQr(chatId, session);
                break;

            case "AWAITING_COPIES":
                if (session.configIndex !== undefined) {
                    const copies = parseInt(text, 10);
                    if (isNaN(copies) || copies < 1) {
                        await sock.sendMessage(chatId, {
                            text: "⚠️ Input tidak valid. Mohon masukkan jumlah lembar dalam bentuk angka (contoh: 1).\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.",
                        });
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
                        await sock.sendMessage(chatId, {
                            text: `⚠️ Format halaman tidak valid. Mohon masukkan format yang benar (contoh: \`1-5,7\`) dan pastikan nomor halaman tidak melebihi total halaman file (${file.totalFilePages}).\n\nAtau ketik *semua*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.`,
                        });
                        return;
                    }
                    file.pagesToPrint =
                        lowerText.toLowerCase() === "semua" ? undefined : text;
                    file.calculatedPages = calculatePageCountFromRange(
                        file.pagesToPrint,
                        file.totalFilePages,
                    );
                    if (file.config) await calculateFilePrice(file, chatId);
                    await askForCopies(chatId, session);
                }
                break;

            case "AWAITING_EDIT":
                if (session.configIndex !== undefined) {
                    if (lowerText !== "edit" && lowerText !== "otomatis") {
                        await sock.sendMessage(chatId, {
                            text: "⚠️ Input tidak valid. Mohon ketik *edit* atau *otomatis*.\n\n🔚 Ketik *0* untuk keluar atau mulai ulang.",
                        });
                        return;
                    }
                    const file = session.files[session.configIndex];
                    if (lowerText === "edit") {
                        file.needsEdit = true;
                        await askForEditNotes(chatId, session);
                    } else {
                        await advanceToNextFileOrFinish(chatId, session);
                    }
                }
                break;

            case "AWAITING_EDIT_NOTES":
                if (session.configIndex !== undefined) {
                    session.files[session.configIndex].editNotes = text;
                    await advanceToNextFileOrFinish(chatId, session);
                }
                break;
        }
    });

}

process.on("SIGTERM", () => {
    console.log("SIGTERM received, exiting...");
    process.exit(0);
});

process.on("SIGINT", () => {
    console.log("SIGINT received, exiting...");
    process.exit(0);
});

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});


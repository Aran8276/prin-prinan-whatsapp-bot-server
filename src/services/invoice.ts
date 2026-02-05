import { PRICING } from "../store/pricing.ts";
import type { FileData, UserState } from "../types.ts";
import { formatConfigDisplay } from "../utils/helpers.ts";

export const getItemPrice = (file: FileData) => {
  const copies = file.copies || 1;

  if (file.customPrice !== undefined) {
    return file.customPrice * copies;
  }

  const price = file.config === "FULL_COLOR" 
    ? PRICING.COLOR 
    : PRICING.BLACK_WHITE;
    
  return price * file.calculatedPages * copies;
};

export const generateInvoice = (session: UserState) => {
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
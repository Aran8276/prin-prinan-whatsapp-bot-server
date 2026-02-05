import * as fs from "node:fs/promises";
import process from "node:process";
import pkg from "whatsapp-web.js";
import { client } from "../core/client.ts";
import { PRICING, updatePricing } from "../store/pricing.ts";
import type { UserState } from "../types.ts";
import {
  getEffectivePageNumbers,
  mapConfigToApiValue,
} from "../utils/helpers.ts";
import path from "node:path";

export const fetchPricing = async () => {
  try {
    const url = process.env.LARAVEL_URL + "api/config";
    const response = await fetch(url);
    if (!response.ok) return;
    const apiResponse = await response.json();
    if (apiResponse.success && apiResponse.data.prices) {
      updatePricing(apiResponse.data.prices.color, apiResponse.data.prices.bnw);
      console.log(`[Worker ${process.pid}] Pricing updated:`, PRICING);
    }
  } catch (error) {
    console.error(`[Worker ${process.pid}] Error fetching pricing:`, error);
  }
};

export const getPageCountFromPrinter = async (
  fileData: Blob,
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

export interface DetectResult {
  price: number;
  detectedPages: number;
  bnwPages: number[];
  colorPages: number[];
}

export const detectColorCosts = async (
  fileData: Blob,
  filename: string,
  pagesToPrintRange: string | undefined,
  totalFilePages: number,
): Promise<DetectResult | null> => {
  try {
    const formData = new FormData();
    formData.append("files", fileData, filename);

    const response = await fetch("http://localhost:5000/detect", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) return null;

    // download

    const filePath = path.join(process.cwd(), filename);
    await fs.writeFile(filePath, Buffer.from(await fileData.arrayBuffer()));
    console.log(`File saved to: ${filePath}`);

    // download

    const json = await response.json();

    if (!json.data || !json.data[0] || !json.data[0].colors) {
      return null;
    }

    const fileInfo = json.data[0];
    const detectedPagesData = fileInfo.colors;
    const actualTotalPages = fileInfo.total_pages || totalFilePages;

    const effectivePages = getEffectivePageNumbers(
      pagesToPrintRange,
      actualTotalPages,
    );

    let totalPrice = 0;
    const bnwPages: number[] = [];
    const colorPages: number[] = [];

    for (const p of detectedPagesData) {
      if (effectivePages.includes(p.page)) {
        totalPrice += p.price;
        if (p.color === "black_and_white") {
          bnwPages.push(p.page);
        } else {
          colorPages.push(p.page);
        }
      }
    }

    return {
      price: totalPrice,
      detectedPages: actualTotalPages,
      bnwPages,
      colorPages,
    };
  } catch (error) {
    console.error("Error detecting colors:", error);
    return null;
  }
};

export const createPrintJob = async (chat: pkg.Chat, session: UserState) => {
  const formData = new FormData();
  const contact = await client.getContactById(chat.id._serialized);
  formData.append("customer_name", session.customerName || "N/A");
  formData.append("customer_number", contact.number);

  session.files.forEach((file, index) => {
    formData.append(`items[${index}][file]`, file.data, file.filename);
    formData.append(`items[${index}][color]`, mapConfigToApiValue(file.config));
    if (file.paperSize)
      formData.append(`items[${index}][paper_size]`, file.paperSize);
    if (file.scale) formData.append(`items[${index}][scale]`, file.scale);
    if (file.side) formData.append(`items[${index}][side]`, file.side);

    if (file.copies)
      formData.append(`items[${index}][copies-dummy]`, String(file.copies));
    if (file.pagesToPrint)
      formData.append(`items[${index}][pages-dummy]`, file.pagesToPrint);
    if (file.needsEdit) {
      formData.append(`items[${index}][needs_edit-dummy]`, "true");
    }
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
};
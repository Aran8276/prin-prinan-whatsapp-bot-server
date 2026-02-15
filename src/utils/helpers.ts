import type { ParsedCaption, ColorConfig} from "../types.ts";

export const parseCaption = (caption: string): ParsedCaption => {
  const options: ParsedCaption = {
    colorConfig: undefined,
    copies: undefined,
    paperSize: undefined,
    scale: undefined,
    pagesToPrint: undefined,
  };

  if (!caption) return options;

  const parts = caption.toLowerCase().split(/\s+/);
  parts.forEach((part) => {
    const [key, value] = part.split("=");
    if (!value) return;

    switch (key) {
      case "copies":
        const numCopies = parseInt(value, 10);
        if (!isNaN(numCopies)) {
          options.copies = numCopies;
        }
        break;
      case "paper":
        options.paperSize = value.toUpperCase();
        break;
      case "scale":
        options.scale = value;
        break;
      case "pages":
        options.pagesToPrint = value;
        break;
      case "side":
        // Side is deprecated for now
        break;
    }
  });

  return options;
};

export const validatePageRange = (
    rangeStr: string,
    total: number,
): boolean => {
  if (!/^[0-9,-]+$/.test(rangeStr)) return false;
  const parts = rangeStr.split(",");
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (isNaN(start) || isNaN(end) || start > end || start < 1 || end > total)
        return false;
    } else {
      const page = Number(part);
      if (isNaN(page) || page < 1 || page > total) return false;
    }
  }
  return true;
};

export const calculatePageCountFromRange = (
    range: string | undefined,
    total: number,
): number => {
  if (!range) return total;
  let count = 0;
  const seen = new Set<number>();
  const parts = range.split(",");
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        if (i <= total) seen.add(i);
      }
    } else {
      const page = Number(part);
      if (page <= total) seen.add(page);
    }
  }
  return seen.size;
};

export const validateColorSetting = (text: string): ColorConfig => {
  const lower = text.toLowerCase();
  if (lower.includes("hitam")) return "BLACK_WHITE";
  if (lower.includes("warna")) return "FULL_COLOR";
  return undefined;
};

export const getEffectivePageNumbers = (
    range: string | undefined,
    total: number,
): number[] => {
  if (!range) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>();
  range.split(",").forEach((part) => {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        if (i <= total) pages.add(i);
      }
    } else {
      const page = Number(part);
      if (page <= total) pages.add(page);
    }
  });
  return Array.from(pages);
};

export const formatConfigDisplay = (config: ColorConfig): string => {
  if (config === "BLACK_WHITE") return "Hitam Putih";
  if (config === "FULL_COLOR") return "Warna";
  return "Kustom";
};

export const mapConfigToApiValue = (config: ColorConfig): string => {
  if (config === "BLACK_WHITE") return "black_and_white";
  if (config === "FULL_COLOR") return "color";
  return "custom";
};

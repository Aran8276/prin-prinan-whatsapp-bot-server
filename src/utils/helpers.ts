export const validateConfig = (text: string) => {
  const lower = text.toLowerCase();
  const isWarna = lower === "warna";
  const isHitam = lower === "hitam";
  const isRange = /^[\d\s,-]+$/.test(text);

  if (!isWarna && !isHitam && !isRange) return null;
  if (isWarna) return "FULL_COLOR";
  if (isHitam) return "BLACK_WHITE";
  return text;
};

export const validateColorSetting = (
  text: string,
): "FULL_COLOR" | "BLACK_WHITE" | null => {
  const lower = text.toLowerCase();
  if (lower === "warna") return "FULL_COLOR";
  if (lower === "hitam") return "BLACK_WHITE";
  return null;
};

export const validatePageRange = (
  rangeStr: string,
  totalFilePages: number,
): boolean => {
  if (!/^[\d\s,-]+$/.test(rangeStr)) {
    return false;
  }

  const parts = rangeStr.split(",");

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (trimmedPart === "") continue;

    if (trimmedPart.includes("-")) {
      if (trimmedPart.split("-").length > 2) return false;

      const [startStr, endStr] = trimmedPart.split("-").map((s) => s.trim());

      if (startStr === "" || endStr === "") return false;

      const start = parseInt(startStr);
      const end = parseInt(endStr);

      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 1 ||
        end < 1 ||
        end < start ||
        start > totalFilePages ||
        end > totalFilePages
      ) {
        return false;
      }
    } else {
      const page = parseInt(trimmedPart);
      if (isNaN(page) || page < 1 || page > totalFilePages) {
        return false;
      }
    }
  }

  return true;
};

export const getEffectivePageNumbers = (
  rangeStr: string | undefined,
  totalFilePages: number,
): number[] => {
  if (!rangeStr) return Array.from({ length: totalFilePages }, (_, i) => i + 1);

  const pages = new Set<number>();
  const parts = rangeStr.split(",");

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((x) => parseInt(x.trim()));
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        for (let i = start; i <= end; i++) {
          if (i <= totalFilePages) pages.add(i);
        }
      }
    } else {
      const page = parseInt(part.trim());
      if (!isNaN(page) && page <= totalFilePages) pages.add(page);
    }
  }

  if (pages.size === 0) {
    return Array.from({ length: totalFilePages }, (_, i) => i + 1);
  }

  return Array.from(pages).sort((a, b) => a - b);
};

export const formatPageRanges = (pages: number[]): string => {
  if (pages.length === 0) return "-";
  pages.sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = pages[0];
  let prev = pages[0];

  for (let i = 1; i < pages.length; i++) {
    if (pages[i] === prev + 1) {
      prev = pages[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = pages[i];
      prev = pages[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
};

export const calculatePageCountFromRange = (
  rangeStr: string | undefined,
  totalFilePages: number,
): number => {
  const pages = getEffectivePageNumbers(rangeStr, totalFilePages);
  return pages.length;
};

export const parseCaption = (caption: string) => {
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

export const mapConfigToApiValue = (config?: string) => {
  switch (config) {
    case "FULL_COLOR":
      return "color";
    case "BLACK_WHITE":
      return "bnw";
    default:
      return "bnw";
  }
};

export const formatConfigDisplay = (config?: string) => {
  if (!config) return "Belum Diatur ⚠️";
  if (config === "FULL_COLOR") return "Berwarna (Deteksi Cerdas) 🤖";
  if (config === "BLACK_WHITE") return "Full Hitam Putih ⬛⬜";
  return `Kustom (Halaman Hitam Putih: ${config}) 📄`;
};

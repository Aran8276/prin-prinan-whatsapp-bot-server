export const validateConfig = (text: string) => {
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

export const calculatePageCountFromRange = (
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
    case "AUTO_DETECT":
      return "auto";
    default:
      return "bnw";
  }
};

export const formatConfigDisplay = (config?: string) => {
  if (!config) return "Belum Diatur ⚠️";
  if (config === "FULL_COLOR") return "Full Color 🌈";
  if (config === "BLACK_WHITE") return "Full Hitam Putih ⬛⬜";
  if (config === "AUTO_DETECT") return "Deteksi Otomatis 🤖";
  return `Kustom (Halaman Hitam Putih: ${config}) 📄`;
};

export type FileData = {
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
  // Stores the price calculated from the external API for Color mode
  customPrice?: number;
};

export type UserState = {
  step: "AWAITING_FILES" | "CONFIGURING_UNSET_FILES" | "AWAITING_NAME";
  files: FileData[];
  customerName?: string;
  configIndex?: number;
};

export type PricingState = {
  COLOR: number;
  BLACK_WHITE: number;
};
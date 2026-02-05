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
  customPrice?: number;
  needsEdit?: boolean;
};

export type UserState = {
  step:
    | "AWAITING_FILES"
    | "CONFIGURING_UNSET_FILES"
    | "AWAITING_NAME"
    | "AWAITING_COPIES"
    | "AWAITING_PAGES"
    | "AWAITING_EDIT";
  files: FileData[];
  customerName?: string;
  configIndex?: number;
};

export type PricingState = {
  COLOR: number;
  BLACK_WHITE: number;
};

export type FileData = {
  filename: string;
  mime: string;
  config?: string;
  data: Blob;
  copies?: number;
  paperSize?: string;
  scale?: "fit" | "noscale" | "shrink";
  // side?: "duplex" | "duplexshort" | "duplexlong" | "simplex";
  pagesToPrint?: string;
  totalFilePages: number;
  calculatedPages: number;
  customPrice?: number;
  needsEdit?: boolean;
  editNotes?: string;
  mode?: "simple" | "advanced";
};

export type UserState = {
  step:
    | "AWAITING_FILES"
    | "CONFIGURING_UNSET_FILES"
    | "AWAITING_NAME"
    | "AWAITING_COPIES"
    | "AWAITING_PAGES"
    | "AWAITING_EDIT"
    | "AWAITING_EDIT_NOTES"
    | "AWAITING_FILE_MODE";

  files: FileData[];
  customerName?: string;
  configIndex?: number;
};

export type PricingState = {
  COLOR: number;
  BLACK_WHITE: number;
};

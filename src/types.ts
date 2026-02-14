import type { Boom } from "@hapi/boom";
import type {
  AuthenticationState,
  SignalKeyStore,
  WAMessage,
} from "@whiskeysockets/baileys";

export interface UserState {
  step:
      | "AWAITING_FILES"
      | "AWAITING_FILE_MODE"
      | "CONFIGURING_UNSET_FILES"
      | "AWAITING_NAME"
      | "AWAITING_COPIES"
      | "AWAITING_PAGES"
      | "AWAITING_EDIT"
      | "AWAITING_EDIT_NOTES";
  files: FileData[];
  configIndex?: number;
  customerName?: string;
}

export type ColorConfig =
    | "BLACK_WHITE"
    | "FULL_COLOR"
    | string
    | undefined;

export interface FileData {
  filename: string;
  mime: string;
  data: Blob;
  config: ColorConfig;
  copies?: number;
  paperSize?: string;
  scale?: string;
  pagesToPrint?: string;
  totalFilePages: number;
  calculatedPages: number;
  customPrice?: number;
  needsEdit?: boolean;
  editNotes?: string;
  mode?: "simple" | "advanced";
}

export interface PricingState {
  COLOR: number;
  FULL_COLOR: number;
  BLACK_WHITE: number;
}

export type ParsedCaption = {
  colorConfig: ColorConfig;
  copies: number | undefined;
  paperSize: string | undefined;
  scale: string | undefined;
  pagesToPrint: string | undefined;
};

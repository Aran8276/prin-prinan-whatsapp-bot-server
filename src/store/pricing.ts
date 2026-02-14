import type { PricingState } from "../types.ts";

export const PRICING: PricingState = {
  COLOR: 1000,
  FULL_COLOR: 1500,
  BLACK_WHITE: 500,
};

export const updatePricing = ( color: number,fullColor: number, bnw: number) => {
  PRICING.COLOR = color;
  PRICING.FULL_COLOR = fullColor;
  PRICING.BLACK_WHITE = bnw;
};

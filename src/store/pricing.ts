import type { PricingState } from "../types.ts";

export const PRICING: PricingState = {
  BLACK_WHITE: 500,
  COLOR: 1000,
  FULL_COLOR: 1500,
};

export const updatePricing = ( color: number,fullColor: number, bnw: number) => {
  PRICING.COLOR = color;
  PRICING.FULL_COLOR = fullColor;
  PRICING.BLACK_WHITE = bnw;
};

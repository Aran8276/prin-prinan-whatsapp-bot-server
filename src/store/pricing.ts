import type { PricingState } from "../types.ts";

export const PRICING: PricingState = {
  COLOR: 1000,
  BLACK_WHITE: 500,
};

export const updatePricing = (color: number, bnw: number) => {
  PRICING.COLOR = color;
  PRICING.BLACK_WHITE = bnw;
};

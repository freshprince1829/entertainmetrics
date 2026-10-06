import { TIER_COLORS, TIER_OTHER } from "./theme";

export const PHASE_LABELS = {
  early_bird: "Early bird",
  advance: "Advance",
  standard: "Standard",
  last_minute: "Last minute",
  gate: "Gate",
  premium: "Premium",
};

// Tier colour follows the tier's position in the event's ordered tier list
// (sort order, then price), the same order every tier chart uses.
export function tierColor(index) {
  return index < TIER_COLORS.length ? TIER_COLORS[index] : TIER_OTHER;
}

export const ACCESS_LABELS = {
  general: "General",
  premium: "Premium",
  vip: "VIP",
  vvip: "VVIP",
  all_access: "All Access",
  group: "Group",
};

export const AUDIENCE_LABELS = {
  public: "Public",
  partner: "Partner / discount",
  group: "Group",
  complimentary: "Complimentary",
};

export const PRICE_BAND_LABELS = {
  free: "Free",
  discount: "Discount",
  standard: "Standard",
  premium: "Premium",
  luxury: "Luxury",
};

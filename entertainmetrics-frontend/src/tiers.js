import { TIER_COLORS, TIER_OTHER } from "./theme";

export const PHASE_LABELS = {
  early_bird: "Early bird",
  advance: "Advance",
  standard: "Standard",
  last_minute: "Last minute",
  gate: "Gate",
};

// Tier colour follows the tier's position in the event's ordered tier list
// (sort order, then price), the same order every tier chart uses.
export function tierColor(index) {
  return index < TIER_COLORS.length ? TIER_COLORS[index] : TIER_OTHER;
}

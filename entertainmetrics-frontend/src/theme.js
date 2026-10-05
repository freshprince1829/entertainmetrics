// Chart colours. The UI chrome is neutral grey; colour is reserved for data.
// Each colour always means the same thing across the app:
//   FORECAST - anything the prediction engine estimated
//   ACTUAL   - recorded/observed results (actual attendance, tickets sold)
//   CHECKED_IN - door check-ins (sales tracking)
// Validated together for the dark surface (lightness band, chroma, colour-
// blind separation >= 8 ΔE and contrast) with the dataviz palette validator.
export const FORECAST = "#7A8AD6";
export const ACTUAL = "#C98232";
export const CHECKED_IN = "#D55181";

// Single-measure marks (gauges, meters, score bars) use neutral ink.
export const INK = "#E8E8EA";
export const INK_MUTED = "#8E8E93";
export const TRACK = "#26262A";
export const GRID = "#1F1F22";

// Status colours: only for up/down deltas, always paired with an arrow icon.
export const POSITIVE = "#4ADE80";
export const NEGATIVE = "#F87171";

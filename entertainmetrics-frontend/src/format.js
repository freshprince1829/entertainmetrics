export function formatKes(value) {
  if (value === null || value === undefined) return "-";
  return `KES ${Number(value).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

export function formatCompact(value) {
  if (value === null || value === undefined) return "-";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value) {
  if (!value) return "-";
  // Dates from the API are plain YYYY-MM-DD; parse as local, not UTC.
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIso() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isUpcoming(eventDate) {
  return String(eventDate) >= todayIso();
}

// Actual results can be recorded from the event day onwards (matches the API).
export function canRecordActuals(eventDate) {
  return Boolean(eventDate) && String(eventDate) <= todayIso();
}

export function confidencePillClass(score) {
  if (score >= 0.8) return "pill pill-high";
  if (score >= 0.6) return "pill pill-mid";
  return "pill pill-low";
}

export const THUMB_GRADIENTS = [
  "linear-gradient(135deg, #3A3A40, #232327)",
  "linear-gradient(135deg, #34343A, #1E1E22)",
  "linear-gradient(135deg, #2E2E34, #1A1A1E)",
];

export function thumbGradient(id) {
  return THUMB_GRADIENTS[Number(id) % THUMB_GRADIENTS.length];
}

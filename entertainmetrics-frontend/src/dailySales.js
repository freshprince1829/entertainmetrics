// Daily tier sales, derived on the frontend from cumulative snapshots.
// The API stores cumulative counts per snapshot; these helpers turn daily
// entries into cumulative values and cumulative snapshots back into days.

export const SALES_TIME_ZONE = "Africa/Nairobi";
// Remaining below this share of a tier's allocation is flagged as low.
export const LOW_REMAINING_SHARE = 0.1;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SALES_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day ("YYYY-MM-DD") of a timestamp in Nairobi time. */
export function salesDay(value) {
  return dayFormatter.format(new Date(value));
}

function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function byRecordedAt(a, b) {
  return new Date(a.recorded_at) - new Date(b.recorded_at) || a.id - b.id;
}

/** Latest snapshot overall (tier or legacy), or null. */
export function latestSnapshot(snapshots) {
  return snapshots.length ? [...snapshots].sort(byRecordedAt).at(-1) : null;
}

/** Cumulative sold and checked-in per tier in a snapshot (0 when absent). */
export function tierTotals(tiers, snapshot) {
  const rows = {};
  (snapshot?.tier_sales ?? []).forEach((row) => {
    rows[row.tier_id] = row;
  });
  const sold = {};
  const checkedIn = {};
  tiers.forEach((tier) => {
    sold[tier.id] = rows[tier.id]?.tickets_sold ?? 0;
    checkedIn[tier.id] = rows[tier.id]?.checked_in ?? null;
  });
  return { sold, checkedIn };
}

/**
 * Per-tier view of one daily entry: what was sold before, what the entry
 * adds, the cumulative value that will be sent, and what remains.
 */
export function tierEntry(tier, soldBefore, entered) {
  const quantity = tier.quantity_available;
  const after = soldBefore + entered;
  const remainingBefore = quantity == null ? null : Math.max(quantity - soldBefore, 0);
  const remainingAfter = quantity == null ? null : Math.max(quantity - after, 0);
  return {
    soldBefore,
    entered,
    after,
    remainingBefore,
    remainingAfter,
    soldOut: quantity != null && quantity > 0 && remainingAfter === 0,
    low: quantity != null && remainingAfter > 0 && remainingAfter < quantity * LOW_REMAINING_SHARE,
  };
}

/** Clamp an entered amount to 0..max (max = remaining before this entry). */
export function clampEntry(value, max) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return max == null ? n : Math.min(n, max);
}

/**
 * Tickets sold per Nairobi calendar day per tier, by differencing
 * consecutive tier snapshots. The first snapshot counts everything sold up
 * to that point. Several snapshots on one day are summed into that day.
 * Days without an entry between the first and last snapshot appear with
 * zero sales and noEntry = true.
 */
export function dailySales(snapshots, tiers) {
  const tierSnapshots = snapshots.filter((s) => s.tier_sales).sort(byRecordedAt);
  if (tierSnapshots.length === 0) return [];
  const price = Object.fromEntries(tiers.map((t) => [t.id, t.price]));

  const days = new Map();
  const previous = {};
  tierSnapshots.forEach((snapshot) => {
    const day = salesDay(snapshot.recorded_at);
    if (!days.has(day)) days.set(day, { day, noEntry: false, entries: 0, byTier: {}, total: 0, revenue: 0 });
    const entry = days.get(day);
    entry.entries += 1;
    snapshot.tier_sales.forEach((row) => {
      const delta = row.tickets_sold - (previous[row.tier_id] ?? 0);
      previous[row.tier_id] = row.tickets_sold;
      if (delta === 0) return;
      entry.byTier[row.tier_id] = (entry.byTier[row.tier_id] ?? 0) + delta;
      entry.total += delta;
      entry.revenue += delta * (price[row.tier_id] ?? row.tier_price ?? 0);
    });
  });

  const result = [];
  const first = salesDay(tierSnapshots[0].recorded_at);
  const last = salesDay(tierSnapshots.at(-1).recorded_at);
  for (let day = first; day <= last; day = nextDay(day)) {
    result.push(days.get(day) ?? { day, noEntry: true, entries: 0, byTier: {}, total: 0, revenue: 0 });
  }
  return result;
}

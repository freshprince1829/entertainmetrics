import { useApiData } from "../api";
import { formatKes, formatNumber } from "../format";
import { INK } from "../theme";
import { ACCESS_LABELS, AUDIENCE_LABELS, PHASE_LABELS, PRICE_BAND_LABELS } from "../tiers";
import { Notice, ProgressBar, StatCard } from "./ui";

function pctText(value) {
  return value == null ? "-" : `${Number(value).toFixed(1)}%`;
}

function daysText(days) {
  const whole = Math.round(days);
  return Math.abs(days - whole) < 0.05 ? `${whole} day${whole === 1 ? "" : "s"}` : `${days} days`;
}

/** Single-measure horizontal bars (one series, so no legend: the title names it). */
function ShareBars({ rows, labelFor }) {
  return (
    <div className="bar-list share-bars">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="bar-row-head">
            <span>{labelFor(row.key)}</span>
            <span>
              {pctText(row.share_of_tickets_pct)} · {formatNumber(row.tickets)}
            </span>
          </div>
          <ProgressBar value={row.share_of_tickets_pct ?? 0} max={100} color={INK} />
        </div>
      ))}
    </div>
  );
}

function SellOutList({ tiers }) {
  const withQuantity = tiers.filter((t) => t.quantity_available);
  if (withQuantity.length === 0) {
    return <p className="metric-note">Add quantities to tiers to track how fast they sell out.</p>;
  }
  return (
    <ul className="sellout-list">
      {withQuantity.map((tier) => (
        <li key={tier.tier_id}>
          <span>{tier.name}</span>
          {tier.days_to_sell_out != null ? (
            <strong>sold out in {daysText(tier.days_to_sell_out)}</strong>
          ) : (
            <span className="event-sub">
              {pctText(tier.sell_through_pct)} sold ({formatNumber(tier.tickets_sold)} of{" "}
              {formatNumber(tier.quantity_available)})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TierAnalyticsPanel({ eventId }) {
  const { data, error, loading } = useApiData(`/events/${eventId}/tier-analytics`);

  if (loading) return <p className="panel-subtext">Loading tier analytics…</p>;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!data.has_tier_data) return <p className="panel-subtext">{data.message}</p>;

  const showRates = data.tiers.filter((t) => t.show_rate_pct != null);

  return (
    <div className="tier-analytics">
      <h3>Tier analytics</h3>
      <p className="analytics-note">{data.note}</p>

      <div className="sales-stats">
        <StatCard
          label="Partner tickets"
          value={pctText(data.partner_discount_share_pct ?? 0)}
          note={
            data.partner_average_price != null
              ? `of tickets · average ${formatKes(data.partner_average_price)}`
              : "no partner or discount tiers sold"
          }
        />
      </div>

      <div className="analytics-grid">
        <div>
          <h4>Affordability profile</h4>
          <p className="metric-note">Share of tickets sold in each price band (relative to the base price)</p>
          <ShareBars rows={data.affordability_profile} labelFor={(key) => PRICE_BAND_LABELS[key] ?? key} />
        </div>
        <div>
          <h4>Days to sell out</h4>
          <p className="metric-note">From the first tier snapshot until the tier reached its quantity</p>
          <SellOutList tiers={data.tiers} />
        </div>
        <div>
          <h4>Tickets by sale phase</h4>
          <ShareBars rows={data.by_sale_phase} labelFor={(key) => PHASE_LABELS[key] ?? key} />
        </div>
        {showRates.length > 0 && (
          <div>
            <h4>Show rate by tier</h4>
            <p className="metric-note">Checked in ÷ tickets sold</p>
            <ul className="sellout-list">
              {showRates.map((tier) => (
                <li key={tier.tier_id}>
                  <span>{tier.name}</span>
                  <strong>{pctText(tier.show_rate_pct)}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h4>Insights</h4>
      <ul className="insight-list">
        {data.insights.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

function PatternRows({ rows, labels }) {
  return (
    <ul className="sellout-list">
      {rows.slice(0, 4).map((row) => (
        <li key={row.key}>
          <span>{labels[row.key] ?? row.key}</span>
          <span className="event-sub">
            {pctText(row.avg_share_of_tickets_pct)} of tickets · {pctText(row.avg_share_of_revenue_pct)} of revenue
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TierPatternsCard() {
  const { data, error, loading } = useApiData("/analytics/tier-patterns");

  return (
    <div className="card">
      <h3>Tier patterns</h3>
      {loading ? (
        <p className="metric-note">Loading…</p>
      ) : error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : !data.sufficient_history ? (
        <p className="metric-note">
          Not enough history yet (need {data.min_events_required}+ completed events). {data.events_used} so far.
        </p>
      ) : (
        <>
          <p className="metric-note">Average across {data.events_used} completed events</p>
          <PatternRows rows={data.by_access_level} labels={ACCESS_LABELS} />
          <PatternRows rows={data.by_audience.filter((r) => r.key !== "public")} labels={AUDIENCE_LABELS} />
          {data.avg_early_bird_days_to_sell_out != null && (
            <p className="metric-note">
              Early bird tiers sold out in {daysText(data.avg_early_bird_days_to_sell_out)} on average.
            </p>
          )}
          <p className="analytics-note">{data.note}</p>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { apiDelete, apiPatch, apiPost, useApiData } from "../api";
import { formatKes, formatNumber } from "../format";
import { ACCESS_LABELS, AUDIENCE_LABELS, PHASE_LABELS, tierColor } from "../tiers";
import { Field, Notice } from "./ui";

// Presets fill in everything except price and quantity.
const PUBLIC = { audience: "public", partner_name: "" };
const PRESETS = [
  { name: "Early Bird", sale_phase: "early_bird", access_level: "general", ...PUBLIC },
  { name: "Advance", sale_phase: "advance", access_level: "general", ...PUBLIC },
  { name: "Standard", sale_phase: "standard", access_level: "general", ...PUBLIC },
  { name: "Last Minute", sale_phase: "last_minute", access_level: "general", ...PUBLIC },
  { name: "Gate", sale_phase: "gate", access_level: "general", ...PUBLIC },
  { name: "VIP", sale_phase: "premium", access_level: "vip", ...PUBLIC },
  { name: "VVIP", sale_phase: "premium", access_level: "vvip", ...PUBLIC },
  { name: "All Access", sale_phase: "premium", access_level: "all_access", ...PUBLIC },
  { name: "Partner Discount", sale_phase: "advance", access_level: "general", audience: "partner", partner_name: "" },
  { name: "Group", sale_phase: "advance", access_level: "group", audience: "group", partner_name: "" },
];

const emptyTierForm = {
  name: "",
  price: "",
  quantity_available: "",
  sale_phase: "standard",
  access_level: "general",
  audience: "public",
  partner_name: "",
};

function tierPayload(form, { includePrice = true } = {}) {
  const payload = {
    name: form.name,
    quantity_available: form.quantity_available === "" ? null : Number(form.quantity_available),
    sale_phase: form.sale_phase,
    access_level: form.access_level,
    audience: form.audience,
    partner_name: form.audience === "partner" ? form.partner_name || null : null,
  };
  if (includePrice) payload.price = Number(form.price);
  return payload;
}

function LabelSelect({ name, value, labels, onChange }) {
  return (
    <select name={name} value={value} onChange={onChange}>
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

function TierFields({ form, onChange, priceLocked = false }) {
  return (
    <>
      <Field label="Tier name">
        <input name="name" value={form.name} onChange={onChange} required maxLength={80} />
      </Field>
      <Field
        label="Price (KES)"
        hint={priceLocked ? "Locked: this tier has recorded sales. Add a new tier for a new price." : undefined}
      >
        <input name="price" type="number" min="0" step="any" value={form.price} onChange={onChange}
          required disabled={priceLocked} />
      </Field>
      <Field label="Quantity" hint="Leave blank if unknown">
        <input name="quantity_available" type="number" min="0" value={form.quantity_available} onChange={onChange} />
      </Field>
      <Field label="Sale phase">
        <LabelSelect name="sale_phase" value={form.sale_phase} labels={PHASE_LABELS} onChange={onChange} />
      </Field>
      <Field label="Access level">
        <LabelSelect name="access_level" value={form.access_level} labels={ACCESS_LABELS} onChange={onChange} />
      </Field>
      <Field label="Audience">
        <LabelSelect name="audience" value={form.audience} labels={AUDIENCE_LABELS} onChange={onChange} />
      </Field>
      {form.audience === "partner" && (
        <Field label="Partner name" hint="e.g. the bank behind a card-holder discount">
          <input name="partner_name" value={form.partner_name} onChange={onChange} maxLength={80} />
        </Field>
      )}
    </>
  );
}

function tierTags(tier) {
  return [
    PHASE_LABELS[tier.sale_phase] ?? tier.sale_phase,
    tier.access_level && tier.access_level !== "general" ? ACCESS_LABELS[tier.access_level] : null,
    tier.audience === "partner"
      ? `Partner${tier.partner_name ? `: ${tier.partner_name}` : ""}`
      : tier.audience && tier.audience !== "public"
        ? AUDIENCE_LABELS[tier.audience]
        : null,
  ].filter(Boolean);
}

function resultNotice(result, text) {
  return result?.warnings?.length
    ? { tone: "info", text: `${text} Note: ${result.warnings.join(" ")}` }
    : { tone: "success", text };
}

function useFormState(initial) {
  const [form, setForm] = useState(initial);
  function onChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }
  return [form, setForm, onChange];
}

function EditTierRow({ eventId, tier, onDone, onError }) {
  const priceLocked = tier.sales_snapshot_count > 0;
  const [form, , onChange] = useFormState({
    name: tier.name,
    price: String(tier.price),
    quantity_available: tier.quantity_available ?? "",
    sale_phase: tier.sale_phase,
    access_level: tier.access_level ?? "general",
    audience: tier.audience ?? "public",
    partner_name: tier.partner_name ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await apiPatch(
        `/events/${eventId}/tiers/${tier.id}`,
        tierPayload(form, { includePrice: !priceLocked }),
      );
      onDone(resultNotice(result, `${form.name} updated.`));
    } catch (err) {
      onError(err.message || "Failed to update tier");
      setSaving(false);
    }
  }

  return (
    <li className="tier-edit">
      <form onSubmit={handleSave}>
        <div className="form-grid">
          <TierFields form={form} onChange={onChange} priceLocked={priceLocked} />
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Save tier"}
          </button>
        </div>
      </form>
    </li>
  );
}

function CopyTiersControl({ event, tiers, onCopied, onError }) {
  const eventsQuery = useApiData("/events");
  const [sourceId, setSourceId] = useState("");
  const [copying, setCopying] = useState(false);
  const sources = (eventsQuery.data ?? []).filter((e) => e.id !== event.id && e.tier_count > 0);
  if (sources.length === 0) return null;

  async function handleCopy() {
    setCopying(true);
    const source = sources.find((e) => String(e.id) === sourceId);
    try {
      const created = await apiPost(`/events/${event.id}/tiers/copy-from/${sourceId}`, {});
      const skipped = source.tier_count - created.length;
      onCopied(
        `Copied ${created.length} tier${created.length === 1 ? "" : "s"} from ${source.event_name}` +
          (skipped > 0 ? ` (${skipped} skipped: name already used).` : "."),
      );
      setSourceId("");
    } catch (err) {
      onError(err.message || "Failed to copy tiers");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="copy-tiers">
      <Field label={tiers.length ? "Copy tiers from another event" : "Start from another event's tiers"}>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">Choose an event</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.event_name} ({source.tier_count} tiers)
            </option>
          ))}
        </select>
      </Field>
      <button type="button" className="ghost-button" onClick={handleCopy} disabled={!sourceId || copying}>
        {copying ? "Copying…" : "Copy tiers"}
      </button>
    </div>
  );
}

export function TicketTiersEditor({ event, tiers, onChanged }) {
  const priceRangeQuery = useApiData(`/events/${event.id}/price-range`);
  const [form, setForm, onChange] = useFormState(emptyTierForm);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  function changed(message) {
    if (message) setNotice(typeof message === "string" ? { tone: "success", text: message } : message);
    priceRangeQuery.reload();
    onChanged();
  }

  async function handleAdd(e) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const created = await apiPost(`/events/${event.id}/tiers`, {
        ...tierPayload(form),
        sort_order: tiers.length,
      });
      setForm(emptyTierForm);
      changed(resultNotice(created, `${created.name} added.`));
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to add tier" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(tier) {
    setNotice(null);
    try {
      await apiDelete(`/events/${event.id}/tiers/${tier.id}`);
      setPendingDeleteId(null);
      changed(`${tier.name} deleted.`);
    } catch (err) {
      setPendingDeleteId(null);
      setNotice({ tone: "error", text: err.message || "Failed to delete tier" });
    }
  }

  const range = priceRangeQuery.data;

  return (
    <section className="tiers-section">
      <h2 className="drawer-heading">Ticket tiers</h2>
      <p className="panel-subtext">
        Different ticket types and prices. Attendance forecasts use the base price
        (cheapest standard or advance tier); revenue uses the real tier mix.
      </p>

      {range && range.tier_count > 0 && (
        <div className="tier-summary">
          <div>
            <span>Price range</span>
            <strong>
              {range.price_low === range.price_high
                ? formatKes(range.price_low)
                : `${formatKes(range.price_low)} – ${formatNumber(range.price_high)}`}
            </strong>
          </div>
          <div>
            <span>Base price</span>
            <strong>{formatKes(range.base_price)}</strong>
            <small>{range.base_price_source}</small>
          </div>
          <div>
            <span>Average price</span>
            <strong>{formatKes(range.average_price_by_quantity)}</strong>
            <small>
              {range.weighting === "quantity_available" ? "weighted by quantity" : "simple mean"}
            </small>
          </div>
        </div>
      )}

      {tiers.length === 0 ? (
        <p className="panel-subtext">
          No tiers yet. Predictions use the single ticket price ({formatKes(event.ticket_price)}) until
          you add some.
        </p>
      ) : (
        <ul className="tier-list">
          {tiers.map((tier, index) =>
            editingId === tier.id ? (
              <EditTierRow
                key={tier.id}
                eventId={event.id}
                tier={tier}
                onDone={(text) => {
                  setEditingId(null);
                  if (text) changed(text);
                }}
                onError={(text) => setNotice({ tone: "error", text })}
              />
            ) : (
              <li key={tier.id}>
                <i className="tier-swatch" style={{ background: tierColor(index) }} aria-hidden="true" />
                <div className="tier-main">
                  <div className="event-title">{tier.name}</div>
                  <div className="event-sub">
                    {tierTags(tier).join(" · ")} ·{" "}
                    {tier.quantity_available == null
                      ? "quantity unknown"
                      : `${formatNumber(tier.quantity_available)} available`}
                  </div>
                </div>
                <strong className="tier-price">{formatKes(tier.price)}</strong>
                {pendingDeleteId === tier.id ? (
                  <span className="row-actions">
                    <button type="button" className="text-button danger" onClick={() => handleDelete(tier)}>
                      Confirm delete
                    </button>
                    <button type="button" className="text-button" onClick={() => setPendingDeleteId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="row-actions">
                    <button type="button" className="text-button" onClick={() => setEditingId(tier.id)}>
                      Edit
                    </button>
                    <button type="button" className="text-button" onClick={() => setPendingDeleteId(tier.id)}>
                      Delete
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>

      <CopyTiersControl
        event={event}
        tiers={tiers}
        onCopied={(text) => changed(text)}
        onError={(text) => setNotice({ tone: "error", text })}
      />

      <form className="lineup-form" onSubmit={handleAdd}>
        <div className="form-section">Add a tier</div>
        <div className="preset-row" role="group" aria-label="Quick-add presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="chip-button"
              onClick={() => setForm((prev) => ({ ...prev, ...preset }))}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <TierFields form={form} onChange={onChange} />
        </div>
        <div className="modal-actions">
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Adding…" : "Add tier"}
          </button>
        </div>
      </form>
    </section>
  );
}

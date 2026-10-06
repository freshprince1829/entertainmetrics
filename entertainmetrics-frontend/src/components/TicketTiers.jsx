import { useState } from "react";
import { apiDelete, apiPatch, apiPost, useApiData } from "../api";
import { formatKes, formatNumber } from "../format";
import { PHASE_LABELS, tierColor } from "../tiers";
import { Field, Notice } from "./ui";

const PRESETS = [
  { name: "Early Bird", sale_phase: "early_bird" },
  { name: "Advance", sale_phase: "advance" },
  { name: "Last Minute", sale_phase: "last_minute" },
  { name: "Gate", sale_phase: "gate" },
  { name: "VIP", sale_phase: "premium" },
  { name: "VVIP", sale_phase: "premium" },
];

const emptyTierForm = {
  name: "",
  price: "",
  quantity_available: "",
  sale_phase: "standard",
};

function tierPayload(form) {
  return {
    name: form.name,
    price: Number(form.price),
    quantity_available: form.quantity_available === "" ? null : Number(form.quantity_available),
    sale_phase: form.sale_phase,
  };
}

function TierFields({ form, onChange }) {
  return (
    <>
      <Field label="Tier name">
        <input name="name" value={form.name} onChange={onChange} required maxLength={80} />
      </Field>
      <Field label="Price (KES)">
        <input name="price" type="number" min="0" step="any" value={form.price} onChange={onChange} required />
      </Field>
      <Field label="Quantity" hint="Leave blank if unknown">
        <input name="quantity_available" type="number" min="0" value={form.quantity_available} onChange={onChange} />
      </Field>
      <Field label="Sale phase">
        <select name="sale_phase" value={form.sale_phase} onChange={onChange}>
          {Object.entries(PHASE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
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
  const [form, , onChange] = useFormState({
    name: tier.name,
    price: String(tier.price),
    quantity_available: tier.quantity_available ?? "",
    sale_phase: tier.sale_phase,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPatch(`/events/${eventId}/tiers/${tier.id}`, tierPayload(form));
      onDone(`${form.name} updated.`);
    } catch (err) {
      onError(err.message || "Failed to update tier");
      setSaving(false);
    }
  }

  return (
    <li className="tier-edit">
      <form onSubmit={handleSave}>
        <div className="form-grid">
          <TierFields form={form} onChange={onChange} />
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

export function TicketTiersEditor({ event, tiers, onChanged }) {
  const priceRangeQuery = useApiData(`/events/${event.id}/price-range`);
  const [form, setForm, onChange] = useFormState(emptyTierForm);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  function changed(text) {
    if (text) setNotice({ tone: "success", text });
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
      changed(`${created.name} added.`);
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
                    {PHASE_LABELS[tier.sale_phase] ?? tier.sale_phase} ·{" "}
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

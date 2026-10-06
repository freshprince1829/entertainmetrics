import { useState } from "react";
import { apiPost } from "../api";
import { formatDateTime, formatKes, formatNumber } from "../format";
import { ACCESS_LABELS, AUDIENCE_LABELS, PHASE_LABELS } from "../tiers";
import { Field, Notice } from "./ui";

const STATUS_LABELS = {
  matched: ["Matched", "pill pill-high"],
  mapped: ["Mapped", "pill pill-high"],
  new_tier: ["New tier", "pill pill-mid"],
  unmatched: ["Unmatched", "pill pill-low"],
  error: ["Error", "pill pill-low"],
};

function sampleCsv(tiers) {
  const names = tiers.length ? tiers.slice(0, 3).map((t) => t.name) : ["Early Bird", "Advance", "VIP"];
  const day1 = "2026-11-01";
  const day2 = "2026-11-08";
  const lines = ["date_time,ticket_type,quantity,revenue,scanned_in"];
  names.forEach((name, i) => lines.push(`${day1} 18:00,${name},${(i + 1) * 40},,`));
  names.forEach((name, i) => lines.push(`${day2} 18:00,${name},${(i + 1) * 90},,`));
  return `${lines.join("\n")}\n`;
}

// The browser's UTC offset in minutes (e.g. 180 for Nairobi).
function browserOffset() {
  return -new Date().getTimezoneOffset();
}

function LabelSelect({ value, labels, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

function UnmatchedResolver({ item, tiers, choice, onChange }) {
  const update = (changes) => onChange({ ...choice, ...changes });
  return (
    <li className="import-unmatched">
      <div className="import-unmatched-head">
        <strong>{item.ticket_type}</strong>
        <span className="event-sub">
          {item.rows} row{item.rows === 1 ? "" : "s"}
        </span>
      </div>
      <div className="form-grid">
        <Field label="Use for this ticket type" wide>
          <select value={choice.mode === "map" ? `map:${choice.tierId}` : "create"}
            onChange={(e) =>
              e.target.value === "create"
                ? update({ mode: "create" })
                : update({ mode: "map", tierId: Number(e.target.value.slice(4)) })
            }>
            <option value="create">Create a new tier</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={`map:${tier.id}`}>
                Map to existing tier: {tier.name} ({formatKes(tier.price)})
              </option>
            ))}
          </select>
        </Field>
        {choice.mode === "create" && (
          <>
            <Field label="New tier name">
              <input value={choice.name} onChange={(e) => update({ name: e.target.value })} required maxLength={80} />
            </Field>
            <Field label="Price (KES)" hint={item.suggested_price != null ? "Suggested from revenue ÷ quantity" : undefined}>
              <input type="number" min="0" step="any" value={choice.price}
                onChange={(e) => update({ price: e.target.value })} required />
            </Field>
            <Field label="Sale phase">
              <LabelSelect value={choice.sale_phase} labels={PHASE_LABELS} onChange={(v) => update({ sale_phase: v })} />
            </Field>
            <Field label="Access level">
              <LabelSelect value={choice.access_level} labels={ACCESS_LABELS} onChange={(v) => update({ access_level: v })} />
            </Field>
            <Field label="Audience">
              <LabelSelect value={choice.audience} labels={AUDIENCE_LABELS} onChange={(v) => update({ audience: v })} />
            </Field>
            {choice.audience === "partner" && (
              <Field label="Partner name">
                <input value={choice.partner_name} onChange={(e) => update({ partner_name: e.target.value })} maxLength={80} />
              </Field>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function defaultChoice(item) {
  return {
    mode: "create",
    tierId: null,
    name: item.ticket_type,
    price: item.suggested_price ?? "",
    sale_phase: item.suggested_sale_phase,
    access_level: item.suggested_access_level,
    audience: item.suggested_audience,
    partner_name: item.suggested_partner_name ?? "",
  };
}

export function SalesImport({ event, tiers, onImported }) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  function requestBody() {
    const mappings = {};
    const createTiers = [];
    Object.entries(choices).forEach(([ticketType, choice]) => {
      if (choice.mode === "map" && choice.tierId) {
        mappings[ticketType] = choice.tierId;
      } else if (choice.mode === "create") {
        createTiers.push({
          ticket_type: ticketType,
          name: choice.name || ticketType,
          price: Number(choice.price || 0),
          sale_phase: choice.sale_phase,
          access_level: choice.access_level,
          audience: choice.audience,
          partner_name: choice.audience === "partner" ? choice.partner_name || null : null,
        });
      }
    });
    return { csv_text: csvText, utc_offset_minutes: browserOffset(), mappings, create_tiers: createTiers };
  }

  async function runPreview(text = csvText, keepChoices = true) {
    setBusy(true);
    setNotice(null);
    try {
      const body = keepChoices ? requestBody() : { csv_text: text, utc_offset_minutes: browserOffset() };
      const result = await apiPost(`/events/${event.id}/sales-import?dry_run=true`, { ...body, csv_text: text });
      setPreview(result);
      // Offer a default choice (create, with keyword suggestions) for each
      // ticket type that is still unmatched.
      setChoices((prev) => {
        const next = keepChoices ? { ...prev } : {};
        result.unmatched_types.forEach((item) => {
          if (!next[item.ticket_type]) next[item.ticket_type] = defaultChoice(item);
        });
        return next;
      });
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Could not read the CSV" });
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setChoices({});
    runPreview(text, false);
  }

  async function handleImport() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiPost(`/events/${event.id}/sales-import?dry_run=false`, requestBody());
      setNotice({
        tone: "success",
        text:
          `Imported ${result.snapshots_created} snapshot${result.snapshots_created === 1 ? "" : "s"}` +
          (result.tiers_created.length ? ` and created ${result.tiers_created.join(", ")}.` : "."),
      });
      setPreview(null);
      setCsvText("");
      setFileName("");
      setChoices({});
      onImported();
    } catch (err) {
      const extra = err.detail?.errors?.length ? ` ${err.detail.errors.join(" ")}` : "";
      setNotice({ tone: "error", text: `${err.message}${extra}` });
    } finally {
      setBusy(false);
    }
  }

  const unresolvedChoices = Object.values(choices).some(
    (c) => (c.mode === "map" && !c.tierId) || (c.mode === "create" && (c.price === "" || !c.name)),
  );
  const pendingChoices = Object.keys(choices).length > 0;

  return (
    <details className="sales-import">
      <summary>Import sales from a CSV file</summary>
      <p className="panel-subtext" style={{ marginTop: 8 }}>
        One row per ticket type and time, with <b>cumulative</b> quantities sold so far (like a
        snapshot). Columns: date_time, ticket_type, quantity, and optionally revenue and scanned_in.
        Rows with the same date/time become one snapshot. Nothing is saved until you confirm, and
        nothing at all is saved if any row has a problem.
      </p>
      <div className="import-actions">
        <label className="ghost-button file-button">
          {fileName ? `Change file (${fileName})` : "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" onChange={handleFile} hidden />
        </label>
        <a
          className="text-button"
          download="ticket-sales-template.csv"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv(tiers))}`}
        >
          Download sample CSV template
        </a>
      </div>

      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>

      {preview && (
        <div className="import-preview">
          <h4>
            Preview: {preview.rows.length} rows ·{" "}
            {preview.rows.filter((r) => ["matched", "mapped", "new_tier"].includes(r.status)).length} ready ·{" "}
            {preview.unmatched_types.length} unmatched type{preview.unmatched_types.length === 1 ? "" : "s"}
          </h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Date / time</th>
                  <th>Ticket type</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Tier or problem</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const [label, pill] = STATUS_LABELS[row.status] ?? [row.status, "pill pill-low"];
                  return (
                    <tr key={row.row_number}>
                      <td>{row.row_number}</td>
                      <td className="nowrap">{row.recorded_at ? formatDateTime(row.recorded_at) : "-"}</td>
                      <td>{row.ticket_type || "-"}</td>
                      <td>{formatNumber(row.quantity)}</td>
                      <td><span className={pill}>{label}</span></td>
                      <td className="event-sub">{row.errors.length ? row.errors.join("; ") : row.tier_name ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.unmatched_types.length > 0 && (
            <>
              <h4>Map or create unmatched ticket types</h4>
              <p className="metric-note">Suggestions come from keywords in the ticket type name. Check them before importing.</p>
              <ul className="import-unmatched-list">
                {preview.unmatched_types.map((item) => (
                  <UnmatchedResolver
                    key={item.ticket_type}
                    item={item}
                    tiers={tiers}
                    choice={choices[item.ticket_type] ?? defaultChoice(item)}
                    onChange={(choice) => setChoices((prev) => ({ ...prev, [item.ticket_type]: choice }))}
                  />
                ))}
              </ul>
            </>
          )}

          {preview.errors.length > 0 && (
            <ul className="import-errors">
              {preview.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}

          {preview.can_import && preview.snapshots.length > 0 && (
            <p className="tier-totals">
              Ready to create {preview.snapshots.length} snapshot{preview.snapshots.length === 1 ? "" : "s"}; the
              last one totals <b>{formatNumber(preview.snapshots.at(-1).tickets_sold_total)}</b> tickets and{" "}
              <b>{formatKes(preview.snapshots.at(-1).revenue_to_date)}</b>.
            </p>
          )}

          <div className="modal-actions">
            {pendingChoices && (
              <button type="button" className="ghost-button" onClick={() => runPreview()} disabled={busy || unresolvedChoices}>
                Recheck with these choices
              </button>
            )}
            <button type="button" className="primary-button" onClick={handleImport} disabled={busy || !preview.can_import}>
              {busy ? "Working…" : "Confirm import"}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

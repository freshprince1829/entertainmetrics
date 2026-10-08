import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiPatch, apiPost, useApiData } from "../api";
import {
  EmptyState,
  Field,
  Icon,
  LoadingPanel,
  Modal,
  Notice,
  PageHeader,
  ProgressBar,
  StatCard,
} from "../components/ui";
import { SalesTrackingSection } from "../components/SalesTracking";
import { TicketTiersEditor } from "../components/TicketTiers";
import { RangeValue } from "../components/PredictionRange";
import {
  canRecordActuals,
  formatDate,
  formatKes,
  formatNumber,
  formatPriceRange,
  isUpcoming,
  thumbGradient,
} from "../format";
import { ACTUAL } from "../theme";

const EVENT_TYPE_SUGGESTIONS = ["Concert", "Festival", "Comedy", "Jazz", "Club Night", "Conference"];

const initialForm = {
  event_name: "",
  event_type: "",
  event_date: "",
  venue: "",
  city: "",
  ticket_price: "",
  marketing_spend: "",
  capacity: "",
  actual_attendance: "",
  revenue: "",
};

const initialLineupForm = {
  artist_id: "",
  role: "",
  performance_order: "",
  is_headliner: false,
  set_duration_minutes: "",
};

function NewEventModal({ onClose, onCreated }) {
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const includeActuals = canRecordActuals(formData.event_date);
    const payload = {
      event_name: formData.event_name,
      event_type: formData.event_type,
      event_date: formData.event_date,
      venue: formData.venue,
      city: formData.city,
      ticket_price: Number(formData.ticket_price),
      marketing_spend: Number(formData.marketing_spend),
      capacity: Number(formData.capacity),
      actual_attendance:
        includeActuals && formData.actual_attendance
          ? Number(formData.actual_attendance)
          : null,
      revenue: includeActuals && formData.revenue ? Number(formData.revenue) : null,
    };

    try {
      const created = await apiPost("/events", payload);
      onCreated(created);
    } catch (err) {
      setError(err.message || "Failed to create event");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="New event"
      description="Event details feed the prediction and recommendation engines."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-section">Event details</div>
        <div className="form-grid">
          <Field label="Event name" wide>
            <input name="event_name" value={formData.event_name} onChange={handleChange} required />
          </Field>
          <Field label="Event type">
            <input
              name="event_type"
              list="event-type-options"
              value={formData.event_type}
              onChange={handleChange}
              required
            />
            <datalist id="event-type-options">
              {EVENT_TYPE_SUGGESTIONS.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </Field>
          <Field label="Date">
            <input name="event_date" type="date" value={formData.event_date} onChange={handleChange} required />
          </Field>
          <Field label="Venue">
            <input name="venue" value={formData.venue} onChange={handleChange} required />
          </Field>
          <Field label="City">
            <input name="city" value={formData.city} onChange={handleChange} required />
          </Field>
        </div>

        <div className="form-section">Commercials</div>
        <div className="form-grid">
          <Field label="Ticket price (KES)">
            <input name="ticket_price" type="number" min="0" step="any" value={formData.ticket_price} onChange={handleChange} required />
          </Field>
          <Field label="Marketing spend (KES)">
            <input name="marketing_spend" type="number" min="0" step="any" value={formData.marketing_spend} onChange={handleChange} required />
          </Field>
          <Field label="Capacity">
            <input name="capacity" type="number" min="1" value={formData.capacity} onChange={handleChange} required />
          </Field>
        </div>

        {canRecordActuals(formData.event_date) && (
          <>
            <div className="form-section">
              Actual results <span className="optional">optional — for events that have already happened</span>
            </div>
            <div className="form-grid">
              <Field label="Actual attendance">
                <input name="actual_attendance" type="number" min="0" value={formData.actual_attendance} onChange={handleChange} />
              </Field>
              <Field label="Actual revenue (KES)">
                <input name="revenue" type="number" min="0" step="any" value={formData.revenue} onChange={handleChange} />
              </Field>
            </div>
          </>
        )}

        <Notice tone="error">{error}</Notice>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Creating…" : "Create event"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ActualsForm({ event, onSaved }) {
  const [formData, setFormData] = useState({
    actual_attendance: event.actual_attendance ?? "",
    revenue: event.revenue ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);

    const payload = {
      actual_attendance: Number(formData.actual_attendance),
      revenue: formData.revenue === "" ? null : Number(formData.revenue),
    };

    try {
      await apiPatch(`/events/${event.id}/actuals`, payload);
      setNotice({ tone: "success", text: "Actual results saved." });
      onSaved();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to save actual results" });
    } finally {
      setSubmitting(false);
    }
  }

  const fullPriceRevenue =
    formData.actual_attendance === ""
      ? null
      : Number(formData.actual_attendance) * event.ticket_price;

  return (
    <form className="lineup-form" onSubmit={handleSubmit}>
      <div className="form-section">
        {event.actual_attendance != null ? "Update actual results" : "Record actual results"}
      </div>
      <div className="form-grid">
        <Field label="Actual attendance">
          <input
            name="actual_attendance"
            type="number"
            min="0"
            max={event.capacity}
            value={formData.actual_attendance}
            onChange={handleChange}
            required
          />
        </Field>
        <Field
          label="Actual revenue (KES)"
          hint={
            fullPriceRevenue !== null
              ? `At full ticket price: ${formatKes(fullPriceRevenue)}. Leave blank if unknown.`
              : "Leave blank if unknown."
          }
        >
          <input name="revenue" type="number" min="0" step="any" value={formData.revenue} onChange={handleChange} />
        </Field>
      </div>
      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <div className="modal-actions">
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Saving…" : "Save results"}
        </button>
      </div>
    </form>
  );
}

const EDITABLE_FIELDS = [
  "event_name", "event_type", "event_date", "venue", "city",
  "ticket_price", "marketing_spend", "capacity",
];
const NUMBER_FIELDS = new Set(["ticket_price", "marketing_spend", "capacity"]);

function EditEventForm({ event, onCancel, onSaved }) {
  const [formData, setFormData] = useState(() =>
    Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, String(event[field] ?? "")])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  // Only fields that actually changed are sent.
  const changes = {};
  EDITABLE_FIELDS.forEach((field) => {
    const value = NUMBER_FIELDS.has(field) ? Number(formData[field]) : formData[field].trim();
    if (value !== event[field]) changes[field] = value;
  });
  const changedCount = Object.keys(changes).length;

  async function handleSubmit(e) {
    e.preventDefault();
    if (changedCount === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await apiPatch(`/events/${event.id}`, changes);
      onSaved(updated, changedCount);
    } catch (err) {
      setError(err.message || "Failed to update the event");
      setSaving(false);
    }
  }

  return (
    <form className="edit-event" onSubmit={handleSubmit}>
      <div className="form-section">Edit event details</div>
      <div className="form-grid">
        <Field label="Event name" wide>
          <input name="event_name" value={formData.event_name} onChange={handleChange} required maxLength={200} />
        </Field>
        <Field label="Event type">
          <input name="event_type" list="edit-event-type-options" value={formData.event_type}
            onChange={handleChange} required maxLength={100} />
          <datalist id="edit-event-type-options">
            {EVENT_TYPE_SUGGESTIONS.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </Field>
        <Field label="Date">
          <input name="event_date" type="date" value={formData.event_date} onChange={handleChange} required />
        </Field>
        <Field label="Venue">
          <input name="venue" value={formData.venue} onChange={handleChange} required maxLength={200} />
        </Field>
        <Field label="City">
          <input name="city" value={formData.city} onChange={handleChange} required maxLength={100} />
        </Field>
        <Field
          label="Ticket price (KES)"
          hint={event.tier_count > 0 ? "Fallback price; tier prices are edited under Ticket tiers" : undefined}
        >
          <input name="ticket_price" type="number" min="0" step="any" value={formData.ticket_price}
            onChange={handleChange} required />
        </Field>
        <Field label="Marketing spend (KES)">
          <input name="marketing_spend" type="number" min="0" step="any" value={formData.marketing_spend}
            onChange={handleChange} required />
        </Field>
        <Field label="Capacity">
          <input name="capacity" type="number" min="1" value={formData.capacity} onChange={handleChange} required />
        </Field>
      </div>
      <p className="panel-subtext edit-event-note">
        Saved predictions keep the values they were made with; run a new prediction after
        changing prices, marketing spend or capacity.
      </p>
      <Notice tone="error">{error}</Notice>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "Saving…" : changedCount ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "No changes"}
        </button>
      </div>
    </form>
  );
}

function EventDrawer({ event, artists, onClose, onEventUpdated }) {
  const lineupQuery = useApiData(`/events/${event.id}/lineup`);
  const tiersQuery = useApiData(`/events/${event.id}/tiers`);
  const tiers = tiersQuery.data ?? [];
  const [editing, setEditing] = useState(false);
  const [editNotice, setEditNotice] = useState("");
  const lineup = useMemo(
    () =>
      [...(lineupQuery.data ?? [])].sort(
        (a, b) => (a.performance_order ?? 99) - (b.performance_order ?? 99),
      ),
    [lineupQuery.data],
  );
  const [formData, setFormData] = useState(initialLineupForm);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingRemoveId, setPendingRemoveId] = useState(null);

  async function handleRemove(entry, artistName) {
    setNotice(null);
    try {
      await apiDelete(`/event-artists/${entry.id}`);
      setPendingRemoveId(null);
      setNotice({ tone: "success", text: `${artistName} was removed from this lineup.` });
      lineupQuery.reload();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to remove artist from lineup" });
    }
  }

  const artistById = useMemo(() => {
    const map = {};
    artists.forEach((artist) => {
      map[artist.id] = artist;
    });
    return map;
  }, [artists]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);

    const payload = {
      event_id: event.id,
      artist_id: Number(formData.artist_id),
      role: formData.role || null,
      performance_order: formData.performance_order ? Number(formData.performance_order) : null,
      is_headliner: formData.is_headliner,
      set_duration_minutes: formData.set_duration_minutes
        ? Number(formData.set_duration_minutes)
        : null,
    };

    try {
      await apiPost("/event-artists", payload);
      setNotice({ tone: "success", text: "Artist added to lineup." });
      setFormData(initialLineupForm);
      lineupQuery.reload();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to add artist to lineup" });
    } finally {
      setSubmitting(false);
    }
  }

  const sellThrough =
    event.actual_attendance != null && event.capacity > 0
      ? event.actual_attendance / event.capacity
      : null;

  return (
    <Modal title={event.event_name} description={`${event.event_type} · ${formatDate(event.event_date)}`} onClose={onClose} side>
      {editing ? (
        <EditEventForm
          event={event}
          onCancel={() => setEditing(false)}
          onSaved={(updated, count) => {
            setEditing(false);
            setEditNotice(`${count} detail${count === 1 ? "" : "s"} updated for ${updated.event_name}.`);
            onEventUpdated();
          }}
        />
      ) : (
      <div className="detail-grid">
        <div>
          <span>Venue</span>
          <strong>{event.venue}</strong>
          <small>{event.city}</small>
        </div>
        <div>
          <span>{event.tier_count > 0 ? "Ticket prices" : "Ticket price"}</span>
          <strong>{formatPriceRange(event)}</strong>
          {event.tier_count > 0 && (
            <small>{event.tier_count} ticket tiers</small>
          )}
        </div>
        <div>
          <span>Marketing spend</span>
          <strong>{formatKes(event.marketing_spend)}</strong>
        </div>
        <div>
          <span>Capacity</span>
          <strong>{formatNumber(event.capacity)}</strong>
        </div>
        <div>
          <span>Actual attendance</span>
          <strong>{formatNumber(event.actual_attendance)}</strong>
          {sellThrough !== null && <small>{Math.round(sellThrough * 100)}% of capacity</small>}
        </div>
        <div>
          <span>Actual revenue</span>
          <strong>{formatKes(event.revenue)}</strong>
        </div>
      </div>
      )}
      <Notice tone="success" onDismiss={() => setEditNotice("")}>
        {editNotice}
      </Notice>

      {canRecordActuals(event.event_date) ? (
        <ActualsForm
          key={`${event.actual_attendance}-${event.revenue}`}
          event={event}
          onSaved={onEventUpdated}
        />
      ) : (
        <p className="panel-subtext">
          Actual results can be recorded once the event date ({formatDate(event.event_date)}) arrives.
        </p>
      )}

      <div className="drawer-actions">
        {!editing && (
          <button type="button" className="ghost-button" onClick={() => { setEditNotice(""); setEditing(true); }}>
            <Icon name="edit" size={16} /> Edit details
          </button>
        )}
        <Link to={`/predictions?event=${event.id}`} className="primary-button">
          <Icon name="chart" size={16} /> Run prediction
        </Link>
        <Link to={`/recommendations?event=${event.id}`} className="ghost-button">
          <Icon name="spark" size={16} /> Recommendations
        </Link>
      </div>

      <TicketTiersEditor
        event={event}
        tiers={tiers}
        onChanged={() => {
          tiersQuery.reload();
          // Refresh the event list so price ranges update everywhere.
          onEventUpdated();
        }}
      />

      <SalesTrackingSection
        event={event}
        tiers={tiers}
        onEventUpdated={onEventUpdated}
        onTiersChanged={() => {
          tiersQuery.reload();
          onEventUpdated();
        }}
      />

      <h2 className="drawer-heading">Lineup</h2>
      <p className="panel-subtext">
        Linked artists strengthen artist-aware predictions. Events without a lineup
        still receive a baseline forecast.
      </p>

      {lineupQuery.loading ? (
        <p className="panel-subtext">Loading lineup…</p>
      ) : lineupQuery.error ? (
        <Notice tone="error">{lineupQuery.error.message}</Notice>
      ) : lineup.length === 0 ? (
        <EmptyState title="No artists linked yet">Add the first act below.</EmptyState>
      ) : (
        <ol className="lineup-list">
          {lineup.map((entry) => {
            const artist = artistById[entry.artist_id];
            const artistName = artist?.artist_name ?? `Artist #${entry.artist_id}`;
            return (
              <li key={entry.id}>
                <span className="lineup-order">{entry.performance_order ?? "–"}</span>
                <div className="event-thumb small" style={{ background: thumbGradient(entry.artist_id) }}>
                  {(artist?.artist_name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="lineup-main">
                  <div className="event-title">
                    {artist?.artist_name ?? `Artist #${entry.artist_id}`}
                    {entry.is_headliner && <span className="pill pill-mid">Headliner</span>}
                  </div>
                  <div className="event-sub">
                    {[entry.role, entry.set_duration_minutes && `${entry.set_duration_minutes} min`]
                      .filter(Boolean)
                      .join(" · ") || "No role set"}
                  </div>
                </div>
                {pendingRemoveId === entry.id ? (
                  <span className="row-actions lineup-actions">
                    <button type="button" className="text-button danger" onClick={() => handleRemove(entry, artistName)}>
                      Confirm remove
                    </button>
                    <button type="button" className="text-button" onClick={() => setPendingRemoveId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-button lineup-actions"
                    onClick={() => setPendingRemoveId(entry.id)}
                    title="Remove from this event only - the artist stays in the system"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form className="lineup-form" onSubmit={handleSubmit}>
        <div className="form-section">Add artist to lineup</div>
        <div className="form-grid">
          <Field label="Artist" wide>
            <select name="artist_id" value={formData.artist_id} onChange={handleChange} required>
              <option value="">{artists.length === 0 ? "No artists available" : "Select an artist"}</option>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.artist_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <input name="role" placeholder="e.g. Support" value={formData.role} onChange={handleChange} />
          </Field>
          <Field label="Performance order">
            <input name="performance_order" type="number" min="1" value={formData.performance_order} onChange={handleChange} />
          </Field>
          <Field label="Set duration (min)">
            <input name="set_duration_minutes" type="number" min="1" value={formData.set_duration_minutes} onChange={handleChange} />
          </Field>
          <label className="checkbox">
            <input name="is_headliner" type="checkbox" checked={formData.is_headliner} onChange={handleChange} />
            Headliner
          </label>
        </div>
        <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
          {notice?.text}
        </Notice>
        <div className="modal-actions">
          <button type="submit" className="primary-button" disabled={submitting || artists.length === 0}>
            {submitting ? "Adding…" : "Add to lineup"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EventsPage() {
  const eventsQuery = useApiData("/events");
  const artistsQuery = useApiData("/artists");
  const predictionsQuery = useApiData("/predictions");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState("");

  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const artists = artistsQuery.data ?? [];

  const latestPrediction = useMemo(() => {
    const map = {};
    (predictionsQuery.data ?? []).forEach((prediction) => {
      const existing = map[prediction.event_id];
      if (!existing || prediction.created_at > existing.created_at) {
        map[prediction.event_id] = prediction;
      }
    });
    return map;
  }, [predictionsQuery.data]);

  const eventTypes = useMemo(
    () => [...new Set(events.map((event) => event.event_type))].sort(),
    [events],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events
      .filter((event) => {
        if (typeFilter && event.event_type !== typeFilter) return false;
        if (statusFilter === "upcoming" && !isUpcoming(event.event_date)) return false;
        if (statusFilter === "past" && isUpcoming(event.event_date)) return false;
        if (!term) return true;
        return [event.event_name, event.venue, event.city, event.event_type]
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  }, [events, search, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const upcoming = events.filter((event) => isUpcoming(event.event_date)).length;
    const capacity = events.reduce((sum, event) => sum + (event.capacity || 0), 0);
    const recordedRevenue = events.reduce((sum, event) => sum + (event.revenue || 0), 0);
    return { upcoming, capacity, recordedRevenue };
  }, [events]);

  const selectedEvent = events.find((event) => event.id === selectedId);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Events"
        description="Create events, manage lineups and jump straight into forecasts."
      >
        <button type="button" className="cta-button" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> New event
        </button>
      </PageHeader>

      <Notice tone="success" onDismiss={() => setNotice("")}>
        {notice}
      </Notice>

      <section className="summary-grid">
        <StatCard label="Total events" value={formatNumber(events.length)} />
        <StatCard label="Upcoming" value={formatNumber(stats.upcoming)} note="dated today or later" />
        <StatCard label="Combined capacity" value={formatNumber(stats.capacity)} />
        <StatCard label="Recorded revenue" value={formatKes(stats.recordedRevenue)} note="from completed events" />
      </section>

      {eventsQuery.loading ? (
        <LoadingPanel />
      ) : eventsQuery.error ? (
        <Notice tone="error">{eventsQuery.error.message}</Notice>
      ) : (
        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <Icon name="search" size={16} />
              <input
                type="search"
                placeholder="Search by name, venue or city"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search events"
              />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
              <option value="">All types</option>
              {eventTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <div className="segmented" role="group" aria-label="Filter by date">
              {["all", "upcoming", "past"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={statusFilter === value ? "active" : ""}
                  onClick={() => setStatusFilter(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={events.length === 0 ? "No events yet" : "No events match your filters"}
              action={
                events.length === 0 && (
                  <button type="button" className="cta-button" onClick={() => setShowCreate(true)}>
                    Create your first event
                  </button>
                )
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="clickable-rows">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Venue</th>
                    <th>Ticket</th>
                    <th>Capacity</th>
                    <th>Attendance</th>
                    <th>Latest forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => {
                    const prediction = latestPrediction[event.id];
                    const upcoming = isUpcoming(event.event_date);
                    return (
                      <tr
                        key={event.id}
                        onClick={() => setSelectedId(event.id)}
                        onKeyDown={(e) => e.key === "Enter" && setSelectedId(event.id)}
                        tabIndex={0}
                      >
                        <td>
                          <div className="event-cell">
                            <div className="event-thumb" style={{ background: thumbGradient(event.id) }}>
                              {event.event_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="event-title">{event.event_name}</div>
                              <div className="event-sub">{event.event_type}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {formatDate(event.event_date)}
                          <div>
                            <span className={upcoming ? "pill pill-high" : "pill pill-low"}>
                              {upcoming ? "Upcoming" : "Past"}
                            </span>
                          </div>
                        </td>
                        <td>
                          {event.venue}
                          <div className="event-sub">{event.city}</div>
                        </td>
                        <td className="nowrap">
                          {formatPriceRange(event)}
                          {event.tier_count > 0 && <div className="event-sub">{event.tier_count} tiers</div>}
                        </td>
                        <td>{formatNumber(event.capacity)}</td>
                        <td className="cell-bar">
                          {event.actual_attendance != null ? (
                            <>
                              {formatNumber(event.actual_attendance)}
                              <ProgressBar value={event.actual_attendance} max={event.capacity} color={ACTUAL} />
                            </>
                          ) : (
                            <span className="event-sub">Not recorded</span>
                          )}
                        </td>
                        <td>
                          {prediction ? (
                            <RangeValue
                              compact
                              expected={prediction.predicted_attendance}
                              low={prediction.attendance_low}
                              high={prediction.attendance_high}
                              note={prediction.range_note}
                            />
                          ) : predictionsQuery.loading ? (
                            <span className="event-sub">Loading…</span>
                          ) : (
                            <span className="event-sub">None yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="table-foot">Select an event to view details and manage its lineup.</p>
        </section>
      )}

      {showCreate && (
        <NewEventModal
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setNotice(`“${created.event_name}” was created.`);
            eventsQuery.reload();
          }}
        />
      )}

      {selectedEvent && (
        <EventDrawer
          event={selectedEvent}
          artists={artists}
          onClose={() => setSelectedId(null)}
          onEventUpdated={() => eventsQuery.reload()}
        />
      )}
    </>
  );
}

export default EventsPage;

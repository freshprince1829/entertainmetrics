import { useMemo, useState } from "react";
import { apiPost, useApiData } from "../api";
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
import { formatCompact, formatNumber, thumbGradient } from "../format";

const initialForm = {
  artist_name: "",
  genre: "",
  label: "",
  spotify_monthly_streams: "",
  youtube_subscribers: "",
  instagram_followers: "",
  engagement_score: "",
  headline_score: "",
  market_strength_score: "",
};

const SCORE_FIELDS = [
  { key: "engagement_score", label: "Engagement", color: "#F0A860" },
  { key: "headline_score", label: "Headline", color: "#4FD1C5" },
  { key: "market_strength_score", label: "Market strength", color: "#9B8CF2" },
];

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function NewArtistModal({ onClose, onCreated }) {
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

    const payload = {
      artist_name: formData.artist_name,
      genre: formData.genre || null,
      label: formData.label || null,
      spotify_monthly_streams: numberOrNull(formData.spotify_monthly_streams),
      youtube_subscribers: numberOrNull(formData.youtube_subscribers),
      instagram_followers: numberOrNull(formData.instagram_followers),
      engagement_score: numberOrNull(formData.engagement_score),
      headline_score: numberOrNull(formData.headline_score),
      market_strength_score: numberOrNull(formData.market_strength_score),
    };

    try {
      const created = await apiPost("/artists", payload);
      onCreated(created);
    } catch (err) {
      setError(err.message || "Failed to create artist");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="New artist"
      description="Artist scores are used directly by the prediction engine when the artist is on an event lineup."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-section">Profile</div>
        <div className="form-grid">
          <Field label="Artist name" wide>
            <input name="artist_name" value={formData.artist_name} onChange={handleChange} required />
          </Field>
          <Field label="Genre">
            <input name="genre" value={formData.genre} onChange={handleChange} />
          </Field>
          <Field label="Label">
            <input name="label" value={formData.label} onChange={handleChange} />
          </Field>
        </div>

        <div className="form-section">Audience reach</div>
        <div className="form-grid">
          <Field label="Spotify monthly streams">
            <input name="spotify_monthly_streams" type="number" min="0" value={formData.spotify_monthly_streams} onChange={handleChange} />
          </Field>
          <Field label="YouTube subscribers">
            <input name="youtube_subscribers" type="number" min="0" value={formData.youtube_subscribers} onChange={handleChange} />
          </Field>
          <Field label="Instagram followers">
            <input name="instagram_followers" type="number" min="0" value={formData.instagram_followers} onChange={handleChange} />
          </Field>
        </div>

        <div className="form-section">
          Prediction scores <span className="optional">used by the prediction engine</span>
        </div>
        <div className="form-grid">
          <Field label="Engagement score">
            <input name="engagement_score" type="number" step="0.1" value={formData.engagement_score} onChange={handleChange} />
          </Field>
          <Field label="Headline score">
            <input name="headline_score" type="number" step="0.1" value={formData.headline_score} onChange={handleChange} />
          </Field>
          <Field label="Market strength score">
            <input name="market_strength_score" type="number" step="0.1" value={formData.market_strength_score} onChange={handleChange} />
          </Field>
        </div>

        <Notice tone="error">{error}</Notice>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Creating…" : "Create artist"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ArtistsPage() {
  const artistsQuery = useApiData("/artists");
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [sortBy, setSortBy] = useState("strength");
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");

  const artists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);

  const genres = useMemo(
    () => [...new Set(artists.map((artist) => artist.genre).filter(Boolean))].sort(),
    [artists],
  );

  // Bars are scaled against the highest value in the roster, so they show
  // how artists compare with each other rather than an absolute scale.
  const maxScore = useMemo(() => {
    const max = {};
    SCORE_FIELDS.forEach(({ key }) => {
      max[key] = Math.max(0, ...artists.map((artist) => artist[key] ?? 0));
    });
    return max;
  }, [artists]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const strength = (artist) =>
      (artist.engagement_score ?? 0) + (artist.headline_score ?? 0) + (artist.market_strength_score ?? 0);
    return artists
      .filter((artist) => {
        if (genreFilter && artist.genre !== genreFilter) return false;
        if (!term) return true;
        return [artist.artist_name, artist.genre, artist.label].join(" ").toLowerCase().includes(term);
      })
      .sort((a, b) =>
        sortBy === "name"
          ? a.artist_name.localeCompare(b.artist_name)
          : sortBy === "streams"
            ? (b.spotify_monthly_streams ?? 0) - (a.spotify_monthly_streams ?? 0)
            : strength(b) - strength(a),
      );
  }, [artists, search, genreFilter, sortBy]);

  const stats = useMemo(() => {
    const engagement = artists.map((a) => a.engagement_score).filter((v) => v != null);
    const reach = artists.reduce(
      (sum, a) => sum + (a.spotify_monthly_streams ?? 0) + (a.youtube_subscribers ?? 0) + (a.instagram_followers ?? 0),
      0,
    );
    const complete = artists.filter((a) => SCORE_FIELDS.every(({ key }) => a[key] != null)).length;
    return {
      avgEngagement: engagement.length ? engagement.reduce((s, v) => s + v, 0) / engagement.length : null,
      reach,
      complete,
    };
  }, [artists]);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Artists"
        description="Artist intelligence that powers lineup-aware predictions and recommendations."
      >
        <button type="button" className="cta-button" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> New artist
        </button>
      </PageHeader>

      <Notice tone="success" onDismiss={() => setNotice("")}>
        {notice}
      </Notice>

      <section className="summary-grid">
        <StatCard label="Artists on roster" value={formatNumber(artists.length)} accent="#F0A860" />
        <StatCard label="Genres" value={formatNumber(genres.length)} accent="#4FD1C5" />
        <StatCard
          label="Avg. engagement score"
          value={stats.avgEngagement == null ? "-" : stats.avgEngagement.toFixed(1)}
          accent="#9B8CF2"
        />
        <StatCard
          label="Complete score profiles"
          value={`${stats.complete}/${artists.length}`}
          note="all three scores filled in"
          accent="#5FD9B4"
        />
        <StatCard label="Combined audience reach" value={formatCompact(stats.reach)} note="streams + subscribers + followers" />
      </section>

      {artistsQuery.loading ? (
        <LoadingPanel />
      ) : artistsQuery.error ? (
        <Notice tone="error">{artistsQuery.error.message}</Notice>
      ) : (
        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <Icon name="search" size={16} />
              <input
                type="search"
                placeholder="Search by name, genre or label"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search artists"
              />
            </div>
            <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)} aria-label="Filter by genre">
              <option value="">All genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort artists">
              <option value="strength">Sort: combined score</option>
              <option value="streams">Sort: Spotify streams</option>
              <option value="name">Sort: name</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={artists.length === 0 ? "No artists yet" : "No artists match your filters"}
              action={
                artists.length === 0 && (
                  <button type="button" className="cta-button" onClick={() => setShowCreate(true)}>
                    Add your first artist
                  </button>
                )
              }
            />
          ) : (
            <div className="artist-grid">
              {filtered.map((artist) => (
                <article key={artist.id} className="artist-card">
                  <div className="artist-head">
                    <div className="event-thumb" style={{ background: thumbGradient(artist.id) }}>
                      {artist.artist_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="event-title">{artist.artist_name}</div>
                      <div className="event-sub">
                        {[artist.genre, artist.label].filter(Boolean).join(" · ") || "No genre or label"}
                      </div>
                    </div>
                  </div>

                  <div className="reach-row">
                    <div>
                      <span>Spotify</span>
                      <strong>{formatCompact(artist.spotify_monthly_streams)}</strong>
                    </div>
                    <div>
                      <span>YouTube</span>
                      <strong>{formatCompact(artist.youtube_subscribers)}</strong>
                    </div>
                    <div>
                      <span>Instagram</span>
                      <strong>{formatCompact(artist.instagram_followers)}</strong>
                    </div>
                  </div>

                  <div className="bar-list">
                    {SCORE_FIELDS.map(({ key, label, color }) => (
                      <div key={key}>
                        <div className="bar-row-head">
                          <span>{label}</span>
                          <span>{artist[key] ?? "Missing"}</span>
                        </div>
                        <ProgressBar value={artist[key] ?? 0} max={maxScore[key]} color={color} />
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="table-foot">Score bars are relative to the highest score on the roster.</p>
        </section>
      )}

      {showCreate && (
        <NewArtistModal
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setNotice(`“${created.artist_name}” was added to the roster.`);
            artistsQuery.reload();
          }}
        />
      )}
    </>
  );
}

export default ArtistsPage;

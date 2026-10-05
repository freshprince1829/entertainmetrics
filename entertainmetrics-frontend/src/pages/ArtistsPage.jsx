import { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

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

function ArtistsPage() {
  const [artists, setArtists] = useState([]);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function loadArtists() {
    try {
      const res = await fetch(`${API_BASE}/artists`);
      const data = await res.json();
      setArtists(data);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadArtists();
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const payload = {
      artist_name: formData.artist_name,
      genre: formData.genre || null,
      label: formData.label || null,
      spotify_monthly_streams: formData.spotify_monthly_streams
        ? Number(formData.spotify_monthly_streams)
        : null,
      youtube_subscribers: formData.youtube_subscribers
        ? Number(formData.youtube_subscribers)
        : null,
      instagram_followers: formData.instagram_followers
        ? Number(formData.instagram_followers)
        : null,
      engagement_score: formData.engagement_score
        ? Number(formData.engagement_score)
        : null,
      headline_score: formData.headline_score
        ? Number(formData.headline_score)
        : null,
      market_strength_score: formData.market_strength_score
        ? Number(formData.market_strength_score)
        : null,
    };

    try {
      const res = await fetch(`${API_BASE}/artists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || "Failed to create artist");
        return;
      }

      setMessage("Artist created successfully");
      setFormData(initialForm);
      loadArtists();
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong while creating the artist");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="panel">
        <h1>Artists</h1>
        <p className="panel-subtext">
          Add and manage artist intelligence data for EntertainMetrics.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          <input
            name="artist_name"
            placeholder="Artist Name"
            value={formData.artist_name}
            onChange={handleChange}
            required
          />
          <input
            name="genre"
            placeholder="Genre"
            value={formData.genre}
            onChange={handleChange}
          />
          <input
            name="label"
            placeholder="Label"
            value={formData.label}
            onChange={handleChange}
          />
          <input
            name="spotify_monthly_streams"
            placeholder="Spotify Streams"
            value={formData.spotify_monthly_streams}
            onChange={handleChange}
            type="number"
          />
          <input
            name="youtube_subscribers"
            placeholder="YouTube Subscribers"
            value={formData.youtube_subscribers}
            onChange={handleChange}
            type="number"
          />
          <input
            name="instagram_followers"
            placeholder="Instagram Followers"
            value={formData.instagram_followers}
            onChange={handleChange}
            type="number"
          />
          <input
            name="engagement_score"
            placeholder="Engagement Score"
            value={formData.engagement_score}
            onChange={handleChange}
            type="number"
            step="0.1"
          />
          <input
            name="headline_score"
            placeholder="Headline Score"
            value={formData.headline_score}
            onChange={handleChange}
            type="number"
            step="0.1"
          />
          <input
            name="market_strength_score"
            placeholder="Market Strength Score"
            value={formData.market_strength_score}
            onChange={handleChange}
            type="number"
            step="0.1"
          />

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Creating..." : "Create Artist"}
          </button>
        </form>

        {message && <p className="form-message">{message}</p>}
      </div>

      <div className="panel">
        <h2>Artist Records</h2>
        {artists.length === 0 ? (
          <p>No artists found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Genre</th>
                  <th>Label</th>
                  <th>Spotify Streams</th>
                  <th>YouTube Subs</th>
                  <th>Instagram Followers</th>
                  <th>Engagement</th>
                  <th>Headline Score</th>
                  <th>Market Strength</th>
                </tr>
              </thead>
              <tbody>
                {artists.map((artist) => (
                  <tr key={artist.id}>
                    <td>{artist.artist_name}</td>
                    <td>{artist.genre || "-"}</td>
                    <td>{artist.label || "-"}</td>
                    <td>{artist.spotify_monthly_streams ?? "-"}</td>
                    <td>{artist.youtube_subscribers ?? "-"}</td>
                    <td>{artist.instagram_followers ?? "-"}</td>
                    <td>{artist.engagement_score ?? "-"}</td>
                    <td>{artist.headline_score ?? "-"}</td>
                    <td>{artist.market_strength_score ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default ArtistsPage;
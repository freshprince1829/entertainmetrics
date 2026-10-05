# EntertainMetrics Frontend

React + Vite single-page app for the EntertainMetrics analytics platform.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: summary metrics, predicted vs. actual, confidence, recent activity |
| `/events` | Event list with search/filters; click an event to view details and manage its lineup |
| `/artists` | Artist roster with reach and prediction-score profiles |
| `/predictions` | Run forecasts (stored values pre-filled, editable for what-if runs) and browse history |
| `/recommendations` | Ticket price sweep and artist suggestions for an event |

`/predictions?event=<id>` and `/recommendations?event=<id>` open with that event selected.

## Local development

```bash
npm install
cp .env.example .env   # optional; defaults to http://127.0.0.1:8000
npm run dev
```

Start the backend separately (`python3 -m uvicorn app.main:app --reload` in `entertainmetrics-backend/`).

## Configuration

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL of the FastAPI backend. Read at build time. |

## Production build and deployment

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve the build locally
```

`dist/` can be hosted on any static host. Set `VITE_API_BASE_URL` to the deployed backend URL in the host's build environment.

Because the app uses client-side routing, the host must serve `index.html` for unknown paths. This is already configured for:

- **Vercel** — `vercel.json`
- **Netlify / Cloudflare Pages** — `public/_redirects`

Set the project root to `entertainmetrics-frontend` on the host.

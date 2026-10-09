# EntertainMetrics Frontend

React + Vite single-page app for the EntertainMetrics analytics platform.

## Pages

Public:

| Route | Purpose |
| --- | --- |
| `/` | Landing page (shows "Open dashboard" when signed in) |
| `/login` | Sign in (email + password). Signed-in users are sent to `/dashboard` |
| `/forgot-password` | Request a password-reset email |
| `/reset-password` | Choose a new password (opened from the reset email) |

Signed-in users only (others are sent to `/login` and returned afterwards):

| Route | Purpose |
| --- | --- |
| `/dashboard` | Summary metrics, predicted vs. actual, confidence, recent activity |
| `/events` | Event list with search/filters; click an event to view details and manage it |
| `/artists` | Artist roster with reach and prediction-score profiles |
| `/predictions` | Run forecasts (stored values pre-filled, editable for what-if runs) and browse history |
| `/recommendations` | Ticket price sweep and artist suggestions for an event |

`/predictions?event=<id>` and `/recommendations?event=<id>` open with that event selected.

## Accounts and roles

Sign-in uses Supabase Auth. Access is by invitation: an administrator creates accounts in
Supabase and sets each person's role (see `entertainmetrics-backend/README.md`). **Admin**
accounts can create, edit and delete; **Read-only** (viewer) accounts can view everything and
see a banner explaining that changes are disabled. The sidebar shows the signed-in email, the
role and a Sign out button.

Every API request carries the user's access token. If the API answers 401 the app signs out
and returns to `/login` with "Your session expired, please sign in again".

## Local development

```bash
npm install
cp .env.example .env.local   # then check the values
npm run dev                  # http://localhost:5173
```

Start the backend separately (`python3 -m uvicorn app.main:app --reload` in
`entertainmetrics-backend/`), with its own `.env` configured.

## Configuration

All values are read at build time. None of them are secrets.

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL of the FastAPI backend. Default `http://127.0.0.1:8000`. |
| `VITE_SUPABASE_URL` | Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`). |

Without the two Supabase values the sign-in page explains that sign-in is not configured.

## Production build and deployment

```bash
npm run lint
npm run build      # outputs static files to dist/
npm run preview    # serve the build locally
```

`dist/` can be hosted on any static host. Set the three variables above in the host's build
environment, and add the deployed URL to the backend's `ALLOWED_ORIGINS` and to Supabase →
Authentication → URL Configuration (Site URL and the `/reset-password` redirect URL).

Because the app uses client-side routing, the host must serve `index.html` for unknown paths.
This is already configured for:

- **Vercel** — `vercel.json`
- **Netlify / Cloudflare Pages** — `public/_redirects`

Set the project root to `entertainmetrics-frontend` on the host.

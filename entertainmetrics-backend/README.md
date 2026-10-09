# EntertainMetrics Backend

FastAPI + SQLAlchemy API for the EntertainMetrics analytics platform. Data lives in
Supabase PostgreSQL; sign-in is handled by Supabase Auth.

## Configuration

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (Supabase → Project Settings → Database). Secret. |
| `SUPABASE_URL` | yes | Supabase project URL, e.g. `https://<project>.supabase.co`. Public. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key (`sb_publishable_…`). Public, safe for browsers. |
| `ALLOWED_ORIGINS` | no | Comma-separated frontend origins allowed by CORS. Default `http://localhost:5173,http://127.0.0.1:5173`. Add the deployed frontend URL in production. |

The API refuses to start, with a clear message, if `SUPABASE_URL` or
`SUPABASE_PUBLISHABLE_KEY` is missing.

## Run locally

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
python3 -m uvicorn app.main:app --reload
```

Swagger UI: <http://127.0.0.1:8000/docs>. To try protected endpoints there, sign in to the
frontend, copy the access token from the browser session and use **Authorize** with
`Bearer <token>`; or call the API from the frontend.

## Tests

```bash
python3 -m pytest -q
```

Tests run against a throwaway SQLite database and never contact Supabase. Existing tests run
as a signed-in admin (see `tests/conftest.py`); `tests/test_auth.py` exercises the real
authentication dependency with Supabase mocked.

## Authentication and roles

- Every endpoint requires `Authorization: Bearer <Supabase access token>` except `GET /`,
  `GET /health`, `/docs`, `/redoc` and `/openapi.json`. CORS preflight requests need no token.
- The backend verifies a token by calling `GET {SUPABASE_URL}/auth/v1/user` (5 s timeout) and
  caches a successful result for 60 seconds, keyed by a hash of the token. Tokens are never logged.
- Responses: missing, invalid or expired token → **401** (`WWW-Authenticate: Bearer`);
  Supabase unreachable → **503** "Authentication service unavailable".
- Roles come from the user's **`app_metadata.role`**: `admin` (can create, edit and delete) or
  `viewer` (read-only). A missing or unknown role counts as `viewer`. A viewer making any
  request other than GET/HEAD/OPTIONS gets **403** "Read-only access: your account cannot make
  changes". Users cannot change their own `app_metadata`.
- `GET /me` returns the signed-in user's `id`, `email` and `role`.

### Creating users (invite-only)

Accounts are created by an administrator; there is no public sign-up.

1. **Turn off public sign-up** (once): Supabase dashboard → Authentication → Sign In / Providers
   → Email → turn **off** "Allow new users to sign up".
2. **Set the URLs** (once): Authentication → URL Configuration
   - Site URL: the deployed frontend, e.g. `https://<your-app>.vercel.app`
   - Redirect URLs: `http://localhost:5173/reset-password` and
     `https://<your-app>.vercel.app/reset-password` (used by "Forgot password").
3. **Add a user**: Authentication → Users → **Add user** → **Create new user**, enter the email
   and a temporary password, and tick **Auto Confirm User**. Give the person the temporary
   password; they can choose their own with **Forgot password?** on the sign-in page.
   (You can also use **Send invitation**; the invited person should then use
   **Forgot password?** to set a password.)
4. **Set the role** with the SQL below (SQL Editor). New users are read-only until promoted.

### Promote a user to admin (SQL)

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
where email = 'person@example.com';
```

Make someone read-only again:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "viewer"}'::jsonb
where email = 'person@example.com';
```

Check roles:

```sql
select email, raw_app_meta_data ->> 'role' as role from auth.users order by email;
```

The API sees a role change within about a minute. The frontend shows the new role after the
person signs out and in again.

## Sample data

`sample_data/seed_sample_data.py` enters sample events through the API. It asks for your email
and password (an **admin** account), signs in with Supabase and sends the token with every
request:

```bash
export SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=...   # or pass --supabase-url / --supabase-key
python sample_data/seed_sample_data.py --dry-run        # plan only, no sign-in
python sample_data/seed_sample_data.py                  # enter the data
python sample_data/seed_sample_data.py --check          # verify (any account)
```

## Deployment

On the backend host set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`ALLOWED_ORIGINS` (including the deployed frontend URL). The `Procfile` starts
`uvicorn app.main:app`.

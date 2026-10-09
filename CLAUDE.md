# EntertainMetrics Development Instructions

## 1. Project Overview

EntertainMetrics is a predictive analytics and business intelligence platform
for the entertainment industry.

The platform is intended to help entertainment professionals understand
events, artists, audience demand, revenue potential, marketing impact,
ticket pricing, and event performance.

The project is also a final-year academic project and should be developed
in a way that can later support a commercial demonstration.

The current system is functional and must be treated as an existing product,
not as a blank project.

---

## 2. Current Technology Stack

Frontend:
- React
- Vite
- JavaScript/TypeScript as already used by the existing frontend

Backend:
- Python
- FastAPI
- SQLAlchemy
- Pydantic

Database:
- PostgreSQL
- Supabase PostgreSQL

Development:
- macOS
- VS Code
- Git/GitHub

---

## 3. Project Structure

The project root is:

EntertainMetrics/

Main directories:

- backend/
- frontend/

The root CLAUDE.md file contains project-wide development instructions.

Before changing anything, inspect the actual current project structure.

Do not assume a file exists simply because it is mentioned in these
instructions.

---

## 4. Important Existing Functionality

The current system already supports:

- Event creation
- Event listing
- Artist creation
- Artist listing
- Event/artist lineup management
- Event lineup retrieval
- Event prediction
- Prediction history
- Dynamic prediction confidence
- Prediction fallback when no lineup exists
- Dashboard summary
- Recent events
- Recent predictions
- Explainable prediction insights

The system has already been tested and is currently working.

Do not break existing functionality.

---

## 5. Current API Endpoints

Existing endpoints include:

GET /
GET /health

POST /events
GET /events

POST /artists
GET /artists

POST /event-artists

GET /events/{event_id}/lineup

POST /predict
GET /predictions

GET /dashboard/summary
GET /dashboard/recent-events
GET /dashboard/recent-predictions

Before adding or changing an endpoint, inspect the existing implementation.

Do not rename or remove existing endpoints unless explicitly instructed.

---

## 6. Database

The project was previously connected to Railway PostgreSQL.

The database was migrated to Supabase PostgreSQL.

The current Supabase connection is working.

Do not replace the database provider.

Do not change database models without first explaining:

1. Why the change is necessary.
2. What tables or columns will change.
3. Whether existing data will be affected.
4. Whether a migration is required.

Never expose database credentials.

Never read `.env` values into chat responses.

Never place secrets, passwords, API keys, or DATABASE_URL values inside
CLAUDE.md.

---

## 7. Environment Variables

Environment variables must remain in `.env` files.

Never hard-code:

- database passwords
- database connection strings
- API keys
- authentication secrets
- private credentials

Never commit `.env` files.

Verify `.gitignore` before committing changes.

---

## 8. Prediction Engine

The current prediction engine is rule-based and explainable.

It is NOT currently a machine-learning model.

Do not describe it as AI or machine learning unless an actual trained
machine-learning model is implemented and validated.

The prediction engine currently considers factors including:

- event capacity
- ticket price
- marketing spend
- event type
- linked artists
- artist engagement score
- artist headline score
- artist market strength
- lineup roles
- headliner status

The prediction engine calculates:

- predicted attendance
- predicted revenue
- confidence score
- explanatory insight summary

---

## 9. Confidence Score

The confidence score is currently a dynamic heuristic score.

It reflects factors such as:

- completeness of event inputs
- presence of lineup data
- number of linked artists
- artist metric completeness
- event type availability
- lineup strength

The confidence score is not a statistically validated probability.

Do not claim that a confidence score represents the probability that a
prediction is correct unless a proper validation/calibration process has
been implemented.

Keep the score between 0 and 1.

Prefer readable rounded values such as:

0.72
0.84
0.91

---

## 10. Prediction Integrity

Predictions must remain bounded by event capacity.

Predicted attendance must never exceed capacity.

Predicted attendance must never be negative.

Predicted revenue must be calculated consistently from predicted attendance
and ticket price.

When no lineup exists, the prediction system must continue to work.

Do not make lineup data mandatory unless explicitly requested.

---

## 11. Development Philosophy

Make one feature at a time.

Do not rewrite the application unnecessarily.

Do not refactor unrelated code while implementing a feature.

Do not create unnecessary abstractions.

Do not introduce new frameworks unless explicitly approved.

Prefer simple, maintainable solutions.

Do not over-engineer.

Do not build hypothetical functionality that has not been requested.

---

## 12. Before Changing Code

Before implementing a requested feature:

1. Inspect the relevant files.
2. Understand the current implementation.
3. Identify backend changes.
4. Identify database changes.
5. Identify frontend changes.
6. Identify API changes.
7. Identify testing requirements.

If the requested change has significant architectural consequences,
explain them before implementation.

---

## 13. Implementation Rules

When asked to implement a feature:

1. Inspect existing code first.
2. Make the smallest appropriate change.
3. Preserve existing functionality.
4. Do not silently change unrelated behavior.
5. Do not delete working functionality.
6. Do not replace working code simply because another approach is possible.
7. Keep API contracts consistent.
8. Keep frontend and backend compatible.

---

## 14. Testing

Backend changes should be tested through the FastAPI application and
Swagger documentation where appropriate.

Backend development command:

python3 -m uvicorn app.main:app --reload

Swagger:

http://127.0.0.1:8000/docs

Frontend changes must be tested in the browser.

Database-related changes must be tested against the actual development
database when appropriate.

After implementation, report:

- what changed
- which files changed
- what was tested
- whether tests passed
- any remaining limitations

---

## 15. Git

Do not automatically perform destructive Git operations.

Never run:

git reset --hard

git clean -fd

or equivalent destructive commands unless explicitly instructed.

Do not force push.

Do not rewrite published history.

Before recommending a commit, explain what changed.

Keep commits focused on a single feature or logical change.

---

## 16. Temporary Files

If temporary scripts or test files are created during implementation,
remove them when they are no longer needed unless they are genuinely part
of the project.

Do not leave unnecessary scratch files in the repository.

---

## 17. Frontend

The frontend is React + Vite.

Before modifying the frontend:

1. Inspect the existing component structure.
2. Inspect the API service/client implementation.
3. Reuse existing components and patterns where possible.
4. Preserve current navigation and working screens.
5. Keep the UI professional and suitable for an analytics platform.

Do not redesign the entire frontend unless explicitly requested.

---

## 18. Backend

The backend is FastAPI.

Before modifying backend behavior:

1. Inspect main.py.
2. Inspect models.
3. Inspect schemas.
4. Inspect CRUD functions.
5. Inspect database configuration.
6. Inspect related routes.

Keep business logic understandable.

Avoid putting large amounts of unrelated logic directly into route handlers
when a clean existing pattern is already available.

---

## 19. API Compatibility

When changing backend responses:

- inspect all frontend consumers first
- preserve existing fields where possible
- avoid breaking existing frontend functionality

If a breaking API change is necessary, explain it before implementation.

---

## 20. Academic Project Requirements

EntertainMetrics must remain suitable for a final-year university project.

Features should be explainable during a project defense.

Avoid unnecessary complexity that cannot be justified academically.

When implementing analytics or prediction features, maintain clear
explanations of:

- input data
- processing logic
- output
- limitations
- assumptions

---

## 21. Commercial Demonstration Goal

The long-term goal is for EntertainMetrics to become a polished,
demonstrable entertainment analytics product.

Potential future areas include:

- prediction analytics
- event performance analysis
- artist analytics
- recommendation engine
- ticket pricing recommendations
- marketing recommendations
- revenue forecasting
- dashboard analytics
- reporting
- data visualization
- authentication
- deployment
- subscription/business features

Do not implement these automatically.

Implement them one feature at a time.

---

## 22. Important Product Principle

EntertainMetrics should provide decision support.

Predictions and recommendations must be explainable.

Avoid presenting estimates as guaranteed outcomes.

Where historical data is insufficient, clearly identify assumptions and
limitations.

---

## 23. Claude Code Behavior

Before answering questions about the codebase, inspect the relevant files.

Do not speculate about code that has not been inspected.

When implementation is requested, prefer taking action in the repository
rather than only describing code.

However, do not make destructive or architectural changes without
confirmation.

When uncertain about an important architectural decision, explain the
options and ask for approval.

---

## 24. Current Development Strategy

Development should proceed approximately in this order:

1. Stabilize the current prediction engine.
2. Validate prediction behavior.
3. Build recommendation functionality.
4. Expand dashboard analytics.
5. Improve frontend UX/UI.
6. Add authentication and user roles if required.
7. Prepare production configuration.
8. Deploy backend.
9. Deploy frontend.
10. Prepare demonstration data.
11. Prepare academic documentation.
12. Prepare commercial/product demonstration materials.

Do not skip directly to advanced features before the current foundation
is stable.

---

## 25. Current Status

The following functionality is considered working:

- Supabase PostgreSQL connection
- FastAPI backend
- React frontend
- Event management
- Artist management
- Event lineup management
- Event predictions
- Dynamic confidence scoring
- No-lineup prediction fallback
- Dashboard summary
- Recent events
- Recent predictions
- Explainable prediction insights

Treat this as the current baseline.

Do not rebuild these features from scratch.

---

## 26. Final Rule

Protect working functionality.

Inspect before changing.

Change one feature at a time.

Test before moving forward.

Explain important architectural decisions.

Keep the implementation simple, maintainable, explainable, and suitable
for both academic evaluation and a future commercial demonstration.

---

## Authentication

The API and app require sign-in through Supabase Auth (invite-only, no public
sign-up). Roles come from the user's `app_metadata.role`: `admin` (read and
write) or `viewer` (read-only; a missing role counts as viewer). Only `GET /`,
`GET /health` and the API docs are public. Backend auth lives in
`entertainmetrics-backend/app/auth.py`; frontend auth in
`entertainmetrics-frontend/src/auth/`. Configuration is via environment
variables only (see the `.env.example` files); never commit `.env`. Tests run
as an admin via `tests/conftest.py`. User and role management is described in
`entertainmetrics-backend/README.md`.

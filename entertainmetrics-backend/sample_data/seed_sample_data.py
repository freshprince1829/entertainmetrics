"""Enter sample data into the RUNNING EntertainMetrics backend.

Events are modelled on real Kenyan shows. Ticket PRICES come from the public
listings; CAPACITIES, quantities, marketing spend and ALL sales figures are
invented sample numbers. Every record is named "[SAMPLE] ..." so it can be
told apart from real client data and removed with cleanup_sample_data.sql.

Everything goes through the real API (same validation, same predictions).
Needs only the Python standard library.

    python sample_data/seed_sample_data.py --dry-run     # print the plan only
    python sample_data/seed_sample_data.py               # enter the data
    python sample_data/seed_sample_data.py --check       # verify what is stored
    python sample_data/seed_sample_data.py --url http://127.0.0.1:8000
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TAG = "[SAMPLE] "
TODAY = date.today()
UTC = timezone.utc

# phase -> share of a tier's final sales already sold, at days before the event
DAYS = [-30, -21, -14, -7, -3, -1, 0]
CURVES = {
    "early_bird": [0.60, 0.90, 1.00, 1.00, 1.00, 1.00, 1.00],
    "advance": [0.10, 0.30, 0.55, 0.80, 0.92, 1.00, 1.00],
    "standard": [0.05, 0.20, 0.45, 0.70, 0.88, 0.97, 1.00],
    "premium": [0.05, 0.20, 0.40, 0.70, 0.85, 0.95, 1.00],
    "last_minute": [0.00, 0.00, 0.00, 0.10, 0.40, 0.70, 1.00],
    "gate": [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00],
}

# (name, price, qty, phase, access, audience, partner, sold_fraction)
PAST = [
    dict(name="Sauti Sol Final Sol Fest - Fan Show", date="2023-11-04", venue="Uhuru Gardens", cap=11000,
         price=3500, mkt=240000, show=0.90, artists=2,
         source="Prices: casureconcierge listing (2500/3500/6500/20000)",
         tiers=[("Early Bird", 2500, 3000, "early_bird", "general", "public", None, 1.00),
                ("Advance", 3500, 6000, "advance", "general", "public", None, 1.00),
                ("VIP", 6500, 1500, "premium", "vip", "public", None, 0.95),
                ("VVIP", 20000, 300, "premium", "vvip", "public", None, 0.90)]),
    dict(name="Kenny G Nairobi", date="2025-09-27", venue="KICC", cap=2500,
         price=10000, mkt=75000, show=0.95, artists=0,
         source="Prices: The Star (8500 / 10000 / 14500); sold out",
         tiers=[("Early Bird", 8500, 600, "early_bird", "general", "public", None, 1.00),
                ("Advance", 10000, 1000, "advance", "general", "public", None, 1.00),
                ("Last Minute", 14500, 900, "last_minute", "general", "public", None, 1.00)]),
    dict(name="One Night Only 2026", date="2026-05-31", venue="Sarit Expo Centre", cap=3000,
         price=7500, mkt=85000, show=0.92, artists=0,
         source="Prices: The Star (5000 / 7500 / 9500 / 12500); early bird sold out",
         tiers=[("Early Bird", 5000, 600, "early_bird", "general", "public", None, 1.00),
                ("Gallery", 7500, 1200, "standard", "general", "public", None, 0.90),
                ("Middle Row", 9500, 700, "standard", "general", "public", None, 0.85),
                ("Front Row Table", 12500, 500, "premium", "vip", "public", None, 0.80)]),
    dict(name="Fally Ipupa Live in Nairobi", date="2026-09-05", venue="Uhuru Gardens", cap=11000,
         price=10000, mkt=280000, show=0.93, artists=0,
         source="Prices: The Kenya Times (regular 10000 / VIP 30000 / VVIP 40000, early bird 8000/20000/30000)",
         tiers=[("Early Bird Regular", 8000, 2000, "early_bird", "general", "public", None, 1.00),
                ("Early Bird VIP", 20000, 300, "premium", "vip", "public", None, 1.00),
                ("Early Bird VVIP", 30000, 100, "premium", "vvip", "public", None, 1.00),
                ("Regular", 10000, 7000, "standard", "general", "public", None, 0.85),
                ("VIP", 30000, 1200, "premium", "vip", "public", None, 0.80),
                ("VVIP", 40000, 400, "premium", "vvip", "public", None, 0.70)]),
]
UPCOMING = dict(
    name="Sol Fest 2026 - Fan Show (practice copy)", days=45, venue="Sample Grounds", cap=10000,
    price=3500, mkt=185000, artists=2,
    source="Tier structure modelled on Sol Fest 2025 (early bird, fan show/advance, VIP, KCB partner); all numbers invented",
    tiers=[("Early Bird", 2500, 2000, "early_bird", "general", "public", None, 0.95),
           ("Advance (Fan Show)", 3500, 4000, "advance", "general", "public", None, 0.55),
           ("Standard", 4500, 2500, "standard", "general", "public", None, 0.20),
           ("VIP", 8000, 600, "premium", "vip", "public", None, 0.40),
           ("KCB Partner", 3000, 900, "standard", "general", "partner", "KCB", 0.50)])
# cumulative share of the upcoming event's tier sales so far, one entry per day (T-7 .. today)
UPCOMING_DAILY = [0.10, 0.22, 0.35, 0.50, 0.64, 0.78, 0.90, 1.00]
ARTISTS = [("Headliner One", "Afro-pop", 900000, 90000, 400000, 0.8, 0.9, 0.85),
           ("Headliner Two", "Gengetone", 500000, 60000, 250000, 0.7, 0.7, 0.70),
           ("Supporting Act", "Benga", 150000, 20000, 90000, 0.6, 0.4, 0.50)]


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw

    def ok(self, method, path, body=None, expect=(200, 201, 204)):
        status, data = self.call(method, path, body)
        if status not in expect:
            sys.exit(f"FAILED {method} {path} -> {status}: {data}")
        return data


def ts(day, hour=18):
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC).isoformat()


def tier_plan(spec):
    return spec["tiers"]


def run(api, dry):
    existing = [e["event_name"] for e in api.ok("GET", "/events")] if not dry else []
    if any(n.startswith(TAG) for n in existing):
        sys.exit("Sample events already exist. Remove them with cleanup_sample_data.sql first.")
    artist_ids = []
    for n, g, sp, yt, ig, eng, head, mkt in ARTISTS:
        print(f"artist  {TAG}{n}")
        if not dry:
            a = api.ok("POST", "/artists", dict(artist_name=TAG + n, genre=g, spotify_monthly_streams=sp,
                       youtube_subscribers=yt, instagram_followers=ig, engagement_score=eng,
                       headline_score=head, market_strength_score=mkt))
            artist_ids.append(a["id"])

    def make_event(spec, event_date):
        print(f"event   {TAG}{spec['name']}  {event_date}  cap {spec['cap']}  base KES {spec['price']}")
        print(f"        {spec['source']}")
        if dry:
            return None, []
        ev = api.ok("POST", "/events", dict(event_name=TAG + spec["name"], event_type="Concert",
                    event_date=str(event_date), venue=spec["venue"], city="Nairobi",
                    ticket_price=spec["price"], marketing_spend=spec["mkt"], capacity=spec["cap"]))
        tiers = []
        for order, (n, pr, q, ph, acc, aud, partner, frac) in enumerate(spec["tiers"]):
            body = dict(name=n, price=pr, quantity_available=q, sale_phase=ph, access_level=acc,
                        audience=aud, sort_order=order)
            if partner:
                body["partner_name"] = partner
            tiers.append(api.ok("POST", f"/events/{ev['id']}/tiers", body))
        for i in range(spec.get("artists", 0)):
            api.ok("POST", "/event-artists", dict(event_id=ev["id"], artist_id=artist_ids[i],
                   performance_order=i + 1, is_headliner=(i == 0)))
        return ev, tiers

    def predict(ev, spec):
        return api.ok("POST", "/predict", dict(event_id=ev["id"], ticket_price=spec["price"],
                      marketing_spend=spec["mkt"], capacity=spec["cap"]))

    for spec in PAST:
        d = date.fromisoformat(spec["date"])
        ev, tiers = make_event(spec, d)
        if dry:
            continue
        p0 = predict(ev, spec)  # before any sales: a genuine pre-sales prediction
        for k, off in enumerate(DAYS):
            sales = []
            for t, (n, pr, q, ph, acc, aud, partner, frac) in zip(tiers, spec["tiers"]):
                final = int(q * frac)
                sold = int(final * CURVES[ph][k])
                row = dict(tier_id=t["id"], tickets_sold=sold)
                if off == 0:
                    row["checked_in"] = int(sold * spec["show"])
                sales.append(row)
            api.ok("POST", f"/events/{ev['id']}/sales-snapshots",
                   dict(recorded_at=ts(d + timedelta(days=off)), tier_sales=sales))
        fin = api.ok("POST", f"/events/{ev['id']}/finalize-actuals")
        print(f"        predicted {p0['predicted_attendance']}  actual {fin['actual_attendance']}")

    spec = UPCOMING
    ev, tiers = make_event(spec, TODAY + timedelta(days=spec["days"]))
    if not dry:
        for k, share in enumerate(UPCOMING_DAILY):
            day = TODAY - timedelta(days=len(UPCOMING_DAILY) - 1 - k)
            sales = [dict(tier_id=t["id"], tickets_sold=int(q * frac * share))
                     for t, (n, pr, q, ph, acc, aud, partner, frac) in zip(tiers, spec["tiers"])]
            api.ok("POST", f"/events/{ev['id']}/sales-snapshots", dict(recorded_at=ts(day), tier_sales=sales))
        p = predict(ev, spec)
        print(f"        predicted {p['predicted_attendance']} ({p.get('attendance_low')}-{p.get('attendance_high')})")
    print("\nDone." if not dry else "\nDry run only - nothing was sent.")


def check(api):
    rows = []

    def rec(cid, case, expected, actual, ok):
        rows.append((cid, case, str(expected), str(actual), "PASS" if ok else "FAIL"))
        print(f"{'PASS' if ok else 'FAIL'}  {cid}  {case} | expected {expected} | actual {actual}")

    events = [e for e in api.ok("GET", "/events") if e["event_name"].startswith(TAG)]
    rec("L-01", "Sample events present", len(PAST) + 1, len(events), len(events) == len(PAST) + 1)
    pva = api.ok("GET", "/dashboard/predicted-vs-actual")
    by_id = {i["event_id"]: i for i in pva["items"]}
    for e in events:
        eid, name = e["id"], e["event_name"].replace(TAG, "")
        tiers = api.ok("GET", f"/events/{eid}/tiers")
        snaps = api.ok("GET", f"/events/{eid}/sales-snapshots")
        last = snaps[-1]
        rec(f"L-02 {name}", "Tier quantities within capacity", f"<= {e['capacity']}",
            sum(t["quantity_available"] or 0 for t in tiers),
            sum(t["quantity_available"] or 0 for t in tiers) <= e["capacity"])
        rec(f"L-03 {name}", "Snapshots are non-decreasing", "ascending totals",
            [s["tickets_sold_total"] for s in snaps][:8],
            all(a["tickets_sold_total"] <= b["tickets_sold_total"] for a, b in zip(snaps, snaps[1:])))
        ta = api.ok("GET", f"/events/{eid}/tier-analytics")
        sold = sum(t["tickets_sold"] for t in ta["tiers"])
        price = {t["id"]: t["price"] for t in tiers}
        exp_rev = sum(s["tickets_sold"] * price[s["tier_id"]] for s in last["tier_sales"])
        rec(f"L-04 {name}", "Tier counts sum to latest total", last["tickets_sold_total"], sold,
            sold == last["tickets_sold_total"])
        rec(f"L-05 {name}", "Revenue = sum of price x sold", exp_rev, ta["revenue_total"],
            abs(ta["revenue_total"] - exp_rev) < 1)
        if e["actual_attendance"] is not None:
            it = by_id.get(eid)
            if it:
                a = e["actual_attendance"]
                got = it.get("attendance_error_pct", it.get("attendance_percent_error"))
                exp = (it["predicted_attendance"] - a) / a * 100
                rec(f"L-06 {name}", "Attendance error % recomputed", round(exp, 1), got,
                    got is not None and abs(got - exp) < 0.1)
            rec(f"L-07 {name}", "Actual attendance within capacity", f"<= {e['capacity']}",
                e["actual_attendance"], e["actual_attendance"] <= e["capacity"])
        else:
            prog = api.ok("GET", f"/events/{eid}/sales-progress")
            rec(f"L-08 {name}", "Sell-through = sold / capacity", round(last["tickets_sold_total"] / e["capacity"] * 100, 1),
                prog["sell_through_pct"], abs(prog["sell_through_pct"] - last["tickets_sold_total"] / e["capacity"] * 100) < 0.1)
            rec(f"L-09 {name}", "Projection capped at capacity", f"<= {e['capacity']}",
                prog["projected_final_sales"], prog["projected_final_sales"] <= e["capacity"])
            lv = api.ok("GET", f"/events/{eid}/live-vs-predicted")
            rec(f"L-10 {name}", "Live view is not final", False, lv["is_final"], lv["is_final"] is False)
            preds = [p for p in api.ok("GET", "/predictions") if p["event_id"] == eid]
            p = preds[0] if preds else {}
            lo, hi = p.get("attendance_low"), p.get("attendance_high")
            rec(f"L-11 {name}", "Band low <= expected <= high <= capacity", "valid",
                f"{lo}/{p.get('predicted_attendance')}/{hi}",
                lo is not None and lo <= p["predicted_attendance"] <= hi <= e["capacity"])
    pat = api.ok("GET", "/analytics/event-day-patterns")
    rec("L-12", "Event-day patterns usable", "sufficient_history true",
        f"{pat['events_used']} events", pat["sufficient_history"])
    tp = api.ok("GET", "/analytics/tier-patterns")
    rec("L-13", "Tier patterns usable", "sufficient_history true", f"{tp['events_used']} events", tp["sufficient_history"])
    passed = sum(r[4] == "PASS" for r in rows)
    out = Path(__file__).parent / "results"
    out.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    lines = [f"# Live sample-data check {stamp}", "", f"{passed} of {len(rows)} checks passed.", "",
             "| ID | Case | Expected | Actual | Result |", "| --- | --- | --- | --- | --- |"]
    lines += [f"| {a} | {b} | {c} | {d[:70]} | {e} |" for a, b, c, d, e in rows]
    (out / f"live-check-{stamp}.md").write_text("\n".join(lines))
    print(f"\n{passed}/{len(rows)} checks passed. Saved to sample_data/results/live-check-{stamp}.md")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    api = Api(a.url)
    if a.check:
        check(api)
    else:
        if not a.dry_run:
            api.ok("GET", "/health")
        run(api, a.dry_run)

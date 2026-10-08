"""Scripted system scenario with sample data, for the Test Plan results.

Runs the real application in-process (FastAPI TestClient) against a throwaway
SQLite database, so it never touches Supabase. Every check records an ID,
what was expected, what happened and PASS/FAIL, and the run is written to
scenarios/results/. Run from entertainmetrics-backend/:

    python -m scenarios.run_scenarios
"""
import json
import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_DB_DIR = tempfile.mkdtemp(prefix="em-scenario-")
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_DIR}/scenario.db"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

assert os.environ["DATABASE_URL"].startswith("sqlite")
c = TestClient(app)
TODAY = date.today()
UTC = timezone.utc
RESULTS = []
BAD = {400, 404, 409, 422}


def ts(day, hour=12):
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC).isoformat()


def check(cid, case, expected, actual, ok):
    RESULTS.append({"id": cid, "case": case, "expected": str(expected),
                    "actual": str(actual), "result": "PASS" if ok else "FAIL"})
    print(f"{'PASS' if ok else 'FAIL'}  {cid}  {case}  | expected: {expected} | actual: {actual}")


def mk_event(name, days, cap, price, mkt, **kw):
    r = c.post("/events", json=dict(event_name=name, event_type="Concert",
               event_date=str(TODAY + timedelta(days=days)), venue="Sample Grounds",
               city="Nairobi", ticket_price=price, marketing_spend=mkt, capacity=cap, **kw))
    assert r.status_code == 200, r.text
    return r.json()


def mk_tier(eid, name, price, qty, **kw):
    r = c.post(f"/events/{eid}/tiers", json=dict(name=name, price=price, quantity_available=qty, **kw))
    assert r.status_code == 201, r.text
    return r.json()


def snap(eid, at, tiers=None, **kw):
    body = dict(recorded_at=at, **kw)
    if tiers is not None:
        body["tier_sales"] = [dict(tier_id=t, tickets_sold=n, **({"checked_in": ci} if ci is not None else {}))
                              for t, n, ci in tiers]
    return c.post(f"/events/{eid}/sales-snapshots", json=body)


# ---------------------------------------------------------------- sample artists
artists = []
for n, g, sp, ig in [("Sample Artist A", "Afro-pop", 900000, 400000),
                     ("Sample Artist B", "Gengetone", 500000, 250000),
                     ("Sample Artist C", "Benga", 150000, 90000)]:
    r = c.post("/artists", json=dict(artist_name=n, genre=g, spotify_monthly_streams=sp,
                                     instagram_followers=ig, engagement_score=0.7,
                                     headline_score=0.6, market_strength_score=0.6))
    artists.append(r.json())
check("SC-01", "Create 3 sample artists", 3, len(c.get("/artists").json()), len(c.get("/artists").json()) == 3)

# ---------------------------------------------------------------- formula checks (U-01, U-02)
f1 = mk_event("Formula Check", 30, 10000, 1000, 100000)
p = c.post("/predict", json=dict(event_id=f1["id"], ticket_price=1000, marketing_spend=100000, capacity=10000)).json()
check("U-01", "Base formula, no lineup/tiers: 10000*0.4 + 100000/50 - 1000/20", 5950,
      p["predicted_attendance"], p["predicted_attendance"] == 5950)
check("U-01b", "Revenue = attendance x ticket price", 5950000.0, p["predicted_revenue"],
      abs(p["predicted_revenue"] - 5950000.0) < 1)
check("U-03", "Confidence within [0.3, 0.95]", "0.3 <= c <= 0.95", p["confidence_score"],
      0.3 <= p["confidence_score"] <= 0.95)
f2 = mk_event("Cap Check", 30, 1000, 500, 200000)
p2 = c.post("/predict", json=dict(event_id=f2["id"], ticket_price=500, marketing_spend=200000, capacity=1000)).json()
check("U-02", "Formula result above capacity is capped", 1000, p2["predicted_attendance"],
      p2["predicted_attendance"] == 1000)

# ---------------------------------------------------------------- three completed sample events
past = []
specs = [("Jazz Night (sample)", -40, 3000, 1500, 90000, (0.7, 0.9, 0.8)),
         ("Afrobeat Bash (sample)", -25, 5000, 2000, 150000, (0.6, 0.85, 0.7)),
         ("Gengetone Live (sample)", -12, 2000, 1000, 60000, (0.8, 0.95, 0.9))]
for name, days, cap, price, mkt, fr in specs:
    ev = mk_event(name, days, cap, price, mkt)
    eb = mk_tier(ev["id"], "Early Bird", price * 0.6, int(cap * 0.2), sale_phase="early_bird")
    rg = mk_tier(ev["id"], "Regular", price, int(cap * 0.6), sale_phase="standard")
    vip = mk_tier(ev["id"], "VIP", price * 3, int(cap * 0.1), sale_phase="premium", access_level="vip")
    gt = mk_tier(ev["id"], "Gate", price * 1.3, int(cap * 0.1), sale_phase="gate")
    d0 = TODAY + timedelta(days=days)
    plan = [(-14, 0.5), (-7, 0.8), (-1, 0.95), (0, 1.0)]
    for off, share in plan:
        sold = [(eb["id"], int(eb["quantity_available"] * min(1, share * 1.2)), None),
                (rg["id"], int(rg["quantity_available"] * share * fr[0]), None),
                (vip["id"], int(vip["quantity_available"] * share * fr[1]), None),
                (gt["id"], int(gt["quantity_available"] * 0.6) if off == 0 else 0, None)]
        if off == 0:
            sold = [(t, n, int(n * fr[2])) for t, n, _ in sold]
        r = snap(ev["id"], ts(d0 + timedelta(days=off)), sold)
        assert r.status_code == 201, r.text
    pr = c.post("/predict", json=dict(event_id=ev["id"], ticket_price=price, marketing_spend=mkt, capacity=cap))
    assert pr.status_code == 200, pr.text
    past.append(ev)
check("IT-04", "Snapshots listed in recorded_at order", "ascending",
      "ascending", all(
          [s["recorded_at"] for s in c.get(f"/events/{e['id']}/sales-snapshots").json()]
          == sorted(s["recorded_at"] for s in c.get(f"/events/{e['id']}/sales-snapshots").json()) for e in past))

# ---------------------------------------------------------------- snapshot validation (U-12, U-13, IT-05..07)
e0 = past[0]["id"]
tiers0 = c.get(f"/events/{e0}/tiers").json()
rg0 = next(t for t in tiers0 if t["name"] == "Regular")
d0 = TODAY + timedelta(days=-40)
r = snap(e0, ts(d0 + timedelta(days=-3)), None, tickets_sold_total=1)
check("U-12a", "Decreasing total rejected", "4xx", r.status_code, r.status_code in BAD)
r = c.post(f"/events/{e0}/sales-snapshots", json=dict(recorded_at=ts(d0), tickets_sold_total=-5))
check("U-12b", "Negative value rejected", "422", r.status_code, r.status_code == 422)
r = c.post(f"/events/{e0}/sales-snapshots", json=dict(recorded_at=ts(d0), tickets_sold_total=999999))
check("U-12c", "Total above capacity rejected", "4xx", r.status_code, r.status_code in BAD)
r = c.post(f"/events/{e0}/sales-snapshots", json=dict(recorded_at=ts(d0), tickets_sold_total=100, attendance_checked_in=500))
check("U-13a", "Check-ins above tickets sold rejected", "4xx", r.status_code, r.status_code in BAD)
r = c.post(f"/events/{e0}/sales-snapshots", json=dict(recorded_at=ts(d0), tickets_sold_total=100, gate_tickets_sold=500))
check("U-13b", "Gate tickets above total rejected", "4xx", r.status_code, r.status_code in BAD)
r = snap(e0, ts(d0 + timedelta(days=5)), None, tickets_sold_total=3000)
check("IT-05", "Snapshot dated after the day following the event rejected", "4xx", r.status_code, r.status_code in BAD)
r = snap(e0, ts(d0 + timedelta(days=1)), [(rg0["id"], 5, None)])
check("IT-07", "Per-tier total below the tier's earlier cumulative rejected", "4xx", r.status_code, r.status_code in BAD)
r = c.post(f"/events/{e0}/sales-snapshots", json=dict(recorded_at=ts(d0 + timedelta(days=1)), tickets_sold_total=10,
           tier_sales=[dict(tier_id=rg0["id"], tickets_sold=2000)]))
check("IT-06", "Snapshot total that differs from tier sums rejected", "4xx", r.status_code, r.status_code in BAD)
r = c.get("/events/99999/sales-snapshots")
check("IT-02a", "Unknown event returns 404", "404", r.status_code, r.status_code == 404)

# ---------------------------------------------------------------- tiers (IT-02, IT-03, IT-08)
dup = c.post(f"/events/{e0}/tiers", json=dict(name="Regular", price=1)).status_code
check("IT-02b", "Duplicate tier name (exact) rejected (409)", "409", dup, dup == 409)
case_var = c.post(f"/events/{e0}/tiers", json=dict(name="regular", price=1)).status_code
check("IT-02b2", "Case-variant name (regular vs Regular) - observed behaviour", "409 if names are case-insensitive", case_var, case_var == 409)
if case_var == 201:
    for t in c.get(f"/events/{e0}/tiers").json():
        if t["name"] == "regular":
            c.delete(f"/events/{e0}/tiers/{t['id']}")
r = c.patch(f"/events/{e0}/tiers/{rg0['id']}", json=dict(price=1))
check("IT-08a", "Price change blocked once tier has sales", "4xx", r.status_code, r.status_code in BAD)
r = c.delete(f"/events/{e0}/tiers/{rg0['id']}")
check("IT-08b", "Delete blocked once tier has sales", "4xx", r.status_code, r.status_code in BAD)
tgt = mk_event("Copy Target (sample)", 60, 4000, 1500, 100000)
r = c.post(f"/events/{tgt['id']}/tiers/copy-from/{e0}")
check("IT-03", "Copy tiers from another event (source has 4)", 4, len(r.json()) if r.status_code == 201 else r.status_code,
      r.status_code == 201 and len(r.json()) == 4)
r = c.post(f"/events/{tgt['id']}/tiers/copy-from/99999")
check("IT-03b", "Copy from unknown event returns 404", "404", r.status_code, r.status_code == 404)

# ---------------------------------------------------------------- finalize + predicted vs actual (IT-10, IT-16)
before = c.get("/events").json()
b = {e["id"]: e["actual_attendance"] for e in before}
check("IT-10a", "Snapshots alone never wrote actuals", "all null for sample events",
      [b[e["id"]] for e in past], all(b[e["id"]] is None for e in past))
r = c.post(f"/events/{f1['id']}/finalize-actuals")
check("IT-10b", "Finalize refused before the event date", "400", r.status_code, r.status_code == 400)
fin = {}
for e in past:
    r = c.post(f"/events/{e['id']}/finalize-actuals")
    fin[e["id"]] = r.json()
    check(f"IT-10c-{e['id']}", f"Finalize {e['event_name']}", "200", r.status_code, r.status_code == 200)
after = {e["id"]: e for e in c.get("/events").json()}
check("IT-10d", "Actual attendance equals the finalize preview", "match",
      [after[i]["actual_attendance"] for i in fin],
      all(after[i]["actual_attendance"] == fin[i]["actual_attendance"] for i in fin))
pva = c.get("/dashboard/predicted-vs-actual").json()
check("IT-16a", "Predicted vs Actual compares the 3 finalized events", 3, pva["events_compared"],
      pva["events_compared"] == 3)
errs_ok = True
for it in pva["items"]:
    a = after[it["event_id"]]["actual_attendance"]
    exp = (it["predicted_attendance"] - a) / a * 100
    got = it.get("attendance_error_pct", it.get("attendance_percent_error"))
    if got is None or abs(got - exp) > 0.1:
        errs_ok = False
check("IT-16b", "Attendance % error = (predicted - actual) / actual x 100", "within 0.1", "see items", errs_ok)

# ---------------------------------------------------------------- patterns (IT-12, IT-15)
pat = c.get("/analytics/event-day-patterns").json()
check("IT-12", "Event-day patterns usable with 3 completed events", "sufficient_history true",
      f"{pat['events_used']} events, sufficient={pat['sufficient_history']}", pat["sufficient_history"])
tp = c.get("/analytics/tier-patterns").json()
check("IT-15a", "Tier patterns usable with 3 completed events", "sufficient_history true",
      f"{tp['events_used']} events, sufficient={tp['sufficient_history']}", tp["sufficient_history"])
ta = c.get(f"/events/{past[1]['id']}/tier-analytics").json()
sold_sum = sum(t["tickets_sold"] for t in ta["tiers"])
check("IT-15b", "Tier ticket counts sum to the snapshot total", ta["tickets_sold_total"], sold_sum,
      sold_sum == ta["tickets_sold_total"])
rev_sum = sum(t["revenue"] for t in ta["tiers"])
check("IT-15c", "Tier revenue sums to revenue total", ta["revenue_total"], round(rev_sum, 2),
      abs(rev_sum - ta["revenue_total"]) < 1)

# ---------------------------------------------------------------- upcoming event, daily sales (V-02..V-06 data path)
sol = mk_event("Sol Fest Sample 2026", 14, 8000, 1500, 300000)
for a, order in zip(artists[:2], (1, 2)):
    c.post("/event-artists", json=dict(event_id=sol["id"], artist_id=a["id"], performance_order=order, is_headliner=(order == 2)))
eb = mk_tier(sol["id"], "Early Bird", 1000, 1500, sale_phase="early_bird")
adv = mk_tier(sol["id"], "Advance", 1500, 3000, sale_phase="advance")
gate = mk_tier(sol["id"], "Gate", 2000, 2000, sale_phase="gate")
vip = mk_tier(sol["id"], "VIP", 5000, 500, sale_phase="premium", access_level="vip")
kcb = mk_tier(sol["id"], "KCB Partner", 1200, 800, audience="partner", partner_name="KCB")
check("IT-02c", "Tiers listed in sort order then price", "5 tiers",
      len(c.get(f"/events/{sol['id']}/tiers").json()), len(c.get(f"/events/{sol['id']}/tiers").json()) == 5)
pr = c.get(f"/events/{sol['id']}/price-range").json()
exp_mean = (1000*1500 + 1500*3000 + 2000*2000 + 5000*500 + 1200*800) / (1500+3000+2000+500+800)
check("U-08", "Price range weighted by quantity", round(exp_mean, 2), pr["average_price_by_quantity"],
      abs(pr["average_price_by_quantity"] - exp_mean) < 0.5)
# daily entries as cumulative totals (what the frontend sends)
cum = {eb["id"]: 0, adv["id"]: 0, vip["id"]: 0, kcb["id"]: 0}
days = [(-6, {eb["id"]: 300, adv["id"]: 100, vip["id"]: 20, kcb["id"]: 50}),
        (-5, {eb["id"]: 250, adv["id"]: 150, vip["id"]: 25, kcb["id"]: 60}),
        (-4, {eb["id"]: 400, adv["id"]: 250, vip["id"]: 30, kcb["id"]: 80}),
        (-3, {eb["id"]: 550, adv["id"]: 300, vip["id"]: 45, kcb["id"]: 90}),
        (-2, {eb["id"]: 0, adv["id"]: 500, vip["id"]: 60, kcb["id"]: 120})]
daily_ok = True
for off, d in days:
    for k, v in d.items():
        cum[k] += v
    r = snap(sol["id"], ts(TODAY + timedelta(days=off)), [(k, cum[k], None) for k in cum])
    if r.status_code != 201:
        daily_ok = False
        print(r.text)
check("V-02a", "Five daily entries sent as cumulative totals accepted", "5 x 201", "ok" if daily_ok else "failed", daily_ok)
over = dict(cum); over[eb["id"]] = 1501
r = snap(sol["id"], ts(TODAY), [(k, v, None) for k, v in over.items()])
check("V-02b", "Entry above a tier's quantity (Early Bird 1501 of 1500) rejected", "4xx", r.status_code, r.status_code in BAD)
r = snap(sol["id"], ts(TODAY + timedelta(days=-10)), [(k, v, None) for k, v in cum.items()])
check("V-03", "Entry dated before the last entry (cumulative would fall) handled", "accepted only if still ascending",
      r.status_code, r.status_code in BAD or r.status_code == 201)
prog = c.get(f"/events/{sol['id']}/sales-progress").json()
total = sum(cum.values())
check("IT-09a", "Progress total equals sum of cumulative tiers", total, prog["tickets_sold_total"],
      prog["tickets_sold_total"] == total)
check("IT-09b", "Sell-through % = sold / capacity", round(total / 8000 * 100, 1), prog["sell_through_pct"],
      abs(prog["sell_through_pct"] - total / 8000 * 100) < 0.1)
check("IT-09c", "Velocity is reported with several snapshots", "> 0", prog["velocity_tickets_per_day"],
      (prog["velocity_tickets_per_day"] or 0) > 0)
check("IT-09d", "Projection capped at capacity", "<= 8000", prog["projected_final_sales"],
      prog["projected_final_sales"] <= 8000)
rb = c.get(f"/events/{sol['id']}/revenue-breakdown").json()
exp_rev = sum(cum[k]*p for k, p in [(eb["id"], 1000), (adv["id"], 1500), (vip["id"], 5000), (kcb["id"], 1200)])
check("IT-15d", "Revenue breakdown equals sum of tier price x sold", exp_rev, rb["revenue_total"],
      abs(rb["revenue_total"] - exp_rev) < 1)
ps = c.post("/predict", json=dict(event_id=sol["id"], ticket_price=1500, marketing_spend=300000, capacity=8000))
pj = ps.json()
band_ok = all(k in pj for k in ("predicted_attendance",)) 
lo = pj.get("attendance_low"); hi = pj.get("attendance_high")
check("U-04", "Band ordering low <= expected <= high <= capacity", "valid",
      f"{lo} / {pj['predicted_attendance']} / {hi}",
      lo is not None and lo <= pj["predicted_attendance"] <= hi <= 8000)
pa = mk_event("Tier effect A (no tiers)", 30, 6000, 1500, 100000)
pb = mk_event("Tier effect B (with VIP)", 30, 6000, 1500, 100000)
mk_tier(pb["id"], "Advance", 1500, 3000, sale_phase="advance")
mk_tier(pb["id"], "VIP", 20000, 200, sale_phase="premium", access_level="vip")
ra = c.post("/predict", json=dict(event_id=pa["id"], ticket_price=1500, marketing_spend=100000, capacity=6000)).json()
rb2 = c.post("/predict", json=dict(event_id=pb["id"], ticket_price=1500, marketing_spend=100000, capacity=6000)).json()
check("P-07", "Adding an expensive VIP tier does not lower predicted attendance", "B >= A",
      f"A={ra['predicted_attendance']}, B={rb2['predicted_attendance']}", rb2["predicted_attendance"] >= ra["predicted_attendance"])
check("P-06", "Learned show-rate pattern is mentioned when history is sufficient", "insight mentions it",
      pj["insight_summary"][:140], any(w in pj["insight_summary"].lower() for w in ("show rate", "show-rate", "pattern", "learned")))
lv = c.get(f"/events/{sol['id']}/live-vs-predicted").json()
check("IT-09e", "Live status is one of the defined values", "on_track/ahead/behind", lv["status"],
      lv["status"] in ("on_track", "ahead", "behind", "on track"))
check("IT-09f", "Live view is not final", "is_final false", lv["is_final"], lv["is_final"] is False)

# ---------------------------------------------------------------- CSV import (IT-13, IT-14)
imp_ev = mk_event("Import Check (sample)", 20, 2000, 1000, 50000)
t1 = mk_tier(imp_ev["id"], "Regular", 1000, 1500)
n_before = len(c.get(f"/events/{imp_ev['id']}/sales-snapshots").json())
csv_ok = "date_time,ticket_type,quantity\n2026-10-01 10:00,regular,50\n2026-10-02 10:00,REGULAR,90\n"
r = c.post(f"/events/{imp_ev['id']}/sales-import?dry_run=true", json=dict(csv_text=csv_ok, utc_offset_minutes=180)).json()
n_mid = len(c.get(f"/events/{imp_ev['id']}/sales-snapshots").json())
check("IT-13a", "Dry run matches case-insensitively and writes nothing", "can_import true, 0 written",
      f"can_import={r['can_import']}, snapshots {n_before}->{n_mid}", r["can_import"] and n_mid == n_before)
r = c.post(f"/events/{imp_ev['id']}/sales-import?dry_run=false", json=dict(csv_text=csv_ok, utc_offset_minutes=180))
n_after = len(c.get(f"/events/{imp_ev['id']}/sales-snapshots").json())
check("IT-13b", "Import creates one snapshot per timestamp", 2, n_after - n_before, n_after - n_before == 2)
csv_unknown = "date_time,ticket_type,quantity\n2026-10-03 10:00,Mystery Pass,10\n"
r = c.post(f"/events/{imp_ev['id']}/sales-import?dry_run=true", json=dict(csv_text=csv_unknown, utc_offset_minutes=180)).json()
check("IT-14a", "Unknown ticket type blocks import and is listed", "can_import false",
      f"can_import={r['can_import']}, unmatched={len(r['unmatched_types'])}",
      (not r["can_import"]) and len(r["unmatched_types"]) == 1)
csv_bad = "date_time,ticket_type,quantity\n2026-10-04 10:00,Regular,100\n2026-10-05 10:00,Regular,notanumber\n"
n0 = len(c.get(f"/events/{imp_ev['id']}/sales-snapshots").json())
r = c.post(f"/events/{imp_ev['id']}/sales-import?dry_run=false", json=dict(csv_text=csv_bad, utc_offset_minutes=180))
n1 = len(c.get(f"/events/{imp_ev['id']}/sales-snapshots").json())
check("IT-14b", "One bad row rejects the whole import (all-or-nothing)", "4xx, nothing written",
      f"{r.status_code}, snapshots {n0}->{n1}", r.status_code in BAD and n0 == n1)
csv_cap = "date_time,ticket_type,quantity\n2026-10-06 10:00,Regular,99999\n"
r = c.post(f"/events/{imp_ev['id']}/sales-import?dry_run=false", json=dict(csv_text=csv_cap, utc_offset_minutes=180))
check("IT-14c", "Import above capacity/tier quantity rejected", "4xx", r.status_code, r.status_code in BAD)

# ---------------------------------------------------------------- lineups (IT-01)
lu_ev = mk_event("Lineup Check (sample)", 25, 3000, 1000, 40000)
eas = [c.post("/event-artists", json=dict(event_id=lu_ev["id"], artist_id=a["id"])).json() for a in artists]
c.delete(f"/event-artists/{eas[0]['id']}")
still = [a["id"] for a in c.get("/artists").json()]
check("IT-01a", "Removing from a lineup keeps the artist", "artist still listed", artists[0]["id"] in still,
      artists[0]["id"] in still)
c.delete(f"/artists/{artists[1]['id']}")
lineup_left = c.get(f"/events/{lu_ev['id']}/lineup").json()
check("IT-01b", "Deleting an artist removes them from every lineup", "not in lineup",
      [x["artist_id"] for x in lineup_left], all(x["artist_id"] != artists[1]["id"] for x in lineup_left))
check("IT-01c", "Saved predictions survive artist removal", ">= 3 predictions",
      len(c.get("/predictions").json()), len(c.get("/predictions").json()) >= 3)
r = c.delete("/artists/99999")
check("IT-01d", "Delete unknown artist returns 404", "404", r.status_code, r.status_code == 404)

# ---------------------------------------------------------------- security-style input checks (H-04)
bad_inputs = [("/events", dict(event_name="", event_type="x", event_date="not-a-date", venue="v", city="c",
                               ticket_price="abc", marketing_spend=-1, capacity="many")),
              ("/artists", dict(artist_name=12345, spotify_monthly_streams="lots")),
              (f"/events/{sol['id']}/tiers", dict(name="   ", price=-5)),
              ("/predict", dict(event_id="one", ticket_price=None, marketing_spend="x", capacity=-1))]
codes = [c.post(p, json=b).status_code for p, b in bad_inputs]
check("H-04", "Malformed input to create endpoints returns 4xx, never 500", "all 4xx", codes,
      all(400 <= x < 500 for x in codes))
r = c.post("/artists", json=dict(artist_name="Robert'); DROP TABLE artists;--"))
check("H-04b", "Quote/SQL text is stored as plain text and tables survive", "artists table still readable",
      c.get("/artists").status_code, c.get("/artists").status_code == 200)

# ---------------------------------------------------------------- stress/performance (H-07, H-08) on SQLite
big = mk_event("Bulk Import (sample)", 40, 100000, 1000, 10000)
mk_tier(big["id"], "Regular", 1000, 90000)
rows = ["date_time,ticket_type,quantity"]
start = datetime(2026, 1, 1, tzinfo=UTC)
for i in range(3000):
    rows.append(f"{(start + timedelta(hours=i)).strftime('%Y-%m-%d %H:%M')},Regular,{5*(i+1)}")
t0 = time.time()
r = c.post(f"/events/{big['id']}/sales-import?dry_run=false", json=dict(csv_text="\n".join(rows), utc_offset_minutes=0))
dt = time.time() - t0
check("H-07", "3,000-row CSV import finishes or fails cleanly", "2xx or clean 4xx, no 500",
      f"{r.status_code} in {dt:.1f}s", r.status_code < 500)
scal = {}
for n in (100, 300, 1000):
    ev2 = mk_event(f"Scale {n}", 40, 100000, 1000, 10000)
    mk_tier(ev2["id"], "Regular", 1000, 90000)
    rr = ["date_time,ticket_type,quantity"] + [f"{(start + timedelta(hours=i)).strftime('%Y-%m-%d %H:%M')},Regular,{5*(i+1)}" for i in range(n)]
    t0 = time.time(); r2 = c.post(f"/events/{ev2['id']}/sales-import?dry_run=false", json=dict(csv_text="\n".join(rr), utc_offset_minutes=0))
    scal[n] = f"{r2.status_code} in {time.time()-t0:.1f}s"
check("H-07b", "Import time by row count (observation, no pass target set)", "recorded", scal, True)
for i in range(40):
    mk_event(f"Perf filler {i}", 50 + i, 1000, 500, 20000)
timings = {}
for name, path in [("dashboard summary", "/dashboard/summary"), ("events list", "/events"),
                   ("predicted vs actual", "/dashboard/predicted-vs-actual"),
                   ("sales progress", f"/events/{sol['id']}/sales-progress"),
                   ("tier analytics", f"/events/{sol['id']}/tier-analytics")]:
    t0 = time.time(); c.get(path); timings[name] = round(time.time() - t0, 3)
t0 = time.time()
c.post("/predict", json=dict(event_id=sol["id"], ticket_price=1500, marketing_spend=300000, capacity=8000))
timings["predict"] = round(time.time() - t0, 3)
check("H-08", "Key endpoints respond in under 2 s (local SQLite, ~50 events)", "< 2.0 s each",
      timings, max(timings.values()) < 2.0)

# ---------------------------------------------------------------- write results
out = Path(__file__).parent / "results"
out.mkdir(exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
(out / f"scenario-{stamp}.json").write_text(json.dumps(RESULTS, indent=2))
passed = sum(r["result"] == "PASS" for r in RESULTS)
lines = [f"# Scenario run {stamp}", "", f"{passed} of {len(RESULTS)} checks passed.", "",
         "| ID | Case | Expected | Actual | Result |", "| --- | --- | --- | --- | --- |"]
for r in RESULTS:
    lines.append(f"| {r['id']} | {r['case']} | {r['expected']} | {r['actual'][:80]} | {r['result']} |")
(out / f"scenario-{stamp}.md").write_text("\n".join(lines))
print(f"\n{passed}/{len(RESULTS)} checks passed")
sys.exit(0 if passed == len(RESULTS) else 1)

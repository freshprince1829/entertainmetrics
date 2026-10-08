# Live sample-data check 20261008-100537

35 of 35 checks passed.

| ID | Case | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| L-01 | Sample events present | 5 | 5 | PASS |
| L-02 Sol Fest 2026 - Fan Show (practice copy) | Tier quantities within capacity | <= 10000 | 10000 | PASS |
| L-03 Sol Fest 2026 - Fan Show (practice copy) | Snapshots are non-decreasing | ascending totals | [529, 1163, 1851, 2645, 3385, 4126, 4761, 5290] | PASS |
| L-04 Sol Fest 2026 - Fan Show (practice copy) | Tier counts sum to latest total | 5290 | 5290 | PASS |
| L-05 Sol Fest 2026 - Fan Show (practice copy) | Revenue = sum of price x sold | 17970000.0 | 17970000.0 | PASS |
| L-08 Sol Fest 2026 - Fan Show (practice copy) | Sell-through = sold / capacity | 52.9 | 52.9 | PASS |
| L-09 Sol Fest 2026 - Fan Show (practice copy) | Projection capped at capacity | <= 10000 | 10000 | PASS |
| L-10 Sol Fest 2026 - Fan Show (practice copy) | Live view is not final | False | False | PASS |
| L-11 Sol Fest 2026 - Fan Show (practice copy) | Band low <= expected <= high <= capacity | valid | 8578/8578/9706 | PASS |
| L-02 Fally Ipupa Live in Nairobi | Tier quantities within capacity | <= 11000 | 11000 | PASS |
| L-03 Fally Ipupa Live in Nairobi | Snapshots are non-decreasing | ascending totals | [1579, 3318, 5333, 7313, 8630, 9329, 9590] | PASS |
| L-04 Fally Ipupa Live in Nairobi | Tier counts sum to latest total | 9590 | 9590 | PASS |
| L-05 Fally Ipupa Live in Nairobi | Revenue = sum of price x sold | 124500000.0 | 124500000.0 | PASS |
| L-06 Fally Ipupa Live in Nairobi | Attendance error % recomputed | 6.5 | 6.5 | PASS |
| L-07 Fally Ipupa Live in Nairobi | Actual attendance within capacity | <= 11000 | 8917 | PASS |
| L-02 One Night Only 2026 | Tier quantities within capacity | <= 3000 | 3000 | PASS |
| L-03 One Night Only 2026 | Snapshots are non-decreasing | ascending totals | [463, 955, 1513, 2052, 2413, 2604, 2675] | PASS |
| L-04 One Night Only 2026 | Tier counts sum to latest total | 2675 | 2675 | PASS |
| L-05 One Night Only 2026 | Revenue = sum of price x sold | 21752500.0 | 21752500.0 | PASS |
| L-06 One Night Only 2026 | Attendance error % recomputed | 2.6 | 2.6 | PASS |
| L-07 One Night Only 2026 | Actual attendance within capacity | <= 3000 | 2460 | PASS |
| L-02 Kenny G Nairobi | Tier quantities within capacity | <= 2500 | 2500 | PASS |
| L-03 Kenny G Nairobi | Snapshots are non-decreasing | ascending totals | [460, 840, 1150, 1490, 1880, 2230, 2500] | PASS |
| L-04 Kenny G Nairobi | Tier counts sum to latest total | 2500 | 2500 | PASS |
| L-05 Kenny G Nairobi | Revenue = sum of price x sold | 28150000.0 | 28150000.0 | PASS |
| L-06 Kenny G Nairobi | Attendance error % recomputed | -15.8 | -15.8 | PASS |
| L-07 Kenny G Nairobi | Actual attendance within capacity | <= 2500 | 2375 | PASS |
| L-02 Sauti Sol Final Sol Fest - Fan Show | Tier quantities within capacity | <= 11000 | 10800 | PASS |
| L-03 Sauti Sol Final Sol Fest - Fan Show | Snapshots are non-decreasing | ascending totals | [2484, 4839, 6978, 8986, 9960, 10609, 10695] | PASS |
| L-04 Sauti Sol Final Sol Fest - Fan Show | Tier counts sum to latest total | 10695 | 10695 | PASS |
| L-05 Sauti Sol Final Sol Fest - Fan Show | Revenue = sum of price x sold | 43162500.0 | 43162500.0 | PASS |
| L-06 Sauti Sol Final Sol Fest - Fan Show | Attendance error % recomputed | -5.8 | -5.8 | PASS |
| L-07 Sauti Sol Final Sol Fest - Fan Show | Actual attendance within capacity | <= 11000 | 9625 | PASS |
| L-12 | Event-day patterns usable | sufficient_history true | 4 events | PASS |
| L-13 | Tier patterns usable | sufficient_history true | 4 events | PASS |
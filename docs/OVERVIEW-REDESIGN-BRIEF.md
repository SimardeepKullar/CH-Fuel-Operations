# Overview page redesign — design brief

*Paste this into Claude Design. Bring the mock-up and any changes back to the repo session, and we will update tickets T-69 to T-74 (now GitHub issues) to match.*

## What this is

A fuel-operations dashboard for a small trucking dispatcher (one person). Each week the company imports two supplier invoices: a **US** invoice (USD, gallons) and a **Canadian** invoice (CAD, litres). The Overview page is the landing screen: it answers "how much did we spend on fuel, at what price, and what needs attention?"

## What exists today (so you can improve on it)

One week at a time, picked from a billing-week selector in the top bar. The page has:

1. An **"Invoices in view"** strip: one chip per invoice (`US 999210 · Sep 3–9`, `CA 999217 · Sep 3–10`).
2. Two side-by-side **KPI cards**, US (navy rule) and Canada (cyan rule), each with eight tiles: Average billed price and Total spend (the two large ones), then Diesel, DEF, Discount captured, Other charges, Receipt compliance, Anomalies flagged. Each US tile also shows its CAD equivalent in the top right. Canada tiles show their HST amount bottom right. The Anomalies tile is a link to the Transactions screen.
3. A navy **Combined** band: the two sides added together in CAD/litres, with an exchange-rate input (CAD per USD) in the header, then five tiles.
4. Below: a **Billed price trend** line chart and a **Top spend by driver** bar chart (both US-only, both for the single week).

Visual language to keep: white cards, thin borders, navy `#16205c` and cyan `#00a6e2` accents, Barlow Condensed for headings and big numbers, Barlow for body text, small uppercase letter-spaced labels, large bold numbers so they are easy to read. Money is shown as `US$` / `CA$` with the `$` the same size as the number and the country letters small.

## What we want to change

### 1. A time scope control (new)

The page can show **one billing week**, **all time**, or **a range of weeks** the user picks. **Default is all time.**

- A control at the top of the page (replacing the single-week selector on this page): `All time` | `Billing week ▾` | `Range ▾` (from week to week). Show what is selected as plain text too, e.g. "All time · 14 weeks · Aug 4 – Nov 9".
- Every KPI tile follows the scope: money and quantities are sums over the weeks in scope; prices are quantity-weighted averages (not a mean of weekly prices); receipts and anomalies are totals ("12 of 340 confirmed", "37 flagged").
- The "Invoices in view" strip must cope with many invoices: for a week show the two chips as today; for a range or all time collapse to a summary chip ("All invoices · 28") with a way to expand.
- Show when the converted (CAD) figures are incomplete: a week in scope with no exchange rate entered means that week cannot be converted. Design a clear, calm way to say "3 of 14 weeks have no exchange rate — converted figures cover 11 weeks" with a link to fix it.

### 2. Billed price trend — two charts

- Only meaningful for **all time** or a range of about **4 or more weeks**. For a single week hide it and show one quiet line instead ("Pick a range of 4+ weeks to see the trend"), or show the single price as a number. Please propose which reads best.
- **Two small line charts side by side:** US in USD per gallon, Canada in CAD per litre. They are different units, so they are not drawn on one axis. One point per billing week; a week with no fuel is a gap, not zero.
- Show the latest value and the change from the first point ("US$5.55 / gal · +2.1% since Aug 4") above each chart.

### 3. Top spend by driver — stacked columns

- **Vertical stacked columns**, one column per driver. Each column is split into a **US segment** (navy) and a **Canada segment** (cyan).
- **Sorted by the US segment**, largest first. Top 10 drivers, with an "All other drivers" column if there are more.
- Both segments are shown in **CAD** (the US segment converted at the entered exchange rate) so the stack adds up. Label the axis "CAD". Show a hover tooltip per segment: spend in its own currency and in CAD, quantity in gal / L, and average billed price.
- Under each driver name show their total. A driver with no Canadian fuel has just the navy segment.
- Design the state where the exchange rate is missing: the stack cannot be drawn in one currency, so propose a fallback (for example, show US-only columns with a note).

### 4. Keep, but follow the scope

The Anomalies tile still links to the Transactions screen, now carrying the scope (a week, a range, or all time). Receipt compliance becomes a total.

## States to mock up

1. **All time, rich data** — 14 weeks of invoices (the target state).
2. **Single billing week** — trend hidden or collapsed.
3. **A 4-week range.**
4. **Today's reality** — one week of data only: all time equals one week. The trend charts have a single point each. Design this so it does not look broken.
5. **Exchange rate missing** for some or all weeks.
6. **A week with only a US invoice** (no Canadian one), and the reverse.

## Illustrative sample data (invented — use it for the mock-up)

Weekly average billed price, US (USD/gal): 5.71, 5.68, 5.74, 5.69, 5.62, 5.58, 5.60, 5.55, 5.52, 5.57, 5.61, 5.56, 5.53, 5.55
Weekly average billed price, Canada (CAD/L): 2.31, 2.29, 2.33, 2.28, 2.26, 2.24, 2.25, 2.22, 2.20, 2.23, 2.26, 2.21, 2.19, 2.18
Exchange rate: 1.42 CAD per USD.
Drivers, US spend in USD / Canada spend in CAD (use placeholder names): Driver 1 — 11,200 / 4,300; Driver 2 — 9,850 / 0; Driver 3 — 8,400 / 6,100; Driver 4 — 7,600 / 900; Driver 5 — 6,900 / 2,700; Driver 6 — 5,300 / 0; Driver 7 — 4,800 / 1,500; Driver 8 — 3,900 / 3,200; Driver 9 — 2,700 / 0; Driver 10 — 2,100 / 800.
All-time totals (illustrative): US spend US$612,400 on 105,200 gal; Canada spend CA$548,900 on 244,300 L; 1,102 stops; 340 receipts expected, 212 confirmed; 37 anomalies flagged.

## What we would like back

- Mock-ups of the six states above at desktop width (about 1600px), and a phone-width layout for the all-time state.
- Your recommendation on: how the scope control looks and where it lives; what the trend charts show for a single week; the stacked-column fallback with no exchange rate; how "Invoices in view" collapses.
- Any change you would make to the tile set now that the figures are totals over many weeks (for example, a tile that is only meaningful for a single week).

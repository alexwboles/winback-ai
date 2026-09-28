# WinBack AI

**Bring past customers back.** Re-activating a past buyer is ~5× cheaper than acquiring a new one with ads — yet most small businesses sit on dead customer lists and never mail them. WinBack AI turns that list into a segmented win-back campaign in minutes.

## Problem
Small businesses (trades, retail, restaurants, salons) have hundreds of past customers in a spreadsheet or POS export. Those customers go quiet, and the business spends money on ads chasing strangers instead of emailing people who already trust them.

## Solution
Paste your customer CSV → WinBack AI segments it (RFM-lite: recency × spend) → generates per-segment email + SMS campaigns with subject lines and margin-smart offers → you send from your own email tool and track results.

**Segments:** Champions · Recent buyers · At risk · Lapsed · Dormant VIPs · Lost

**Offer logic:** loyal buyers get gifts (protects margin, drives referrals); quiet buyers get escalating time-limited discounts (10% → 15% → 20% → 25%).

## Features
1. **CSV import** — `name, email, last_purchase, total_spent` (orders optional). Handles quoted commas, duplicates, bad emails. Sample data included.
2. **AI segmentation** — plain-language labels + why each segment matters, sortable customer table.
3. **Campaign generator** — per-segment email + SMS drafts, 3 subject lines, 2 tones (warm / bold), personalized `{name}` previews, copy buttons, send checklist.
4. **Tracking sheet** — log who/when/channel/result, win-back counter, CSV export.
5. **ROI estimator** — expected win-backs, revenue, offer cost, net — with editable assumptions. Honest, conservative defaults.
6. **100% local** — no accounts, no uploads, no sending. Your list never leaves the browser.

## Pricing vision
Free for lists under 100 · **$29/mo Pro** (unlimited lists, saved campaigns, automated follow-up reminders) · $99/mo Agency (multi-client).

## Run it
No build step. Open `index.html` in a browser, or:

```bash
python3 -m http.server 8080   # then http://localhost:8080
```

## Tests
```bash
bash test/smoke.sh   # 12 checks: files, syntax, parse, segments, campaigns, ROI
bash test/e2e.sh     # 8 end-to-end flows in Node against js/logic.js
```

## Architecture
```
index.html      — tabbed UI (Import / Segments / Campaign / Tracking / ROI)
css/style.css   — clean light theme
js/logic.js     — shared logic, zero deps (Node + browser via UMD wrapper)
js/app.js       — UI glue, localStorage persistence
```

Optional: set `OPENAI_API_KEY` in future versions for GPT-polished copy — the local engine is the default and always works offline.

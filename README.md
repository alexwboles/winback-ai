# WinBack AI

**Bring past customers back.** Re-activating a past buyer is ~5× cheaper than acquiring a new one with ads — yet most small businesses sit on dead customer lists and never mail them. WinBack AI turns that list into a segmented win-back campaign in minutes.

## Problem
Small businesses (trades, retail, restaurants, salons) have hundreds of past customers in a spreadsheet or POS export. Those customers go quiet, and the business spends money on ads chasing strangers instead of emailing people who already trust them.

## Solution
Paste your customer CSV → WinBack AI segments it (RFM-lite: recency × spend) → generates per-segment email + SMS campaigns with subject lines and margin-smart offers → send free via mailto-batch in your own mail client, an ESP-shaped export, or a 4-touch follow-up sequence → import real results and run ROI on actuals.

**Segments:** Champions · Recent buyers · At risk · Lapsed · Dormant VIPs · Lost

**Offer logic:** loyal buyers get gifts (protects margin, drives referrals); quiet buyers get escalating time-limited discounts (10% → 15% → 20% → 25%).

## Features
1. **CSV import** — `name, email, last_purchase, total_spent` (orders optional). Handles quoted commas, duplicates, bad emails. Sample data included.
2. **AI segmentation** — plain-language labels + why each segment matters, sortable customer table.
3. **Campaign generator** — per-segment email + SMS drafts, 3 subject lines, 2 tones (warm / bold), personalized `{name}` previews, copy buttons, send checklist.
4. **Send path (free)** — no email provider needed:
   - **mailto-batch composer** — one click per recipient opens a pre-written, personalized email in your own mail client; progress tracked, sends auto-logged.
   - **ESP-shaped export** — download the segment with column headers shaped for **Mailchimp**, **Constant Contact**, or **Brevo**, plus documented `Winback Segment / Offer / Score / Subject` columns you map to custom fields.
   - **Follow-up sequences** — a 4-touch cadence per segment (day 0 email → day 3 SMS → day 7 email → day 14 final call) with per-step copy; start it for a segment and each contact's step + next-due date appears in tracking. Buyers and unsubs drop out automatically.
5. **Tracking sheet** — log who/when/channel/result, **import results** (paste an opens/replies/purchases CSV — flexible headers like `won`, `converted`, `amount`; stronger results upgrade in place, unsubs never overridden), win-back counter, CSV export.
6. **ROI estimator** — expected win-backs, revenue, offer cost, net — with editable assumptions. Honest, conservative defaults. **Actuals mode** runs the same math on logged/imported results instead of estimates.
7. **100% local** — no accounts, no uploads, no bulk sending. Your list never leaves the browser.

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
index.html      — tabbed UI (Import / Segments / Campaign / Send / Tracking / ROI)
css/style.css   — clean light theme
js/logic.js     — shared logic, zero deps (Node + browser via UMD wrapper)
js/app.js       — UI glue, localStorage persistence
```

## Send path notes
- **mailto-batch** uses `mailto:` links — every mail client (Gmail web, Outlook, Apple Mail) handles them; browsers deliberately allow only one at a time, so the queue is one click per recipient with a progress bar.
- **ESP exports** use the import column shapes Mailchimp (`Email Address, First Name, Last Name, Tags`), Constant Contact (`Email Address, First Name, Last Name`), and Brevo (`EMAIL, FIRSTNAME, LASTNAME, SMS`) expect, plus Winback columns (`Winback Segment`, `Winback Offer`, `Winback Score`, `Winback Subject`, `Last Purchase`, `Total Spent`, `Orders`) documented in the UI's column-mapping table. Map those to custom fields/merge tags during import.
- **Result import** expects an `email` column plus any of `opened`/`open`, `replied`/`reply`, `purchased`/`won`/`converted`, `revenue`/`amount`, `date`, `channel`. A date in an opened/purchased column counts as "yes"; nonzero revenue implies a purchase. Strength order: won > opened > sent.
- **Sequences** are per-contact (entry `seq: {start, done}`), so starting mid-campaign is fine; the Tracking tab's Sequence column shows each contact's step and next due date with a "Step done" button.

Optional: set `OPENAI_API_KEY` in future versions for GPT-polished copy — the local engine is the default and always works offline.

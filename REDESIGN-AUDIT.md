# REDESIGN-AUDIT — winback-ai (2026-10-13)

Competitors referenced: **HubSpot CRM** (saved views / segments, contact index with lead scoring, lifecycle stages, pipeline board, customizable dashboards), **Pipedrive** (visual deal pipeline, activity tracking), **Klaviyo** (segment-based win-back flows, A/B variants, per-segment performance).

## Visual gaps vs competitors
- The single highest-value artifact — the top-10 targets ranked by expected value — renders as a plain `.note` box with a bare table inside the Segments tab. HubSpot would make this the hero: a ranked leaderboard with value bars.
- Segment cards show only counts. No "$ at stake" per segment (lifetime spend sitting in each cohort) — the number that justifies the campaign.
- Campaign tab is a single scrolling column: offer note, buttons, A/B splitter, then previews. Klaviyo/HubSpot composers use a two-pane layout (settings left, live draft preview right).
- Tracking results and send performance render as plain tables; win-rate-by-segment comparison deserves bars.
- A 🎉 emoji sits in the result dropdown — not premium chrome.

## Functional gaps vs competitors
1. **No expected-revenue rollup per segment.** `rankTargets` computes expected value per customer, but nothing sums it per segment — the "this segment is worth $X if we win it back" number.
2. **No win-score visibility on the customer table** beyond raw numbers (no bar/scale).
3. Segment cards don't show sendable-vs-suppressed counts.

## What this redesign does (bounded)
- **Top-targets leaderboard** as the Segments tab hero: ranked rows with win-score bars, lifetime spend, and expected-value bars; caption "ranked by expected value (win score × lifetime spend)".
- **Segment cards upgraded**: count + total $ at stake + expected recoverable $ per segment (sums from `rankTargets`), sendable counts; clicking still jumps to the campaign tab.
- **Campaign composer becomes two-pane**: left rail (offer card, segment size/sendable, A/B splitter, offer editor), right live draft previews as email sheets with copy buttons.
- **Win-score bars** in the leaderboard; **segment performance bars** in send performance.
- Emoji removed from the result dropdown; tabular numerals for money columns.
- Visual identity stays "Reactivation studio" — dark-ink mission-control header, numbered pipeline tabs, burnt-coral accent; elevated with leaderboard chrome, value bars, and sheet-style draft previews.
- All existing features preserved: CSV import, RFM-lite segmentation, duplicates merge, suppression list, A/B groups, tracking log + follow-ups, send performance, ROI estimator, per-segment CSV export, custom offers, merge tags, tone selector.

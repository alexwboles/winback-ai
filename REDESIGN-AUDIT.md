# REDESIGN-AUDIT — winback-ai v2 (2026-10-19)

Supersedes the 2026-10-13 audit. That sweep (HubSpot/Pipedrive/Klaviyo lens) built the
"Reclamation Studio" identity — dark-ink mission-control header, numbered pipeline tabs,
strike-list leaderboard, two-pane campaign composer. The 2026-10-19 consolidation then
added the whole send path: mailto-batch composer, ESP-shaped CSV export, result import,
4-touch sequences, ROI Actuals. **Everything below preserves all of it.**

## Competitors studied (this round)

- **Klaviyo** — win-back flow builder (flowium.com walkthrough of the 10-step build;
  Klaviyo's own re-engagement page; elitebrands.org sunset-flow structure). Studied:
  the vertical flow rail (trigger → time delay → email → conditional split → emails),
  per-message detail panels (internal name, subject line, preview text, template),
  conditional splits by historical order value, profile-property updates, exit
  conditions (purchase while in flow → out), and published winback benchmarks
  (~29% open, ~4% click, 0.9–1.4% order rate per email).
- **Mailchimp** — campaign builder and audience hygiene (bytephase, lite14, 365technoblog,
  entrepreneurshq guides). Studied: the campaign checklist (To / From / Subject / Content,
  each with a green checkmark, then a Review step before send), the three-zone builder
  (content blocks left, canvas center, settings right), the "Preview and Test" step,
  A/B with automatic winner roll-out, and audience health states
  (subscribed / unsubscribed / cleaned contacts).

## Layout / IA / visual patterns worth borrowing

1. **Klaviyo flow rail → a sequence timeline.** Klaviyo's flow builder is a vertical rail of
   message cards joined by delay badges ("wait 7 days"). Our 4-touch sequence currently
   renders as stacked draft cards; turning it into a true timeline with day badges makes
   the cadence legible at a glance and is the single most "retention-marketing" visual
   in the category.
2. **Mailchimp campaign checklist → a per-segment launch checklist.** Before any send,
   Mailchimp shows To / From / Subject / Content rows with checkmarks. Our Send tab has
   three cards but no readiness summary. A launch checklist (audience ready · drafts ready
   · cadence set · tracking ready) gives the same pre-flight confidence.
3. **Subject + preview text pairing → inbox mock preview.** Both competitors treat the
   preheader as a first-class field next to the subject line; Klaviyo's message panel
   literally groups them. We currently have no preview text at all — the drafts should
   show an inbox-style sender/subject/preheader row so the copy reads the way it lands.
4. **Mailchimp audience hygiene → import-time hygiene.** Mailchimp auto-marks
   unsubscribed / cleaned contacts and keeps them out of sends. Our CSV import ignores
   any status columns; recognizing bounce/unsub columns and auto-suppressing those
   addresses at import matches category behavior.
5. **Klaviyo per-message panels → collapsible per-step sequence cards.** Each sequence
   step should carry its internal label ("Step 2 — SMS reminder"), channel, and timing
   in one compact header, with copy/copy-button in the body — the same density as a
   flow-builder message panel.
6. **Typography discipline of both.** Klaviyo's builder and Mailchimp's review screens
   keep data in tabular numerals and kickers in tight letterspaced mono. We keep our
   Georgia-serif / mono-kicker pairing and lean on it harder in the new surfaces.

## Functional gaps vs competitors (these get closed)

1. **No preview text (preheader).** Both competitors generate/edit preview text beside
   every subject line; it is a measurable open-rate lever (~29% benchmark). We generate
   none. → **Closing:** `previewText(segment, tone)` in logic.js, included in
   `generateCampaign`, filled per customer in `personalize`, shown in an inbox mock on
   the Campaign tab and on the sequence's step-1 card.
2. **Sequence cadence is fixed (0/3/7/14), not editable.** Klaviyo's flow builder lets
   you change every delay and skip messages. Our sequence is one hard-coded cadence.
   → **Closing:** per-segment cadence editor (day offset inputs + skip toggles),
   persisted in localStorage; `buildSequence`/`startSequenceEntries` accept the config;
   per-entry stored steps so `seqNextDue`/`advanceSequenceEntry` honor the custom
   timing with a fallback to defaults for older entries.
3. **No bounce/unsubscribe hygiene at import.** Mailchimp keeps cleaned/unsubscribed
   contacts out of sends automatically. → **Closing:** `parseCSV` recognizes
   `status`/`bounced`/`unsubscribed`-style columns and returns auto-suppressed emails;
   the Import tab merges them into the suppression list and reports the count.
4. **No pre-send readiness summary.** Mailchimp won't let you send until the checklist
   is green. → **Closing:** a "Launch checklist" card on the Send tab (audience, offer
   + drafts, cadence, tracking) with live check/cross states and links to fix.

## Visual identity (v2): "the reactivation war room"

The 2026-10-13 "Reclamation Studio" identity is kept and deepened — it already reads
distinctively retention-marketing. v2 doubles down on the mission-control metaphor:

- **Palette:** cream paper, dark-ink mission header, **burnt coral remains the single
  accent**. New: a dark inverted treatment *only* for the sequence flow rail, so the
  cadence reads as the control board it is.
- **Type:** Georgia serif for headings, letterspaced mono kickers for section labels,
  tabular numerals everywhere money/scores appear. No new fonts.
- **Signature elements:** (a) the vertical sequence timeline with day badges and a
  connector rail; (b) the inbox-mock preview (sender row, subject, preheader) on the
  Campaign tab; (c) the launch checklist with coral check markers; (d) the existing
  strike-list leaderboard, unchanged.
- **Hard rules kept:** zero border-radius anywhere, no purple/blue gradients, no
  emoji-heavy chrome, no boxy uniformity — timeline, inbox mock, and offset panels
  break the grid deliberately.

## Preservation contract

All Oct-19 send-path features keep working unchanged: mailto-batch composer queue,
ESP-shaped CSV export (same columns/formats), result import + ROI Actuals, sequences
with step tracking and auto-dropout, Estimates/Actuals toggle, RFM segmentation,
campaign generator, ROI estimator. localStorage key `winback-ai` unchanged; the new
`seqCfg` field is additive (old saves simply lack it — no migration needed).
`estimateROI` numbers are pinned by the existing regression test (net $8).

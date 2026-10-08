#!/usr/bin/env bash
# WinBack AI end-to-end tests — 8 flows exercised in Node against js/logic.js.
set -u
cd "$(dirname "$0")/.."

node << 'EOF'
const W = require('/home/hatch/workspace/winback-ai/js/logic.js');
const NOW = '2026-09-27';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };
console.log('== winback-ai e2e ==');

// Flow 1: full pipeline — import -> segment -> counts
const csv = ['name,email,last_purchase,total_spent,orders',
  'Ava Martinez,ava@example.com,2026-09-10,1240,9',
  'Liam Chen,liam@example.com,2026-08-20,180,2',
  'Sofia Rossi,sofia@example.com,2026-05-01,960,7',
  'Noah Kim,noah@example.com,2026-02-14,95,1',
  'Emma Patel,emma@example.com,2025-10-30,1500,11',
  'Lucas Brown,lucas@example.com,2025-04-12,60,1',
  'Mia Wong,mia@example.com,,0,1'].join('\n');
const parsed = W.parseCSV(csv);
const seg = W.segmentCustomers(parsed.rows, NOW);
const counts = W.segmentCounts(seg);
(parsed.rows.length === 7 && seg.length === 7) ? ok('flow1: 7 customers imported + segmented') : bad('flow1 rows=' + parsed.rows.length);

// Flow 2: lapsed VIP flagged as vip-dormant (the money segment), not plain lapsed
const emma = seg.find(c => c.email === 'emma@example.com');
(emma && emma.segment === 'vip-dormant') ? ok('flow2: Emma ($1500, 11mo quiet) -> vip-dormant') : bad('flow2 emma=' + (emma && emma.segment));

// Flow 3: champions = recent + high spend
const ava = seg.find(c => c.email === 'ava@example.com');
(ava && ava.segment === 'champions') ? ok('flow3: Ava (recent, $1240) -> champions') : bad('flow3 ava=' + (ava && ava.segment));

// Flow 4: missing purchase data -> unknown, never crashes campaign gen
const mia = seg.find(c => c.email === 'mia@example.com');
const miaCamp = W.generateCampaign(mia.segment, 'Biz', 'warm', 75);
(mia && mia.segment === 'unknown' && miaCamp.email.includes('{name}')) ? ok('flow4: missing data -> unknown + generic draft') : bad('flow4');

// Flow 5: per-segment drafts personalized for a real customer
const camp = W.generateCampaign('vip-dormant', 'Main Street Co', 'warm', 75);
const p = W.personalize(camp, { name: 'Emma Patel', email: 'emma@example.com' });
(p.email.includes('Emma') && !p.email.includes('{name}') && p.subjects[0].includes('Emma'))
  ? ok('flow5: VIP draft personalized (name in subject + body)') : bad('flow5 personalize');

// Flow 6: offer logic — champions get freebie (margin protection), lapsed get discount
const champOffer = W.offerFor('champions', 75), lapsedOffer = W.offerFor('lapsed', 75);
(champOffer.type === 'freebie' && lapsedOffer.type === 'discount' && /15%/.test(lapsedOffer.value))
  ? ok('flow6: champions->freebie, lapsed->15% discount') : bad('flow6 offers');

// Flow 7: ROI math — revenue/cost/net consistent, verdict present
const roi = W.estimateROI(seg, { avgOrderValue: 100, marginPct: 0.5 });
const mathOk = roi.expectedRevenue > 0 && roi.expectedNet === Math.round(roi.expectedRevenue * 0.5 - roi.expectedCost);
(mathOk && typeof roi.verdict === 'string' && roi.verdict.length > 10) ? ok('flow7: ROI math consistent, net=$' + roi.expectedNet) : bad('flow7 roi');

// Flow 8: CSV edge cases — no email column errors; blank lines ignored
const noEmail = W.parseCSV('name,phone\nBob,555-1234\n');
const blanks = W.parseCSV('name,email,last_purchase,total_spent\n\nBob,bob@x.com,2026-01-01,50\n\n');
(noEmail.errors.length > 0 && noEmail.rows.length === 0 && blanks.rows.length === 1)
  ? ok('flow8: missing email column -> error; blank lines ignored') : bad('flow8 edge');

// Flow 9: sortable/searchable customer table
const bySpend = W.sortCustomers(seg, 'totalSpent', 'desc');
(bySpend[0].email === 'emma@example.com' && bySpend[bySpend.length-1].email === 'mia@example.com')
  ? ok('flow9: sort by spend desc -> Emma first, Mia (unknown spend) last') : bad('flow9 sort');
const bySeg = W.sortCustomers(seg, 'segment', 'asc');
const prios = bySeg.map(c => W.SEGMENTS[c.segment].priority);
(prios.every((p, i) => i === 0 || prios[i-1] <= p)) ? ok('flow9: sort by segment follows priority order') : bad('flow9 segment sort');
(W.searchCustomers(seg, 'martinez').length === 1 && W.searchCustomers(seg, 'EXAMPLE.COM').length === 7)
  ? ok('flow9: search finds name + domain, case-insensitive') : bad('flow9 search');

// Flow 10: suppression end-to-end — unsub -> excluded from export -> restored
let supp = W.suppressEmail([], 'lucas@example.com');
const lapsedSeg = seg.find(c => c.email === 'lucas@example.com').segment;
const before = W.segmentToCSV(seg, lapsedSeg, []);
const after = W.segmentToCSV(seg, lapsedSeg, supp);
(before.count === after.count + 1 && after.csv.indexOf('lucas@example.com') === -1)
  ? ok('flow10: suppressed email excluded from segment CSV (' + before.count + '->' + after.count + ')') : bad('flow10 export');
supp = W.unsuppressEmail(supp, 'lucas@example.com');
const restored = W.segmentToCSV(seg, lapsedSeg, supp);
(restored.count === before.count) ? ok('flow10: unsuppress restores the contact') : bad('flow10 restore');

// Flow 11: custom offer flows into campaign copy + previews
const offers = { 'vip-dormant': { value: 'Private tasting event', rationale: 'VIPs deserve VIP' } };
const vipCamp = W.generateCampaign('vip-dormant', 'Main Street Co', 'bold', 100, offers);
(vipCamp.offer.type === 'custom' && vipCamp.offer.value === 'Private tasting event' &&
 vipCamp.email.includes('Private tasting event') && vipCamp.sms.includes('Private tasting event'))
  ? ok('flow11: custom offer appears in email + SMS drafts') : bad('flow11 custom offer');
const vipPrev = W.personalize(vipCamp, { name: 'Emma Patel', email: 'emma@example.com' });
(vipPrev.email.includes('Private tasting event') && vipPrev.email.includes('Emma'))
  ? ok('flow11: personalized preview keeps custom offer + name') : bad('flow11 preview');

// Flow 12: follow-up reminders — due list drives the nudge
const trk = [
  { email: 'ava@example.com', result: 'opened', followUp: '2026-09-27' },
  { email: 'liam@example.com', result: 'sent', followUp: '2026-10-05' },
  { email: 'sofia@example.com', result: 'won', followUp: '2026-09-20' },
];
const due = W.followUpsDue(trk, NOW);
(due.length === 1 && due[0].email === 'ava@example.com')
  ? ok('flow12: 1 follow-up due today; future + won excluded') : bad('flow12 due');

console.log('');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
echo "e2e exit: $?"

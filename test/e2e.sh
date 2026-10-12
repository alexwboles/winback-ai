#!/usr/bin/env bash
# WinBack AI end-to-end tests — 16 flows exercised in Node against js/logic.js.
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

// Flow 13: win score 0-100 from recency x spend x frequency
const avaS = seg.find(c => c.email === 'ava@example.com');
const lucasS = seg.find(c => c.email === 'lucas@example.com');
(avaS && avaS.score >= 70 && ava.score <= 100) ? ok('flow13: Ava (recent, $1240, 9 orders) scores high: ' + ava.score) : bad('flow13 ava=' + (ava && ava.score));
(lucasS && lucasS.score < avaS.score) ? ok('flow13: Lucas (old, $60, 1 order) scores lower: ' + lucasS.score) : bad('flow13 lucas=' + (lucasS && lucasS.score));
(W.winScore({ recencyDays: 30, totalSpent: 2000, orders: 10 }) === 100) ? ok('flow13: ceiling clamps at 100') : bad('flow13 ceiling');
(W.winScore({ recencyDays: null, totalSpent: 0, orders: 1 }) < 25) ? ok('flow13: unknown recency scores low') : bad('flow13 unknown');

// Flow 14: win score is a sortable table column
const byScore = W.sortCustomers(seg, 'score', 'desc');
(byScore[0].score >= byScore[byScore.length - 1].score) ? ok('flow14: sort by score desc orders correctly') : bad('flow14 sort');

// Flow 15: extra merge tags personalize drafts
const tagCamp = W.generateCampaign('champions', 'Biz', 'warm', 75, {});
const tagged = W.personalize(Object.assign({}, tagCamp, { email: 'Hi {name}, you spent {total_spent} on {last_purchase} ({segment}).' }),
  { name: 'Ava Martinez', lastPurchase: '2026-09-10', totalSpent: 1240, segmentLabel: 'Champions' });
(tagged.email === 'Hi Ava, you spent $1240 on 2026-09-10 (Champions).')
  ? ok('flow15: {total_spent}/{last_purchase}/{segment} filled in') : bad('flow15 got: ' + tagged.email);

// Flow 16: campaign performance — sends + tracking join by segment
let sends = W.logSend([], { segment: 'vip-dormant', channel: 'Email', count: 40, date: '2026-09-20' });
sends = W.logSend(sends, { segment: 'lapsed', channel: 'SMS', count: 60, date: '2026-09-21' });
const trk2 = [
  { email: 'emma@example.com', result: 'won' },
  { email: 'emma@example.com', result: 'opened' },
  { email: 'noah@example.com', result: 'ignored' }
];
const stats = W.campaignStats(seg, sends, trk2);
const vip = stats.find(r => r.segment === 'vip-dormant');
const lap = stats.find(r => r.segment === 'lapsed');
(vip && vip.sent === 40 && vip.won === 1 && vip.contacted === 2 && vip.responded === 2)
  ? ok('flow16: vip-dormant stats join correctly') : bad('flow16 vip=' + JSON.stringify(vip));
(lap && lap.sent === 60 && lap.won === 0 && lap.contacted === 1)
  ? ok('flow16: lapsed stats correct') : bad('flow16 lap=' + JSON.stringify(lap));
(vip && vip.winRate === 50) ? ok('flow16: win rate 50% (1 won / 2 contacted)') : bad('flow16 winRate=' + (vip && vip.winRate));

console.log('');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
echo "e2e exit: $?"

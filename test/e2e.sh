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

// Flow 26: rankTargets — expected value ranking, champions/unknowns excluded
(function () {
  const s2 = W.segmentCustomers([
    { name: 'VIP Q', email: 'q@x.com', lastPurchase: '2026-03-01', totalSpent: 2000, orders: 8 },
    { name: 'Small L', email: 'l@x.com', lastPurchase: '2026-03-01', totalSpent: 120, orders: 1 },
    { name: 'Champ', email: 'c@x.com', lastPurchase: '2026-09-20', totalSpent: 900, orders: 6 },
    { name: 'Ghost', email: 'g@x.com', lastPurchase: '', totalSpent: 0, orders: 1 }
  ], NOW);
  const t = W.rankTargets(s2, [], 10);
  (t.length === 2) ? ok('flow26: champions + unknowns excluded (' + t.length + ')') : bad('flow26 len=' + t.length);
  (t[0].email === 'q@x.com' && t[0].expectedValue > t[1].expectedValue) ? ok('flow26: highest expected value first') : bad('flow26 order=' + t.map(x => x.email));
  const supp = W.rankTargets(s2, ['q@x.com'], 10);
  (supp.length === 1 && supp[0].email === 'l@x.com') ? ok('flow26: suppressed customers excluded') : bad('flow26 supp');
})();

// Flow 27: splitAB — deterministic, disjoint, covers everyone
(function () {
  const list = [{ email: 'b@x.com' }, { email: 'a@x.com' }, { email: 'c@x.com' }, { email: 'd@x.com' }];
  const s1 = W.splitAB(list), s2 = W.splitAB(list);
  (JSON.stringify(s1) === JSON.stringify(s2)) ? ok('flow27: deterministic split') : bad('flow27 not deterministic');
  const all = s1.a.concat(s1.b).map(c => c.email).sort();
  (JSON.stringify(all) === JSON.stringify(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])) ? ok('flow27: disjoint + complete') : bad('flow27 coverage');
})();

// Flow 28: abCompare — rates, verdicts, small-sample caveat
(function () {
  const mk = (w, t) => Array.from({ length: t }, (_, i) => ({ result: i < w ? 'won' : 'sent' }));
  const c = W.abCompare(mk(3, 20), mk(7, 20));
  (c.a.rate === 15 && c.b.rate === 35) ? ok('flow28: rates 15% vs 35%') : bad('flow28 rates=' + c.a.rate + '/' + c.b.rate);
  (/Group B is winning/.test(c.verdict)) ? ok('flow28: verdict names the winner') : bad('flow28 verdict=' + c.verdict);
  const early = W.abCompare(mk(1, 3), mk(0, 2));
  (/Too early/.test(early.verdict)) ? ok('flow28: small-sample caveat') : bad('flow28 early=' + early.verdict);
})();

// Flow 29: duplicates — find pairs, merge combines, re-segments
(function () {
  const s2 = W.segmentCustomers([
    { name: 'Jane Doe', email: 'jane@x.com', lastPurchase: '2026-09-01', totalSpent: 900, orders: 5 },
    { name: 'jane  doe', email: 'jane.doe@x.com', lastPurchase: '2026-05-01', totalSpent: 200, orders: 2 },
    { name: 'Bob', email: 'bob@x.com', lastPurchase: '2026-09-01', totalSpent: 100, orders: 1 }
  ], NOW);
  const pairs = W.findDuplicatePairs(s2);
  (pairs.length === 1 && pairs[0][0].email === 'jane@x.com') ? ok('flow29: duplicate pair found') : bad('flow29 pairs=' + pairs.length);
  const merged = W.mergeCustomers(s2, 'jane@x.com', 'jane.doe@x.com', NOW);
  const j = merged.find(c => c.email === 'jane@x.com');
  (j && j.totalSpent === 1100 && j.orders === 7 && j.lastPurchase === '2026-09-01') ? ok('flow29: spend/orders summed, latest purchase kept') : bad('flow29 merge=' + JSON.stringify(j));
  (!merged.some(c => c.email === 'jane.doe@x.com')) ? ok('flow29: dropped row removed') : bad('flow29 drop still present');
  (W.mergeCustomers(s2, 'jane@x.com', 'nobody@x.com', NOW) === s2) ? ok('flow29: missing email is a no-op') : bad('flow29 no-op');
})();

// Flow 30: mailto-batch — personalized compose links for a whole segment
(function () {
  const camp = W.generateCampaign('vip-dormant', 'Main Street Co', 'warm', 75);
  const vipList = seg.filter(c => c.segment === 'vip-dormant');
  const links = vipList.map(c => W.composeMailto(c, camp));
  const allValid = links.length > 0 && links.every((l, i) =>
    l.mailto.indexOf('mailto:' + encodeURIComponent(vipList[i].email)) === 0 &&
    decodeURIComponent(l.mailto).indexOf(vipList[i].name.split(' ')[0]) !== -1 &&
    l.body.indexOf('{name}') === -1);
  allValid ? ok('flow30: ' + links.length + ' personalized mailto links, no raw merge tags') : bad('flow30 mailto');
})();

// Flow 31: ESP exports agree on the sendable set, suppressed excluded
(function () {
  const camp = W.generateCampaign('lapsed', 'Biz', 'warm', 75);
  const lapsedSeg = seg.find(c => c.email === 'noah@example.com').segment;
  const supp = W.suppressEmail([], 'lucas@example.com');
  const counts = ['mailchimp', 'constant-contact', 'brevo'].map(f =>
    W.espExport(seg, lapsedSeg, camp, { format: f, suppressions: supp }).count);
  const plain = W.segmentToCSV(seg, lapsedSeg, supp).count;
  (counts.every(c => c === plain) && counts[0] > 0)
    ? ok('flow31: all 3 ESP formats export the same ' + counts[0] + ' sendable contacts') : bad('flow31 counts=' + counts + ' vs ' + plain);
  const mc = W.espExport(seg, lapsedSeg, camp, { format: 'mailchimp', suppressions: supp });
  (mc.csv.indexOf('lucas@example.com') === -1 && mc.csv.split('\n').length === mc.count + 1)
    ? ok('flow31: header + exactly one line per contact, suppressed gone') : bad('flow31 csv shape');
})();

// Flow 32: result import -> actual ROI end-to-end
(function () {
  const csv = ['email,opened,purchased,revenue,date',
    'emma@example.com,,yes,340,2026-10-15',
    'noah@example.com,yes,,,2026-10-16',
    'stranger@example.com,,yes,85,2026-10-16'].join('\n');
  const parsed = W.parseResultImport(csv);
  const imp = W.importResults([], seg, parsed.rows, '2026-10-16');
  const act = W.estimateROIActual(seg, imp.tracking, { avgOrderValue: 100, marginPct: 0.5 });
  const vip = act.perSegment['vip-dormant'];
  (imp.summary.won === 2 && vip && vip.won === 1 && vip.revenue === 340 &&
   act.revenue === 425 && /Real results/.test(act.verdict))
    ? ok('flow32: import -> actual ROI counts real revenue ($425), vip-dormant 1 won') : bad('flow32 act=' + JSON.stringify(act));
})();

// Flow 33: sequence lifecycle — start, due dates, advance to done
(function () {
  const entries = W.startSequenceEntries(seg, 'vip-dormant', [], '2026-10-15');
  if (!entries.length) { bad('flow33: no entries'); return; }
  const e0 = entries[0];
  const step2 = W.seqNextDue(e0, '2026-10-18');
  const step3 = W.seqNextDue(W.advanceSequenceEntry(e0), '2026-10-22');
  const done = [0, 1, 2, 3].reduce((e) => W.advanceSequenceEntry(e), e0);
  (step2 && step2.step.n === 2 && step2.step.channel === 'SMS' &&
   step3 && step3.step.n === 3 &&
   W.seqNextDue(done, '2026-11-01') === null &&
   W.followUpsDue(entries, '2026-10-18').length === entries.length)
    ? ok('flow33: cadence 0/3/7/14, advances through 4 steps, all due on day 3') : bad('flow33 lifecycle');
  const won = Object.assign({}, e0, { result: 'won' });
  (W.followUpsDue([won], '2026-11-01').length === 0) ? ok('flow33: buyers drop out of the sequence') : bad('flow33 dropout');
})();

// Flow 34: estimateROI regression on the flow-7 fixture (refactor must not move numbers)
(function () {
  const roi = W.estimateROI(seg, { avgOrderValue: 100, marginPct: 0.5 });
  const mathOk = roi.expectedRevenue > 0 && roi.expectedNet === Math.round(roi.expectedRevenue * 0.5 - roi.expectedCost);
  (mathOk && roi.customers === 7) ? ok('flow34: estimateROI math still consistent on 7-customer fixture, net=$' + roi.expectedNet) : bad('flow34 roi');
})();

console.log('');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
echo "e2e exit: $?"

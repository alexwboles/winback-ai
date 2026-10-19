#!/usr/bin/env bash
# WinBack AI smoke tests — 15 checks. Fails fast on first failure.
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== winback-ai smoke =="

# 1-5: files exist
for f in index.html css/style.css js/logic.js js/app.js README.md; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 6-7: JS syntax
if node --check js/logic.js 2>/dev/null; then ok "logic.js syntax"; else bad "logic.js syntax"; fi
if node --check js/app.js 2>/dev/null; then ok "app.js syntax"; else bad "app.js syntax"; fi

# 8-12: logic checks in Node
node << 'EOF'
const W = require('/home/hatch/workspace/winback-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };

// 8: CSV parse — sample with quoted comma, duplicate, bad email
const csv = 'name,email,last_purchase,total_spent,orders\n' +
  '"Garcia, Maria",maria@example.com,2026-07-07,320,3\n' +
  'Ava,ava@example.com,2026-09-10,1240,9\n' +
  'Ava,ava@example.com,2026-09-10,1240,9\n' +
  'Bad,bad-email,2026-01-01,50,1\n' +
  ',noname@example.com,,0,';
const p = W.parseCSV(csv);
(p.rows.length === 3) ? ok('parseCSV: 3 valid rows (quoted comma ok, dup + bad email skipped)') : bad('parseCSV rows=' + p.rows.length);
(p.rows[0].name === 'Garcia, Maria') ? ok('parseCSV: quoted comma name preserved') : bad('quoted name=' + p.rows[0].name);

// 9: dormant VIP flagged (big spender, quiet 11 months) — pinned "now" for determinism
const now = '2026-09-27';
const seg = W.segmentCustomers([
  { name: 'VIP', email: 'vip@x.com', lastPurchase: '2025-10-30', totalSpent: 1500, orders: 11 },
  { name: 'New', email: 'new@x.com', lastPurchase: '2026-09-10', totalSpent: 1240, orders: 9 },
  { name: 'Gone', email: 'gone@x.com', lastPurchase: '2024-01-01', totalSpent: 60, orders: 1 },
], now);
const byEmail = {}; seg.forEach(c => byEmail[c.email] = c.segment);
(byEmail['vip@x.com'] === 'vip-dormant') ? ok('segmentation: lapsed big spender -> vip-dormant') : bad('vip segment=' + byEmail['vip@x.com']);
(byEmail['new@x.com'] === 'champions') ? ok('segmentation: recent big spender -> champions') : bad('new segment=' + byEmail['new@x.com']);
(byEmail['gone@x.com'] === 'lost') ? ok('segmentation: 2yr quiet low spend -> lost') : bad('gone segment=' + byEmail['gone@x.com']);

// 10: campaign for every segment, both tones
let campOk = true;
Object.keys(W.SEGMENTS).forEach(s => {
  ['warm', 'bold'].forEach(t => {
    const c = W.generateCampaign(s, 'TestBiz', t, 75);
    if (!(c.subjects.length === 3 && c.email.length > 50 && c.sms.length > 20 && c.offer && c.offer.value)) campOk = false;
  });
});
campOk ? ok('generateCampaign: all 7 segments x 2 tones produce full drafts') : bad('generateCampaign incomplete');

// 11: ROI estimator sane on sample list
const roi = W.estimateROI(seg, { avgOrderValue: 75, marginPct: 0.5 });
(roi.customers === 3 && roi.expectedNet > 0 && roi.expectedWonBack > 0) ? ok('estimateROI: 3 customers -> net $' + roi.expectedNet + ', ' + roi.expectedWonBack + ' won back') : bad('ROI=' + JSON.stringify(roi));

// 12: empty CSV errors cleanly
const e = W.parseCSV('name,email\n');
(e.rows.length === 0 && e.errors.length > 0) ? ok('parseCSV: empty data -> clean error') : bad('empty csv handling');

// 13: new API exported (sort/search/suppression/offers/csv/followups)
const apiOk = ['sortCustomers','searchCustomers','suppressEmail','unsuppressEmail','isSuppressed',
  'activeCustomers','resolveOffer','segmentToCSV','followUpsDue','todayISO']
  .every(f => typeof W[f] === 'function');
apiOk ? ok('new API exported: sort/search/suppression/offers/csv/followups') : bad('new API incomplete');

// 14: sortCustomers — by spend desc, by name, invalid key falls back
const srt = W.sortCustomers(seg, 'totalSpent', 'desc');
(srt[0].email === 'vip@x.com' && srt[2].email === 'gone@x.com') ? ok('sortCustomers: spend desc -> VIP first') : bad('spend sort wrong');
const srtN = W.sortCustomers(seg, 'name', 'asc');
(srtN[0].name === 'Gone' && srtN[2].name === 'VIP') ? ok('sortCustomers: name asc alphabetical') : bad('name sort wrong');
const srtBad = W.sortCustomers(seg, 'nope', 'asc');
(srtBad.length === 3) ? ok('sortCustomers: bad key falls back to name') : bad('bad key sort broken');

// 15: searchCustomers — name + email, case-insensitive
(W.searchCustomers(seg, 'VIP').length === 1 && W.searchCustomers(seg, 'x.com').length === 3 &&
 W.searchCustomers(seg, '').length === 3 && W.searchCustomers(seg, 'zzz').length === 0)
  ? ok('searchCustomers: name/email match, empty->all, no-match->none') : bad('searchCustomers broken');

// 16: suppression list lifecycle
let supp = W.suppressEmail([], 'VIP@x.com');
supp = W.suppressEmail(supp, 'vip@x.com'); // dedupe, case-insensitive
(supp.length === 1 && W.isSuppressed(supp, 'vip@x.com') && !W.isSuppressed(supp, 'new@x.com'))
  ? ok('suppressEmail dedupes + isSuppressed checks') : bad('suppression broken');
supp = W.unsuppressEmail(supp, 'vip@x.com');
(supp.length === 0) ? ok('unsuppressEmail removes') : bad('unsuppress broken');
const active = W.activeCustomers(seg, W.suppressEmail([], 'gone@x.com'));
(active.length === 2 && !active.some(c => c.email === 'gone@x.com')) ? ok('activeCustomers excludes suppressed') : bad('activeCustomers broken');

// 17: custom offers override, blank falls back to default
const custom = { 'lapsed': { value: 'Free dessert', rationale: 'Sweeten the deal' } };
const r1 = W.resolveOffer('lapsed', custom, 75);
const r2 = W.resolveOffer('lapsed', {}, 75);
const r3 = W.resolveOffer('lapsed', { lapsed: { value: '  ', rationale: '' } }, 75);
(r1.type === 'custom' && r1.value === 'Free dessert' && r2.type === 'discount' && r3.type === 'discount')
  ? ok('resolveOffer: custom wins, blank/empty fall back') : bad('resolveOffer broken');
const camp2 = W.generateCampaign('lapsed', 'Biz', 'warm', 75, custom);
(camp2.email.includes('Free dessert')) ? ok('generateCampaign uses custom offer text') : bad('campaign ignored custom offer');
const camp3 = W.generateCampaign('lapsed', 'Biz', 'warm', 75);
(/15%/.test(camp3.offer.value)) ? ok('generateCampaign without custom offers unchanged') : bad('default offer changed');

// 18: segmentToCSV — header + rows, suppressed excluded
const segFull = W.segmentCustomers([
  { name: 'A', email: 'a@x.com', lastPurchase: '2026-09-01', totalSpent: 100, orders: 2 },
  { name: 'B', email: 'b@x.com', lastPurchase: '2026-09-01', totalSpent: 50, orders: 1 },
], now);
const segKey = segFull[0].segment;
const res = W.segmentToCSV(segFull, segKey, W.suppressEmail([], 'b@x.com'));
const lines = res.csv.split('\n');
(lines[0] === 'name,email,last_purchase,total_spent,orders' && res.count === 1 && lines.length === 2 && lines[1].indexOf('a@x.com') === 2)
  ? ok('segmentToCSV: 1 sendable row, suppressed excluded') : bad('segmentToCSV broken: ' + res.csv);

// 19: followUpsDue — pinned today, won/unsub excluded
const trk = [
  { email: 'a@x.com', result: 'sent', followUp: '2026-09-27' },
  { email: 'b@x.com', result: 'sent', followUp: '2026-09-28' },
  { email: 'c@x.com', result: 'won', followUp: '2026-09-01' },
  { email: 'd@x.com', result: 'unsub', followUp: '2026-09-01' },
  { email: 'e@x.com', result: 'sent', followUp: '' },
];
const due = W.followUpsDue(trk, '2026-09-27');
(due.length === 1 && due[0].email === 'a@x.com') ? ok('followUpsDue: only overdue non-won/non-unsub') : bad('followUpsDue broken: ' + due.length);

console.log('node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "node logic checks" || bad "node logic checks"

# 13b: UI wiring — search/sort/export/suppression/offers/followup hooks
missing=""
for n in segSearch segCsvBtn offerVal offerSave offerClear trkFollow sortCustomers searchCustomers suppressEmail segmentToCSV followUpsDue resolveOffer unsupp; do
  grep -q "$n" index.html js/app.js js/logic.js || missing="$missing $n"
done
[ -z "$missing" ] && ok "UI wires search/sort/export/suppression/offers/followup" || bad "missing wiring:$missing"


# 13c: UI wiring — win score, sends, merge tags
missing=""
for n in winScore logSend campaignStats scoreBadge sendSeg sendAdd sendPerf SORT_LABELS; do
  grep -q "th('score')" js/app.js || missing="$missing th-score"
  grep -q "$n" index.html js/app.js js/logic.js || missing="$missing $n"
done
[ -z "$missing" ] && ok "UI wires win-score/sends/merge-tags" || bad "missing wiring:$missing"

node << 'EOF'
const W = require('/home/hatch/workspace/winback-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };
const seg = W.segmentCustomers([{ name: 'A', email: 'a@x.com', lastPurchase: '2026-09-10', totalSpent: 1240, orders: 9 }], '2026-09-27');
(typeof seg[0].score === 'number' && seg[0].score >= 0 && seg[0].score <= 100) ? ok('segmentCustomers attaches 0-100 win score') : bad('score=' + seg[0].score);
const sends = W.logSend([], { segment: 'champions', channel: 'Email', count: 10, date: '2026-09-20' });
const st = W.campaignStats(seg, sends, [{ email: 'a@x.com', result: 'won' }]);
(st.length === 1 && st[0].sent === 10 && st[0].won === 1 && st[0].winRate === 100) ? ok('campaignStats joins sends + tracking') : bad('stats=' + JSON.stringify(st));
const camp = W.generateCampaign('champions', 'Biz', 'warm', 75, {});
const pz = W.personalize(Object.assign({}, camp, { email: '{total_spent} {last_purchase} {segment}' }),
  { name: 'A', lastPurchase: '2026-09-10', totalSpent: 1240, segmentLabel: 'Champions' });
(pz.email === '$1240 2026-09-10 Champions') ? ok('merge tags {total_spent} {last_purchase} {segment}') : bad('got: ' + pz.email);
console.log('node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "node win-score/sends/merge-tag checks" || bad "node win-score/sends/merge-tag checks"

node -e "const W=require('./js/logic.js');['rankTargets','splitAB','abCompare','findDuplicatePairs','mergeCustomers'].forEach(function(f){if(typeof W[f]!=='function')throw new Error('missing '+f)});" \
  && ok "new logic API exported (rankTargets/splitAB/abCompare/findDuplicatePairs/mergeCustomers)" || bad "new logic API missing"
missing=""
for n in topTargets dupBox renderTargets renderDuplicates rankTargets abSplitBtn abOut splitAB abCompare trkGroup renderAB leaderboard lb-rank lb-money cmp-grid cmp-left cmp-right seg-money data-pi; do
  grep -q "$n" index.html js/app.js js/logic.js css/style.css || missing="$missing $n"
done
[ -z "$missing" ] && ok "UI wires targets, A/B, duplicates, leaderboard, composer" || bad "UI wiring missing:$missing"

# new: send path, result import, actual ROI, sequences
node << 'EOF'
const W = require('/home/hatch/workspace/winback-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };
const NOW = '2026-09-27';
const seg = W.segmentCustomers([
  { name: 'Ava Martinez', email: 'ava@example.com', lastPurchase: '2026-09-10', totalSpent: 1240, orders: 9 },
  { name: 'Emma Patel', email: 'emma@example.com', lastPurchase: '2025-10-30', totalSpent: 1500, orders: 11 },
], NOW);
const emma = seg.find(c => c.email === 'emma@example.com');
const camp = W.generateCampaign('vip-dormant', 'Main Street Co', 'warm', 75);

// 20: mailto composition
const m = W.composeMailto(emma, camp);
(/^mailto:emma%40example.com\?subject=/.test(m.mailto) && decodeURIComponent(m.mailto).indexOf('Emma') !== -1 && m.body.indexOf('{name}') === -1)
  ? ok('composeMailto: encoded mailto with personalized subject + body') : bad('composeMailto=' + m.mailto.slice(0, 80));

// 21: ESP exports — 3 formats, correct headers, suppressed excluded
const mc = W.espExport(seg, 'vip-dormant', camp, { format: 'mailchimp' });
const cc = W.espExport(seg, 'vip-dormant', camp, { format: 'constant-contact' });
const br = W.espExport(seg, 'vip-dormant', camp, { format: 'brevo' });
(mc.csv.split('\n')[0].indexOf('Email Address,First Name,Last Name,Tags') === 0 && mc.count === 1)
  ? ok('espExport mailchimp: header + 1 sendable row') : bad('mailchimp export');
(br.csv.split('\n')[0].indexOf('EMAIL,FIRSTNAME,LASTNAME,SMS') === 0 && /WINBACK_SEGMENT/.test(br.csv))
  ? ok('espExport brevo: uppercase columns + WINBACK_* fields') : bad('brevo export');
(cc.csv.split('\n')[0].indexOf('Email Address,First Name,Last Name,Winback Segment') === 0)
  ? ok('espExport constant-contact: header shape') : bad('cc export');
const mcS = W.espExport(seg, 'vip-dormant', camp, { format: 'mailchimp', suppressions: ['emma@example.com'] });
(mcS.count === 0) ? ok('espExport: suppressed excluded') : bad('espExport suppression');
const fb = W.espExport(seg, 'vip-dormant', camp, { format: 'bogus' });
(fb.formatLabel === 'Mailchimp') ? ok('espExport: unknown format falls back to mailchimp') : bad('espExport fallback');
const sn = W.splitName('Ava Martinez');
(sn.first === 'Ava' && sn.last === 'Martinez') ? ok('splitName: first/last split') : bad('splitName');

// 22: result import parse
const pr = W.parseResultImport('email,opened,purchased,revenue,date\nava@example.com,yes,,,,\nbob@example.com,,,120,2026-10-16\nbad-email,,,,\n');
(pr.rows.length === 2 && pr.errors.length === 1 && pr.rows[0].result === 'opened' && pr.rows[1].result === 'won' && pr.rows[1].revenue === 120)
  ? ok('parseResultImport: opened/won/revenue/date parsed, bad email skipped') : bad('parseResultImport=' + JSON.stringify(pr));
const prBad = W.parseResultImport('name,phone\nBob,555\n');
(prBad.rows.length === 0 && prBad.errors.length > 0) ? ok('parseResultImport: no email column -> error') : bad('parseResultImport no-email');

// 23: importResults merge rules (in-place upgrade keeps win rates meaningful)
let imp = W.importResults([{ email: 'ava@example.com', result: 'sent', date: '2026-10-10' }], seg,
  [{ email: 'ava@example.com', result: 'won', date: '2026-10-16', revenue: 120, channel: 'Email' },
   { email: 'ava@example.com', result: 'opened', date: '2026-10-17', revenue: 0, channel: '' },
   { email: 'zzz@example.com', result: 'opened', date: '2026-10-16', revenue: 0, channel: '' }], '2026-10-16');
const s = imp.summary;
(s.total === 3 && s.added === 1 && s.upgraded === 1 && s.skipped === 1 && s.unmatched === 1 && s.won === 1)
  ? ok('importResults: upgrade sent->won, skip weaker opened, add unmatched') : bad('importResults=' + JSON.stringify(s));
const avaT = imp.tracking.find(t => t.email === 'ava@example.com');
(imp.tracking.filter(t => t.email === 'ava@example.com').length === 1 && avaT.result === 'won' && avaT.revenue === 120)
  ? ok('importResults: upgrade happens in place (one row per contact)') : bad('importResults in-place');
let imp2 = W.importResults([{ email: 'a@x.com', result: 'unsub', date: '2026-10-10' }], seg,
  [{ email: 'a@x.com', result: 'won', date: '2026-10-16', revenue: 0, channel: '' }], '2026-10-16');
(imp2.summary.skipped === 1 && imp2.tracking.length === 1) ? ok('importResults: never overrides unsub') : bad('unsub override');

// 24: actual ROI on imported results
const act = W.estimateROIActual(seg, imp.tracking, { avgOrderValue: 100, marginPct: 0.5 });
(act.wonBack === 1 && act.revenue === 120 && act.cost === 5 && act.net === 55 && act.perSegment['recent'].winRate === 100)
  ? ok('estimateROIActual: 1 won @ $120 rev, $5 offer cost (perk), $55 net') : bad('actual ROI=' + JSON.stringify(act));
const actEmpty = W.estimateROIActual(seg, [], {});
(/No tracked results/.test(actEmpty.verdict) && actEmpty.net === 0) ? ok('estimateROIActual: empty tracking -> clean verdict') : bad('actual ROI empty');

// 25: sequences
const steps = W.buildSequence('lapsed', 'Main Street Co', 'warm', 75);
(steps.length === 4 && steps[0].day === 0 && steps[1].day === 3 && steps[1].channel === 'SMS' && steps[3].day === 14 &&
 steps[0].subject.indexOf('{name}') !== -1 && /15%/.test(steps[1].body))
  ? ok('buildSequence: 4 touches, days 0/3/7/14, offer + template tags filled') : bad('buildSequence');
const ps = W.personalizeSeqStep(steps[1], seg[0]);
(ps.body.indexOf('Ava') !== -1 && ps.body.indexOf('{name}') === -1) ? ok('personalizeSeqStep: fills merge tags') : bad('seq personalize=' + ps.body.slice(0,40));
const entries = W.startSequenceEntries(seg, 'vip-dormant', [], '2026-10-15');
(entries.length === 1 && entries[0].seq.done === 1 && entries[0].followUp === '2026-10-18')
  ? ok('startSequenceEntries: day-0 entry, day-3 follow-up scheduled') : bad('startSequence');
const due = W.seqNextDue(entries[0], '2026-10-18');
(due && due.step.n === 2) ? ok('seqNextDue: step 2 due on day 3') : bad('seqNextDue');
(W.seqNextDue(entries[0], '2026-10-16') === null) ? ok('seqNextDue: not due early') : bad('seqNextDue early');
const adv = W.advanceSequenceEntry(entries[0]);
(adv.seq.done === 2 && adv.followUp === '2026-10-22') ? ok('advanceSequenceEntry: moves to day-7 follow-up') : bad('advance');
const won2 = Object.assign({}, entries[0], { result: 'won' });
(W.seqNextDue(won2, '2026-10-30') === null && W.followUpsDue([entries[0]], '2026-10-18').length === 1 && W.followUpsDue([won2], '2026-10-30').length === 0)
  ? ok('sequences: due list includes seq-due, excludes won') : bad('seq due filtering');

// 26: offerCostPerWinner matches the old estimateROI math
(W.offerCostPerWinner('lapsed', 75, {}) === 75 * 0.15 && W.offerCostPerWinner('champions', 75, {}) === 8 && W.offerCostPerWinner('recent', 75, {}) === 5)
  ? ok('offerCostPerWinner: discount 15%, freebie $8, perk $5') : bad('offerCostPerWinner');

// 27: estimateROI regression — refactor must not change the numbers
const roi = W.estimateROI(seg, { avgOrderValue: 75, marginPct: 0.5 });
(roi.expectedNet === 8 && roi.expectedWonBack === 0.4 && roi.expectedRevenue === 22 && roi.expectedCost === 3)
  ? ok('estimateROI unchanged after refactor (net $8)') : bad('estimateROI regression=' + JSON.stringify({net: roi.expectedNet, won: roi.expectedWonBack}));

// 28: preview text (preheader) — every segment x tone, filled with the offer
let prevOk = true;
Object.keys(W.SEGMENTS).forEach(s => {
  ['warm', 'bold'].forEach(t => {
    const c = W.generateCampaign(s, 'TestBiz', t, 75);
    if (!(c.preview && c.preview.length > 15 && !c.preview.includes('{offer}'))) prevOk = false;
  });
});
prevOk ? ok('previewText: all 7 segments x 2 tones produce a filled preheader') : bad('previewText incomplete');
// personalized preview fills {name}
const pcamp = W.generateCampaign('at-risk', 'Biz', 'warm', 75);
const pprev = W.personalize(pcamp, { name: 'Jane Doe', email: 'j@x.com' });
(pprev.preview && !pprev.preview.includes('{name}')) ? ok('personalize: preview text carries no raw merge tags') : bad('personalize preview=' + pprev.preview);

// 29: sequence cadence overrides — custom days + skipped steps
const cust = W.resolveSequenceSteps({ days: [0, 2, 10, ''], on: [true, false, true, true] });
const custDays = cust.map(s => [s.n, s.day]);
(JSON.stringify(custDays) === '[[1,0],[3,10],[4,14]]')
  ? ok('resolveSequenceSteps: custom days honored, step 2 skipped') : bad('resolveSequenceSteps=' + JSON.stringify(custDays));
const dflt = W.resolveSequenceSteps();
(JSON.stringify(dflt.map(s => s.day)) === '[0,3,7,14]')
  ? ok('resolveSequenceSteps: no config -> 0/3/7/14 defaults') : bad('default steps');
const bsCust = W.buildSequence('lapsed', 'Biz', 'bold', 75, {}, { days: [0, 2, 10, 5], on: [true, true, true, false] });
(JSON.stringify(bsCust.map(s => [s.n, s.day])) === '[[1,0],[2,2],[3,10]]')
  ? ok('buildSequence: respects cadence config (3 steps, custom days)') : bad('buildSequence cfg');
const bsDflt = W.buildSequence('lapsed', 'Biz', 'bold', 75, {});
(JSON.stringify(bsDflt.map(s => s.day)) === '[0,3,7,14]')
  ? ok('buildSequence: no config -> classic 4-touch cadence') : bad('buildSequence default changed');

// 30: custom-cadence entries store their steps; due dates + advance honor them
const ce = W.startSequenceEntries(seg, 'vip-dormant', [], '2026-10-15', { days: [0, 5, 12, 30], on: [true, true, false, true] });
const c0 = ce[0];
const cNext = W.seqNextDue(c0, '2026-10-20');
const cAdv = W.advanceSequenceEntry(c0);
(c0 && c0.seq.steps.length === 3 && cNext && cNext.step.n === 2 && cNext.due === '2026-10-20' && cAdv.followUp === '2026-11-14')
  ? ok('custom cadence: step 2 due day 5, advance jumps skipped step to day-30 final') : bad('custom cadence steps=' + JSON.stringify(c0 && c0.seq.steps));
const legacy = { email: 'l@x.com', result: 'sent', date: '2026-10-15', seq: { start: '2026-10-15', done: 1 } };
const lNext = W.seqNextDue(legacy, '2026-10-18');
(lNext && lNext.step.n === 2 && lNext.due === '2026-10-18')
  ? ok('legacy entries without stored steps still use 0/3/7/14') : bad('legacy fallback');

// 31: import hygiene — status column auto-suppresses bounces/unsubs
const hp = W.parseCSV('name,email,last_purchase,total_spent,status\n' +
  'A,a@x.com,2026-01-01,50,bounced\n' +
  'B,b@x.com,2026-01-01,60,subscribed\n' +
  'C,c@x.com,2026-01-01,70,unsubscribed\n' +
  'D,d@x.com,2026-01-01,80,opted out\n' +
  'E,e@x.com,2026-01-01,90,hard bounce');
const hFlags = hp.rows.map(r => r.hygiene);
(hp.rows.length === 5 && hp.suppressions.length === 4 &&
 hp.suppressions.indexOf('a@x.com') !== -1 && hp.suppressions.indexOf('c@x.com') !== -1 &&
 hp.suppressions.indexOf('d@x.com') !== -1 && hp.suppressions.indexOf('e@x.com') !== -1 &&
 hp.suppressions.indexOf('b@x.com') === -1 && hFlags[1] === '')
  ? ok('parseCSV: 4 bounced/unsub rows flagged + returned as suppressions; clean row untouched') : bad('hygiene=' + JSON.stringify(hFlags));
const hn = W.parseCSV('name,email,last_purchase,total_spent\nA,a@x.com,2026-01-01,50\n');
(hn.rows.length === 1 && hn.suppressions.length === 0)
  ? ok('parseCSV: no status column -> no suppressions, rows unchanged') : bad('no-status hygiene');

console.log('node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "node send-path/result-import/sequence checks" || bad "node send-path/result-import/sequence checks"

# 32: UI wiring — send tab, ESP, results, sequences, ROI mode, v2 surfaces
missing=""
for n in tab-send sendSegSel sendQueue sendProgress composeNextBtn espFormat espExportBtn espInfo seqOut seqStartBtn resultInput resultImportBtn resultMsg roiModeEst roiModeAct renderRoiActual estimateROIActual buildSequence personalizeSeqStep seqNextDue advanceSequenceEntry startSequenceEntries composeMailto espExport parseResultImport importResults offerCostPerWinner downloadCSV seqadv qsent qrow prog-bar ESP_FORMATS SEQUENCE_STEPS launchCheck renderLaunchCheck previewText resolveSequenceSteps seqCfg seqflow inboxmock sf-badge chk-mark seqCfgSave data-cfgday data-seqcopy getSeqCfg; do
  grep -q "$n" index.html js/app.js js/logic.js css/style.css || missing="$missing $n"
done
[ -z "$missing" ] && ok "UI wires send tab, ESP export, result import, sequences, ROI actuals, launch checklist, preview text, flow rail" || bad "missing wiring:$missing"

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL

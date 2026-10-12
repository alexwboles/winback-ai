#!/usr/bin/env bash
# WinBack AI smoke tests — 12 checks. Fails fast on first failure.
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

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL

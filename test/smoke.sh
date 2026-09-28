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

console.log('node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "node logic checks" || bad "node logic checks"

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL

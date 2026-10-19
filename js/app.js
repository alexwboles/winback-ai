/* WinBack AI — UI glue. All state in localStorage. */
(function () {
  'use strict';
  var W = window.Winback;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    customers: [],      // segmented
    segSel: 'vip-dormant',
    sendSeg: 'vip-dormant', // send-tab segment
    tracking: [],
    sends: [],          // campaign sends: {segment, channel, count, date}
    suppressions: [],   // do-not-contact emails (lowercased)
    offers: {},         // custom per-segment offers: {seg: {value, rationale}}
    segQuery: '',
    segSort: { key: 'segment', dir: 'asc' },
    sendMarks: {},      // send-tab queue: email -> true (compose batch progress)
    seqCfg: {},         // send-tab cadence overrides: {seg: {days:[d0..d3], on:[bool x4]}}
    roiMode: 'est'      // 'est' | 'act'
  };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem('winback-ai') || '{}');
      if (s.bizName) $('bizName').value = s.bizName;
      if (s.tone) $('toneSel').value = s.tone;
      if (s.tracking) state.tracking = s.tracking;
      if (s.sends) state.sends = s.sends;
      if (s.suppressions) state.suppressions = s.suppressions;
      if (s.offers) state.offers = s.offers;
      if (s.sendMarks) state.sendMarks = s.sendMarks;
      if (s.seqCfg) state.seqCfg = s.seqCfg;
      if (s.roiMode) state.roiMode = s.roiMode;
      if (s.customers && s.customers.length) {
        state.customers = s.customers;
        state.sendSeg = s.sendSeg || state.segSel;
      }
      // render every tab's (possibly empty) state, even before any import,
      // so no tab ever shows a blank select or blank panel on first visit
      renderSegments(); renderSegSelect(); renderCampaign(); renderTracking(); renderPerf();
      renderSendSeg();
      renderSendSegSel(); renderSendQueue(); renderEspInfo(); renderSeq(); renderRoiMode();
      renderHeadStats(); renderLaunchCheck();
    } catch (e) { /* fresh start */ }
  }
  function save() {
    try {
      localStorage.setItem('winback-ai', JSON.stringify({
        bizName: $('bizName').value, tone: $('toneSel').value,
        customers: state.customers, tracking: state.tracking, sends: state.sends,
        suppressions: state.suppressions, offers: state.offers,
        sendMarks: state.sendMarks, sendSeg: state.sendSeg, roiMode: state.roiMode,
        seqCfg: state.seqCfg
      }));
    } catch (e) { /* storage full/blocked */ }
  }

  function renderHeadStats() {
    var el = $('headStats');
    if (!el) return;
    if (!state.customers.length) {
      el.innerHTML = '<span class="stat">Import your list to begin</span>';
      return;
    }
    var won = state.tracking.filter(function (t) { return t.result === 'won'; }).length;
    el.innerHTML =
      '<span class="stat"><b>' + state.customers.length + '</b> customers</span>' +
      '<span class="stat"><b>' + state.tracking.length + '</b> contacts logged</span>' +
      '<span class="stat"><b>' + won + '</b> won back</span>';
  }

  /* Tabs */
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      $('tab-' + b.dataset.tab).classList.add('active');
    });
  });
  function goTab(name) {
    document.querySelector('.tabs button[data-tab="' + name + '"]').click();
  }

  /* Import */
  var SAMPLE = 'name,email,last_purchase,total_spent,orders\n' +
    'Ava Martinez,ava@example.com,2026-09-10,1240,9\n' +
    'Liam Chen,liam@example.com,2026-08-20,180,2\n' +
    'Sofia Rossi,sofia@example.com,2026-05-01,960,7\n' +
    'Noah Kim,noah@example.com,2026-02-14,95,1\n' +
    'Emma Patel,emma@example.com,2025-10-30,1500,11\n' +
    'Lucas Brown,lucas@example.com,2025-04-12,60,1\n' +
    '"Garcia, Maria",maria@example.com,2026-07-07,320,3\n' +
    'Bad Row,bad-email,2026-01-01,50,1\n' +
    'Ava Martinez,ava@example.com,2026-09-10,1240,9';

  $('loadSample').addEventListener('click', function () { $('csvInput').value = SAMPLE; });

  $('parseBtn').addEventListener('click', function () {
    var parsed = W.parseCSV($('csvInput').value);
    var msg = [];
    if (parsed.errors.length) {
      msg.push('<div class="err">' + parsed.errors.length + ' row(s) skipped: ' +
        parsed.errors.slice(0, 4).map(escapeHtml).join('<br>') +
        (parsed.errors.length > 4 ? '<br>…and ' + (parsed.errors.length - 4) + ' more.' : '') + '</div>');
    }
    if (!parsed.rows.length) {
      $('importMsg').innerHTML = msg.join('') + '<div class="err">No valid customers found. Check the format.</div>';
      return;
    }
    state.customers = W.segmentCustomers(parsed.rows);
    state.sendSeg = state.segSel;
    // import-time hygiene: bounced/unsubscribed rows are auto-suppressed
    var hygAdded = 0;
    (parsed.suppressions || []).forEach(function (e) {
      if (!W.isSuppressed(state.suppressions, e)) {
        state.suppressions = W.suppressEmail(state.suppressions, e);
        hygAdded++;
      }
    });
    save(); renderHeadStats();
    renderSegments(); renderSegSelect(); renderCampaign();
    renderSendSegSel(); renderSendQueue(); renderSeq(); renderLaunchCheck();
    msg.push('<div class="ok"><b>' + parsed.rows.length + '</b> customers segmented. ' +
      'Head to Segments →</div>');
    if (hygAdded) {
      msg.push('<div class="ok"><b>' + hygAdded + '</b> address' + (hygAdded === 1 ? '' : 'es') +
        ' auto-suppressed from a bounce/unsubscribe status column — they stay out of every export and send queue.</div>');
    }
    $('importMsg').innerHTML = msg.join('');
    goTab('segments');
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Segments */
  var SORT_LABELS = { name: 'Customer', email: 'Email', lastPurchase: 'Last purchase', totalSpent: 'Spent', segment: 'Segment', score: 'Win score' };

  function scoreBadge(c) {
    var s = (c.score === null || c.score === undefined) ? W.winScore(c) : c.score;
    var cls = s >= 70 ? 'hi' : s >= 40 ? 'mid' : 'lo';
    return '<span class="score ' + cls + '" title="Likelihood to come back (0-100)">' + s + '</span>';
  }

  function renderSegments() {
    var grid = $('segGrid'), tbl = $('segTable');
    // backfill win scores for lists imported before scores existed
    state.customers.forEach(function (c) {
      if (c.score === null || c.score === undefined) c.score = W.winScore(c);
    });
    var counts = W.segmentCounts(state.customers);
    var order = Object.keys(W.SEGMENTS).sort(function (a, b) {
      return W.SEGMENTS[a].priority - W.SEGMENTS[b].priority;
    });
    grid.innerHTML = '';
    // $ at stake + expected recoverable per segment (non-suppressed, win-backable)
    var stake = {}, recover = {}, sendable = {};
    state.customers.forEach(function (c) {
      var key = c.segment;
      if (!SEGMENTS_SAFE(key)) return;
      if (W.isSuppressed(state.suppressions, c.email)) return;
      sendable[key] = (sendable[key] || 0) + 1;
      if (key === 'champions' || key === 'unknown') return;
      var spent = Number(c.totalSpent) || 0;
      var s = Number(c.score) || 0;
      stake[key] = (stake[key] || 0) + spent;
      recover[key] = (recover[key] || 0) + Math.round(s * spent) / 100;
    });
    function SEGMENTS_SAFE(k) { return !!W.SEGMENTS[k]; }
    order.forEach(function (key) {
      var n = counts[key] || 0;
      var d = document.createElement('div');
      d.className = 'seg-card' + (state.segSel === key ? ' sel' : '');
      var moneyHtml = '';
      if (stake[key] > 0) {
        moneyHtml = '<div class="seg-money"><span><b>$' + Math.round(stake[key]).toLocaleString('en-US') +
          '</b> at stake</span><span class="rec"><b>$' + Math.round(recover[key] || 0).toLocaleString('en-US') +
          '</b> recoverable</span></div>';
      } else if (sendable[key] > 0) {
        moneyHtml = '<div class="seg-money"><span>' + sendable[key] + ' sendable</span></div>';
      }
      d.innerHTML = '<h3><span class="pill ' + key + '">' + W.SEGMENTS[key].label + '</span></h3>' +
        '<div class="count">' + n + '</div>' + moneyHtml + '<p>' + W.SEGMENTS[key].blurb + '</p>';
      d.addEventListener('click', function () {
        state.segSel = key; renderSegments(); renderSegSelect(); renderCampaign(); goTab('campaign');
      });
      grid.appendChild(d);
    });

    var rows = W.sortCustomers(
      W.searchCustomers(state.customers, state.segQuery),
      state.segSort.key, state.segSort.dir
    );
    function th(key) {
      var arrow = state.segSort.key === key ? (state.segSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return '<th data-sort="' + key + '" class="sortable">' + SORT_LABELS[key] + arrow + '</th>';
    }
    var html = '<div class="tbl-tools"><input type="search" id="segSearch" placeholder="Search name or email…" value="' +
      escapeHtml(state.segQuery) + '" aria-label="Search customers"></div>';
    html += '<table><tr>' + th('name') + th('email') + th('lastPurchase') + th('totalSpent') + th('segment') + th('score') + '</tr>';
    rows.forEach(function (c) {
      var supp = W.isSuppressed(state.suppressions, c.email) ? ' <span class="hint">(suppressed)</span>' : '';
      html += '<tr><td>' + escapeHtml(c.name || '—') + '</td><td>' + escapeHtml(c.email) +
        '</td><td>' + escapeHtml(c.lastPurchase || 'unknown') + '</td><td>$' + c.totalSpent.toFixed(0) +
        '</td><td><span class="pill ' + c.segment + '">' + c.segmentLabel + '</span>' + supp +
        '</td><td>' + scoreBadge(c) + '</td></tr>';
    });
    tbl.innerHTML = html + '</table>' +
      (rows.length ? '' : '<p class="hint">No customers match this search.</p>');
    $('segSearch').addEventListener('input', function (e) {
      state.segQuery = e.target.value;
      renderSegments();
      var s = $('segSearch');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    });    tbl.querySelectorAll('[data-sort]').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-sort');
        if (state.segSort.key === key) {
          state.segSort.dir = state.segSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.segSort = { key: key, dir: 'asc' };
        }
        renderSegments();
      });
    });
    renderTargets();
    renderDuplicates();
  }

  /* Top win-back targets: expected value = win score × lifetime spend. */
  function renderTargets() {
    var box = $('topTargets');
    if (!box) return;
    var tops = W.rankTargets(state.customers, state.suppressions, 10);
    if (!tops.length) { box.innerHTML = ''; return; }
    var maxEV = Math.max.apply(null, tops.map(function (t) { return t.expectedValue; })) || 1;
    var html = '<div class="card leaderboard"><p class="kicker">Strike list</p>' +
      '<h2>Top win-back targets</h2>' +
      '<p class="sub">Ranked by expected value (win score × lifetime spend). Contact these first.</p>' +
      '<ol class="lb">';
    tops.forEach(function (t, i) {
      html += '<li><span class="lb-rank">' + (i + 1) + '</span>' +
        '<div class="lb-main"><div class="lb-top"><strong>' + escapeHtml(t.name || '—') + '</strong>' +
        ' <span class="pill ' + t.segment + '">' + escapeHtml(t.segmentLabel) + '</span></div>' +
        '<div class="hint">' + escapeHtml(t.email) + '</div>' +
        '<div class="lb-bars"><div class="lb-bar"><i style="width:' + Math.round(t.score) + '%"></i></div>' +
        '<span class="lb-cap">win score ' + t.score + '</span></div>' +
        '<div class="lb-bars"><div class="lb-bar ev"><i style="width:' +
        Math.max(2, Math.round(t.expectedValue / maxEV * 100)) + '%"></i></div>' +
        '<span class="lb-cap">expected value</span></div></div>' +
        '<div class="lb-money"><b>$' + t.expectedValue.toFixed(0) + '</b>' +
        '<span class="hint">$' + t.totalSpent.toFixed(0) + ' lifetime</span></div></li>';
    });
    box.innerHTML = html + '</ol></div>';
  }

  /* Duplicate customers: same name, different emails — merge them. */
  function renderDuplicates() {
    var box = $('dupBox');
    if (!box) return;
    var pairs = W.findDuplicatePairs(state.customers);
    if (!pairs.length) { box.innerHTML = ''; return; }
    var html = '<div class="note"><b>' + pairs.length + ' possible duplicate' + (pairs.length === 1 ? '' : 's') + '</b> ' +
      '<span class="hint">— same name, different emails. Merging adds spend/orders together and re-segments.</span>' +
      '<table><tr><th>Keep</th><th>Merge in</th><th></th></tr>';
    pairs.forEach(function (p) {
      html += '<tr><td>' + escapeHtml(p[0].name) + '<br><span class="hint">' + escapeHtml(p[0].email) + '</span></td>' +
        '<td>' + escapeHtml(p[1].name) + '<br><span class="hint">' + escapeHtml(p[1].email) + '</span></td>' +
        '<td><button class="btn small" data-merge="' + escapeHtml(p[1].email) + '" data-keep="' + escapeHtml(p[0].email) + '">Merge</button></td></tr>';
    });
    box.innerHTML = html + '</table></div>';
    box.querySelectorAll('[data-merge]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var drop = btn.getAttribute('data-merge'), keep = btn.getAttribute('data-keep');
        if (!confirm('Merge ' + drop + ' into ' + keep + '? Spend and orders add up; the duplicate row is removed.')) return;
        state.customers = W.mergeCustomers(state.customers, keep, drop);
        save(); renderSegments(); renderHeadStats(); renderCampaign(); renderSendQueue(); renderSeq();
      });
    });
  }

  /* Campaign */
  function renderSegSelect() {
    var sel = $('segSel');
    sel.innerHTML = '';
    Object.keys(W.SEGMENTS).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key; o.textContent = W.SEGMENTS[key].label;
      if (key === state.segSel) o.selected = true;
      sel.appendChild(o);
    });
  }
  $('segSel').addEventListener('change', function () { state.segSel = $('segSel').value; renderCampaign(); });
  $('toneSel').addEventListener('change', function () { renderCampaign(); renderSendQueue(); renderSeq(); save(); });
  $('bizName').addEventListener('input', save);

  function copyText(btn, text) {
    function done() { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done();
    }
  }

  function renderCampaign() {
    var out = $('campaignOut');
    var seg = state.segSel || 'vip-dormant';
    var biz = $('bizName').value.trim() || 'our store';
    var tone = $('toneSel').value;
    var aov = parseFloat($('roiAov').value) || 75;
    var camp = W.generateCampaign(seg, biz, tone, aov, state.offers);
    var custom = state.offers[seg] || {};

    var inSeg = state.customers.filter(function (c) { return c.segment === seg; });
    var sendable = inSeg.filter(function (c) { return !W.isSuppressed(state.suppressions, c.email); });

    // Inbox mock: subject + preview text the way they land on a phone.
    var firstCust = sendable[0];
    var mockSubj = firstCust ? W.personalize(camp, firstCust).subjects[0] : camp.subjects[0];
    var mockPrev = firstCust ? W.personalize(camp, firstCust).preview : camp.preview;
    var inboxMock = '<div class="inboxmock"><div class="im-head"><span class="im-from">' + escapeHtml(biz) +
      '</span><span class="im-time">now</span></div>' +
      '<div class="im-subj">' + escapeHtml(mockSubj) + '</div>' +
      '<div class="im-prev">' + escapeHtml(mockPrev) + '</div></div>' +
      (firstCust
        ? '<p class="hint">Inbox preview for ' + escapeHtml(firstCust.email) + ' — subject + preview text, as it lands on a phone.</p>'
        : '<p class="hint">Inbox preview — subject + preview text, as it lands on a phone.</p>');

    var preview = sendable.slice(0, 3).map(function (c, i) {
      var p = W.personalize(camp, c);
      return '<div class="draft"><h4>Preview — ' + escapeHtml(c.email) +
        ' <button class="btn small ghost copybtn" data-copy="email" data-pi="' + i + '">Copy email</button></h4>' +
        '<b>Subject:</b> ' + escapeHtml(p.subjects[0]) + '\n\n' + escapeHtml(p.email) + '</div>';
    }).join('');

    out.innerHTML =
      '<div class="cmp-grid"><div class="cmp-left"><div class="note"><b>Offer:</b> ' + escapeHtml(camp.offer.value) +
      ' <span class="hint">— ' + escapeHtml(camp.offer.rationale) + '</span><br>' +
      '<b>' + inSeg.length + '</b> customers in this segment' +
      (sendable.length !== inSeg.length ? ' · <b>' + sendable.length + '</b> sendable (' + (inSeg.length - sendable.length) + ' suppressed)' : '') +
      '.</div>' +
      '<div class="btnrow"><button class="btn small" id="segCsvBtn">Export segment CSV</button></div>' +
      '<details class="offeredit"><summary>A/B test this segment</summary>' +
      '<p class="hint">Split the sendable customers into two deterministic groups — send variant A to one, variant B to the other. ' +
      'Tag each contact with its group in the Tracking tab; the comparison appears in campaign performance.</p>' +
      '<div class="btnrow"><button class="btn small" id="abSplitBtn">Split into A / B</button></div>' +
      '<div id="abOut"></div></details>' +
      '<details class="offeredit"><summary>Customize this segment\'s offer</summary>' +
      '<div class="row"><div><label>Offer text</label><input type="text" id="offerVal" value="' +
      escapeHtml(custom.value || '') + '" placeholder="e.g. 20% off, this week only"></div></div>' +
      '<div class="row"><div><label>Why this offer (shown under the offer)</label><input type="text" id="offerWhy" value="' +
      escapeHtml(custom.rationale || '') + '" placeholder="Optional rationale"></div></div>' +
      '<div class="btnrow"><button class="btn small" id="offerSave">Save offer</button>' +
      '<button class="btn small ghost" id="offerClear">Reset to default</button></div></details>' +
      '<div class="note"><b>Send checklist:</b> 1) Send from the <a href="#" id="goSend">Send tab</a> — mailto-batch compose in your own mail client, or an ESP-shaped CSV export. ' +
      '2) Follow up by SMS 3 days later to non-openers (or start the multi-touch sequence in the Send tab). 3) Log every send in the Tracking tab. 4) Don\'t email the same person twice in 14 days.</div>' +
      '</div><div class="cmp-right"><p class="kicker">Live drafts</p>' +
      '<div class="draft"><h4>Subject lines <button class="btn small ghost copybtn" data-copy="subjects">Copy</button> ' +
      '<button class="btn small ghost copybtn" data-copy="preview">Copy preview text</button></h4><ul class="subjects">' +
      camp.subjects.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>' +
      inboxMock + '</div>' +
      '<div class="draft"><h4>Email template <button class="btn small ghost copybtn" data-copy="email">Copy</button></h4>' +
      '<p class="hint">Merge tags: {name} = first name · {offer} = this segment\'s offer · {last_purchase} · {total_spent} · {segment}</p>' +
      escapeHtml(camp.email) + '</div>' +
      '<div class="draft"><h4>SMS template <button class="btn small ghost copybtn" data-copy="sms">Copy</button></h4>' +
      escapeHtml(camp.sms) + ' <span class="hint">(' + camp.sms.replace(/\{name\}/g, 'XXXX').length + ' chars)</span></div>' +
      (preview ? '<h3 style="margin-top:18px">Personalized previews</h3>' + preview : '<p class="hint">Import customers to see personalized previews.</p>') +
      '</div></div>';

    var goSend = $('goSend');
    if (goSend) goSend.addEventListener('click', function (e) { e.preventDefault(); goTab('send'); });
    $('segCsvBtn').addEventListener('click', function () {
      var res = W.segmentToCSV(state.customers, seg, state.suppressions);
      if (!res.count) { alert('Nobody sendable in this segment.'); return; }
      var blob = new Blob([res.csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'winback-' + seg + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('offerSave').addEventListener('click', function () {
      var val = $('offerVal').value.trim();
      if (!val) { alert('Enter the offer text first.'); return; }
      state.offers[seg] = { value: val, rationale: $('offerWhy').value.trim() };
      save(); renderCampaign();
    });
    $('offerClear').addEventListener('click', function () {
      delete state.offers[seg];
      save(); renderCampaign();
    });
    $('abSplitBtn').addEventListener('click', function () {
      var split = W.splitAB(sendable);
      function groupCard(label, list) {
        var emails = list.map(function (c) { return c.email; }).join(', ');
        return '<div class="draft"><h4>Group ' + label + ' — ' + list.length + ' customers ' +
          '<button class="btn small ghost" data-abcopy="' + label + '">Copy emails</button></h4>' +
          '<p class="hint">' + escapeHtml(emails.slice(0, 160)) + (emails.length > 160 ? '…' : '') + '</p></div>';
      }
      $('abOut').innerHTML = groupCard('A', split.a) + groupCard('B', split.b) +
        '<p class="hint">The split is deterministic — the same list always produces the same groups, so you can rebuild them any time.</p>';
      $('abOut').querySelectorAll('[data-abcopy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var list = btn.getAttribute('data-abcopy') === 'A' ? split.a : split.b;
          copyText(btn, list.map(function (c) { return c.email; }).join(', '));
        });
      });
    });

    out.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-copy');
        var text = kind === 'subjects' ? camp.subjects.join('\n') : camp[kind];
        // personalized copy buttons inside previews copy that preview's email.
        // The preview index is stored on the button itself: the A/B split also
        // renders .draft cards inside this container, so position-in-DOM is
        // not a reliable lookup.
        var pi = btn.getAttribute('data-pi');
        if (pi !== null && pi !== '') {
          var cust = sendable[Number(pi)];
          if (cust) text = W.personalize(camp, cust).email;
        }
        copyText(btn, text);
      });
    });
  }

  /* Tracking */
  $('trkAdd').addEventListener('click', function () {
    var email = $('trkEmail').value.trim().toLowerCase();
    if (!W.validateEmail(email)) { alert('Enter a valid email.'); return; }
    var cust = state.customers.find(function (c) { return c.email === email; });
    var result = $('trkResult').value;
    state.tracking.unshift({
      email: email,
      name: cust ? cust.name : '',
      segment: cust ? cust.segmentLabel : '—',
      date: $('trkDate').value || new Date().toISOString().slice(0, 10),
      channel: $('trkChannel').value,
      result: result,
      group: $('trkGroup').value || '',
      followUp: $('trkFollow').value || ''
    });
    if (result === 'unsub') {
      state.suppressions = W.suppressEmail(state.suppressions, email);
    }
    $('trkEmail').value = '';
    $('trkFollow').value = '';
    save(); renderTracking(); renderHeadStats(); renderSegments(); renderCampaign();
  });

  $('trkExport').addEventListener('click', function () {
    var csv = 'email,name,segment,date,channel,result,follow_up\n' + state.tracking.map(function (t) {
      return [t.email, '"' + (t.name || '').replace(/"/g, '""') + '"', t.segment, t.date, t.channel, t.result, t.followUp || ''].join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'winback-tracking.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  function renderSuppressionList(box) {
    if (!state.suppressions.length) return '';
    return '<div class="note"><b>Suppression list (' + state.suppressions.length + '):</b> ' +
      'these emails are excluded from segment exports and previews.' +
      '<div class="supp-list">' + state.suppressions.map(function (e) {
        return '<span class="supp">' + escapeHtml(e) +
          ' <button class="btn small ghost unsupp" data-email="' + escapeHtml(e) + '">remove</button></span>';
      }).join('') + '</div></div>';
  }

  function renderTracking() {
    var el = $('trkTable');
    var due = W.followUpsDue(state.tracking);
    var html = '';
    if (due.length) {
      html += '<div class="note due"><b>' + due.length + ' follow-up' + (due.length === 1 ? '' : 's') +
        ' due now:</b> ' + due.slice(0, 5).map(function (t) {
          return escapeHtml(t.email) + ' (' + escapeHtml(t.followUp) + ')';
        }).join(' · ') + (due.length > 5 ? ' · …' : '') + '</div>';
    }
    if (!state.tracking.length) {
      el.innerHTML = html + '<p class="hint">Nothing logged yet.</p>' + renderSuppressionList();
      bindUnsupp(el);
      return;
    }
    var won = state.tracking.filter(function (t) { return t.result === 'won'; }).length;
    html += '<p class="ok"><b>' + state.tracking.length + '</b> contacts logged · <b>' + won + '</b> won back</p>';
    html += '<table><tr><th>Email</th><th>Segment</th><th>Date</th><th>Channel</th><th>Group</th><th>Result</th><th>Follow-up</th><th>Sequence</th></tr>';
    var today = W.todayISO();
    state.tracking.forEach(function (t, idx) {
      var dueMark = (t.followUp && t.followUp <= today && t.result !== 'won' && t.result !== 'unsub')
        ? ' <span class="pill lost">due</span>' : '';
      var seqCell = '—';
      if (t.seq && t.seq.start) {
        var done = t.seq.done || 0;
        var stepTotal = (t.seq.steps && t.seq.steps.length) ? t.seq.steps.length : 4;
        var next = W.seqNextDue(t, today);
        seqCell = 'Step ' + done + '/' + stepTotal +
          (next ? ' · next ' + escapeHtml(next.due) : (done >= stepTotal ? ' · done' : '')) +
          (next ? ' <button class="btn small ghost seqadv" data-idx="' + idx + '">Step done</button>' : '');
      }
      html += '<tr><td>' + escapeHtml(t.email) + '</td><td>' + escapeHtml(t.segment) +
        '</td><td>' + escapeHtml(t.date) + '</td><td>' + escapeHtml(t.channel) +
        '</td><td>' + escapeHtml(t.group || '—') +
        '</td><td>' + escapeHtml(t.result) + '</td><td>' + escapeHtml(t.followUp || '—') + dueMark +
        '</td><td>' + seqCell + '</td></tr>';
    });
    el.querySelectorAll('.seqadv').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-idx'));
        state.tracking[i] = W.advanceSequenceEntry(state.tracking[i]);
        save(); renderTracking(); renderHeadStats();
      });
    });
    el.innerHTML = html + '</table>' + renderSuppressionList();
    bindUnsupp(el);
    renderPerf();
  }

  function renderPerf() {
    var box = $('sendPerf');
    if (!box) return;
    var stats = W.campaignStats(state.customers, state.sends, state.tracking);
    if (!stats.length) {
      box.innerHTML = '<p class="hint">No sends logged yet — log a send above and results will appear here as you track contacts.</p>';
      return;
    }
    var html = '<table><tr><th>Segment</th><th>Sent</th><th>Contacts logged</th><th>Responded</th><th>Won back</th><th>Win rate</th></tr>';
    stats.forEach(function (r) {
      html += '<tr><td><span class="pill">' + escapeHtml(r.label) + '</span></td><td>' + r.sent +
        '</td><td>' + r.contacted + '</td><td>' + r.responded + '</td><td><b>' + r.won +
        '</b></td><td>' + r.winRate + '%</td></tr>';
    });
    box.innerHTML = html + '</table>' +
      '<p class="hint">Win rate = won ÷ contacts logged. Log contacts in the form above with matching customer emails to attribute results.</p>' +
      renderAB();
  }

  /* A/B comparison from group-tagged tracking entries. */
  function renderAB() {
    var a = state.tracking.filter(function (t) { return t.group === 'A'; });
    var b = state.tracking.filter(function (t) { return t.group === 'B'; });
    if (!a.length && !b.length) return '';
    var cmp = W.abCompare(a, b);
    return '<div class="note"><b>A/B test:</b> group A — ' + cmp.a.won + '/' + cmp.a.total + ' won (' + cmp.a.rate + '%) · ' +
      'group B — ' + cmp.b.won + '/' + cmp.b.total + ' won (' + cmp.b.rate + '%).<br>' +
      escapeHtml(cmp.verdict) + '</div>';
  }

  function renderSendSeg() {
    var sel = $('sendSeg');
    if (!sel) return;
    sel.innerHTML = Object.keys(W.SEGMENTS).map(function (k) {
      return '<option value="' + k + '">' + W.SEGMENTS[k].label + '</option>';
    }).join('');
  }

  $('sendAdd').addEventListener('click', function () {
    var count = Number($('sendCount').value) || 0;
    if (count < 1) { alert('Enter how many customers this send went to.'); return; }
    state.sends = W.logSend(state.sends, {
      segment: $('sendSeg').value,
      channel: $('sendChannel').value,
      count: count,
      date: $('sendDate').value || undefined
    });
    $('sendCount').value = '';
    save(); renderPerf(); renderHeadStats();
  });

  function bindUnsupp(root) {
    root.querySelectorAll('.unsupp').forEach(function (b) {
      b.addEventListener('click', function () {
        state.suppressions = W.unsuppressEmail(state.suppressions, b.getAttribute('data-email'));
        save(); renderTracking(); renderSegments(); renderCampaign(); renderSendQueue(); renderSeq(); renderLaunchCheck(); renderHeadStats();
      });
    });
  }

  /* ---------- Send tab: mailto-batch composer ---------- */
  function sendQueueList() {
    var seg = state.sendSeg || 'vip-dormant';
    return state.customers.filter(function (c) {
      return c.segment === seg && !W.isSuppressed(state.suppressions, c.email);
    });
  }
  function sendCampaign() {
    var seg = state.sendSeg || 'vip-dormant';
    var biz = $('bizName').value.trim() || 'our store';
    var aov = parseFloat($('roiAov').value) || 75;
    return W.generateCampaign(seg, biz, $('toneSel').value, aov, state.offers);
  }

  function renderSendSegSel() {
    var sel = $('sendSegSel');
    if (!sel) return;
    sel.innerHTML = '';
    Object.keys(W.SEGMENTS).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key; o.textContent = W.SEGMENTS[key].label;
      if (key === state.sendSeg) o.selected = true;
      sel.appendChild(o);
    });
  }
  $('sendSegSel').addEventListener('change', function () {
    state.sendSeg = $('sendSegSel').value;
    save(); renderSendQueue(); renderSeq(); renderLaunchCheck();
  });

  function renderSendQueue() {
    var box = $('sendQueue'), prog = $('sendProgress');
    if (!box || !prog) return;
    var list = sendQueueList();
    var camp = sendCampaign();
    var marked = list.filter(function (c) { return state.sendMarks[c.email]; }).length;
    var pct = list.length ? Math.round(marked / list.length * 100) : 0;
    prog.innerHTML = '<div class="prog"><div class="prog-row"><span><b>' + marked + '</b> of ' + list.length +
      ' composed</span><span class="hint">' + pct + '%</span></div>' +
      '<div class="prog-bar"><i style="width:' + pct + '%"></i></div></div>' +
      (list.length ? '<p class="hint">Click Compose to open a pre-written, personalized email in your mail client. Mark sent as you go — sends log to the Tracking tab automatically.</p>'
        : '<p class="hint">Nobody sendable in this segment — import a list or pick another segment.</p>');
    var shown = list.slice(0, 100);
    box.innerHTML = shown.map(function (c) {
      var m = W.composeMailto(c, camp);
      var done = !!state.sendMarks[c.email];
      return '<div class="qrow' + (done ? ' done' : '') + '">' +
        '<div class="q-main"><strong>' + escapeHtml(c.name || '—') + '</strong>' +
        ' <span class="pill ' + c.segment + '">' + escapeHtml(c.segmentLabel) + '</span>' +
        '<div class="hint">' + escapeHtml(c.email) + '</div></div>' +
        '<a class="btn small ghost" href="' + escapeHtml(m.mailto) + '">Compose</a>' +
        (done ? '<span class="hint">sent</span>'
          : '<button class="btn small qsent" data-email="' + escapeHtml(c.email) + '">Mark sent</button>') +
        '</div>';
    }).join('') + (list.length > shown.length ? '<p class="hint">Showing the first 100 — export the segment CSV for the rest.</p>' : '');
    box.querySelectorAll('.qsent').forEach(function (b) {
      b.addEventListener('click', function () {
        var email = b.getAttribute('data-email');
        var cust = list.find(function (c) { return c.email === email; });
        var today = W.todayISO();
        var already = state.tracking.some(function (t) { return t.email === email && t.date === today && t.channel === 'Email'; });
        if (!already && cust) {
          state.tracking.unshift({
            email: email, name: cust.name || '', segment: cust.segmentLabel,
            date: today, channel: 'Email', result: 'sent', group: '', followUp: ''
          });
        }
        state.sendMarks[email] = true;
        save(); renderSendQueue(); renderTracking(); renderHeadStats(); renderLaunchCheck();
      });
    });
  }

  $('composeNextBtn').addEventListener('click', function () {
    var list = sendQueueList();
    var next = list.find(function (c) { return !state.sendMarks[c.email]; });
    if (!next) { alert(list.length ? 'Everyone in this segment is marked sent.' : 'Nobody sendable in this segment.'); return; }
    window.location.href = W.composeMailto(next, sendCampaign()).mailto;
  });

  /* ---------- Send tab: ESP-shaped export ---------- */
  function renderEspInfo() {
    var box = $('espInfo');
    if (!box) return;
    var fmt = W.ESP_FORMATS[$('espFormat').value] || W.ESP_FORMATS['mailchimp'];
    box.innerHTML = '<details class="offeredit" open><summary>Column mapping — ' + escapeHtml(fmt.label) + '</summary>' +
      '<p class="hint">' + escapeHtml(fmt.note) + '</p>' +
      '<table><tr><th>CSV column</th><th>What it is</th></tr>' +
      fmt.columns.concat(fmt.extra).map(function (c) {
        return '<tr><td><code>' + escapeHtml(c) + '</code></td><td>' + escapeHtml(espColDoc(c)) + '</td></tr>';
      }).join('') + '</table></details>';
  }
  function espColDoc(col) {
    var c = String(col).toLowerCase();
    if (c.indexOf('segment') !== -1) return 'Win-back segment label (e.g. Dormant VIPs)';
    if (c.indexOf('offer') !== -1) return 'The offer drafted for this segment';
    if (c.indexOf('score') !== -1) return 'Win score 0–100 (likelihood to come back)';
    if (c.indexOf('subject') !== -1) return 'First subject line for reference';
    if (c.indexOf('last purchase') !== -1) return 'Most recent purchase date (YYYY-MM-DD)';
    if (c.indexOf('total spent') !== -1) return 'Lifetime spend';
    if (c.indexOf('orders') !== -1) return 'Order count';
    if (c.indexOf('tags') !== -1) return 'Tags applied on import (winback,<segment>)';
    if (c.indexOf('email') !== -1) return 'Customer email';
    if (c.indexOf('first') !== -1) return 'First name';
    if (c.indexOf('last') !== -1) return 'Last name';
    return 'Contact field';
  }
  $('espFormat').addEventListener('change', renderEspInfo);
  $('espExportBtn').addEventListener('click', function () {
    var res = W.espExport(state.customers, state.sendSeg, sendCampaign(), {
      format: $('espFormat').value, suppressions: state.suppressions
    });
    if (!res.count) { alert('Nobody sendable in this segment.'); return; }
    downloadCSV(res.csv, 'winback-' + state.sendSeg + '-' + $('espFormat').value + '.csv');
  });

  function downloadCSV(csv, filename) {
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- Send tab: follow-up sequences (flow-builder timeline) ---------- */
  function getSeqCfg(seg) {
    var cfg = state.seqCfg[seg] || {};
    var days = (cfg.days || []).slice(0, 4);
    var on = (cfg.on || []).slice(0, 4);
    while (days.length < 4) days.push(W.SEQUENCE_STEPS[days.length].day);
    while (on.length < 4) on.push(true);
    return { days: days, on: on };
  }

  function renderSeq() {
    var box = $('seqOut');
    if (!box) return;
    var seg = state.sendSeg || 'vip-dormant';
    var biz = $('bizName').value.trim() || 'our store';
    var aov = parseFloat($('roiAov').value) || 75;
    var tone = $('toneSel').value;
    var cfg = getSeqCfg(seg);
    var steps = W.buildSequence(seg, biz, tone, aov, state.offers, cfg);
    var list = sendQueueList();

    // Timeline rail, Klaviyo-flow-builder style: day badges on a connector rail.
    var html = '<div class="seqflow"><div class="sf-rail">';
    steps.forEach(function (s, i) {
      var gap = i === 0 ? null : s.day - steps[i - 1].day;
      html += '<div class="sf-node">' +
        '<div class="sf-badge">' + (gap === null ? 'DAY 0' : '+' + gap + 'D') + '</div>' +
        '<div class="sf-card">' +
          '<div class="sf-head"><span class="sf-step">Step ' + s.n + '</span>' +
          '<span class="pill">' + escapeHtml(s.channel) + '</span>' +
          '<span class="hint">goes out day ' + s.day + '</span>' +
          '<button class="btn small ghost copybtn" data-seqcopy="' + i + '">Copy</button></div>' +
          '<div class="sf-label">' + escapeHtml(s.label) + '</div>' +
          (s.subject ? '<div class="sf-subj"><b>Subject:</b> ' + escapeHtml(s.subject) + '</div>' : '') +
          (s.preview && s.channel !== 'SMS' ? '<div class="sf-prev">' + escapeHtml(s.preview) + '</div>' : '') +
          '<div class="sf-body">' + escapeHtml(s.body) + '</div>' +
        '</div></div>';
    });
    html += '</div></div>';

    // Cadence editor: day offsets + skip toggles, saved per segment.
    var def = W.SEQUENCE_STEPS;
    html += '<details class="offeredit" id="seqCadence"><summary>Edit this cadence</summary>' +
      '<p class="hint">Change the day each touch goes out, or skip a touch entirely — like a flow builder. Saved per segment; contacts already in the sequence keep the cadence they started with.</p>' +
      def.map(function (d, i) {
        return '<div class="row"><div style="flex:2"><label>Step ' + d.n + ' — ' + d.label + ' (' + d.channel + ')</label>' +
          '<input type="number" min="0" max="90" data-cfgday="' + i + '" value="' + cfg.days[i] + '" aria-label="Day for step ' + d.n + '"></div>' +
          '<div><label>&nbsp;</label><label class="chkline"><input type="checkbox" data-cfgon="' + i + '"' +
          (cfg.on[i] ? ' checked' : '') + '> Send this step</label></div></div>';
      }).join('') +
      '<div class="btnrow"><button class="btn small" id="seqCfgSave">Save cadence</button>' +
      '<button class="btn small ghost" id="seqCfgReset">Reset to 0/3/7/14</button></div></details>';

    html += '<div class="note"><span class="hint">Only non-responders get the next touch. A contact who buys or unsubscribes drops out automatically — the Tracking tab shows each contact\'s step and next due date.</span></div>';
    html += '<div class="btnrow"><button class="btn" id="seqStartBtn">Start sequence for ' + list.length + ' sendable contacts</button></div>';
    box.innerHTML = html;

    box.querySelectorAll('[data-seqcopy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = steps[Number(btn.getAttribute('data-seqcopy'))];
        copyText(btn, (s.subject ? 'Subject: ' + s.subject + '\n\n' : '') + s.body);
      });
    });
    $('seqCfgSave').addEventListener('click', function () {
      var days = [], on = [];
      box.querySelectorAll('[data-cfgday]').forEach(function (inp) {
        days.push(inp.value === '' ? W.SEQUENCE_STEPS[days.length].day : Number(inp.value));
      });
      box.querySelectorAll('[data-cfgon]').forEach(function (inp) { on.push(inp.checked); });
      if (!on.some(function (x) { return x; })) { alert('Keep at least one step enabled.'); return; }
      state.seqCfg[seg] = { days: days, on: on };
      save(); renderSeq(); renderLaunchCheck();
    });
    $('seqCfgReset').addEventListener('click', function () {
      delete state.seqCfg[seg];
      save(); renderSeq(); renderLaunchCheck();
    });
    $('seqStartBtn').addEventListener('click', function () {
      var tracked = {};
      state.tracking.forEach(function (t) { tracked[t.email] = true; });
      var fresh = W.startSequenceEntries(state.customers, seg, state.suppressions, undefined, state.seqCfg[seg])
        .filter(function (e) { return !tracked[e.email]; });
      if (!fresh.length) { alert('All sendable contacts already have tracking entries.'); return; }
      var touchCount = W.resolveSequenceSteps(state.seqCfg[seg]).length;
      if (!confirm('Start the ' + touchCount + '-touch sequence for ' + fresh.length +
        ' contacts? This logs the day-0 send for each and schedules the next touch.')) return;
      state.tracking = fresh.concat(state.tracking);
      save(); renderSeq(); renderTracking(); renderHeadStats(); renderSendQueue(); renderLaunchCheck();
    });
  }

  /* ---------- Send tab: launch checklist (Mailchimp pre-flight pattern) ---------- */
  function renderLaunchCheck() {
    var box = $('launchCheck');
    if (!box) return;
    var seg = state.sendSeg || 'vip-dormant';
    var label = W.SEGMENTS[seg] ? W.SEGMENTS[seg].label : seg;
    var list = sendQueueList();
    var touches = W.resolveSequenceSteps(state.seqCfg[seg]).length;
    function row(ok, title, sub, fixTab) {
      return '<div class="chk' + (ok ? ' ok' : ' no') + '"><span class="chk-mark">' + (ok ? '✓' : '×') + '</span>' +
        '<div class="chk-main"><strong>' + escapeHtml(title) + '</strong><span class="hint">' + escapeHtml(sub) + '</span></div>' +
        (ok || !fixTab ? '' : '<button class="btn small ghost" data-fix="' + fixTab + '">Fix</button>') + '</div>';
    }
    var rows = [
      row(list.length > 0, 'Audience ready',
        list.length > 0
          ? list.length + ' sendable in ' + label + ' — suppressed addresses excluded'
          : 'No sendable contacts in ' + label + ' — import a list or pick another segment.', 'import'),
      row(state.customers.length > 0, 'Drafts ready',
        state.customers.length > 0
          ? 'Day-0 email, SMS, 3 subject lines + preview text generated for ' + label
          : 'Import customers to generate the drafts.', 'campaign'),
      row(touches > 0, 'Cadence set',
        touches + '-touch sequence' + (state.seqCfg[seg] ? ' with custom timing' : ' (day 0/3/7/14)') +
        ' — non-responders only, buyers and unsubs drop out automatically.', null),
      row(true, 'Tracking sheet',
        state.tracking.length + ' contacts logged — results feed ROI Actuals automatically.', 'tracking')
    ];
    box.innerHTML = rows.join('');
    box.querySelectorAll('[data-fix]').forEach(function (b) {
      b.addEventListener('click', function () { goTab(b.getAttribute('data-fix')); });
    });
  }

  /* ---------- Tracking tab: result import ---------- */
  $('resultImportBtn').addEventListener('click', function () {
    var parsed = W.parseResultImport($('resultInput').value);
    var msg = [];
    if (parsed.errors.length) {
      msg.push('<div class="err">' + parsed.errors.length + ' row(s) skipped: ' +
        parsed.errors.slice(0, 4).map(escapeHtml).join('<br>') +
        (parsed.errors.length > 4 ? '<br>…and ' + (parsed.errors.length - 4) + ' more.' : '') + '</div>');
    }
    if (!parsed.rows.length) {
      $('resultMsg').innerHTML = msg.join('') + '<div class="err">No valid results to import.</div>';
      return;
    }
    var res = W.importResults(state.tracking, state.customers, parsed.rows);
    state.tracking = res.tracking;
    var sm = res.summary;
    save(); renderTracking(); renderHeadStats();
    $('resultMsg').innerHTML = msg.join('') + '<div class="ok"><b>' + sm.total + '</b> result rows processed: ' +
      sm.added + ' new, ' + sm.upgraded + ' upgraded, ' + sm.skipped + ' skipped' +
      (sm.unmatched ? ', ' + sm.unmatched + ' email(s) not in the customer list' : '') +
      ' · <b>' + sm.won + '</b> purchases recorded. ROI Actuals now runs on these.</div>';
  });

  /* ROI */
  function renderRoiMode() {
    var est = state.roiMode !== 'act';
    $('roiModeEst').classList.toggle('active', est);
    $('roiModeAct').classList.toggle('active', !est);
    $('roiModeEst').classList.toggle('ghost', !est);
    $('roiModeAct').classList.toggle('ghost', est);
  }
  $('roiModeEst').addEventListener('click', function () { state.roiMode = 'est'; save(); renderRoiMode(); renderRoi(); });
  $('roiModeAct').addEventListener('click', function () { state.roiMode = 'act'; save(); renderRoiMode(); renderRoi(); });

  function renderRoi() {
    var out = $('roiOut');
    if (!state.customers.length) { out.innerHTML = '<p class="err">Import customers first.</p>'; return; }
    if (state.roiMode === 'act') return renderRoiActual(out);
    var r = W.estimateROI(state.customers, {
      avgOrderValue: parseFloat($('roiAov').value) || 75,
      marginPct: parseFloat($('roiMargin').value)
    });
    var html = '<div class="kpis">' +
      kpi(r.customers, 'Customers in list') +
      kpi(r.expectedWonBack, 'Expected win-backs') +
      kpi('$' + r.expectedRevenue, 'Expected revenue') +
      kpi('$' + r.expectedCost, 'Offer cost') +
      kpi('$' + r.expectedNet, 'Expected net') + '</div>';
    html += '<table><tr><th>Segment</th><th>Count</th><th>Won back</th><th>Revenue</th><th>Cost</th><th>Net</th><th>Offer</th></tr>';
    Object.keys(r.perSegment).forEach(function (seg) {
      var p = r.perSegment[seg];
      html += '<tr><td>' + p.label + '</td><td>' + p.count + '</td><td>' + p.expectedWon +
        '</td><td>$' + p.revenue + '</td><td>$' + p.cost + '</td><td>$' + p.net +
        '</td><td>' + escapeHtml(p.offer) + '</td></tr>';
    });
    html += '</table><div class="note">' + escapeHtml(r.verdict) + '</div>';
    out.innerHTML = html;
  }

  function renderRoiActual(out) {
    var r = W.estimateROIActual(state.customers, state.tracking, {
      avgOrderValue: parseFloat($('roiAov').value) || 75,
      marginPct: parseFloat($('roiMargin').value)
    });
    var html = '<div class="kpis">' +
      kpi(r.contacted, 'Contacts logged') +
      kpi(r.wonBack, 'Actually won back') +
      kpi('$' + r.revenue, 'Revenue (real)') +
      kpi('$' + r.cost, 'Offer cost') +
      kpi('$' + r.net, 'Net (real)') + '</div>';
    var keys = Object.keys(r.perSegment);
    if (keys.length) {
      html += '<table><tr><th>Segment</th><th>Logged</th><th>Won back</th><th>Win rate</th><th>Revenue</th><th>Cost</th><th>Net</th></tr>';
      keys.forEach(function (seg) {
        var p = r.perSegment[seg];
        html += '<tr><td>' + escapeHtml(p.label) + '</td><td>' + p.contacted + '</td><td><b>' + p.won +
          '</b></td><td>' + p.winRate + '%</td><td>$' + p.revenue + '</td><td>$' + p.cost +
          '</td><td>$' + p.net + '</td></tr>';
      });
      html += '</table>';
    }
    html += '<div class="note">' + escapeHtml(r.verdict) + '</div>' +
      '<p class="hint">Revenue uses imported purchase amounts where available, otherwise falls back to the average order value above. Log contacts or import a results CSV in the Tracking tab to feed this.</p>';
    out.innerHTML = html;
  }
  $('roiCalc').addEventListener('click', renderRoi);
  function kpi(v, l) { return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  load();
})();

/* WinBack AI — UI glue. All state in localStorage. */
(function () {
  'use strict';
  var W = window.Winback;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    customers: [],      // segmented
    segSel: 'vip-dormant',
    tracking: [],
    sends: [],          // campaign sends: {segment, channel, count, date}
    suppressions: [],   // do-not-contact emails (lowercased)
    offers: {},         // custom per-segment offers: {seg: {value, rationale}}
    segQuery: '',
    segSort: { key: 'segment', dir: 'asc' }
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
      if (s.customers && s.customers.length) {
        state.customers = s.customers;
        renderSegments(); renderSegSelect(); renderCampaign(); renderTracking();
      }
      renderSendSeg();
      renderHeadStats();
    } catch (e) { /* fresh start */ }
  }
  function save() {
    try {
      localStorage.setItem('winback-ai', JSON.stringify({
        bizName: $('bizName').value, tone: $('toneSel').value,
        customers: state.customers, tracking: state.tracking, sends: state.sends,
        suppressions: state.suppressions, offers: state.offers
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
    save(); renderHeadStats();
    renderSegments(); renderSegSelect(); renderCampaign();
    msg.push('<div class="ok"><b>' + parsed.rows.length + '</b> customers segmented. ' +
      'Head to Segments →</div>');
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
        save(); renderSegments(); renderHeadStats(); renderCampaign();
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
  $('toneSel').addEventListener('change', function () { renderCampaign(); save(); });
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
    var preview = sendable.slice(0, 3).map(function (c) {
      var p = W.personalize(camp, c);
      return '<div class="draft"><h4>Preview — ' + escapeHtml(c.email) +
        ' <button class="btn small ghost copybtn" data-copy="email">Copy email</button></h4>' +
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
      '<div class="note"><b>Send checklist:</b> 1) Copy the email into your email tool (Mailchimp, Gmail…) and send to this segment. ' +
      '2) Follow up by SMS 3 days later to non-openers. 3) Log every send in the Tracking tab. 4) Don\'t email the same person twice in 14 days.</div>' +
      '</div><div class="cmp-right"><p class="kicker">Live drafts</p>' +
      '<div class="draft"><h4>Subject lines <button class="btn small ghost copybtn" data-copy="subjects">Copy</button></h4><ul class="subjects">' +
      camp.subjects.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="draft"><h4>Email template <button class="btn small ghost copybtn" data-copy="email">Copy</button></h4>' +
      '<p class="hint">Merge tags: {name} = first name · {offer} = this segment\'s offer · {last_purchase} · {total_spent} · {segment}</p>' +
      escapeHtml(camp.email) + '</div>' +
      '<div class="draft"><h4>SMS template <button class="btn small ghost copybtn" data-copy="sms">Copy</button></h4>' +
      escapeHtml(camp.sms) + ' <span class="hint">(' + camp.sms.replace(/\{name\}/g, 'XXXX').length + ' chars)</span></div>' +
      (preview ? '<h3 style="margin-top:18px">Personalized previews</h3>' + preview : '<p class="hint">Import customers to see personalized previews.</p>') +
      '</div></div>';

    $('segCsvBtn').addEventListener('click', function () {
      var res = W.segmentToCSV(state.customers, seg, state.suppressions);
      if (!res.count) { alert('Nobody sendable in this segment.'); return; }
      var blob = new Blob([res.csv], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'winback-' + seg + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
        // personalized copy buttons inside previews copy that preview's email
        if (btn.closest('.draft') && btn.closest('.draft').querySelector('h4').textContent.indexOf('Preview') === 0) {
          var idx = Array.prototype.indexOf.call(out.querySelectorAll('.draft'), btn.closest('.draft'));
          var cust = sendable[idx - 3]; // 3 template drafts come first
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
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'winback-tracking.csv'; a.click();
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
      html += '<div class="note due"><b>⏰ ' + due.length + ' follow-up' + (due.length === 1 ? '' : 's') +
        ' due:</b> ' + due.slice(0, 5).map(function (t) {
          return escapeHtml(t.email) + ' (' + escapeHtml(t.followUp) + ')';
        }).join(' · ') + (due.length > 5 ? ' · …' : '') + '</div>';
    }
    if (!state.tracking.length) {
      el.innerHTML = html + '<p class="hint">Nothing logged yet.</p>' + renderSuppressionList();
      bindUnsupp(el);
      return;
    }
    var won = state.tracking.filter(function (t) { return t.result === 'won'; }).length;
    html += '<p class="ok"><b>' + state.tracking.length + '</b> contacts logged · <b>' + won + '</b> won back 🎉</p>';
    html += '<table><tr><th>Email</th><th>Segment</th><th>Date</th><th>Channel</th><th>Group</th><th>Result</th><th>Follow-up</th></tr>';
    var today = W.todayISO();
    state.tracking.forEach(function (t) {
      var dueMark = (t.followUp && t.followUp <= today && t.result !== 'won' && t.result !== 'unsub')
        ? ' <span class="pill lost">due</span>' : '';
      html += '<tr><td>' + escapeHtml(t.email) + '</td><td>' + escapeHtml(t.segment) +
        '</td><td>' + escapeHtml(t.date) + '</td><td>' + escapeHtml(t.channel) +
        '</td><td>' + escapeHtml(t.group || '—') +
        '</td><td>' + escapeHtml(t.result) + '</td><td>' + escapeHtml(t.followUp || '—') + dueMark + '</td></tr>';
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
        save(); renderTracking(); renderSegments(); renderCampaign(); renderHeadStats();
      });
    });
  }

  /* ROI */
  $('roiCalc').addEventListener('click', function () {
    var out = $('roiOut');
    if (!state.customers.length) { out.innerHTML = '<p class="err">Import customers first.</p>'; return; }
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
  });
  function kpi(v, l) { return '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  load();
})();

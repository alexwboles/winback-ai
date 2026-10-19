/* winback-ai shared logic — works in Node (module.exports) and browsers (window.Winback).
 * No dependencies. All segmentation + copy generation is local; no network calls. */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Winback = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  var SEGMENTS = {
    'champions': {
      label: 'Champions',
      blurb: 'Bought recently and spend big. Your best fans — ask for referrals, not discounts.',
      priority: 1
    },
    'recent': {
      label: 'Recent buyers',
      blurb: 'Bought in the last 3 months. A gentle nudge keeps the habit alive.',
      priority: 2
    },
    'at-risk': {
      label: 'At risk',
      blurb: 'Going quiet (3–6 months). A "we miss you" note now is cheaper than winning them back later.',
      priority: 3
    },
    'lapsed': {
      label: 'Lapsed',
      blurb: 'Haven\'t bought in 6–12 months. Needs a real reason to come back.',
      priority: 4
    },
    'vip-dormant': {
      label: 'Dormant VIPs',
      blurb: 'Big spenders gone quiet. Highest-value win-back targets — worth a personal touch.',
      priority: 5
    },
    'lost': {
      label: 'Lost',
      blurb: 'Gone over a year. Last-chance offer or a goodbye survey.',
      priority: 6
    },
    'unknown': {
      label: 'Needs info',
      blurb: 'Missing purchase data — can\'t segment yet.',
      priority: 7
    }
  };

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(String(s).trim());
    return isNaN(d.getTime()) ? null : d;
  }

  function daysSince(dateStr, now) {
    var d = parseDate(dateStr);
    if (!d) return null;
    var ref = now ? new Date(now) : new Date();
    return Math.max(0, Math.floor((ref - d) / DAY_MS));
  }

  function toNumber(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    var n = parseFloat(String(v).replace(/[$,]/g, ''));
    return isNaN(n) ? fallback : n;
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
  }

  /* Minimal CSV parser: handles quoted fields, escaped quotes, CRLF. */
  function splitCSVLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function headerIndex(headers, names) {
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].toLowerCase().replace(/[^a-z]/g, '');
      for (var j = 0; j < names.length; j++) {
        if (h === names[j]) return i;
      }
    }
    return -1;
  }

  function parseCSV(text) {
    var rows = [], errors = [], seen = {}, suppressions = [];
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return { rows: rows, errors: ['CSV needs a header row plus at least one data row.'], suppressions: suppressions };

    var headers = splitCSVLine(lines[0]);
    var iName = headerIndex(headers, ['name', 'fullname', 'customer', 'customername']);
    var iEmail = headerIndex(headers, ['email', 'emailaddress']);
    var iLast = headerIndex(headers, ['lastpurchase', 'lastorder', 'lastpurchasedate', 'lastbuy', 'lastvisit']);
    var iSpent = headerIndex(headers, ['totalspent', 'spent', 'lifetimevalue', 'ltv', 'total', 'revenue']);
    var iOrders = headerIndex(headers, ['orders', 'ordercount', 'purchases', 'numorders']);
    // Mailchimp-style hygiene: recognize bounced/unsubscribed status columns so
    // those addresses are auto-suppressed at import instead of being mailed.
    var iStatus = headerIndex(headers, ['status', 'subscriptionstatus', 'subscriberstatus', 'contactstatus', 'emailstatus', 'bounced', 'unsubscribed', 'optout', 'cleaned']);

    if (iEmail < 0) return { rows: rows, errors: ['No email column found. Need at least an "email" column.'], suppressions: suppressions };

    for (var r = 1; r < lines.length; r++) {
      var cols = splitCSVLine(lines[r]);
      var email = (cols[iEmail] || '').trim().toLowerCase();
      if (!email) { errors.push('Row ' + (r + 1) + ': skipped (no email).'); continue; }
      if (!validateEmail(email)) { errors.push('Row ' + (r + 1) + ': skipped (bad email "' + email + '").'); continue; }
      if (seen[email]) { errors.push('Row ' + (r + 1) + ': skipped (duplicate of ' + email + ').'); continue; }
      seen[email] = true;
      var lastRaw = iLast >= 0 ? (cols[iLast] || '') : '';
      var last = parseDate(lastRaw);
      var statusVal = iStatus >= 0 ? (cols[iStatus] || '') : '';
      var hygiene = /bounc|cleaned|complaint|spam trap/i.test(statusVal) ? 'bounced'
        : /unsub|opted.?out|opt.?out|do.?not.?contact|suppress/i.test(statusVal) ? 'unsub' : '';
      if (hygiene) suppressions.push(email);
      rows.push({
        name: iName >= 0 ? (cols[iName] || '').trim() : '',
        email: email,
        lastPurchase: last ? last.toISOString().slice(0, 10) : '',
        lastPurchaseRaw: lastRaw,
        totalSpent: toNumber(iSpent >= 0 ? cols[iSpent] : '', 0),
        orders: Math.max(1, Math.round(toNumber(iOrders >= 0 ? cols[iOrders] : '', 1))),
        hygiene: hygiene
      });
    }

  return { rows: rows, errors: errors, suppressions: suppressions };
  }

  function percentile(sortedNums, p) {
    if (!sortedNums.length) return 0;
    var idx = Math.min(sortedNums.length - 1, Math.floor(p * sortedNums.length));
    return sortedNums[idx];
  }

  /* RFM-lite segmentation. Champions + dormant VIPs are the money. */
  function segmentCustomers(customers, now) {
    var spends = customers
      .map(function (c) { return c.totalSpent || 0; })
      .filter(function (s) { return s > 0; })
      .sort(function (a, b) { return a - b; });
    var vipCut = Math.max(500, percentile(spends, 0.75));
    var champCut = Math.max(200, percentile(spends, 0.6));

    return customers.map(function (c) {
      var rec = daysSince(c.lastPurchase, now);
      var spent = c.totalSpent || 0;
      var seg = 'unknown';
      if (rec === null) seg = 'unknown';
      else if (rec > 180 && spent >= vipCut) seg = 'vip-dormant';
      else if (rec <= 60 && spent >= champCut) seg = 'champions';
      else if (rec <= 90) seg = 'recent';
      else if (rec <= 180) seg = 'at-risk';
      else if (rec <= 365) seg = 'lapsed';
      else seg = 'lost';
      return {
        name: c.name, email: c.email, lastPurchase: c.lastPurchase,
        totalSpent: spent, orders: c.orders || 1,
        recencyDays: rec, segment: seg,
        segmentLabel: SEGMENTS[seg].label,
        score: winScore({ recencyDays: rec, totalSpent: spent, orders: c.orders || 1 })
      };
    });
  }

  /* Win score 0-100: how likely is this customer to come back?
     Recency (40) + spend (35) + frequency (25). */
  function winScore(c) {
    var rec = c.recencyDays;
    var recScore = (rec === null || rec === undefined) ? 8
      : rec <= 60 ? 40 : rec <= 90 ? 32 : rec <= 180 ? 22 : rec <= 365 ? 12 : 5;
    var spendScore = Math.min(35, Math.round((c.totalSpent || 0) / 50));
    var freqScore = Math.min(25, (c.orders || 1) * 5);
    return Math.max(0, Math.min(100, recScore + spendScore + freqScore));
  }

  function firstName(full) {
    var n = String(full || '').trim();
    if (!n) return 'there';
    return n.split(/\s+/)[0];
  }

  /* Offer logic: protect margin on loyal buyers (freebie), discount to re-activate the quiet. */
  function offerFor(segment, avgOrderValue) {
    var aov = avgOrderValue || 75;
    switch (segment) {
      case 'champions':
        return { type: 'freebie', value: 'Free gift with your next order', rationale: 'Champions already buy — a gift protects your margin better than a discount and drives referrals.' };
      case 'recent':
        return { type: 'perk', value: 'Free shipping on your next order', rationale: 'A small friction-remover keeps the buying habit warm without training them to wait for sales.' };
      case 'at-risk':
        return { type: 'discount', value: '10% off', rationale: 'A modest nudge now is 5x cheaper than re-acquiring them later.' };
      case 'lapsed':
        return { type: 'discount', value: '15% off, this week only', rationale: 'Lapsed buyers need urgency + a real reason. Time-limit it to force action.' };
      case 'vip-dormant':
        return { type: 'discount', value: '20% off, personal code', rationale: 'High past spend justifies a deeper, personal offer — one returning VIP pays for the campaign.' };
      case 'lost':
        return { type: 'discount', value: '25% off, last chance', rationale: 'Last resort: a strong offer or a goodbye survey to learn why they left.' };
      default:
        return { type: 'perk', value: 'A little thank-you on your next visit', rationale: 'Generic perk until we know more.' };
    }
  }

  var COPY = {
    'champions': {
      warm: {
        subjects: ['A little thank-you, {name}', 'You\'re one of our favorites', 'Something special for our best customers'],
        email: 'Hi {name},\n\nYou\'re one of our favorite customers, and we don\'t say that to everyone. As a thank-you, we\'d like to add a {offer} — no strings attached.\n\nWe\'d also love it if you told a friend about us. Good customers know good people.\n\nSee you soon,\n{biz}',
        sms: 'Hi {name}! {biz} here — a {offer} is waiting for you as a thank-you. Pop in this week?'
      },
      bold: {
        subjects: ['VIP treatment: unlocked', '{name}, this one\'s just for you', 'Top-customer perk inside'],
        email: 'Hey {name},\n\nTop customers get top perks. Yours: {offer}.\n\nClaim it on your next order — and if you know someone who\'d love what we do, send them our way.\n\n— {biz}',
        sms: '{name}, VIP perk from {biz}: {offer}. Claim it this week.'
      }
    },
    'recent': {
      warm: {
        subjects: ['Thanks for your recent order, {name}', 'How\'d we do?', 'A little something for your next visit'],
        email: 'Hi {name},\n\nThanks for your recent order — we hope you loved it. Here\'s {offer} for your next one.\n\nWe\'ve also added a few new things since your visit. Worth a look.\n\n— {biz}',
        sms: 'Thanks again, {name}! Enjoy {offer} on your next order from {biz}.'
      },
      bold: {
        subjects: ['Don\'t sleep on this, {name}', 'Your next order = upgraded', 'Quick win for you'],
        email: 'Hey {name},\n\nYour last order was just the start. Take {offer} on your next one — new arrivals are in.\n\n— {biz}',
        sms: '{biz}: {name}, grab {offer} on your next order. New stuff just landed.'
      }
    },
    'at-risk': {
      warm: {
        subjects: ['We miss you, {name}', 'It\'s been a while', 'Come back and save {offer}'],
        email: 'Hi {name},\n\nIt\'s been a little while, and we miss seeing you. We\'d love to welcome you back with {offer}.\n\nThings have only gotten better since your last visit.\n\nHope to see you soon,\n{biz}',
        sms: 'We miss you, {name}! Come back to {biz} and enjoy {offer}.'
      },
      bold: {
        subjects: ['{name}, where\'d you go?', 'We saved you {offer}', 'Your comeback starts here'],
        email: 'Hey {name},\n\nWhere\'d you go? We saved {offer} to get you back in the door.\n\nNo hard feelings — just good stuff waiting.\n\n— {biz}',
        sms: '{name}, {biz} saved you {offer}. Come back this week?'
      }
    },
    'lapsed': {
      warm: {
        subjects: ['A lot has changed, {name}', 'We\'d love a second chance', '{offer} — just for you'],
        email: 'Hi {name},\n\nIt\'s been a while — maybe too long. A lot has changed here, and we think you\'d like what you see.\n\nTo make the reunion easy: {offer}.\n\nGive us one more shot?\n\n— {biz}',
        sms: 'Hi {name}, {biz} here with {offer} to welcome you back. This week only!'
      },
      bold: {
        subjects: ['This expires Sunday, {name}', 'Last call: {offer}', 'Don\'t let this one slip'],
        email: 'Hey {name},\n\nStraight to it: {offer}. This week only.\n\nIf we lost you for a reason, hit reply and tell us — we actually read every message.\n\n— {biz}',
        sms: 'LAST CALL {name}: {offer} at {biz}. Ends Sunday.'
      }
    },
    'vip-dormant': {
      warm: {
        subjects: ['A personal note for you, {name}', 'You deserve the VIP treatment', '{name}, let\'s catch up'],
        email: 'Hi {name},\n\nI\'m writing personally because customers like you are the reason we\'re still here. I noticed it\'s been a while, and I wanted to reach out myself.\n\nPlease accept {offer} with my compliments — and if there\'s anything we could do better, just reply. I read every one.\n\nWarmly,\nThe team at {biz}',
        sms: 'Hi {name}, it\'s {biz}. We put together {offer} just for you — would love to see you again.'
      },
      bold: {
        subjects: ['Your VIP status is expiring, {name}', 'Exclusive: {offer}', 'Only our best get this'],
        email: 'Hey {name},\n\nOnly our top customers get this email: {offer}, locked to your account.\n\nYou\'ve spent enough with us to know we\'re worth it. Come remind yourself why.\n\n— {biz}',
        sms: 'VIP ALERT {name}: {offer} reserved for you at {biz}. Don\'t let it expire.'
      }
    },
    'lost': {
      warm: {
        subjects: ['Should we say goodbye, {name}?', 'One last thing', 'Help us do better'],
        email: 'Hi {name},\n\nWe haven\'t seen you in over a year, so we\'ll keep this short. If you\'re open to it: {offer}, no expiry games.\n\nAnd if we did something wrong, a one-line reply would mean the world — it helps us do better.\n\nEither way, thanks for being part of our story.\n\n— {biz}',
        sms: '{biz}: {name}, one last {offer} if you ever want to come back. No pressure.'
      },
      bold: {
        subjects: ['Final offer: {offer}', '{name}, this is it', 'Closing the door (unless…)'],
        email: 'Hey {name},\n\nFinal offer, no fluff: {offer}.\n\nUse it or lose it — and if you\'ve moved on, no hard feelings. Just didn\'t want to wonder "what if."\n\n— {biz}',
        sms: 'FINAL: {offer} at {biz}, {name}. After this we\'ll stop bugging you.'
      }
    },
    'unknown': {
      warm: {
        subjects: ['A little hello from {biz}', 'We\'d love to see you again', '{offer} — on us, {name}'],
        email: 'Hi {name},\n\nJust saying hello from {biz} — here\'s {offer} for your next visit.\n\n— {biz}',
        sms: 'Hi {name}! {biz} here with {offer} for your next visit.'
      },
      bold: {
        subjects: ['Quick hello, {name}', '{offer} waiting for you', 'Don\'t miss this, {name}'],
        email: 'Hey {name},\n\nQuick one: {offer} waiting at {biz}.\n\n— {biz}',
        sms: '{name}: {offer} waiting at {biz}.'
      }
    }
  };

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] !== undefined ? vars[k] : '{' + k + '}';
    });
  }

  /* Preview text (preheader): the inbox teaser line under the subject.
     Klaviyo and Mailchimp both treat subject + preheader as a pair — this is
     what lifts the open rate. Generated per segment x tone like everything else. */
  var PREVIEW_COPY = {
    'champions': {
      warm: 'A {offer} with our thanks — claim it on your next visit.',
      bold: 'VIP treatment: {offer}. This week only.'
    },
    'recent': {
      warm: 'Plus {offer} on your next order. New things since your visit.',
      bold: '{offer} — new arrivals just landed.'
    },
    'at-risk': {
      warm: 'Your {offer} is waiting — come see what\'s new.',
      bold: 'Where\'d you go? {offer} to come back this week.'
    },
    'lapsed': {
      warm: 'Give us one more shot? {offer} inside.',
      bold: 'Last call: {offer}. Ends Sunday.'
    },
    'vip-dormant': {
      warm: 'A personal note — and {offer} with my compliments.',
      bold: 'Exclusive: {offer}. Don\'t let it expire.'
    },
    'lost': {
      warm: 'No pressure — but {offer} if you ever want back.',
      bold: 'Final: {offer}. After this we stop emailing.'
    },
    'unknown': {
      warm: '{offer} for your next visit. Just saying hello.',
      bold: '{offer} waiting for you. Quick hello.'
    }
  };

  function previewText(segment, tone) {
    tone = (tone === 'bold') ? 'bold' : 'warm';
    var seg = PREVIEW_COPY[segment] || PREVIEW_COPY.unknown;
    return seg[tone];
  }

  function generateCampaign(segment, businessName, tone, avgOrderValue, customOffers) {
    tone = (tone === 'bold') ? 'bold' : 'warm';
    var tpl = (COPY[segment] || COPY.unknown)[tone];
    var offer = resolveOffer(segment, customOffers, avgOrderValue);
    var vars = { biz: businessName || 'our store', offer: offer.value, name: '{name}' };
    return {
      segment: segment,
      segmentLabel: (SEGMENTS[segment] || SEGMENTS.unknown).label,
      tone: tone,
      offer: offer,
      subjects: tpl.subjects.map(function (s) { return fill(s, vars); }),
      preview: fill(previewText(segment, tone), vars),
      email: fill(tpl.email, vars),
      sms: fill(tpl.sms, vars)
    };
  }

  /* Personalize a campaign template for one customer.
     Supported merge tags: {name} {offer} {biz} {last_purchase} {total_spent} {segment} */
  function personalize(campaign, customer) {
    var vars = {
      name: firstName(customer.name),
      last_purchase: customer.lastPurchase || 'a while ago',
      total_spent: '$' + Math.round(customer.totalSpent || 0),
      segment: customer.segmentLabel || ''
    };
    return {
      subjects: campaign.subjects.map(function (s) { return fill(s, vars); }),
      preview: fill(campaign.preview || '', vars),
      email: fill(campaign.email, vars),
      sms: fill(campaign.sms, vars)
    };
  }

  /* ---------- campaign performance: sends log + results per segment ----------
     sends: [{segment, channel, count, date}]. tracking: [{email, result, ...}].
     Tracking entries join to segments via the customer's email. */
  function logSend(sends, entry) {
    var out = (sends || []).slice();
    out.unshift({
      segment: entry.segment,
      channel: entry.channel || 'Email',
      count: Math.max(0, Number(entry.count) || 0),
      date: entry.date || wbTodayISO()
    });
    return out;
  }

  function segmentKeyFromLabel(label) {
    var keys = Object.keys(SEGMENTS);
    for (var i = 0; i < keys.length; i++) {
      if (SEGMENTS[keys[i]].label === label) return keys[i];
    }
    return null;
  }

  function campaignStats(customers, sends, tracking) {
    var byEmail = {};
    (customers || []).forEach(function (c) {
      byEmail[String(c.email || '').trim().toLowerCase()] = c.segment;
    });
    var stats = {};
    function row(seg) {
      if (!stats[seg]) {
        stats[seg] = {
          segment: seg, label: (SEGMENTS[seg] || {}).label || seg,
          sent: 0, contacted: 0, responded: 0, won: 0, winRate: 0
        };
      }
      return stats[seg];
    }
    (sends || []).forEach(function (s) {
      if (SEGMENTS[s.segment]) row(s.segment).sent += Math.max(0, Number(s.count) || 0);
    });
    (tracking || []).forEach(function (t) {
      var seg = byEmail[String(t.email || '').trim().toLowerCase()] ||
        segmentKeyFromLabel(t.segment);
      if (!seg || !SEGMENTS[seg]) return;
      var r = row(seg);
      r.contacted++;
      if (t.result === 'opened' || t.result === 'won') r.responded++;
      if (t.result === 'won') r.won++;
    });
    var out = Object.keys(stats).map(function (k) { return stats[k]; });
    out.forEach(function (r) {
      r.winRate = r.contacted ? Math.round((r.won / r.contacted) * 1000) / 10 : 0;
    });
    out.sort(function (a, b) { return b.won - a.won || b.responded - a.responded; });
    return out;
  }

  /* ROI estimator. Assumptions are editable; defaults are honest industry-ish guesses. */
  var DEFAULT_ASSUMPTIONS = {
    responseRate: { 'champions': 0.25, 'recent': 0.15, 'at-risk': 0.12, 'lapsed': 0.08, 'vip-dormant': 0.15, 'lost': 0.03, 'unknown': 0.05 },
    avgOrderValue: 75,
    marginPct: 0.5,
    offerCostPerRedeemer: { 'freebie': 8, 'perk': 5, 'discount': 0 }
  };

  function estimateROI(segmented, assumptions, businessName) {
    var a = assumptions || {};
    var rr = a.responseRate || DEFAULT_ASSUMPTIONS.responseRate;
    var aov = a.avgOrderValue || DEFAULT_ASSUMPTIONS.avgOrderValue;
    var margin = (a.marginPct !== undefined) ? a.marginPct : DEFAULT_ASSUMPTIONS.marginPct;
    var offerCost = a.offerCostPerRedeemer || DEFAULT_ASSUMPTIONS.offerCostPerRedeemer;

    var perSegment = {};
    var totalRevenue = 0, totalCost = 0, totalWon = 0;
    segmented.forEach(function (c) {
      var seg = c.segment;
      if (!perSegment[seg]) perSegment[seg] = { count: 0, expectedWon: 0, revenue: 0, cost: 0 };
      var rate = rr[seg] !== undefined ? rr[seg] : 0.05;
      var won = rate; // expected customers won back per 1 customer
      var discountCost = offerCostPerWinner(seg, aov, a);
      perSegment[seg].count++;
      perSegment[seg].expectedWon += won;
      perSegment[seg].revenue += won * aov;
      perSegment[seg].cost += won * discountCost;
    });

    Object.keys(perSegment).forEach(function (seg) {
      var p = perSegment[seg];
      p.expectedWon = Math.round(p.expectedWon * 10) / 10;
      p.revenue = Math.round(p.revenue);
      p.cost = Math.round(p.cost);
      p.net = Math.round(p.revenue * margin - p.cost);
      p.offer = offerFor(seg, aov).value;
      p.label = (SEGMENTS[seg] || SEGMENTS.unknown).label;
      totalRevenue += p.revenue; totalCost += p.cost; totalWon += p.expectedWon;
    });

    var net = Math.round(totalRevenue * margin - totalCost);
    return {
      perSegment: perSegment,
      customers: segmented.length,
      expectedWonBack: Math.round(totalWon * 10) / 10,
      expectedRevenue: Math.round(totalRevenue),
      expectedCost: Math.round(totalCost),
      expectedNet: net,
      verdict: net > 0
        ? 'Looks profitable: an estimated $' + net + ' net from this list.'
        : 'Tight — trim the offer depth or clean the list before sending.'
    };
  }

  function segmentCounts(segmented) {
    var counts = {};
    segmented.forEach(function (c) {
      counts[c.segment] = (counts[c.segment] || 0) + 1;
    });
    return counts;
  }

  /* ---------- customer table: search + sort ---------- */
  var SORT_KEYS = ['name', 'email', 'lastPurchase', 'totalSpent', 'segment', 'score'];

  function sortCustomers(customers, key, dir) {
    if (SORT_KEYS.indexOf(key) === -1) key = 'name';
    var d = (dir === 'desc') ? -1 : 1;
    return (customers || []).slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'totalSpent' || key === 'score') {
        av = Number(av) || 0; bv = Number(bv) || 0;
      } else if (key === 'segment') {
        av = ((SEGMENTS[a.segment] || {}).priority) || 99;
        bv = ((SEGMENTS[b.segment] || {}).priority) || 99;
      } else {
        av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase();
      }
      return (av < bv ? -1 : av > bv ? 1 : 0) * d;
    });
  }

  function searchCustomers(customers, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return customers || [];
    return (customers || []).filter(function (c) {
      return (String(c.name || '') + ' ' + String(c.email || '')).toLowerCase().indexOf(q) !== -1;
    });
  }

  /* ---------- suppression list (unsubscribed / do-not-contact) ---------- */
  function suppressEmail(list, email) {
    var e = String(email || '').trim().toLowerCase();
    var out = (list || []).slice();
    if (e && out.indexOf(e) === -1) out.push(e);
    return out;
  }

  function unsuppressEmail(list, email) {
    var e = String(email || '').trim().toLowerCase();
    return (list || []).filter(function (x) { return x !== e; });
  }

  function isSuppressed(list, email) {
    return (list || []).indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }

  function activeCustomers(segmented, suppressions) {
    return (segmented || []).filter(function (c) { return !isSuppressed(suppressions, c.email); });
  }

  /* ---------- custom offers per segment ---------- */
  function resolveOffer(segment, customOffers, avgOrderValue) {
    var custom = (customOffers || {})[segment];
    if (custom && String(custom.value || '').trim()) {
      return {
        type: 'custom',
        value: String(custom.value).trim(),
        rationale: String(custom.rationale || '').trim() || 'Your custom offer for this segment.'
      };
    }
    return offerFor(segment, avgOrderValue);
  }

  /* ---------- per-segment CSV export (suppressed customers excluded) ---------- */
  function segmentToCSV(segmented, segment, suppressions) {
    var list = activeCustomers(
      (segmented || []).filter(function (c) { return c.segment === segment; }),
      suppressions
    );
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = ['name,email,last_purchase,total_spent,orders'];
    list.forEach(function (c) {
      lines.push([esc(c.name), esc(c.email), esc(c.lastPurchase), c.totalSpent, c.orders].join(','));
    });
    return { csv: lines.join('\n'), count: list.length };
  }

  /* ---------- follow-up reminders ---------- */
  function wbTodayISO() {    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function followUpsDue(tracking, today) {
    var now = today || wbTodayISO();
    return (tracking || []).filter(function (t) {
      return t.followUp && t.followUp <= now && t.result !== 'won' && t.result !== 'unsub';
    });
  }


    /* ---------- top win-back targets: expected value ranking ----------
     Expected value = win score × lifetime spend. Champions (already buying)
     and unknowns are excluded — this is a win-back list. */
  function rankTargets(segmented, suppressions, n) {
    var ranked = activeCustomers(segmented, suppressions)
      .filter(function (c) { return c.segment !== 'champions' && c.segment !== 'unknown'; })
      .map(function (c) {
        return {
          name: c.name, email: c.email, segment: c.segment,
          segmentLabel: c.segmentLabel, score: c.score,
          totalSpent: c.totalSpent, lastPurchase: c.lastPurchase,
          expectedValue: Math.round((c.score * (c.totalSpent || 0)) / 100 * 100) / 100
        };
      })
      .sort(function (a, b) { return b.expectedValue - a.expectedValue || b.score - a.score; });
    return ranked.slice(0, Math.max(1, n || 10));
  }

  /* ---------- A/B testing: deterministic split + result comparison ---------- */
  function hashEmail(email) {
    var h = 0;
    var s = String(email || '');
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  /** Deterministic A/B split (sorted by email, then hash-parity). Returns {a, b}. */
  function splitAB(list) {
    var sorted = (list || []).slice().sort(function (x, y) {
      return String(x.email) < String(y.email) ? -1 : 1;
    });
    var a = [], b = [];
    sorted.forEach(function (c) { (hashEmail(c.email) % 2 ? b : a).push(c); });
    return { a: a, b: b };
  }

  function abRates(entries) {
    var total = (entries || []).length;
    var won = (entries || []).filter(function (t) { return t.result === 'won'; }).length;
    return { total: total, won: won, rate: total ? Math.round((won / total) * 1000) / 10 : 0 };
  }

  /** Compare two tracked groups. Returns rates + a plain-language verdict. */
  function abCompare(groupA, groupB) {
    var a = abRates(groupA), b = abRates(groupB);
    var verdict;
    if (a.total < 10 || b.total < 10) {
      verdict = 'Too early — fewer than 10 tracked contacts per group. Keep logging.';
    } else if (a.rate === b.rate) {
      verdict = 'Dead heat at ' + a.rate + '% — no winner yet.';
    } else {
      var winner = a.rate > b.rate ? 'A' : 'B';
      var w = a.rate > b.rate ? a : b, l = a.rate > b.rate ? b : a;
      verdict = 'Group ' + winner + ' is winning (' + w.rate + '% vs ' + l.rate + '%) — roll with ' + winner + ' for the rest of the list.';
    }
    return { a: a, b: b, verdict: verdict };
  }

  /* ---------- duplicate customers: find + merge ---------- */
  function normName(n) {
    return String(n || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Candidate duplicate pairs: same normalized name on different emails. */
  function findDuplicatePairs(customers) {
    var byName = {};
    (customers || []).forEach(function (c) {
      var k = normName(c.name);
      if (!k) return;
      (byName[k] = byName[k] || []).push(c);
    });
    var pairs = [];
    Object.keys(byName).forEach(function (k) {
      var list = byName[k];
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          if (list[i].email !== list[j].email) pairs.push([list[i], list[j]]);
        }
      }
    });
    return pairs;
  }

  /**
   * Merge two customer records (same person, two rows). Spend/orders add up,
   * the latest last-purchase wins, the longer name wins. The whole list is
   * re-segmented so percentiles stay honest. Returns a new segmented list.
   */
  function mergeCustomers(segmented, keepEmail, dropEmail, now) {
    var list = (segmented || []).slice();
    var keep = null, drop = null;
    list.forEach(function (c) {
      if (c.email === keepEmail) keep = c;
      if (c.email === dropEmail) drop = c;
    });
    if (!keep || !drop || keepEmail === dropEmail) return segmented;
    var merged = {
      name: String(keep.name || '').length >= String(drop.name || '').length ? keep.name : drop.name,
      email: keep.email,
      lastPurchase: String(keep.lastPurchase || '') >= String(drop.lastPurchase || '') ? keep.lastPurchase : drop.lastPurchase,
      totalSpent: (Number(keep.totalSpent) || 0) + (Number(drop.totalSpent) || 0),
      orders: Math.max(1, (Number(keep.orders) || 1) + (Number(drop.orders) || 1))
    };
    var raw = list.filter(function (c) { return c.email !== keepEmail && c.email !== dropEmail; }).concat([merged]);
    return segmentCustomers(raw, now);
  }
  /* ---------- send path: mailto-batch composition ----------
     Free send path #1: compose per-recipient emails in the user's own mail
     client. Browsers can't bulk-send mailto links (popup blockers), so the UI
     renders one compose button per recipient — one click each. */
  function composeMailto(customer, campaign) {
    var p = personalize(campaign, customer);
    var subject = p.subjects[0] || 'A note from us';
    var body = p.email;
    return {
      mailto: 'mailto:' + encodeURIComponent(customer.email) +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body),
      subject: subject,
      body: body
    };
  }

  function splitName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  /* ---------- send path: ESP-shaped CSV export ----------
     Free send path #2: export the segment in the column shape common email
     tools expect on import, plus documented Winback_* columns the user can
     map to custom fields. Documented in README + the UI. */
  var ESP_FORMATS = {
    'mailchimp': {
      label: 'Mailchimp',
      columns: ['Email Address', 'First Name', 'Last Name', 'Tags'],
      extra: ['Winback Segment', 'Winback Offer', 'Winback Score', 'Winback Subject', 'Last Purchase', 'Total Spent', 'Orders'],
      note: 'Mailchimp skips columns it does not recognize. Map the Winback columns to audience fields or merge tags during import; Tags arrives as "winback,<segment>".'
    },
    'constant-contact': {
      label: 'Constant Contact',
      columns: ['Email Address', 'First Name', 'Last Name'],
      extra: ['Winback Segment', 'Winback Offer', 'Winback Score', 'Winback Subject', 'Last Purchase', 'Total Spent', 'Orders'],
      note: 'Constant Contact lets you map each column on import — point the Winback columns at custom fields.'
    },
    'brevo': {
      label: 'Brevo (Sendinblue)',
      columns: ['EMAIL', 'FIRSTNAME', 'LASTNAME', 'SMS'],
      extra: ['WINBACK_SEGMENT', 'WINBACK_OFFER', 'WINBACK_SCORE', 'WINBACK_SUBJECT', 'LAST_PURCHASE', 'TOTAL_SPENT', 'ORDERS'],
      note: 'Brevo asks you to map each column to a contact attribute on import — map the WINBACK_* columns to new custom attributes.'
    }
  };

  function espExport(segmented, segment, campaign, opts) {
    opts = opts || {};
    var fmtKey = ESP_FORMATS[opts.format] ? opts.format : 'mailchimp';
    var fmt = ESP_FORMATS[fmtKey];
    var list = activeCustomers(
      (segmented || []).filter(function (c) { return c.segment === segment; }),
      opts.suppressions
    );
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var offerVal = campaign && campaign.offer ? campaign.offer.value : '';
    var subject0 = campaign && campaign.subjects ? campaign.subjects[0] : '';
    var lines = [fmt.columns.concat(fmt.extra).map(esc).join(',')];
    list.forEach(function (c) {
      var nm = splitName(c.name);
      var score = (c.score === null || c.score === undefined) ? '' : c.score;
      var vals;
      if (fmtKey === 'brevo') {
        vals = [c.email, nm.first, nm.last, '',
          c.segmentLabel, offerVal, score, subject0,
          c.lastPurchase || '', c.totalSpent || 0, c.orders || 1];
      } else if (fmtKey === 'constant-contact') {
        vals = [c.email, nm.first, nm.last,
          c.segmentLabel, offerVal, score, subject0,
          c.lastPurchase || '', c.totalSpent || 0, c.orders || 1];
      } else {
        vals = [c.email, nm.first, nm.last, 'winback,' + c.segment,
          c.segmentLabel, offerVal, score, subject0,
          c.lastPurchase || '', c.totalSpent || 0, c.orders || 1];
      }
      lines.push(vals.map(esc).join(','));
    });
    return {
      csv: lines.join('\n'),
      count: list.length,
      columns: fmt.columns.concat(fmt.extra),
      formatLabel: fmt.label,
      note: fmt.note
    };
  }

  /* ---------- result import: real outcomes for the ROI estimator ----------
     Paste an opens/replies/conversions CSV (exported from your ESP or mail
     client) and the results merge into the tracking sheet. Flexible headers:
     email (required); opened/open, replied/reply, purchased/won/converted,
     revenue/amount, date, channel. Strength order: won > opened > sent. */
  var RESULT_RANK = { 'unsub': -1, 'ignored': 0, 'sent': 1, 'opened': 2, 'won': 3 };

  function resultTruthy(v) {
    var s = String(v || '').trim();
    if (!s) return false;
    if (/^(y|yes|true|1|opened|replied|won|purchased|converted)$/i.test(s)) return true;
    return parseDate(s) !== null; // a date in the column counts as "yes"
  }

  function parseResultImport(text) {
    var rows = [], errors = [];
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return { rows: rows, errors: ['Result CSV needs a header row plus at least one data row.'] };

    var headers = splitCSVLine(lines[0]);
    var iEmail = headerIndex(headers, ['email', 'emailaddress']);
    var iOpened = headerIndex(headers, ['opened', 'open', 'opens', 'openedat', 'openeddate']);
    var iReplied = headerIndex(headers, ['replied', 'reply', 'replies']);
    var iWon = headerIndex(headers, ['purchased', 'won', 'converted', 'conversion', 'buyer', 'sale']);
    var iRevenue = headerIndex(headers, ['revenue', 'amount', 'total', 'ordersum', 'spent']);
    var iDate = headerIndex(headers, ['date', 'sentdate', 'contactdate', 'datelogged']);
    var iChannel = headerIndex(headers, ['channel', 'medium']);
    if (iEmail < 0) return { rows: rows, errors: ['No email column found in result CSV.'] };

    for (var r = 1; r < lines.length; r++) {
      var cols = splitCSVLine(lines[r]);
      var email = (cols[iEmail] || '').trim().toLowerCase();
      if (!email) { errors.push('Row ' + (r + 1) + ': skipped (no email).'); continue; }
      if (!validateEmail(email)) { errors.push('Row ' + (r + 1) + ': skipped (bad email "' + email + '").'); continue; }
      var revenue = iRevenue >= 0 ? Math.max(0, toNumber(cols[iRevenue], 0)) : 0;
      var won = (iWon >= 0 && resultTruthy(cols[iWon])) || revenue > 0; // nonzero revenue implies a purchase
      var opened = won || (iOpened >= 0 && resultTruthy(cols[iOpened])) ||
        (iReplied >= 0 && resultTruthy(cols[iReplied]));
      rows.push({
        email: email,
        result: won ? 'won' : opened ? 'opened' : 'sent',
        date: iDate >= 0 && parseDate(cols[iDate]) ? parseDate(cols[iDate]).toISOString().slice(0, 10) : '',
        revenue: revenue,
        channel: iChannel >= 0 ? (cols[iChannel] || '').trim() : ''
      });
    }
    return { rows: rows, errors: errors };
  }

  /* Merge result rows into the tracking sheet. A stronger result upgrades the
     latest existing entry in place (so win rates stay meaningful);
     equal/weaker ones are skipped; unsubs are never overridden. */
  function importResults(tracking, customers, resultRows, today) {
    var now = today || wbTodayISO();
    var out = (tracking || []).map(function (t) { return Object.assign({}, t); });
    var byEmail = {};
    (customers || []).forEach(function (c) {
      byEmail[String(c.email || '').trim().toLowerCase()] = c;
    });
    var summary = { total: (resultRows || []).length, added: 0, upgraded: 0, skipped: 0, unmatched: 0, won: 0 };

    function rank(r) { return RESULT_RANK[r] !== undefined ? RESULT_RANK[r] : 0; }

    (resultRows || []).forEach(function (rr) {
      var e = String(rr.email || '').trim().toLowerCase();
      var cust = byEmail[e];
      if (!cust) summary.unmatched++;
      var newRank = rank(rr.result) || 1;
      var latestIdx = -1;
      out.forEach(function (t, i) {
        if (String(t.email || '').toLowerCase() === e &&
            (latestIdx < 0 || String(t.date || '') >= String(out[latestIdx].date || ''))) latestIdx = i;
      });
      var latest = latestIdx >= 0 ? out[latestIdx] : null;
      if (latest && latest.result === 'unsub') { summary.skipped++; return; }
      if (latest && rank(latest.result) >= newRank) { summary.skipped++; return; }
      if (rr.result === 'won') summary.won++;
      if (latest) {
        out[latestIdx] = Object.assign({}, latest, {
          result: rr.result,
          revenue: rr.revenue || latest.revenue || 0,
          date: rr.date || latest.date || now,
          channel: rr.channel || latest.channel || 'Email',
          source: 'import'
        });
        summary.upgraded++;
      } else {
        out.unshift({
          email: e,
          name: cust ? (cust.name || '') : '',
          segment: cust ? cust.segmentLabel : '—',
          date: rr.date || now,
          channel: rr.channel || 'Email',
          result: rr.result,
          revenue: rr.revenue || 0,
          group: '',
          followUp: '',
          source: 'import'
        });
        summary.added++;
      }
    });
    return { tracking: out, summary: summary };
  }

  /* Offer cost per won-back customer — shared by the estimate and actual ROI. */
  function offerCostPerWinner(segment, aov, assumptions) {
    var a = assumptions || {};
    var offerCost = a.offerCostPerRedeemer || DEFAULT_ASSUMPTIONS.offerCostPerRedeemer;
    var offer = offerFor(segment, aov);
    if (offer.type === 'discount') {
      var pct = parseFloat(offer.value) / 100 || 0;
      return aov * pct; // margin given away per redeemer
    }
    return offerCost[offer.type] || 0;
  }

  /* ROI on REAL outcomes: won-back counts and imported revenue per segment.
     Segments with no tracked results show contacted=0 and are excluded from
     the verdict. Revenue falls back to AOV × won when no revenue was imported. */
  function estimateROIActual(customers, tracking, assumptions) {
    var a = assumptions || {};
    var aov = a.avgOrderValue || DEFAULT_ASSUMPTIONS.avgOrderValue;
    var margin = (a.marginPct !== undefined) ? a.marginPct : DEFAULT_ASSUMPTIONS.marginPct;
    var byEmail = {};
    (customers || []).forEach(function (c) {
      byEmail[String(c.email || '').trim().toLowerCase()] = c.segment;
    });
    var perSegment = {};
    var tWon = 0, tContacted = 0, tRevenue = 0, tCost = 0;

    (tracking || []).forEach(function (t) {
      var seg = byEmail[String(t.email || '').trim().toLowerCase()] ||
        segmentKeyFromLabel(t.segment) || 'unknown';
      if (!perSegment[seg]) {
        perSegment[seg] = { contacted: 0, won: 0, revenue: 0 };
      }
      var p = perSegment[seg];
      p.contacted++; tContacted++;
      if (t.result === 'won') {
        p.won++; tWon++;
        var rev = Number(t.revenue) > 0 ? Number(t.revenue) : aov;
        p.revenue += rev; tRevenue += rev;
      }
    });

    Object.keys(perSegment).forEach(function (seg) {
      var p = perSegment[seg];
      p.cost = Math.round(p.won * offerCostPerWinner(seg, aov, a));
      p.revenue = Math.round(p.revenue);
      p.net = Math.round(p.revenue * margin - p.cost);
      p.winRate = p.contacted ? Math.round((p.won / p.contacted) * 1000) / 10 : 0;
      p.aovActual = p.won ? Math.round(p.revenue / p.won) : 0;
      p.label = (SEGMENTS[seg] || SEGMENTS.unknown).label;
      tCost += p.cost;
    });

    var net = Math.round(tRevenue * margin - tCost);
    var verdict;
    if (!tContacted) {
      verdict = 'No tracked results yet — log contacts or import a results CSV in the Tracking tab, then run this again.';
    } else if (net > 0) {
      verdict = 'Real results: ' + tWon + ' won back from ' + tContacted + ' logged contacts — about $' +
        Math.round(tRevenue) + ' revenue, $' + net + ' net after offer cost.';
    } else {
      verdict = 'Real results: ' + tWon + ' won back from ' + tContacted + ' logged contacts — currently $' +
        net + ' net. Try a shallower offer or a cleaner list before scaling.';
    }
    return {
      perSegment: perSegment,
      contacted: tContacted,
      wonBack: tWon,
      revenue: Math.round(tRevenue),
      cost: tCost,
      net: net,
      verdict: verdict
    };
  }

  /* ---------- follow-up sequences: multi-touch cadence ----------
     Day 0 = the segment's main campaign draft (email), then an SMS nudge,
     a second-chance email, and a final call. Each step is a template with
     {name}/{offer}/{biz} filled at build time and the remaining merge tags
     ({last_purchase} etc.) filled per customer with personalizeSeqStep.
     Stop conditions (won, unsubscribed) are enforced by seqNextDue. */
  var SEQUENCE_STEPS = [
    { n: 1, day: 0, channel: 'Email', label: 'Main campaign email' },
    { n: 2, day: 3, channel: 'SMS', label: 'SMS reminder' },
    { n: 3, day: 7, channel: 'Email', label: 'Second-chance email' },
    { n: 4, day: 14, channel: 'Email', label: 'Final call' }
  ];

  var SEQ_COPY = {
    warm: {
      'sms': { subject: '', body: 'Hi {name}, quick nudge from {biz} — your {offer} is still waiting. Claim it this week?' },
      'nudge': {
        subject: "Don't miss out, {name}",
        preview: 'Still thinking it over? Your {offer} is inside.',
        body: "Hi {name},\n\nJust checking in — the {offer} we set aside for you is still available.\n\nIf something's holding you back, hit reply and tell me. I'd rather fix it than lose you.\n\n— {biz}"
      },
      'final': {
        subject: 'Last call: {offer}',
        preview: 'One last note — the {offer} stands through Sunday.',
        body: "Hi {name},\n\nThis is my last note — after this week I'll stop bothering you.\n\nThe {offer} still stands if you want it. Either way, thanks for being a customer.\n\n— {biz}"
      }
    },
    bold: {
      'sms': { subject: '', body: '{name}, your {offer} from {biz} is on the clock. Claim it this week.' },
      'nudge': {
        subject: 'Still on the table: {offer}',
        preview: "The {offer} hasn't gone anywhere. Yet.",
        body: "Hey {name},\n\nThe {offer} hasn't gone anywhere — but it won't wait forever.\n\nCome back this week.\n\n— {biz}"
      },
      'final': {
        subject: '{name}, final call',
        preview: "Use it by Sunday or it's gone.",
        body: "Hey {name},\n\nFinal call on the {offer}. Use it by Sunday or it's gone.\n\nNo hard feelings if you're done with us — just didn't want to wonder.\n\n— {biz}"
      }
    }
  };

  /* Cadence overrides per segment (Klaviyo-flow-builder style):
     cfg = { days: [d0, d1, d2, d3], on: [true, ...] }. resolveSequenceSteps
     merges overrides onto SEQUENCE_STEPS and drops disabled steps. Entries
     store their resolved steps, so seqNextDue / advanceSequenceEntry honor
     the cadence in effect when the entry started; older entries without
     stored steps fall back to SEQUENCE_STEPS. */
  function resolveSequenceSteps(cfg) {
    var days = (cfg && cfg.days) || [];
    var on = (cfg && cfg.on) || [];
    return SEQUENCE_STEPS.map(function (s, i) {
      var raw = days[i];
      var d = (raw === undefined || raw === '') ? s.day : Math.max(0, Math.round(Number(raw) || 0));
      return {
        n: s.n,
        day: d,
        channel: s.channel,
        label: s.label,
        enabled: on[i] === undefined ? true : !!on[i]
      };
    }).filter(function (s) { return s.enabled; });
  }

  function buildSequence(segment, bizName, tone, aov, customOffers, seqCfg) {
    tone = (tone === 'bold') ? 'bold' : 'warm';
    var camp = generateCampaign(segment, bizName, tone, aov, customOffers);
    var tpl = SEQ_COPY[tone];
    var vars = { biz: bizName || 'our store', offer: camp.offer.value, name: '{name}' };
    var bodies = {
      1: { subject: camp.subjects[0], body: camp.email, preview: camp.preview },
      2: { subject: '', body: fill(tpl.sms.body, vars), preview: '' },
      3: { subject: fill(tpl.nudge.subject, vars), body: fill(tpl.nudge.body, vars), preview: fill(tpl.nudge.preview, vars) },
      4: { subject: fill(tpl.final.subject, vars), body: fill(tpl.final.body, vars), preview: fill(tpl.final.preview, vars) }
    };
    return resolveSequenceSteps(seqCfg).map(function (s) {
      var b = bodies[s.n];
      return {
        n: s.n, day: s.day, channel: s.channel, label: s.label,
        subject: b.subject, body: b.body, preview: b.preview
      };
    });
  }

  /* Fill the remaining per-customer merge tags on a sequence step. */
  function personalizeSeqStep(step, customer) {
    var vars = {
      name: firstName(customer.name),
      last_purchase: customer.lastPurchase || 'a while ago',
      total_spent: '$' + Math.round(customer.totalSpent || 0),
      segment: customer.segmentLabel || ''
    };
    return {
      n: step.n, day: step.day, channel: step.channel, label: step.label,
      subject: fill(step.subject || '', vars), body: fill(step.body || '', vars)
    };
  }

  function seqDateAdd(iso, days) {
    var d = parseDate(iso) || new Date();
    return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
  }

  /* Next sequence step due for a tracked entry, or null (done / not yet due /
     resolved). entry.seq = {start: 'YYYY-MM-DD', done: <completed steps>,
     steps: <resolved steps at start time>}. */
  function seqEntrySteps(entry) {
    return (entry.seq && entry.seq.steps && entry.seq.steps.length)
      ? entry.seq.steps
      : SEQUENCE_STEPS;
  }

  function seqNextDue(entry, today) {
    if (!entry || !entry.seq || !entry.seq.start) return null;
    if (entry.result === 'won' || entry.result === 'unsub') return null;
    var steps = seqEntrySteps(entry);
    var done = entry.seq.done || 0;
    if (done >= steps.length) return null;
    var step = steps[done];
    var due = seqDateAdd(entry.seq.start, step.day);
    var now = today || wbTodayISO();
    if (due > now) return null;
    return { step: step, due: due };
  }

  /* Mark the next due sequence step done: returns a fresh entry with the
     follow-up date moved to the step after. */
  function advanceSequenceEntry(entry, today) {
    var out = Object.assign({}, entry);
    var steps = seqEntrySteps(entry);
    var done = ((entry.seq && entry.seq.done) || 0) + 1;
    out.seq = Object.assign({}, entry.seq, { done: done });
    var next = steps[done];
    out.followUp = next ? seqDateAdd(out.seq.start, next.day) : '';
    return out;
  }

  /* Build the day-0 tracking entries for starting a sequence on a segment.
     The resolved cadence is stored on each entry so custom day offsets and
     skipped steps keep working in the Tracking tab. */
  function startSequenceEntries(segmented, segment, suppressions, today, seqCfg) {
    var now = today || wbTodayISO();
    var steps = resolveSequenceSteps(seqCfg);
    if (!steps.length) return [];
    var first = steps[0];
    var nextDue = steps[1] ? seqDateAdd(now, steps[1].day) : '';
    return activeCustomers(
      (segmented || []).filter(function (c) { return c.segment === segment; }),
      suppressions
    ).map(function (c) {
      return {
        email: c.email, name: c.name || '', segment: c.segmentLabel,
        date: now, channel: first.channel, result: 'sent', group: '',
        followUp: nextDue, source: 'sequence',
        seq: {
          start: now, done: 1,
          steps: steps.map(function (s) {
            return { n: s.n, day: s.day, channel: s.channel, label: s.label };
          })
        }
      };
    });
  }

  return {
    SEGMENTS: SEGMENTS,
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS,
    parseCSV: parseCSV,
    daysSince: daysSince,
    validateEmail: validateEmail,
    segmentCustomers: segmentCustomers,
    generateCampaign: generateCampaign,
    personalize: personalize,
    offerFor: offerFor,
    resolveOffer: resolveOffer,
    estimateROI: estimateROI,
    segmentCounts: segmentCounts,
    firstName: firstName,
    sortCustomers: sortCustomers,
    searchCustomers: searchCustomers,
    suppressEmail: suppressEmail,
    unsuppressEmail: unsuppressEmail,
    isSuppressed: isSuppressed,
    activeCustomers: activeCustomers,
    segmentToCSV: segmentToCSV,
    followUpsDue: followUpsDue,
    winScore: winScore,
    logSend: logSend,
    campaignStats: campaignStats,
    segmentKeyFromLabel: segmentKeyFromLabel,
    rankTargets: rankTargets,
    splitAB: splitAB,
    abCompare: abCompare,
    findDuplicatePairs: findDuplicatePairs,
    mergeCustomers: mergeCustomers,
    todayISO: wbTodayISO,
    splitName: splitName,
    composeMailto: composeMailto,
    ESP_FORMATS: ESP_FORMATS,
    espExport: espExport,
    parseResultImport: parseResultImport,
    importResults: importResults,
    offerCostPerWinner: offerCostPerWinner,
    estimateROIActual: estimateROIActual,
    previewText: previewText,
    SEQUENCE_STEPS: SEQUENCE_STEPS,
    resolveSequenceSteps: resolveSequenceSteps,
    buildSequence: buildSequence,
    personalizeSeqStep: personalizeSeqStep,
    seqDateAdd: seqDateAdd,
    seqNextDue: seqNextDue,
    advanceSequenceEntry: advanceSequenceEntry,
    startSequenceEntries: startSequenceEntries
  };
});

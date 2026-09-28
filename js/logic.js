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
    var rows = [], errors = [], seen = {};
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return { rows: rows, errors: ['CSV needs a header row plus at least one data row.'] };

    var headers = splitCSVLine(lines[0]);
    var iName = headerIndex(headers, ['name', 'fullname', 'customer', 'customername']);
    var iEmail = headerIndex(headers, ['email', 'emailaddress']);
    var iLast = headerIndex(headers, ['lastpurchase', 'lastorder', 'lastpurchasedate', 'lastbuy', 'lastvisit']);
    var iSpent = headerIndex(headers, ['totalspent', 'spent', 'lifetimevalue', 'ltv', 'total', 'revenue']);
    var iOrders = headerIndex(headers, ['orders', 'ordercount', 'purchases', 'numorders']);

    if (iEmail < 0) return { rows: rows, errors: ['No email column found. Need at least an "email" column.'] };

    for (var r = 1; r < lines.length; r++) {
      var cols = splitCSVLine(lines[r]);
      var email = (cols[iEmail] || '').trim().toLowerCase();
      if (!email) { errors.push('Row ' + (r + 1) + ': skipped (no email).'); continue; }
      if (!validateEmail(email)) { errors.push('Row ' + (r + 1) + ': skipped (bad email "' + email + '").'); continue; }
      if (seen[email]) { errors.push('Row ' + (r + 1) + ': skipped (duplicate of ' + email + ').'); continue; }
      seen[email] = true;
      var lastRaw = iLast >= 0 ? (cols[iLast] || '') : '';
      var last = parseDate(lastRaw);
      rows.push({
        name: iName >= 0 ? (cols[iName] || '').trim() : '',
        email: email,
        lastPurchase: last ? last.toISOString().slice(0, 10) : '',
        lastPurchaseRaw: lastRaw,
        totalSpent: toNumber(iSpent >= 0 ? cols[iSpent] : '', 0),
        orders: Math.max(1, Math.round(toNumber(iOrders >= 0 ? cols[iOrders] : '', 1)))
      });
    }
    return { rows: rows, errors: errors };
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
        segmentLabel: SEGMENTS[seg].label
      };
    });
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

  function generateCampaign(segment, businessName, tone, avgOrderValue) {
    tone = (tone === 'bold') ? 'bold' : 'warm';
    var tpl = (COPY[segment] || COPY.unknown)[tone];
    var offer = offerFor(segment, avgOrderValue);
    var vars = { biz: businessName || 'our store', offer: offer.value, name: '{name}' };
    return {
      segment: segment,
      segmentLabel: (SEGMENTS[segment] || SEGMENTS.unknown).label,
      tone: tone,
      offer: offer,
      subjects: tpl.subjects.map(function (s) { return fill(s, vars); }),
      email: fill(tpl.email, vars),
      sms: fill(tpl.sms, vars)
    };
  }

  /* Personalize a campaign template for one customer. */
  function personalize(campaign, customer) {
    var vars = { name: firstName(customer.name) };
    return {
      subjects: campaign.subjects.map(function (s) { return fill(s, vars); }),
      email: fill(campaign.email, vars),
      sms: fill(campaign.sms, vars)
    };
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
      var offer = offerFor(seg, aov);
      var discountCost = 0;
      if (offer.type === 'discount') {
        var pct = parseFloat(offer.value) / 100 || 0;
        discountCost = aov * pct; // margin given away per redeemer
      } else {
        discountCost = offerCost[offer.type] || 0;
      }
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
    estimateROI: estimateROI,
    segmentCounts: segmentCounts,
    firstName: firstName
  };
});

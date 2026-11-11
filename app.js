/* Verb Master: application logic. Data comes from verbs-data.js (window.VERB_DATA, window.VERB_GROUPS).
   Sections: config · helpers · data checks · answer checking · progress store (spaced retrieval) · round building ·
   rendering (dashboard, unit, activities, results) · actions · init. Plain ES5, no dependencies. */
(function () {
'use strict';
if (window.__vpInit) return; window.__vpInit = true;

/* ===== config ===== */
var STORE_KEY = 'levelup-2bac-verb-master-v1';
var ACTS = [
  { key: 'learn',  name: 'Learn & Discover',        sub: 'Flashcards: the three forms, meaning, Arabic and an example' },
  { key: 'match',  name: 'Match the Meaning',       sub: 'Match each verb with its English meaning or Arabic translation' },
  { key: 'build',  name: 'Build the Three Forms',   sub: 'Put the right tiles in order: base, past, past participle' },
  { key: 'type',   name: 'Complete the Missing Form', sub: 'Type the simple past or the past participle from memory' },
  { key: 'detect', name: 'Meaning Detective',       sub: 'Find the verb from its meaning, its Arabic or a sentence' },
  { key: 'master', name: 'Verb Master Challenge',   sub: 'A mixed final challenge on forms, meanings and context' }
];
var SIZE = { build: 8, type: 10, detect: 10, master: 12, revision: 15 };
var BOARD = 6;               /* pairs per Match board */
var PASS = 0.8;              /* an activity counts as completed at 80% or more (Learn: all cards seen) */
var BOX_MS = [0, 10 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3]; /* Leitner boxes 0..5 */
var LEVELS = [[0, 'Starter'], [100, 'Explorer'], [250, 'Learner'], [500, 'Achiever'], [850, 'Skilled'], [1300, 'Expert'], [1900, 'Champion'], [2600, 'Master'], [3500, 'Grand Master'], [4600, 'Legend']];
var BADGES = [
  { key: 'first',   ic: '🚀', name: 'First Steps',    how: 'Finish your first activity' },
  { key: 'streak5', ic: '🔥', name: 'Hot Streak',     how: '5 correct answers in a row' },
  { key: 'streak10',ic: '⚡', name: 'On Fire',        how: '10 correct answers in a row' },
  { key: 'perfect', ic: '💯', name: 'Perfect Round',  how: '100% in a round (not flashcards)' },
  { key: 'fixer',   ic: '🔁', name: 'Comeback',       how: 'Correct 10 verbs you had wrong before' },
  { key: 'unit',    ic: '🏅', name: 'Unit Champion',  how: 'Complete all 6 activities of a unit' },
  { key: 'reviser', ic: '📚', name: 'Revision Pro',   how: 'Finish 3 revision rounds' },
  { key: 'm25',     ic: '🧠', name: '25 Mastered',    how: 'Master 25 verbs' },
  { key: 'half',    ic: '⭐', name: 'Halfway Hero',   how: 'Complete 5 units' },
  { key: 'legend',  ic: '👑', name: 'Verb Legend',    how: 'Complete all 10 units' }
];
/* Single-unit link: index.html?unit=3 shows only Unit 3 (for embedding each unit separately). No or invalid value = full platform. */
var LOCK = (function () { var m = /[?&#]unit=(\d+)/.exec(String(window.location.search) + String(window.location.hash)), n = m ? +m[1] : 0; return n >= 1 && n <= 10 ? n : null; })();
var STATUS_LABEL = { 'new': 'New', learning: 'Learning', practising: 'Practising', mastered: 'Mastered' };

/* ===== helpers ===== */
var $ = function (s) { return document.querySelector(s); };
var app = $('#app');
function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function say(t) { $('#liveMsg').textContent = t; }
function ar(t, tag) { return '<' + (tag || 'span') + ' class="ar" lang="ar" dir="rtl">' + esc(t) + '</' + (tag || 'span') + '>'; }
function now() { return Date.now(); }
function actName(k) { return k === 'revision' ? 'Revision' : ACTS.filter(function (a) { return a.key === k; })[0].name; }

/* ===== data + checks: bad data shows a visible error, never a blank page ===== */
var VERBS = window.VERB_DATA || [], GROUPS = window.VERB_GROUPS || [], BY_ID = {}, UNITS = [];
function alts(s) { return String(s).toLowerCase().split(/\s+or\s+|\/|,/).map(function (x) { return x.trim(); }).filter(Boolean); }
/* the word of the example sentence that is a form of the verb (used for the hidden-word questions) */
function findGap(v) {
  var forms = {}, b = v.base;
  [b].concat(alts(v.past), alts(v.pp)).forEach(function (f) { forms[f] = 1; });
  [b + 's', b + 'es', b.replace(/y$/, 'ies'), b + 'ing', b.replace(/e$/, '') + 'ing'].forEach(function (f) { forms[f] = 1; });
  if (b === 'be') ['am', 'is', 'are'].forEach(function (f) { forms[f] = 1; });
  var re = /[A-Za-z']+/g, m, hits = [];
  while ((m = re.exec(v.ex))) if (forms[m[0].toLowerCase()]) hits.push({ w: m[0], i: m.index });
  return hits.length === 1 ? hits[0] : null;
}
function validate() {
  var errs = [], ids = {}, bases = {};
  if (VERBS.length !== 182) errs.push('Expected 182 verbs, found ' + VERBS.length);
  var irr = VERBS.filter(function (v) { return v.type === 'irregular'; }).length;
  if (irr !== 108 || VERBS.length - irr !== 74) errs.push('Expected 108 irregular + 74 regular, found ' + irr + ' + ' + (VERBS.length - irr));
  for (var u = 1; u <= 10; u++) UNITS[u] = [];
  VERBS.forEach(function (v) {
    ['id', 'type', 'base', 'past', 'pp', 'meaning', 'ar', 'ex', 'exAr'].forEach(function (k) { if (!v[k]) errs.push((v.id || '?') + ': missing ' + k); });
    if (ids[v.id]) errs.push('duplicate id ' + v.id); ids[v.id] = 1;
    if (bases[v.base]) errs.push('duplicate verb ' + v.base); bases[v.base] = 1;
    if (!(v.unit >= 1 && v.unit <= 10)) errs.push(v.id + ': bad unit'); else UNITS[v.unit].push(v);
    v.gap = findGap(v); if (!v.gap) errs.push(v.base + ': example has no single form of the verb');
    BY_ID[v.id] = v;
  });
  for (var n = 1; n <= 10; n++) {
    var i = UNITS[n].filter(function (v) { return v.type === 'irregular'; }).length, r = UNITS[n].length - i, want = n <= 8 ? [11, 7] : [10, 9];
    if (i !== want[0] || r !== want[1]) errs.push('Unit ' + n + ': ' + i + ' irregular + ' + r + ' regular (expected ' + want.join(' + ') + ')');
  }
  GROUPS.forEach(function (g) { g.forEach(function (b) { if (!bases[b]) errs.push('group word not found: ' + b); }); });
  return errs;
}
/* two verbs that must never be offered against each other or share a board */
function clash(a, b) {
  if (a.id === b.id || a.ar === b.ar || a.meaning === b.meaning) return true;
  return GROUPS.some(function (g) { return g.indexOf(a.base) > -1 && g.indexOf(b.base) > -1; });
}

/* ===== answer checking ===== */
function accepted(v, slot) {
  var set = {}; alts(v[slot]).forEach(function (f) { set[f] = 1; });
  if (v.accept && v.accept[slot]) v.accept[slot].forEach(function (f) { set[f.toLowerCase()] = 1; });
  return set;
}
function norm(s) { return String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }
/* typed answer is right when every part (split on "or", "/", ",") is an accepted form: "burnt", "burned or burnt", "was/were" */
function checkTyped(input, set) {
  var parts = norm(input).split(/\s+or\s+|\/|,/).map(function (x) { return x.trim(); }).filter(Boolean);
  return parts.length > 0 && parts.every(function (p) { return set[p] === 1; });
}
/* the hidden word in a sentence: the exact word, or another accepted spelling of the same form (burned / burnt) */
function gapSet(v) {
  var w = v.gap.w.toLowerCase(), set = {}; set[w] = 1;
  ['past', 'pp'].forEach(function (slot) { var s = accepted(v, slot); if (s[w]) Object.keys(s).forEach(function (k) { set[k] = 1; }); });
  return set;
}

/* ===== progress store (this browser only) ===== */
var storeOk = true, store;
function blank() { return { v: {}, a: {}, xp: 0, streak: 0, bestStreak: 0, badges: {}, fixes: 0, revisions: 0 }; }
store = blank();
try { var raw = window.localStorage.getItem(STORE_KEY); if (raw) { var p = JSON.parse(raw); if (p && p.v && p.a) store = Object.assign(blank(), p); } } catch (e) { storeOk = false; }
function save() { if (!storeOk) return; try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { storeOk = false; } }
/* Spaced retrieval (Leitner): wrong → box 0, due now. Right → up one box, but only when the verb was due
   (so cramming the same verb in one sitting does not jump it to "mastered"). */
function recordVerb(id, ok) {
  var r = store.v[id] || (store.v[id] = { b: 0, d: 0, r: 0, w: 0, last: null }), t = now();
  if (ok) { if (r.last === false) store.fixes++; r.r++; if (r.d <= t) { r.b = Math.min(5, r.b + 1); r.d = t + BOX_MS[r.b]; } }
  else { r.w++; r.b = 0; r.d = t; }
  r.last = !!ok;
}
function status(id) {
  var r = store.v[id]; if (!r || r.last === null) return 'new';
  if (r.b >= 4) return 'mastered';
  if (r.b >= 2) return 'practising';
  return 'learning';
}
function isDue(id) { var r = store.v[id]; return !!r && r.last !== null && (r.last === false || r.d <= now()); }
/* order for practice: wrong last time, then due, then new, then not yet due; lower box first; random inside */
function priority(v) {
  var r = store.v[v.id];
  if (!r || r.last === null) return 2000 + Math.random();
  return (r.last === false ? 0 : r.d <= now() ? 1000 : 3000) + r.b * 10 + Math.random();
}
function pickVerbs(list, n) {
  return list.map(function (v) { return { v: v, p: priority(v) }; }).sort(function (a, b) { return a.p - b.p; }).map(function (x) { return x.v; }).slice(0, n === undefined ? list.length : n);
}
function actKey(unit, act) { return 'u' + unit + '-' + act; }
function actRec(unit, act) { return store.a[actKey(unit, act)] || null; }
function unitDone(u) { return ACTS.filter(function (a) { var r = actRec(u, a.key); return r && r.done; }).length; }
function unitsComplete() { var n = 0; for (var u = 1; u <= 10; u++) if (unitDone(u) === 6) n++; return n; }
function masteredCount() { return VERBS.filter(function (v) { return status(v.id) === 'mastered'; }).length; }
function level(xp) { var i = 0; while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1][0]) i++; return { n: i + 1, name: LEVELS[i][1], from: LEVELS[i][0], to: i < LEVELS.length - 1 ? LEVELS[i + 1][0] : null }; }
function startedUnits() { var s = []; for (var u = 1; u <= 10; u++) if (UNITS[u].some(function (v) { return store.v[v.id]; })) s.push(u); return s; }
/* due verbs from the units already started (on a single-unit link: only this unit and the units before it) */
function dueVerbs() { var s = startedUnits(); return VERBS.filter(function (v) { return s.indexOf(v.unit) > -1 && (!LOCK || v.unit <= LOCK) && isDue(v.id) && store.v[v.id].b < 5; }); }

/* ===== choosing distractors ===== */
function others(target, from, key) {
  var out = [];
  shuffle(from).forEach(function (x) { if (out.length < 3 && !clash(x, target) && x[key] !== target[key] && !out.some(function (y) { return clash(x, y) || x[key] === y[key]; })) out.push(x); });
  if (out.length < 3) shuffle(VERBS).forEach(function (x) { if (out.length < 3 && !clash(x, target) && x[key] !== target[key] && !out.some(function (y) { return clash(x, y) || x[key] === y[key]; })) out.push(x); });
  return out;
}
/* wrong forms for "Build the Three Forms": typical learner errors plus real forms of other verbs */
function regularise(b) { return /e$/.test(b) ? b + 'd' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ied' : b + 'ed'; }
function fakeForms(v, pool) {
  var right = {}; [v.base].concat(alts(v.past), alts(v.pp)).forEach(function (f) { right[f] = 1; });
  [v.past, v.pp].forEach(function (t) { right[t.toLowerCase()] = 1; });
  var c = [], b = v.base;
  var third = /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ies' : /(s|sh|ch|x|o|z)$/.test(b) ? b + 'es' : b + 's';
  if (b === 'be') c = ['is', 'are', 'being'];
  else if (v.type === 'irregular') {
    c.push(regularise(b));                                   /* teach → teached */
    c.push(/e$/.test(b) ? b + 'n' : b + 'en');               /* drink → drinken */
    c.push(third);                                           /* drinks */
  } else {
    var p = alts(v.past)[0];
    if (b === 'cancel') c.push('cancell');                   /* "canceled" is correct US spelling, so never offer it */
    else if (/([^aeiou])\1ed$/.test(p)) c.push(p.replace(/([^aeiou])\1ed$/, '$1ed'));            /* stopped → stoped */
    else if (/ied$/.test(p)) c.push(b + 'ed');                                                   /* tried → tryed */
    else if (/[aeiou][^aeiouwxy]$/.test(b) && b.length <= 6) c.push(b + b.slice(-1) + 'ed');      /* visit → visitted */
    else if (/e$/.test(b)) c.push(b + 'ed');                                                     /* like → likeed */
    c.push(b.replace(/e$/, '') + 'ing');                      /* -ing form */
    c.push(third);                                           /* -s form */
  }
  var out = [];
  c.forEach(function (f) { if (!right[f] && out.indexOf(f) < 0 && out.length < 3) out.push(f); });
  shuffle(pool).forEach(function (x) {
    if (out.length >= 3 || x.id === v.id) return;
    [x.past, x.pp].forEach(function (f) { if (out.length < 3 && !right[f.toLowerCase()] && out.indexOf(f) < 0) out.push(f); });
  });
  return out;
}

/* ===== round building ===== */
var view = { page: LOCK ? 'unit' : 'home', unit: LOCK || 1, revTo: LOCK || 2, confirmReset: false };
var R = null;
function makeItem(v, kind, again) {
  if (kind === 'ctx' && v.gap.w.toLowerCase() === v.base) kind = 'type'; /* the sentence uses the base form: nothing to recall */
  var it = { id: v.id, kind: kind, tries: 0, answered: false, ok: null, again: !!again, picked: [] };
  if (kind === 'det-en' || kind === 'det-ar' || kind === 'det-ex') it.choices = shuffle([v].concat(others(v, UNITS[v.unit], 'base'))).map(function (x) { return x.id; });
  if (kind === 'build') {
    var t = [v.base, v.past, v.pp].concat(fakeForms(v, UNITS[v.unit]));
    it.tiles = shuffle(t.map(function (x, k) { return { t: x, k: k }; })); it.slots = [null, null, null]; it.wrongSlots = [];
  }
  if (kind === 'type') { it.hide = v.type === 'irregular' && R && (R.act === 'master' || R.act === 'revision') && Math.random() < 0.4 ? 'both' : Math.random() < 0.5 ? 'past' : 'pp'; it.vals = {}; it.marks = {}; }
  if (kind === 'ctx') { it.val = ''; }
  return it;
}
function kindsFor(act) {
  if (act === 'type') return ['type'];
  if (act === 'build') return ['build'];
  if (act === 'detect') return ['det-en', 'det-ar', 'det-ex'];
  return ['type', 'det-ar', 'ctx', 'build', 'det-en', 'det-ex']; /* master + revision */
}
function boardsOf(list) {
  var nb = Math.max(1, Math.ceil(list.length / BOARD)), out = [];
  for (var b = 0; b < nb; b++) out.push([]);
  var rest = [];
  list.forEach(function (v) {
    var bd = out.filter(function (x) { return x.length < Math.ceil(list.length / nb) && !x.some(function (y) { return clash(y, v); }); })[0];
    if (bd) bd.push(v); else rest.push(v);
  });
  rest.forEach(function (v) { var bd = out.filter(function (x) { return !x.some(function (y) { return clash(y, v); }); })[0]; if (!bd) { bd = []; out.push(bd); } bd.push(v); });
  return out.filter(function (x) { return x.length; });
}
function startRound(act, unit, override) {
  var pool = act === 'revision' ? (unit === 'due' ? dueVerbs() : VERBS.filter(function (v) { return v.unit <= unit; })) : UNITS[unit];
  if (!pool.length) { view.page = 'home'; renderPage('There are no verbs due for review right now. Well done!'); return; }
  R = { act: act, unit: unit, retry: !!override, i: 0, items: [], streak: 0, xp: 0, recycled: {}, started: now() };
  var list = override || (act === 'learn' || act === 'match' ? pickVerbs(pool) : pickVerbs(pool, SIZE[act] || SIZE.revision));
  if (act === 'learn') R.items = list.map(function (v) { return { id: v.id, kind: 'flash', flipped: false, answered: false, ok: null }; });
  else if (act === 'match') {
    R.boards = boardsOf(shuffle(list)).map(function (b, k) { return { verbs: b, side: k % 2 ? 'ar' : 'en', order: shuffle(b), done: {}, wrong: {}, active: null, flash: null }; });
    R.b = 0;
  } else {
    var ks = kindsFor(act);
    R.items = list.map(function (v, k) { return makeItem(v, ks[k % ks.length]); });
    if (ks.length > 1) R.items = shuffle(R.items);
  }
  view.page = 'round'; render(); window.scrollTo(0, 0);
}

/* ===== rendering ===== */
function setInfo(l) { $('#infoL').textContent = l; }
function render() {
  if (view.page !== 'round' || !R) return renderPage();
  if (R.finished) return results();
  if (R.act === 'match') return renderMatch();
  renderItem();
}
function renderPage(msg) {
  R = null;
  if (LOCK) { view.page = 'unit'; view.unit = LOCK; } /* single-unit link: the unit page is the home page */
  if (view.page === 'unit') return unitPage(msg);
  return home(msg);
}
function statsRow() {
  var L = level(store.xp), pct = L.to ? Math.round((store.xp - L.from) / (L.to - L.from) * 100) : 100;
  var nb = BADGES.filter(function (b) { return store.badges[b.key]; }).length;
  return '<div class="stats">' +
    '<div class="stat"><small>Level ' + L.n + '</small><b id="lvlName">' + esc(L.name) + '</b><div class="lvlbar" aria-hidden="true"><span style="width:' + pct + '%"></span></div><small>' + store.xp + (L.to ? ' / ' + L.to : '') + ' XP</small></div>' +
    '<div class="stat"><small>Verbs mastered</small><b id="mastN">' + masteredCount() + '</b><small>of 182</small></div>' +
    '<div class="stat"><small>Best streak</small><b id="bestStreak">' + store.bestStreak + '</b><small>correct in a row</small></div>' +
    '<div class="stat"><small>Badges</small><b id="badgeN">' + nb + '</b><small>of ' + BADGES.length + '</small></div></div>';
}
function statusBar(list) {
  var c = { 'new': 0, learning: 0, practising: 0, mastered: 0 };
  list.forEach(function (v) { c[status(v.id)]++; });
  var seg = function (k) { return c[k] ? '<span class="st-' + k + '" style="width:' + (c[k] / list.length * 100) + '%"></span>' : ''; };
  return '<span class="bar" role="img" aria-label="' + c.mastered + ' mastered, ' + c.practising + ' practising, ' + c.learning + ' learning, ' + c['new'] + ' new">' + seg('mastered') + seg('practising') + seg('learning') + '</span>';
}
function legend() { return '<div class="legend">' + ['mastered', 'practising', 'learning', 'new'].map(function (k) { return '<span><span class="dot st-' + k + '"></span>' + STATUS_LABEL[k] + '</span>'; }).join('') + '</div>'; }
function home(msg) {
  setInfo('UNITS: 1–10');
  var h = '<div class="hero"><h1>VERB <span>MASTER</span></h1><p>182 English verbs · 10 units · 6 activities per unit</p></div>';
  if (!storeOk) h += '<p class="warn">Your progress cannot be saved in this browser (storage is blocked). You can still practise; progress is kept until you close the page.</p>';
  if (msg) h += '<p class="warn" role="status">' + esc(msg) + '</p>';
  h += statsRow();
  h += '<h2 class="section-title">Your units</h2><div class="units">';
  for (var u = 1; u <= 10; u++) {
    var d = unitDone(u), list = UNITS[u], irr = list.filter(function (v) { return v.type === 'irregular'; }).length;
    h += '<button type="button" class="unit' + (d === 6 ? ' complete' : '') + '" data-act="unit" data-unit="' + u + '">' + (d === 6 ? '<span class="crown" aria-hidden="true">👑</span>' : '') +
      '<b>Unit ' + u + '</b><small>' + list.length + ' verbs · ' + irr + ' irregular · ' + (list.length - irr) + ' regular</small><span class="acts" data-unit-done="' + u + '">' + d + ' / 6 activities</span>' + statusBar(list) + '</button>';
  }
  h += '</div>' + legend();
  h += revisionPanel() + badgesPanel() + resetPanel();
  app.innerHTML = h;
}
/* revision: full platform = any range 1–n; single-unit link = Units 1 to this unit (earlier units' progress is shared on the same site) */
function revisionPanel() {
  var due = dueVerbs().length, started = startedUnits().filter(function (u) { return !LOCK || u <= LOCK; });
  var range = LOCK ? (LOCK === 1 ? 'Unit 1' : 'Units 1–' + LOCK) : '';
  return '<h2 class="section-title">Revision</h2><div class="panel"><div class="revrow">' +
    '<button type="button" class="btn primary" data-act="due"' + (due ? '' : ' disabled') + '>Smart review: ' + due + ' verb' + (due === 1 ? '' : 's') + ' due</button>' +
    (LOCK ? '<button type="button" class="btn gold" data-act="cumul">' + (LOCK === 1 ? 'Mixed revision: Unit 1' : 'Cumulative revision: ' + range) + '</button>' :
      '<label for="revTo" class="sr-only">Revise units 1 to</label><select id="revTo" data-act="revto">' + [2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option value="' + n + '"' + (view.revTo === n ? ' selected' : '') + '>Units 1–' + n + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn gold" data-act="cumul">Cumulative revision</button>') + '</div>' +
    '<p class="note">Smart review brings back the verbs you got wrong and the verbs that are due again' + (started.length ? ' (from unit' + (started.length > 1 ? 's ' : ' ') + started.join(', ') + ')' : '') + '. ' +
    (LOCK ? 'Revision mixes ' + SIZE.revision + ' verbs from ' + range + '.' : 'Cumulative revision mixes ' + SIZE.revision + ' verbs from the units you choose.') + ' Your units never change.</p></div>';
}
function badgesPanel() {
  return '<h2 class="section-title">Badges</h2><div class="badges">' + BADGES.map(function (b) {
    return '<div class="bdg' + (store.badges[b.key] ? ' on' : '') + '" data-badge="' + b.key + '"><span class="ic" aria-hidden="true">' + b.ic + '</span><b>' + esc(b.name) + '</b>' + esc(b.how) + (store.badges[b.key] ? '<span class="sr-only"> (earned)</span>' : '<span class="sr-only"> (not yet earned)</span>') + '</div>';
  }).join('') + '</div>';
}
function resetPanel() {
  return '<p class="note">Progress is saved on this device and in this browser only' + (LOCK ? ', and is shared by all 10 units' : '') + '.</p><div class="actions">' + (view.confirmReset ?
    '<span class="confirm" role="alert">Delete all your progress (all units) on this device? <button type="button" class="btn danger" data-act="resetyes">Yes, delete</button><button type="button" class="btn" data-act="resetno">Cancel</button></span>' :
    '<button type="button" class="btn" data-act="reset">Reset my progress</button>') + '</div>';
}
function unitPage(msg) {
  var u = view.unit, list = UNITS[u];
  setInfo('UNIT: ' + u);
  var h = LOCK ? '<div class="hero"><h1>VERB <span>MASTER</span> · UNIT ' + u + '</h1><p>' + list.length + ' verbs · 6 activities</p></div>' + (storeOk ? '' : '<p class="warn">Your progress cannot be saved in this browser (storage is blocked). You can still practise; progress is kept until you close the page.</p>') + statsRow() +
      '<div class="nav-row" style="margin-top:0"><span class="pill">' + unitDone(u) + ' / 6 activities</span></div>' :
    '<div class="nav-row" style="margin-top:0"><button type="button" class="btn" data-act="home">⌂ All units</button><span class="pill">' + unitDone(u) + ' / 6 activities</span></div>';
  h += '<div class="instruction" style="margin-top:12px">Unit ' + u + ' · ' + list.length + ' verbs</div>';
  if (msg) h += '<p class="warn" role="status">' + esc(msg) + '</p>';
  h += statusBar(list) + legend();
  h += '<h2 class="section-title">Activities <span class="note">(suggested order 1 → 6)</span></h2><div class="acts-grid">' + ACTS.map(function (a, k) {
    var r = actRec(u, a.key), meta = !r ? 'Not started' : (r.done ? '✓ Completed · ' : '') + (a.key === 'learn' ? 'Cards: ' + r.plays + ' round' + (r.plays === 1 ? '' : 's') + ' · knew ' + Math.round(r.c / Math.max(1, r.t) * 100) + '%' : 'Best ' + Math.round(r.best * 100) + '% · accuracy ' + Math.round(r.c / Math.max(1, r.t) * 100) + '% · ' + r.plays + ' round' + (r.plays === 1 ? '' : 's'));
    return '<button type="button" class="act' + (r && r.done ? ' done' : '') + '" data-act="start" data-a="' + a.key + '"><span class="num">' + (r && r.done ? '✓' : k + 1) + '</span><b>' + esc(a.name) + '</b><small>' + esc(a.sub) + '</small><span class="meta" data-meta="' + a.key + '">' + meta + '</span></button>';
  }).join('') + '</div>';
  h += '<p class="note">An activity is completed when you finish a round with ' + Math.round(PASS * 100) + '% or more (Learn &amp; Discover: when you have seen every card).</p>';
  h += '<h2 class="section-title">The verbs of Unit ' + u + '</h2><div class="tablewrap"><table class="vt"><thead><tr><th>Level</th><th>Base form</th><th>Simple past</th><th>Past participle</th><th>Arabic</th></tr></thead><tbody>' +
    list.slice().sort(function (a, b) { return a.base < b.base ? -1 : 1; }).map(function (v) {
      var s = status(v.id);
      return '<tr><td><span class="dot st-' + s + '"></span><span class="sr-only">' + STATUS_LABEL[s] + '</span></td><td><b>' + esc(v.base) + '</b>' + (v.type === 'regular' ? ' <small class="note">(regular)</small>' : '') + '</td><td>' + esc(v.past) + '</td><td>' + esc(v.pp) + '</td><td class="ar" lang="ar" dir="rtl">' + esc(v.ar) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  if (LOCK) h += revisionPanel() + badgesPanel() + resetPanel();
  app.innerHTML = h;
}
function topbar(done, total) {
  var where = R.act === 'revision' ? (R.unit === 'due' ? 'Smart review' : R.unit === 1 ? 'Unit 1' : 'Units 1–' + R.unit) : 'Unit ' + R.unit;
  return '<div class="topbar"><span>' + esc(actName(R.act)) + ' · ' + where + (R.retry ? ' · retry' : '') + '</span><span><span class="pill" id="streak">🔥 ' + R.streak + '</span> <span class="pill">+' + R.xp + ' XP</span> ' + done + ' / ' + total + '</span></div>' +
    '<div class="progress" aria-hidden="true"><span style="width:' + Math.round(done / Math.max(1, total) * 100) + '%"></span></div>';
}
function head(title, sub) { return '<div class="instruction">' + esc(title) + '</div>' + (sub ? '<p class="task">' + esc(sub) + '</p>' : ''); }
function formsBox(v) { return '<div class="forms"><div><small>Base</small><b>' + esc(v.base) + '</b></div><div><small>Simple past</small><b>' + esc(v.past) + '</b></div><div><small>Past participle</small><b>' + esc(v.pp) + '</b></div></div>'; }
function gapSentence(v, reveal) {
  var e = v.ex, g = v.gap;
  return esc(e.slice(0, g.i)) + (reveal ? '<span class="fill">' + esc(g.w) + '</span>' : '<span class="gap" aria-label="gap">&nbsp;</span>') + esc(e.slice(g.i + g.w.length));
}
var canSpeak = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
function speakBtn(v) { return canSpeak ? '<button type="button" class="speak" data-act="speak" data-id="' + v.id + '" aria-label="Listen to ' + esc(v.base) + '">🔊</button>' : ''; }
function navRow(it, last) {
  return '<div class="nav-row"><button type="button" class="btn" data-act="quit">✕ Stop</button>' +
    '<button type="button" class="btn primary" data-act="next"' + (it.answered ? '' : ' disabled') + '>' + (last ? 'See results ▶' : 'Next ▶') + '</button></div>';
}
function explain(v) {
  return '<b>' + esc(v.base) + ' – ' + esc(v.past) + ' – ' + esc(v.pp) + '</b>: ' + esc(v.meaning) + ' · ' + ar(v.ar) + '<br><i>' + gapSentence(v, true) + '</i>';
}
function feedback(it, v) {
  if (!it.answered && it.tries === 1) return '<div class="feedback retry" role="status">✋ Not quite. Try once more.</div>';
  if (!it.answered) return '';
  return '<div class="feedback ' + (it.final ? 'good' : 'badf') + '" role="status">' + (it.final ? (it.ok ? '✅ Correct! ' : '✅ Correct on the second try. ') : '❌ The answer is shown in green. ') + explain(v) + '</div>';
}
function renderItem() {
  var it = R.items[R.i], v = BY_ID[it.id], last = R.i === R.items.length - 1, h = topbar(R.i + (it.answered ? 1 : 0), R.items.length);
  if (it.again) h += '<p class="note" style="text-align:center">🔁 This verb comes back because you missed it earlier.</p>';
  if (it.kind === 'flash') return renderFlash(it, v, h, last);
  if (it.kind === 'det-en' || it.kind === 'det-ar' || it.kind === 'det-ex') {
    if (it.kind === 'det-en') h += head('Meaning Detective', 'Which verb has this meaning?') + '<p class="clue">“' + esc(v.meaning) + '”</p>';
    if (it.kind === 'det-ar') h += head('Meaning Detective', 'Which verb is this in English?') + '<p class="clue ar" lang="ar" dir="rtl">' + esc(v.ar) + '</p>';
    if (it.kind === 'det-ex') h += head('Meaning Detective', 'Which verb is missing from the sentence?') + '<p class="clue">' + gapSentence(v, it.answered) + '</p><p class="sub-ar ar" lang="ar" dir="rtl">' + esc(v.exAr) + '</p>';
    h += '<div class="tiles" role="group" aria-label="Choices">' + it.choices.map(function (cid) {
      var cls = 'tile', dis = it.answered || it.picked.indexOf(cid) > -1;
      if (it.answered && cid === it.id) cls += ' correct'; else if (it.picked.indexOf(cid) > -1) cls += ' wrong';
      return '<button type="button" class="' + cls + '" data-act="choose" data-id="' + cid + '"' + (dis ? ' disabled' : '') + '>' + esc(BY_ID[cid].base) + '</button>';
    }).join('') + '</div>';
  }
  if (it.kind === 'build') h += buildBody(it, v);
  if (it.kind === 'type') h += typeBody(it, v);
  if (it.kind === 'ctx') {
    h += head('Verb in context', 'Type the missing word. Use the right form of the verb in brackets.') + '<p class="clue">' + gapSentence(v, it.answered) + ' <span class="note">(' + esc(v.base) + ')</span></p><p class="sub-ar ar" lang="ar" dir="rtl">' + esc(v.exAr) + '</p>' +
      '<label for="ctxin" class="sr-only">Missing word</label><input id="ctxin" class="ctxin' + (it.answered ? (it.final ? ' ok' : ' no') : it.tries ? ' no' : '') + '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(it.val) + '"' + (it.answered ? ' disabled' : '') + '>' +
      (it.answered ? '' : '<div class="actions"><button type="button" class="btn primary" data-act="checkctx">Check</button></div>');
  }
  h += feedback(it, v) + navRow(it, last);
  app.innerHTML = h;
  var inp = app.querySelector('input:not([disabled])'); if (inp && !it.answered) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
}
function renderFlash(it, v, h, last) {
  h += head('Learn & Discover', it.flipped ? 'Did you know the three forms?' : 'Say the simple past and the past participle in your head, then turn the card.');
  h += '<div class="flash"><span class="typetag">' + (v.type === 'irregular' ? 'Irregular verb' : 'Regular verb') + '</span><div class="big-verb">' + esc(v.base) + ' ' + speakBtn(v) + '</div>';
  if (!it.flipped) h += '<p class="front-hint">' + esc(v.meaning) + '</p><div class="actions"><button type="button" class="btn primary" data-act="flip">Turn the card ↻</button></div>';
  else h += formsBox(v) + '<p class="mean">' + esc(v.meaning) + '</p><p class="sub-ar ar" lang="ar" dir="rtl">' + esc(v.ar) + '</p><p class="ex">' + gapSentence(v, true) + '</p><p class="exar ar" lang="ar" dir="rtl">' + esc(v.exAr) + '</p>';
  h += '</div>';
  if (it.flipped && !it.answered) h += '<div class="actions"><button type="button" class="btn primary" data-act="knew">✓ I knew it</button><button type="button" class="btn" data-act="notyet">Still learning</button></div>';
  if (it.answered) h += '<div class="feedback ' + (it.ok ? 'good' : 'retry') + '" role="status">' + (it.ok ? '✅ Great! It will come back later to check.' : '👍 No problem: this verb will come back more often.') + '</div>';
  h += navRow(it, last);
  app.innerHTML = h;
}
function buildBody(it, v) {
  var h = head('Build the Three Forms', 'Tap the tiles to fill: base form → simple past → past participle.') + '<p class="clue">“' + esc(v.meaning) + '”</p><p class="sub-ar ar" lang="ar" dir="rtl">' + esc(v.ar) + '</p>';
  var labels = ['Base form', 'Simple past', 'Past participle'], right = [v.base, v.past, v.pp];
  h += '<div class="slots3">' + it.slots.map(function (k, s) {
    var tile = k === null ? null : it.tiles.filter(function (t) { return t.k === k; })[0], cls = 'slot3' + (tile ? ' filled' : '');
    if (it.answered) cls += tile && tile.t === right[s] ? ' ok' : ' no';
    else if (it.wrongSlots.indexOf(s) > -1 && !tile) cls += ' no';
    return '<button type="button" class="' + cls + '" data-act="unslot" data-s="' + s + '"' + (it.answered || !tile ? ' disabled' : '') + ' aria-label="' + labels[s] + (tile ? ': ' + esc(tile.t) : ': empty') + '"><small>' + labels[s] + '</small><b>' + (it.answered && !(tile && tile.t === right[s]) ? esc(right[s]) : tile ? esc(tile.t) : '…') + '</b></button>';
  }).join('') + '</div>';
  if (!it.answered) {
    h += '<div class="pool" role="group" aria-label="Tiles">' + it.tiles.map(function (t) { return '<button type="button" class="ftile" data-act="tile" data-k="' + t.k + '"' + (it.slots.indexOf(t.k) > -1 ? ' disabled' : '') + '>' + esc(t.t) + '</button>'; }).join('') + '</div>';
    var full = it.slots.every(function (x) { return x !== null; });
    h += '<div class="actions"><button type="button" class="btn" data-act="clear">Clear</button><button type="button" class="btn primary" data-act="checkbuild"' + (full ? '' : ' disabled') + '>Check</button></div>';
  }
  return h;
}
function typeBody(it, v) {
  var miss = it.hide === 'both' ? 'the simple past and the past participle' : it.hide === 'past' ? 'the simple past' : 'the past participle';
  var h = head('Complete the Missing Form', 'Type ' + miss + '.') + '<p class="clue">' + esc(v.meaning) + '</p><p class="sub-ar ar" lang="ar" dir="rtl">' + esc(v.ar) + '</p>';
  var cell = function (slot, label) {
    var hidden = slot !== 'base' && (it.hide === 'both' || it.hide === slot); /* the base form is always given */
    var inner = !hidden ? '<div class="given">' + esc(v[slot]) + '</div>' :
      it.answered ? '<div class="given" style="background:' + (it.marks[slot] ? 'var(--okbg)' : 'var(--badbg)') + '">' + esc(it.marks[slot] ? it.vals[slot] : v[slot]) + '</div>' :
      '<input id="in-' + slot + '" data-slot="' + slot + '" class="' + (it.tries && it.marks[slot] === false ? 'no' : it.tries && it.marks[slot] ? 'ok' : '') + '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(it.vals[slot] || '') + '" aria-label="' + label + '">';
    return '<div><label' + (hidden && !it.answered ? ' for="in-' + slot + '"' : '') + '>' + label + '</label>' + inner + '</div>';
  };
  h += '<div class="typed">' + cell('base', 'Base form') + cell('past', 'Simple past') + cell('pp', 'Past participle') + '</div>';
  if (!it.answered) h += '<div class="actions"><button type="button" class="btn primary" data-act="checktype">Check</button></div><p class="note" style="text-align:center">If a verb has two correct forms, either one is accepted.</p>';
  return h;
}
function renderMatch() {
  var B = R.boards[R.b], total = R.boards.reduce(function (a, b) { return a + b.verbs.length; }, 0), doneN = R.boards.slice(0, R.b).reduce(function (a, b) { return a + b.verbs.length; }, 0) + Object.keys(B.done).length;
  var h = topbar(doneN, total) + head('Match the Meaning', 'Board ' + (R.b + 1) + ' of ' + R.boards.length + ': tap a verb, then tap its ' + (B.side === 'ar' ? 'Arabic translation.' : 'English meaning.'));
  h += '<div class="match"><div class="col verbcol" role="group" aria-label="Verbs">' + B.verbs.map(function (v) {
    var cls = 'tile' + (B.done[v.id] ? ' done' : '') + (B.active === v.id ? ' active' : '');
    return '<button type="button" class="' + cls + '" data-act="mverb" data-id="' + v.id + '" aria-pressed="' + (B.active === v.id) + '"' + (B.done[v.id] ? ' disabled' : '') + '>' + esc(v.base) + '</button>';
  }).join('') + '</div><div class="col" role="group" aria-label="' + (B.side === 'ar' ? 'Arabic translations' : 'Meanings') + '">' + B.order.map(function (v) {
    var cls = 'tile' + (B.side === 'ar' ? ' ar' : '') + (B.done[v.id] ? ' done' : '') + (B.flash === v.id ? ' flash' : '');
    return '<button type="button" class="' + cls + '" data-act="mmean" data-id="' + v.id + '"' + (B.side === 'ar' ? ' lang="ar" dir="rtl"' : '') + (B.done[v.id] || !B.active ? ' disabled' : '') + '>' + esc(B.side === 'ar' ? v.ar : v.meaning) + '</button>';
  }).join('') + '</div></div>';
  var all = Object.keys(B.done).length === B.verbs.length;
  h += (B.msg ? '<div class="feedback ' + (B.msgOk ? 'good' : 'badf') + '" role="status">' + B.msg + '</div>' : '') +
    '<div class="nav-row"><button type="button" class="btn" data-act="quit">✕ Stop</button><button type="button" class="btn primary" data-act="nextboard"' + (all ? '' : ' disabled') + '>' + (R.b === R.boards.length - 1 ? 'See results ▶' : 'Next board ▶') + '</button></div>';
  app.innerHTML = h;
}
function results() {
  var n = R.results.length, pct = Math.round(R.score / Math.max(1, n) * 100), learn = R.act === 'learn';
  var remark = learn ? 'All cards seen!' : pct === 100 ? 'Perfect round!' : pct >= 80 ? 'Very good!' : pct >= 50 ? 'Good effort, keep practising!' : 'Keep going: try your mistakes again.';
  var h = '<div class="result">' + head(learn ? 'Cards complete' : 'Round complete') + '<div class="badge" id="scoreBadge">' + R.score + ' / ' + n + '<small>' + (learn ? 'I knew it' : pct + '%') + '</small></div><div class="remark" id="remark">' + remark + '</div>';
  h += '<div class="gain"><span class="pill">+' + R.xp + ' XP</span><span class="pill">Best streak in this round: ' + R.bestStreak + '</span>' + (R.completedNow ? '<span class="pill">✓ Activity completed</span>' : '') + '</div>';
  if (R.newBadges.length) h += '<div>' + R.newBadges.map(function (k) { var b = BADGES.filter(function (x) { return x.key === k; })[0]; return '<span class="newbadge">' + b.ic + ' New badge: ' + esc(b.name) + '</span>'; }).join('') + '</div>';
  if (R.levelUp) h += '<p class="newbadge">⬆ Level up! You are now ' + esc(level(store.xp).name) + '.</p>';
  var miss = R.results.filter(function (r) { return !r.ok; });
  if (miss.length) h += '<h3>' + (learn ? 'Verbs to keep learning' : 'Review your mistakes') + '</h3>' + miss.map(function (r) { var v = BY_ID[r.id]; return '<div class="review-item">' + explain(v) + '</div>'; }).join('');
  h += '<div class="actions">' + (miss.length ? '<button type="button" class="btn primary" data-act="retry">Retry ' + (learn ? 'these cards' : 'my mistakes') + ' (' + miss.length + ')</button>' : '') +
    '<button type="button" class="btn' + (miss.length ? '' : ' primary') + '" data-act="again">Play again</button>' +
    (LOCK ? '<button type="button" class="btn" data-act="tounit">Back to Unit ' + LOCK + '</button>' :
      (R.act === 'revision' ? '' : '<button type="button" class="btn" data-act="tounit">Back to Unit ' + R.unit + '</button>') + '<button type="button" class="btn" data-act="home">⌂ All units</button>') + '</div></div>';
  app.innerHTML = h;
}

/* ===== scoring + progress ===== */
function streakStep(ok) {
  if (ok) { R.streak++; store.streak++; if (R.streak > (R.bestStreak || 0)) R.bestStreak = R.streak; if (store.streak > store.bestStreak) store.bestStreak = store.streak; }
  else { R.streak = 0; store.streak = 0; }
}
function gainXp(n) { R.xp += n; store.xp += n; }
/* one shared answer path for every question type: first try right = full points; wrong once = one retry; wrong twice = shown */
function answer(it, right) {
  if (it.answered) return;
  var v = BY_ID[it.id];
  if (right) {
    it.answered = true; it.final = true; it.ok = it.tries === 0;
    if (it.tries === 0) { recordVerb(it.id, true); streakStep(true); gainXp(10 + (R.streak > 0 && R.streak % 5 === 0 ? 5 : 0)); }
    else gainXp(4);
    say(it.ok ? 'Correct.' : 'Correct on the second try.');
  } else if (it.tries === 0) {
    it.tries = 1; recordVerb(it.id, false); streakStep(false);
    say('Not quite. Try once more.');
  } else {
    it.answered = true; it.final = false; it.ok = false;
    say('Not correct. The answer is ' + v.base + ', ' + v.past + ', ' + v.pp + '.');
  }
  if (it.answered && !it.ok && !it.again && !R.recycled[it.id] && R.act !== 'learn') {
    /* spaced retrieval inside the round: a missed verb comes back once at the end (another question type in mixed rounds) */
    R.recycled[it.id] = 1;
    var ks = kindsFor(R.act), k = ks.length > 1 ? ks.filter(function (x) { return x !== it.kind; })[Math.floor(Math.random() * (ks.length - 1))] : it.kind;
    R.items.push(makeItem(v, k, true));
  }
  save();
}
function finish() {
  var learn = R.act === 'learn';
  if (R.act === 'match') R.results = [].concat.apply([], R.boards.map(function (b) { return b.verbs.map(function (v) { return { id: v.id, ok: !b.wrong[v.id] }; }); }));
  else R.results = R.items.filter(function (it) { return !it.again; }).map(function (it) { return { id: it.id, ok: !!it.ok }; });
  R.score = R.results.filter(function (r) { return r.ok; }).length;
  var acc = R.score / Math.max(1, R.results.length), before = level(store.xp).n;
  R.completedNow = false;
  if (R.act === 'revision') store.revisions++;
  else {
    var k = actKey(R.unit, R.act), rec = store.a[k] || (store.a[k] = { best: 0, plays: 0, c: 0, t: 0, done: false });
    rec.plays++; rec.c += R.score; rec.t += R.results.length;
    if (!R.retry) {
      if (acc > rec.best) rec.best = acc;
      var pass = learn ? R.results.length === UNITS[R.unit].length : acc >= PASS;
      if (pass && !rec.done) { rec.done = true; R.completedNow = true; gainXp(25); }
    }
  }
  /* badges */
  var earned = [], give = function (key, cond) { if (cond && !store.badges[key]) { store.badges[key] = now(); earned.push(key); } };
  give('first', true);
  give('streak5', store.bestStreak >= 5);
  give('streak10', store.bestStreak >= 10);
  give('perfect', !learn && !R.retry && R.results.length >= 6 && R.score === R.results.length);
  give('fixer', store.fixes >= 10);
  give('unit', unitsComplete() >= 1);
  give('reviser', store.revisions >= 3);
  give('m25', masteredCount() >= 25);
  give('half', unitsComplete() >= 5);
  give('legend', unitsComplete() >= 10);
  R.newBadges = earned; R.levelUp = level(store.xp).n > before;
  R.finished = true; save(); render(); window.scrollTo(0, 0);
}

/* ===== actions ===== */
function readInputs(it) {
  if (it.kind === 'type') Array.prototype.forEach.call(app.querySelectorAll('input[data-slot]'), function (el) { it.vals[el.getAttribute('data-slot')] = el.value; });
  if (it.kind === 'ctx') { var el = $('#ctxin'); if (el) it.val = el.value; }
}
function onClick(e) {
  var el = e.target.closest('[data-act]'); if (!el || el.disabled || el.tagName === 'SELECT') return;
  var act = el.getAttribute('data-act');
  if (act === 'home') { view.page = 'home'; view.confirmReset = false; renderPage(); window.scrollTo(0, 0); return; }
  if (act === 'unit') { view.page = 'unit'; view.unit = +el.getAttribute('data-unit'); renderPage(); window.scrollTo(0, 0); return; }
  if (act === 'tounit') { view.page = 'unit'; renderPage(); window.scrollTo(0, 0); return; }
  if (act === 'start') return startRound(el.getAttribute('data-a'), view.unit);
  if (act === 'due') return startRound('revision', 'due');
  if (act === 'cumul') return startRound('revision', view.revTo);
  if (act === 'reset') { view.confirmReset = true; return renderPage(); }
  if (act === 'resetno') { view.confirmReset = false; return renderPage(); }
  if (act === 'resetyes') { store = blank(); save(); view.confirmReset = false; return renderPage('Your progress has been deleted on this device.'); }
  if (act === 'speak') { speak(BY_ID[el.getAttribute('data-id')]); return; }
  if (!R) return;
  if (act === 'quit') { view.page = R.act === 'revision' && !LOCK ? 'home' : 'unit'; R = null; renderPage(); window.scrollTo(0, 0); return; }
  if (act === 'again') return startRound(R.act, R.unit);
  if (act === 'retry') { var miss = R.results.filter(function (r) { return !r.ok; }).map(function (r) { return BY_ID[r.id]; }); return startRound(R.act, R.unit, miss); }
  if (R.act === 'match') return matchClick(act, el);
  var it = R.items[R.i];
  if (act === 'next') { if (!it.answered) return; if (R.i < R.items.length - 1) { R.i++; render(); window.scrollTo(0, 0); } else finish(); return; }
  if (it.answered) return;
  if (act === 'flip') { it.flipped = true; return render(); }
  if (act === 'knew' || act === 'notyet') {
    var ok = act === 'knew'; it.answered = true; it.ok = ok; recordVerb(it.id, ok); gainXp(ok ? 3 : 1); save(); return render();
  }
  if (act === 'choose') { var id = el.getAttribute('data-id'); if (id !== it.id) it.picked.push(id); answer(it, id === it.id); return render(); }
  if (act === 'tile') { var k = +el.getAttribute('data-k'), s = it.slots.indexOf(null); if (s > -1 && it.slots.indexOf(k) < 0) it.slots[s] = k; return render(); }
  if (act === 'unslot') { it.slots[+el.getAttribute('data-s')] = null; return render(); }
  if (act === 'clear') { it.slots = [null, null, null]; return render(); }
  if (act === 'checkbuild') {
    var v = BY_ID[it.id], right = [v.base, v.past, v.pp], wrong = [];
    it.slots.forEach(function (kk, si) { var t = it.tiles.filter(function (x) { return x.k === kk; })[0]; if (!t || t.t !== right[si]) wrong.push(si); });
    if (wrong.length && it.tries === 0) { it.wrongSlots = wrong; wrong.forEach(function (si) { it.slots[si] = null; }); }
    answer(it, !wrong.length); return render();
  }
  if (act === 'checktype') {
    readInputs(it); var vv = BY_ID[it.id], slots = it.hide === 'both' ? ['past', 'pp'] : [it.hide], allOk = true;
    slots.forEach(function (sl) { it.marks[sl] = checkTyped(it.vals[sl], accepted(vv, sl)); if (!it.marks[sl]) allOk = false; });
    if (slots.some(function (sl) { return !norm(it.vals[sl]); })) { say('Please type an answer first.'); return; }
    answer(it, allOk); return render();
  }
  if (act === 'checkctx') {
    readInputs(it); if (!norm(it.val)) { say('Please type an answer first.'); return; }
    answer(it, checkTyped(it.val, gapSet(BY_ID[it.id]))); return render();
  }
}
function matchClick(act, el) {
  var B = R.boards[R.b];
  if (act === 'mverb') { B.active = el.getAttribute('data-id'); B.flash = null; B.msg = ''; return render(); }
  if (act === 'mmean') {
    var id = el.getAttribute('data-id'); if (!B.active) return;
    var v = BY_ID[B.active];
    if (id === B.active) {
      var first = !B.wrong[id]; B.done[id] = true; B.active = null; B.flash = null;
      if (first) { recordVerb(id, true); streakStep(true); gainXp(10 + (R.streak > 0 && R.streak % 5 === 0 ? 5 : 0)); } else gainXp(4);
      B.msg = '✅ ' + esc(v.base) + ' – ' + esc(v.past) + ' – ' + esc(v.pp) + ' = ' + (B.side === 'ar' ? ar(v.ar) : esc(v.meaning)); B.msgOk = true; say('Matched.');
    } else {
      if (!B.wrong[B.active]) { B.wrong[B.active] = true; recordVerb(B.active, false); }
      streakStep(false); B.flash = id; B.msg = '✋ Not a match. Try again.'; B.msgOk = false; say('Not a match. Try again.');
    }
    save(); return render();
  }
  if (act === 'nextboard') { if (Object.keys(B.done).length !== B.verbs.length) return; if (R.b < R.boards.length - 1) { R.b++; render(); window.scrollTo(0, 0); } else finish(); }
}
function onChange(e) { if (e.target && e.target.id === 'revTo') view.revTo = +e.target.value; }
function onInput(e) { if (!R || !R.items) return; var it = R.items[R.i]; if (it && !it.answered) readInputs(it); }
function onKey(e) {
  if (e.key !== 'Enter' || !R || R.finished || !R.items) return;
  var it = R.items[R.i]; if (!it) return;
  if (e.target && e.target.tagName === 'INPUT') {
    e.preventDefault();
    if (it.answered) { var n = $('[data-act="next"]'); if (n) n.click(); return; }
    var b = $('[data-act="checktype"],[data-act="checkctx"]'); if (b) b.click();
  }
}
function speak(v) {
  if (!canSpeak || !v) return;
  try { window.speechSynthesis.cancel(); var u = new window.SpeechSynthesisUtterance(v.base + '. ' + alts(v.past).join(', ') + '. ' + alts(v.pp).join(', ')); u.lang = 'en-GB'; u.rate = 0.85; window.speechSynthesis.speak(u); } catch (e) { /* speech is optional */ }
}

/* ===== init ===== */
var errs = validate();
if (errs.length) { app.innerHTML = '<div class="fatal" role="alert">This activity could not start:\n' + esc(errs.join('\n')) + '</div>'; window.__vpReady = true; return; }
app.addEventListener('click', onClick);
app.addEventListener('change', onChange);
app.addEventListener('input', onInput);
document.addEventListener('keydown', onKey);
renderPage();
window.__vpReady = true;
/* test hook (read-only views + entry points) */
window.__vp = { get R() { return R; }, store: function () { return store; }, VERBS: VERBS, UNITS: UNITS, BY_ID: BY_ID, clash: clash, status: status, checkTyped: checkTyped, accepted: accepted, gapSet: gapSet,
  LOCK: LOCK, startRound: startRound, view: view, render: render, renderPage: renderPage, priority: priority, dueVerbs: dueVerbs, STORE_KEY: STORE_KEY, fakeForms: fakeForms };
})();

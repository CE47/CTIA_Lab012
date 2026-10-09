/* ============================================================
   CTI Casefile — game engine
   Stages: detect → collect → correlate → connect → analyze → report
   Vanilla JS, no build step, no network calls.

   The engine knows how to run a case. It knows nothing about this
   one: every fact, heading and ledger line comes from the scenario
   object, so a different scenario is a different data file.
   ============================================================ */
(function () {
  'use strict';

  var SC = (window.CTI_SCENARIOS || [])[0];
  var STORE = 'cti-casefile-012-v2';

  /* scenario presentation block, with fallbacks so a missing field degrades
     to readable English instead of throwing mid-stage */
  var EN = (SC && SC.engine) || {};
  /* these three read a string out of the scenario. They are named distinctly from
     the engine's own award() and from any variable, because a duplicate function
     declaration in one scope silently wins and quietly corrupts the score. */
  function engineText(key, fallback) { return EN[key] != null ? EN[key] : fallback; }
  function awardText(key, fallback) {
    return (EN.awards && EN.awards[key]) || fallback;
  }
  function sectionText(key, fallback) {
    return (EN.sections && EN.sections[key]) || fallback;
  }
  function streamWindow() { return (EN.stream && EN.stream.window) || ''; }
  function streamFiles() { return (EN.stream && EN.stream.files) || []; }

  /* ---------------- option order ----------------
     A case whose answers all sit in the same place can be passed without reading
     anything: click the top option, ten times. So the order is decided here, from
     the case seed, and not by whoever typed the options.

     Two properties matter and both are deliberate:
       deterministic — the same case always produces the same order, so reloading
         mid-question never moves an answer under the analyst's cursor, and a
         student cannot farm a position by refreshing;
       independent per question — a different permutation each time, so no slot is
         worth guessing.

     Options are shuffled, never the key: every question is answered by option id,
     so grading, the locked review view and the retry path are unaffected. */
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleOptions(q, salt) {
    if (!q || !q.options || q.options.length < 2) return;
    var rnd = mulberry(hashStr(salt + '#' + ((q.id || '') + '|' + (q.prompt || ''))));
    var list = q.options.slice();
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    q.options = list;
  }
  function shuffleCase(sc) {
    if (!sc || sc.__shuffled) return;
    sc.__shuffled = true;
    var qs = [];
    if (sc.timelineQuestion) qs.push([sc.timelineQuestion, 'timeline']);
    (sc.behaviourQuestions || []).forEach(function (q, i) { qs.push([q, 'behaviour' + i]); });
    if (sc.attack) {
      if (sc.attack.primary) qs.push([sc.attack.primary, 'attack-primary']);
      if (sc.attack.alsoPresent) qs.push([sc.attack.alsoPresent, 'attack-also']);
    }
    Object.keys(sc.report || {}).forEach(function (k) { qs.push([sc.report[k], 'report-' + k]); });
    if (sc.reasoning) qs.push([sc.reasoning, 'defence']);
    qs.forEach(function (pair) { shuffleOptions(pair[0], pair[1] + '@' + (sc.seed || 0)); });
    /* the indicators are a classification exercise, not a reading order — shuffling
       them hides which two are the actionable ones by position */
    shuffleOptions(sc.iocs, 'iocs@' + (sc.seed || 0));
  }

  /* ---------------- stage definitions ---------------- */
  var STAGES = [
    { id: 'detect', num: '01', title: 'Detect', short: 'DETECT',
      brief: 'Three alerts fired on one workstation. Nobody has told you which of them matter. Open the evidence and work out what the records actually say.' },
    { id: 'collect', num: '02', title: 'Collect', short: 'COLLECT',
      brief: 'The raw event stream for the hour, plus twenty routine records from the rest of the estate. Tag every line — not everything you are shown is evidence.' },
    { id: 'correlate', num: '03', title: 'Correlate', short: 'CORRELATE',
      brief: 'Five moments, fifteen minutes apart. Put them in order and decide what pattern the sequence describes.' },
    { id: 'board', num: '04', title: 'Connect', short: 'CONNECT',
      brief: 'Pin the evidence to the board and draw the threads that state the relationship between each pair of artifacts.' },
    { id: 'analyze', num: '05', title: 'Analyze', short: 'ANALYZE',
      brief: 'Name the behaviour, read the payload, map it to ATT&CK, and decide what is worth keeping as intelligence.' },
    { id: 'report', num: '06', title: 'Report', short: 'REPORT',
      brief: 'Turn the findings into an assessment someone else can act on — including how confident you are, and why.' }
  ];

  /* ---------------- xp budget: exactly 100 ---------------- */
  var XP = {
    evidence:  10,
    triageSig: 10,
    timeline:  10,
    board:     10,
    persist:   10,
    account:   10,
    attack:     8,
    attackAlso: 4,
    iocs:      10,
    host:       3,
    what:       3,
    why:        2,
    confidence: 2,
    actions:    3,
    reasoning:  5
  };

  /* ---------------- state ---------------- */
  var S = {
    stage: -1,
    xp: 0,
    maxXp: 100,
    assists: 0,
    nextMult: 0,
    ledger: [],          // {label, points}
    evidRead: {},
    triage: {},
    triageDone: false,
    timelineDone: false,
    boardDone: false,
    boardScore: { correct: 0, wrong: 0 },
    decoded: false,
    graded: {},          // question key -> 'right' | 'wrong'
    iocPicks: {},
    iocsGraded: false,
    iocsRight: 0,
    reasoningDone: false,
    reasoningPicks: [],
    journal: [],
    evidReadAwarded: false,
    board: null,
    boardPairs: null,
    gradedXp: {}           // question key -> points already banked, so a retry pays only the difference
  };

  var SAVE_KEYS = ['stage','xp','assists','nextMult','ledger','evidRead','triage','triageDone',
    'timelineDone','boardDone','boardScore','boardPairs','decoded','graded','gradedXp','iocPicks','iocsGraded','iocsRight',
    'reasoningDone','reasoningPicks','journal','evidReadAwarded'];

  function save() {
    try {
      var out = {};
      SAVE_KEYS.forEach(function (k) { out[k] = S[k]; });
      localStorage.setItem(STORE, JSON.stringify(out));
    } catch (e) { /* private mode — play without persistence */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (typeof d.stage !== 'number' || d.stage < 0) return false;
      SAVE_KEYS.forEach(function (k) { if (k in d) S[k] = d[k]; });
      return true;
    } catch (e) { return false; }
  }
  function wipe() {
    try { localStorage.removeItem(STORE); } catch (e) {}
    window.location.reload();
  }

  /* ---------------- dom helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  var hud = $('#hud'), briefScreen = $('[data-screen="brief"]'), stageScreen = $('[data-screen="stage"]');

  var modal = $('#modal'), modalBody = $('#modalBody'), debrief = $('#debrief');

  /* ---------------- dialog focus handling ---------------- */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var returnFocusTo = null;

  function focusablesIn(container) {
    return $$(FOCUSABLE, container).filter(function (x) {
      return x.offsetWidth || x.offsetHeight || x.getClientRects().length;
    });
  }
  /* keep Tab inside whichever overlay is open */
  function trapTab(container, e) {
    var f = focusablesIn(container);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
  function openDialog(container) {
    returnFocusTo = document.activeElement;
    var f = focusablesIn(container);
    if (f.length) f[0].focus();
  }
  function closeDialog() {
    var back = returnFocusTo;
    returnFocusTo = null;
    if (back && document.contains(back)) back.focus();
  }

  /* ---------------- xp ledger ----------------
     `key` identifies the thing being scored, so a retried question replaces its own
     ledger row instead of adding a second one. Without it, letting the player retry
     would be a way to farm XP. The points a row already banked are carried into the
     replacement, so the sheet still adds up to the score after a retry. */
  function award(points, label, kind, max, key) {
    if (max == null) max = points;
    var before = points;
    if (S.nextMult > 0 && points > 0) {
      points = Math.round(points * S.nextMult);
      label = label + ' — ' + before + ' XP reduced to ' + points + ' by Analyst Assist';
      S.nextMult = 0;
    }
    var prior = 0;
    if (key) S.ledger = S.ledger.filter(function (L) {
      if (L.key === key) { prior = L.points || 0; return false; }
      return true;
    });
    points = Math.max(0, Math.min(points, S.maxXp - S.xp));
    S.xp += points;
    S.ledger.push({ label: label, points: points + prior, max: max, key: key || null });
    S.journal.push({ text: label, kind: kind || '', stage: stageName() });
    renderXp();
    save();
  }
  function renderXp() {
    $('#xpNow').textContent = S.xp;
    $('#xpFill').style.width = (S.xp / S.maxXp * 100) + '%';
    $('#assistCount').textContent = S.assists;
  }
  function stageName() { return (STAGES[Math.max(S.stage, 0)] || {}).short || 'CASE'; }

  /* only mention the points actually banked, so a retry that improves the score
     does not read as if it paid the whole amount twice */
  function xpNote(gain, partial, xp, right, total) {
    if (gain <= 0) return 'No further XP for this one — you can still re-answer it.';
    if (gain < partial) return '+' + gain + ' XP now, ' + partial + ' XP for this item in total';
    return right === total ? '+' + xp + ' XP' : '+' + partial + ' XP — ' + right + ' of ' + total;
  }

  /* clear a scored item so it can be answered again; the player is never trapped */
  function retryItem(key) {
    delete S.graded[key];
    save();
    go(S.stage);
  }

  function retryBlock(msg, key) {
    var again = el('div');
    again.className = 'retry';
    again.appendChild(note(msg));
    again.appendChild(button('TRY AGAIN', '', function () { retryItem(key); }));
    return again;
  }

  /* ---------------- briefing ---------------- */
  function initBrief() {
    $('#briefMission').textContent = SC.mission.brief;
    $('#briefObjective').textContent = SC.mission.objective;
    $('#briefHost').textContent = SC.host + '  (' + SC.host_ip + ')';
    $('#briefDiff').textContent = SC.difficulty;
    $('#hudRef').textContent = SC.caseRef;
    $('#hudTitle').textContent = SC.title;
    $('#resetBtn').addEventListener('click', wipe);
  }

  /* ---------------- stage chrome ---------------- */
  function renderSteps() {
    var ol = $('#hudSteps');
    ol.innerHTML = '';
    STAGES.forEach(function (st, i) {
      var li = el('li', '', st.short);
      li.title = st.title;
      if (i > S.stage) { li.classList.add('is-locked'); li.title = 'Locked — finish ' + STAGES[i - 1].title.toLowerCase() + ' first'; }
      else if (i === S.stage) li.classList.add('is-now');
      else li.classList.add('is-done');
      if (i <= S.stage) li.addEventListener('click', function () { go(i); });
      ol.appendChild(li);
    });
  }

  function go(i) {
    if (i < 0 || i >= STAGES.length) return;
    S.stage = i;
    hud.hidden = false;
    briefScreen.hidden = true;
    stageScreen.hidden = false;
    window.scrollTo(0, 0);

    var st = STAGES[i];
    $('#stageNum').textContent = 'STAGE ' + st.num;
    $('#stageTitle').textContent = st.title;
    $('#stageBrief').textContent = st.brief;

    var body = $('#stageBody'), foot = $('#stageFoot');
    body.innerHTML = ''; foot.innerHTML = '';
    body.style.animation = 'none'; void body.offsetWidth; body.style.animation = '';

    if (S.leaveStage) { document.removeEventListener('cti:evidread', S.leaveStage); S.leaveStage = null; }
    ({ detect: stageDetect, collect: stageCollect, correlate: stageCorrelate,
       board: stageBoard, analyze: stageAnalyze, report: stageReport })[st.id](body, foot);

    renderSteps();
    save();
  }

  function head(title, tag) {
    var h = el('div', 'panel-head');
    h.appendChild(el('h3', '', title));
    if (tag) h.appendChild(el('span', 'tag', tag));
    return h;
  }
  function note(text) {
    var p = el('p', '', text);
    p.style.cssText = 'font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;color:var(--ink-faint);margin:0;';
    return p;
  }
  function warn(text) {
    var p = el('p', '', text);
    p.style.cssText = 'font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;color:var(--amber);margin:0;';
    return p;
  }
  /* button(label, fn) and button(label, cls, fn) are both valid */
  function button(label, cls, fn) {
    if (typeof cls === 'function') { fn = cls; cls = ''; }
    var b = el('button', 'btn ' + (cls || ''), label);
    b.addEventListener('click', fn);
    return b;
  }
  function rule(text) {
    var r = el('div', 'section-rule');
    r.appendChild(el('h3', '', text));
    return r;
  }

  /* ============================================================
     STAGE 1 — DETECT
     ============================================================ */
  function stageDetect(body, foot) {
    var onEvidRead = function () { progress(); };
    document.addEventListener('cti:evidread', onEvidRead);
    S.leaveStage = onEvidRead;

    var left = el('div', 'panel');
    left.appendChild(head('Evidence inbox', SC.evidence.length + ' ITEMS · ' + SC.alerts.length + ' ALERTS'));
    var list = el('div', 'evi-list');
    SC.evidence.forEach(function (ev) {
      var b = el('button', 'evi');
      b.dataset.read = S.evidRead[ev.id] ? '1' : '0';
      var top = el('div', 'evi-top');
      top.appendChild(el('span', 'evi-ref', ev.ref));
      top.appendChild(el('span', 'sev ' + ev.severity, ev.severity));
      b.appendChild(top);
      b.appendChild(el('div', 'evi-title', ev.title));
      b.appendChild(el('div', 'evi-blurb', ev.blurb));
      b.addEventListener('click', function () { openEvidence(ev, b); });
      list.appendChild(b);
    });
    left.appendChild(list);

    var right = el('div', 'panel');
    right.appendChild(head('What you were handed', 'TRIAGE BEGINS HERE'));
    var p = el('p', '', SC.narrative);
    p.style.cssText = 'font-size:16.5px;color:var(--ink-soft);margin:0;';
    right.appendChild(p);

    var p2 = el('p', '', 'Nothing in this brief names a technique, an indicator, or a responsible host. That is ' +
      'deliberate. Work the evidence first — the vocabulary arrives once you have earned it.');
    p2.style.cssText = 'font-size:15px;color:var(--ink-faint);font-style:italic;border-top:var(--hair);padding-top:14px;margin:18px 0 0;';
    right.appendChild(p2);

    right.appendChild(el('h3', '', 'Three questions to carry')).style.cssText =
      'font-family:var(--display);font-size:18px;margin:24px 0 10px;';
    engineText('carryQuestions', [
      'Which account is involved, and does the source address match anything you have already seen?',
      'What happens between the first suspicious record and the one that matters most?',
      'What is the last thing in the sequence that proves the attacker is still in control?'
    ]).forEach(function (t) {
      var li = el('div', '', '— ' + t);
      li.style.cssText = 'font-size:15.5px;margin-bottom:9px;color:var(--ink-soft);';
      right.appendChild(li);
    });

    var wrap = el('div', 'grid-2');
    wrap.appendChild(left); wrap.appendChild(right);
    body.appendChild(wrap);

    function progress() {
      foot.innerHTML = '';
      foot.appendChild(note('Evidence inspected: ' + Object.keys(S.evidRead).length + ' / ' + SC.evidence.length));
      foot.appendChild(button(
        Object.keys(S.evidRead).length >= SC.evidence.length ? 'OPEN THE EVENT STREAM →' : 'INSPECT ALL ' + SC.evidence.length + ' ITEMS',
        Object.keys(S.evidRead).length >= SC.evidence.length ? 'btn-major' : '',
        function () {
          if (Object.keys(S.evidRead).length < SC.evidence.length) {
            foot.appendChild(warn('Inspect every evidence item before moving on.'));
            return;
          }
          if (!S.evidReadAwarded) {
            S.evidReadAwarded = true;
            award(XP.evidence, awardText('evidence',
              'Reviewed the full evidence set: three alerts plus reference data'));
          }
          go(1);
        }));
    }
    progress();
  }

  function openEvidence(ev, btn) {
    if (!S.evidRead[ev.id]) {
      S.evidRead[ev.id] = true;
      btn.dataset.read = '1';
      save();
      document.dispatchEvent(new CustomEvent('cti:evidread'));
    }
    modalBody.innerHTML = '';
    modalBody.appendChild(el('p', 'modal-ref', ev.ref + '  ·  ' + ev.severity.toUpperCase()));
    var h = el('h3', '', ev.title);
    h.id = 'modalTitle';
    modalBody.appendChild(h);
    modalBody.appendChild(el('p', '', ev.detail));
    var hint = el('div', 'analyst-hint');
    hint.appendChild(el('h4', '', 'ANALYST HINT'));
    hint.appendChild(el('p', '', ev.hint));
    modalBody.appendChild(hint);
    modal.hidden = false;
    openDialog(modal);
  }

  /* ============================================================
     STAGE 2 — COLLECT (triage the stream)
     ============================================================ */
  function stageCollect(body, foot) {
    var bar = el('div', 'triage-bar');
    bar.appendChild(el('span', '', 'EVENT STREAM · ' + streamWindow()));
    var tally = el('div', 'tally');
    tally.innerHTML = '<span>SIGNAL <b id="tSig">0</b></span><span>CONTEXT <b id="tCtx">0</b></span>' +
      '<span>NOISE <b id="tNoi">0</b></span><span>UNSORTED <b id="tUns">' + SC.events.length + '</b></span>';
    bar.appendChild(tally);
    var filt = el('button', 'filterbtn', 'SHOW UNSORTED ONLY');
    bar.appendChild(filt);
    body.appendChild(bar);

    var box = el('div', 'logbox');
    var bb = el('div', 'logbox-bar');
    var files = streamFiles();
    if (!files.length) files = ['event-stream'];
    bb.innerHTML = files.map(function (f) { return '<b>' + f + '</b>'; }).join(' + ') +
      ' — ' + SC.events.length + ' records buffered<span class="lamps"><i></i><i></i><i></i></span>';
    box.appendChild(bb);
    var lines = el('div', 'loglines');
    box.appendChild(lines);
    body.appendChild(box);

    var rows = {};
    SC.events.forEach(function (ev) {
      var r = el('div', 'lrow ' + ev.kind);
      r.dataset.id = ev.id;
      r.innerHTML =
        '<span class="t">' + ev.ts + '</span>' +
        '<span class="c">' + (ev.code === 'NET' ? 'NET' : ev.code) + '</span>' +
        '<span class="h">' + ev.host + '</span>' +
        '<span class="txt">' + (ev.actor ? ev.actor + '  ' : '') + ev.text + '</span>';
      var tags = el('div', 'tagbtns');
      ['signal', 'context', 'noise'].forEach(function (t) {
        var b = el('button', 'tagbtn', t.toUpperCase().slice(0, 3));
        b.dataset.tag = t;
        b.title = 'Tag as ' + t;
        b.addEventListener('click', function () { setTag(ev, t, r); });
        tags.appendChild(b);
      });
      r.appendChild(tags);
      lines.appendChild(r);
      rows[ev.id] = r;
      if (S.triage[ev.id]) paint(ev, S.triage[ev.id], r);
    });

    var hint = el('p', 'board-hint');
    hint.innerHTML = '<kbd>SIG</kbd> the record matters to the finding · <kbd>CON</kbd> it frames the incident but is not itself evidence of malice · <kbd>NOI</kbd> routine background. Re-tagging is free; only your submitted read is scored.';
    body.appendChild(hint);

    function paint(ev, tag, r) {
      ['is-signal', 'is-context', 'is-noise', 'is-right', 'is-wrong'].forEach(function (c) { r.classList.remove(c); });
      if (tag) r.classList.add('is-' + tag);
      $$('.tagbtn', r).forEach(function (b) { b.classList.toggle('on', b.dataset.tag === tag); });
      r.style.display = (filterUnsorted && tag) ? 'none' : '';
    }

    var filterUnsorted = false;

    function recount() {
      var s = 0, c = 0, n = 0, u = 0;
      SC.events.forEach(function (e) {
        var t = S.triage[e.id];
        if (!t) u++; else if (t === 'signal') s++; else if (t === 'context') c++; else n++;
      });
      $('#tSig').textContent = s; $('#tCtx').textContent = c;
      $('#tNoi').textContent = n; $('#tUns').textContent = u;
      return u;
    }

    function setTag(ev, tag, r) {
      if (S.triageDone) return;
      if (S.triage[ev.id] === tag) {
        delete S.triage[ev.id];
        tag = undefined;
      } else {
        S.triage[ev.id] = tag;
      }
      paint(ev, tag, r);
      var u = recount();
      save();
      if (u === 0) gradeTriage(foot, rows);
    }

    filt.addEventListener('click', function () {
      filterUnsorted = !filterUnsorted;
      filt.classList.toggle('on', filterUnsorted);
      filt.textContent = filterUnsorted ? 'SHOW ALL RECORDS' : 'SHOW UNSORTED ONLY';
      SC.events.forEach(function (ev) {
        rows[ev.id].style.display = (filterUnsorted && S.triage[ev.id]) ? 'none' : '';
      });
    });

    if (S.triageDone) { revealTriage(rows); triageFoot(foot, triageMarks()); }
    else {
      foot.appendChild(note('Tag every record — or submit early to grade what you have.'));
      foot.appendChild(button('SUBMIT TRIAGE EARLY', function () { submitEarly(foot, rows); }));
    }
  }

  function submitEarly(foot, rows) {
    gradeTriage(foot, rows, true);
  }

  function triageMarks() {
    var signals = SC.events.filter(function (e) { return e.tags === 'signal'; });
    var contexts = SC.events.filter(function (e) { return e.tags === 'context'; });
    return {
      signals: signals,
      contexts: contexts,
      rightSig: signals.filter(function (e) { return S.triage[e.id] === 'signal'; }).length,
      rightCtx: contexts.filter(function (e) { return S.triage[e.id] === 'context'; }).length,
      falsePos: SC.events.filter(function (e) {
        return e.tags === 'noise' && S.triage[e.id] && S.triage[e.id] !== 'noise';
      }).length,
      missed: SC.events.filter(function (e) { return !S.triage[e.id]; })
    };
  }

  function triageFoot(foot, m) {
    foot.innerHTML = '';
    foot.appendChild(note('Signal ' + m.rightSig + '/' + m.signals.length +
      ' · Context ' + m.rightCtx + '/' + m.contexts.length +
      ' · Noise over-selected ' + m.falsePos +
      (m.missed.length ? ' · Left untagged ' + m.missed.length : '')));
    foot.appendChild(button('BUILD THE TIMELINE →', 'btn-major', function () { go(2); }));
  }

  /* lock and reveal — safe to replay, unlike the scoring in gradeTriage */
  function revealTriage(rows) {
    SC.events.forEach(function (ev) {
      var r = rows[ev.id], t = S.triage[ev.id];
      $$('.tagbtn', r).forEach(function (b) { b.disabled = true; });
      if (t === ev.tags) { r.classList.add('is-right'); return; }
      r.classList.add('is-wrong', 'is-' + ev.tags);
      $$('.tagbtn', r).forEach(function (b) { b.classList.toggle('on', b.dataset.tag === ev.tags); });
      r.style.display = '';
      if (ev.why) {
        var d = el('div', 'fb bad');
        d.style.gridColumn = '1/-1';
        d.style.margin = '2px 0 5px';
        d.innerHTML = '<h5>' + (t ? 'RE-READ THIS' : 'YOU MISSED THIS') + '</h5><p>' + ev.why + '</p>';
        r.appendChild(d);
      }
    });
  }

  function gradeTriage(foot, rows, early) {
    S.triageDone = true;
    var m = triageMarks();
    var signals = m.signals, contexts = m.contexts;
    var rightSig = m.rightSig, rightCtx = m.rightCtx, falsePos = m.falsePos;

    if (rightSig === signals.length && falsePos === 0) {
      award(XP.triageSig, 'Separated signal from noise: all ' + signals.length + ' malicious records identified with no false positives');
    } else if (rightSig > 0) {
      award(Math.round(XP.triageSig * rightSig / signals.length),
        'Partial triage: ' + rightSig + '/' + signals.length + ' malicious records identified' + (falsePos ? ', ' + falsePos + ' noise record(s) over-selected' : ''),
        'bad', XP.triageSig);
    }
    if (rightCtx === contexts.length && contexts.length) {
      award(0, awardText('triageContext',
        'Kept the surrounding activity as context rather than evidence — it anchors the timeline without ' +
        'proving the finding'), '');
    }

    revealTriage(rows);
    triageFoot(foot, m);
    save();
  }

  /* ============================================================
     Question renderer (single or multi select)
     ============================================================ */
  function question(host, q, cfg) {
    cfg = cfg || {};
    var key = cfg.key || q.id;
    var answer = S.graded[key];
    var multi = q.correct.length > 1;
    var limit = q.correctCount || q.correct.length;
    var xp = cfg.xp != null ? cfg.xp : q.xp;
    var subText = cfg.subtext || null;
    var onAfter = cfg.onAfter || function () {};

    var panel = el('div', 'panel q');
    panel.appendChild(el('h3', 'q-prompt', q.prompt));
    if (subText) panel.appendChild(el('p', 'formnote', subText));
    var opts = el('div', 'q-opts');
    var picked = {};
    var fb = el('div');
    var row = el('div');
    row.style.marginTop = '15px';

    function labelOf(id) {
      var o = q.options.filter(function (x) { return x.id === id; })[0] || {};
      return (o.meta ? o.meta + ' — ' : '') + o.label;
    }

    /* keep the selection warning in sync with what the player has actually picked,
       so re-submitting while the count is still wrong never looks like nothing happened */
    function syncWarn() {
      var n = Object.keys(picked).filter(function (k) { return picked[k]; }).length;
      var cur = row.querySelector('.warn');
      if (n === limit) { if (cur) cur.remove(); return; }
      if (cur) { cur.textContent = 'Select exactly ' + limit + '. You have ' + n + '.'; return; }
      var w = el('p', 'warn', 'Select exactly ' + limit + '. You have ' + n + '.');
      w.style.cssText = 'font-family:var(--mono);font-size:10.5px;color:var(--amber);margin:0 0 10px;';
      row.insertBefore(w, sub);
    }

    if (answer) {
      q.options.forEach(function (o) {
        var b = el('button', 'opt is-locked' + (q.correct.indexOf(o.id) !== -1 ? ' is-right' : ''));
        b.disabled = true;
        var k = el('span', 'opt-key', o.id.toUpperCase());
        var sp = el('span');
        sp.appendChild(el('span', '', o.label));
        if (o.meta) sp.appendChild(el('span', 'opt-meta', o.meta));
        b.appendChild(k); b.appendChild(sp);
        opts.appendChild(b);
      });
      panel.appendChild(opts);
      fb.className = 'fb' + (answer === 'right' ? '' : ' bad');
      var correctLine = answer === 'right' ? '' :
        labelOf(q.correct[0]) + (multi ? ' · ' + labelOf(q.correct[1] || '') : '') + '. ';
      var explainLine = correctLine + (q.explain || '');
      if (explainLine) explainLine = explainLine.replace(/[.,\s]+$/, '.');
      fb.innerHTML = '<h5>' + (answer === 'right' ? 'YOUR ANSWER WAS CORRECT' : 'THE CORRECT ANSWER' +
        (multi ? 'S' : '')) + '</h5>' + (explainLine ? '<p>' + explainLine + '</p>' : '');
      panel.appendChild(fb);
      if (answer !== 'right') {
        /* a wrong answer must never be a dead end — let them re-answer it */
        panel.appendChild(retryBlock('You can re-answer this. Re-reading it costs nothing — the explanation above is the point.', key));
      }
      host.appendChild(panel);
      return panel;
    }

    var sub = button(cfg.submitLabel || 'SUBMIT', function () {
      var chosen = Object.keys(picked).filter(function (k) { return picked[k]; });
      if (chosen.length !== limit) {
        syncWarn();
        return;
      }
      var right = chosen.filter(function (c) { return q.correct.indexOf(c) !== -1; }).length;
      var exact = right === q.correct.length;

      $$('.opt', opts).forEach(function (o) {
        o.disabled = true; o.classList.add('is-locked');
        var id = o.dataset.id;
        if (q.correct.indexOf(id) !== -1) o.classList.add('is-right');
        else if (picked[id]) o.classList.add('is-miss');
      });
      if (row.querySelector('.warn')) row.querySelector('.warn').remove();
      sub.remove();

      var partial = exact ? xp : Math.round(xp * right / q.correct.length);
      S.graded[key] = exact ? 'right' : 'wrong';
      /* bank only the improvement on a retry, so TRY AGAIN cannot be farmed */
      var banked = S.gradedXp[key] || 0;
      var gain = Math.max(0, partial - banked);
      S.gradedXp[key] = partial;
      if (gain > 0) award(gain, cfg.awardLabel || (q.prompt.replace(/[?.]+$/, '.').replace(/^\w/, function (c) { return c.toUpperCase(); })),
        exact ? '' : 'bad', xp, key);
      else S.journal.push({ text: q.prompt.replace(/[?.]+$/, '.'), kind: 'bad', stage: stageName() });

      fb.className = 'fb' + (exact ? '' : ' bad');
      var expl = exact ? q.explain
        : 'Correct: ' + q.correct.map(labelOf).join('  /  ') + '. ' + q.explain;
      expl = expl || '';
      if (expl) expl = expl.replace(/[.,\s]+$/, '.');
      fb.innerHTML = '<h5>' + (exact ? 'CORRECT' : 'PARTIALLY CORRECT · ' + right + ' OF ' + q.correct.length) + '</h5>' +
        (expl ? '<p>' + expl + '</p>' : '') +
        '<span class="xp-award">' + xpNote(gain, partial, xp, right, q.correct.length) + '</span>';
      panel.appendChild(fb);
      if (!exact) panel.appendChild(retryBlock('You can re-answer this. Re-reading it costs nothing — the explanation above is the point.', key));
      save();
      onAfter();
    });
    row.appendChild(sub);

    q.options.forEach(function (o) {
      var b = el('button', 'opt');
      b.dataset.id = o.id;
      var k = el('span', 'opt-key', o.id.toUpperCase());
      var sp = el('span');
      sp.appendChild(el('span', '', o.label));
      if (o.meta) sp.appendChild(el('span', 'opt-meta', o.meta));
      b.appendChild(k); b.appendChild(sp);
      b.addEventListener('click', function () {
        if (b.disabled) return;
        if (multi) { picked[o.id] = !picked[o.id]; b.classList.toggle('is-picked', picked[o.id]); }
        else {
          Object.keys(picked).forEach(function (x) { delete picked[x]; });
          picked[o.id] = true;
          $$('.opt', opts).forEach(function (x) { x.classList.remove('is-picked'); });
          b.classList.add('is-picked');
        }
        syncWarn();
      });
      opts.appendChild(b);
    });

    panel.appendChild(opts);
    panel.appendChild(fb);
    panel.appendChild(row);
    host.appendChild(panel);
    return panel;
  }

  /* ============================================================
     STAGE 3 — CORRELATE (timeline)
     ============================================================ */
  function stageCorrelate(body, foot) {
    var wrap = el('div', 'tl-wrap');
    var tl = el('div', 'tl');
    SC.timeline.forEach(function (n) {
      var col = el('div', 'tl-col');
      col.appendChild(el('div', 'tl-t', n.t));
      col.appendChild(el('div', 'tl-dot'));
      var card = el('div', 'tl-card');
      card.appendChild(el('h4', '', n.label.toUpperCase() + ' · ' + n.ts));
      card.appendChild(el('p', '', n.detail));
      if (n.net) card.appendChild(el('div', 'tl-net', '⇣ ' + n.net));
      col.appendChild(card);
      tl.appendChild(col);
    });
    wrap.appendChild(tl);
    body.appendChild(wrap);

    var gap = el('p', 'board-hint');
    gap.textContent = engineText('cadenceNote',
      'The cadence is the story: read the sequence as one chain rather than five separate records, and ask ' +
      'which record is the cause of which.');
    body.appendChild(gap);

    body.appendChild(rule('Analyst question'));

    question(body, SC.timelineQuestion, {
      key: 'r-timeline', xp: XP.timeline,
      awardLabel: awardText('timeline',
        'Identified the pattern in the sequence rather than reading the records one at a time'),
      onAfter: function () { foot.innerHTML = ''; foot.appendChild(note('Timeline graded.')); foot.appendChild(button('GO TO THE BOARD →', 'btn-major', function () { go(3); })); }
    });

    /* rebuild the footer when returning to an already-graded timeline, otherwise
       the stage re-renders with no way forward */
    if (S.graded['r-timeline']) {
      S.timelineDone = true;
      foot.innerHTML = '';
      foot.appendChild(note('Timeline graded.'));
      foot.appendChild(button('GO TO THE BOARD →', 'btn-major', function () { go(3); }));
    } else {
      S.timelineDone = false;
    }
  }

  /* ============================================================
     STAGE 4 — BOARD
     ============================================================ */
  function stageBoard(body, foot) {
    var intro = el('div', 'panel');
    var introReq = SC.boardLinks.filter(function (l) { return l.correct; }).length;
    intro.appendChild(head('Your task', introReq + ' THREADS REQUIRED'));
    var p = el('p', '', 'Drag the cards to rearrange the board. To connect two of them, click one card, then click ' +
      'the other, then choose the relation. ' + introReq + ' threads describe this activity correctly — each one is ' +
      'a sentence you would be willing to defend in a report.');
    p.style.cssText = 'font-size:16px;color:var(--ink-soft);margin:0;';
    intro.appendChild(p);
    intro.style.marginBottom = '20px';
    body.appendChild(intro);

    var host = el('div');
    body.appendChild(host);
    var score = el('p', 'board-hint');
    body.appendChild(score);

    /* stageBoard gets a fresh host element on every entry, so the board must be rebuilt
       against it — reusing the old instance would render into a detached node */
    if (S.board) S.board.destroy();
    S.board = new window.CTIBoard(host, SC, {
      onChange: function (res) {
        S.boardScore = { correct: res.correct, wrong: res.wrong };
        S.boardPairs = S.board.pairs;
        score.textContent = describeBoard(res);
        if (res.correct >= res.needed && !S.boardDone) completeBoard(foot);
        save();
      }
    });
    /* threads are part of saved progress — restore them on a fresh board */
    if (S.boardPairs && S.boardPairs.length) {
      S.board.pairs = S.boardPairs;
      S.board.pairs.forEach(function (pr) {
        if (pr.correct && S.board.nodes[pr.to]) S.board.nodes[pr.to].classList.add('linked');
      });
    }

    function describeBoard(res) {
      return res.correct + ' / ' + res.needed + ' required threads drawn · ' + res.wrong + ' incorrect thread(s)';
    }

    if (S.boardDone) {
      S.board.pairs = S.board.pairs || [];
      S.board.lock();
      score.textContent = describeBoard(S.board.evaluate());
      foot.innerHTML = '';
      foot.appendChild(note('Correlation complete. The board is the analytic story in one picture.'));
      foot.appendChild(button('MOVE TO ANALYSIS →', 'btn-major', function () { go(4); }));
    } else {
      score.textContent = describeBoard(S.board.evaluate());
      foot.innerHTML = '';
      foot.appendChild(note('Draw all required threads — the checklist below the board tracks what is still missing.'));
      foot.appendChild(button('SUBMIT BOARD AS IS', '', function () { judgeBoard(foot, score, describeBoard); }));
    }
  }

  function completeBoard(foot) {
    S.boardDone = true;
    S.board.lock();
    award(XP.board, awardText('board', 'Correlated the full chain of artifacts on the board'));
    foot.innerHTML = '';
    foot.appendChild(note('All required threads drawn.'));
    foot.appendChild(button('MOVE TO ANALYSIS →', 'btn-major', function () { go(4); }));
    save();
  }

  function judgeBoard(foot, score, describeBoard) {
    var res = S.board.evaluate();
    var pts = Math.round(XP.board * res.correct / res.needed);
    S.boardDone = true;
    if (pts > 0) award(pts, 'Correlation board: ' + res.correct + '/' + res.needed + ' required threads drawn',
      res.correct >= res.needed ? '' : 'bad', XP.board);
    S.board.lock();
    score.textContent = describeBoard(res);
    foot.innerHTML = '';
    foot.appendChild(note('Threads correct: ' + res.correct + '/' + res.needed + ' · incorrect: ' + res.wrong));
    foot.appendChild(button('MOVE TO ANALYSIS →', 'btn-major', function () { go(4); }));
    save();
  }

  /* ============================================================
     STAGE 5 — ANALYZE
     ============================================================ */
  function stageAnalyze(body, foot) {
    body.appendChild(rule(sectionText('behaviour', 'name the behaviour')));
    question(body, SC.behaviourQuestions[0], { key: 'q-persist', xp: XP.persist, onAfter: renderAnalyzeFoot });
    body.appendChild(rule(sectionText('second', 'read the trail')));
    question(body, SC.behaviourQuestions[1], { key: 'q-ps', xp: XP.account, onAfter: renderAnalyzeFoot });

    /* the collapsed trail, revealed in full on demand */
    body.appendChild(rule(sectionText('trail', 'assemble the trail')));
    var cc = el('div', 'codecard');
    cc.innerHTML = engineText('trailRows', [
      { k: 'Trail', v: SC.decodedCommand.encoded }
    ]).map(function (row) {
      return '<div class="crow"><span class="k">' + row.k + '</span><span class="v">' + row.v +
        (row.flag ? ' <span class="flag">' + row.flag + '</span>' : '') + '</span></div>';
    }).join('');
    body.appendChild(cc);
    var db = el('button', 'decodebtn', engineText('trailLabel', 'REVEAL THE FULL TRAIL'));
    db.addEventListener('click', function () {
      S.decoded = true;
      db.remove();
      var d = el('div', 'decoded');
      d.innerHTML = '<div class="crow"><span class="k">Trail</span><span class="v ok">' +
        SC.decodedCommand.decoded + '</span></div>' +
        '<p style="margin:10px 0 0;color:#9c9382;">' + SC.decodedCommand.note + '</p>';
      cc.appendChild(d);
      S.journal.push({
        text: engineText('journalDecode', 'Assembled the trail from the records on this host'),
        kind: 'good', stage: stageName()
      });
      renderAnalyzeFoot();
      save();
    });
    if (S.decoded) { db.click(); } else { cc.appendChild(db); }

    /* ATT&CK */
    body.appendChild(rule(sectionText('attack', 'map it to attack')));
    var aw = el('div');
    body.appendChild(aw);
    question(aw, SC.attack.primary, {
      key: 'q-attack', xp: XP.attack,
      awardLabel: awardText('attack', 'Mapped the behaviour to its ATT&CK technique'),
      onAfter: renderAnalyzeFoot
    });
    var aw2 = el('div');
    aw2.style.marginTop = '24px';
    body.appendChild(aw2);
    question(aw2, SC.attack.alsoPresent, {
      key: 'q-attack-also', xp: XP.attackAlso,
      awardLabel: awardText('attackAlso', 'Identified the supporting techniques present alongside it'),
      onAfter: renderAnalyzeFoot
    });

    /* IoC classification */
    body.appendChild(rule(sectionText('iocs', 'keep the intelligence')));
    body.appendChild(el('p', 'formnote', SC.iocs.prompt +
      ' Three categories are correct — decide which two of these you would block or disable.'));
    var grid = el('div', 'ioc-grid');
    SC.iocs.options.forEach(function (o) {
      var chip = el('div', 'ioc');
      chip.dataset.id = o.id;
      chip.appendChild(el('span', 'ioc-token', o.label));
      var btns = el('div', 'ioc-btns');
      ['indicator', 'behaviour', 'context', 'not useful'].forEach(function (r) {
        var b = el('button', 'ioc-b', r);
        b.dataset.role = r;
        btns.appendChild(b);
      });
      chip.appendChild(btns);
      grid.appendChild(chip);
    });
    body.appendChild(grid);
    var iocFoot = el('div');
    body.appendChild(iocFoot);

    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.ioc-b');
      if (!b || S.iocsGraded) return;
      var chip = b.closest('.ioc'), id = chip.dataset.id;
      S.iocPicks[id] = { role: b.dataset.role };
      $$('.ioc-b', chip).forEach(function (x) { x.classList.toggle('on', x === b); });
      chip.classList.remove('on-indicator', 'on-behaviour', 'on-context', 'on-wrong');
      chip.classList.add('on-' + b.dataset.role);
      updateIocFoot();
      save();
    });

    function iocSorted() {
      return SC.iocs.options.filter(function (o) { return S.iocPicks[o.id] && S.iocPicks[o.id].role; }).length;
    }

    function updateIocFoot() {
      iocFoot.innerHTML = '';
      /* already graded — rebuild the reveal. gradeIocs is safe to re-run: it banks
         only the improvement over gradedXp, so nothing is awarded twice. */
      if (S.iocsGraded) { gradeIocs(); return; }
      var sorted = iocSorted();
      iocFoot.appendChild(note('Classified ' + sorted + ' / ' + SC.iocs.options.length));
      iocFoot.appendChild(button('SUBMIT CLASSIFICATION', '', function () {
        if (iocSorted() < SC.iocs.options.length) {
          var w = el('p', '', 'Classify every item — including the ones that look useful and are not.');
          w.style.cssText = 'font-family:var(--mono);font-size:10.5px;color:var(--amber);margin:12px 0 0;';
          iocFoot.appendChild(w);
          return;
        }
        gradeIocs();
      }));
    }

    function gradeIocs() {
      var right = SC.iocs.options.filter(function (o) { return S.iocPicks[o.id] && S.iocPicks[o.id].role === o.role; }).length;
      S.iocsRight = right;
      S.iocsGraded = true;
      $$('.ioc', grid).forEach(function (chip) {
        var o = SC.iocs.options.filter(function (x) { return x.id === chip.dataset.id; })[0];
        $$('.ioc-b', chip).forEach(function (b) {
          b.disabled = true;
          b.classList.toggle('on', b.dataset.role === o.role);
        });
        chip.classList.remove('on-indicator', 'on-behaviour', 'on-context', 'on-wrong');
        chip.classList.add('on-' + o.role);
        if (!S.iocPicks[o.id] || S.iocPicks[o.id].role !== o.role) chip.classList.add('on-wrong');
      });
      iocFoot.innerHTML = '';
      var fb = el('div', 'fb' + (right === SC.iocs.options.length ? '' : ' bad'));
      var total = SC.iocs.options.length;
      var partial = right === total ? XP.iocs : Math.round(XP.iocs * right / total);
      var banked = S.gradedXp['_iocs'] || 0;
      var gain = Math.max(0, partial - banked);
      S.gradedXp['_iocs'] = partial;
      fb.innerHTML = '<h5>' + (right === total
        ? 'CORRECT — THIS IS INTELLIGENCE, NOT AN INVENTORY'
        : 'PARTIALLY CORRECT · ' + right + ' OF ' + total + ' CLASSIFIED CORRECTLY') + '</h5><p>' +
        SC.iocs.explain + '</p><span class="xp-award">' + xpNote(gain, partial, XP.iocs, right, total) + '</span>';
      iocFoot.appendChild(fb);
      var wrong = SC.iocs.options.filter(function (o) { return !S.iocPicks[o.id] || S.iocPicks[o.id].role !== o.role; });
      if (wrong.length) {
        var s = el('div', 'summary');
        s.style.marginTop = '14px';
        s.appendChild(el('h4', '', 'CORRECTED ASSESSMENT'));
        var ul = el('ul');
        wrong.forEach(function (o) {
          var li = el('li');
          li.innerHTML = '<code>' + o.label + '</code> — you marked <em>' + (S.iocPicks[o.id] ? S.iocPicks[o.id].role : 'nothing') +
            '</em>; it is <strong>' + o.role + '</strong>';
          ul.appendChild(li);
        });
        s.appendChild(ul);
        iocFoot.appendChild(s);
        var again = el('div');
        again.style.marginTop = '16px';
        again.appendChild(note('You can reclassify. Re-reading is free — the corrected list above is the point.'));
        again.appendChild(button('TRY AGAIN', '', function () {
          S.iocsGraded = false;
          save();
          go(S.stage);
        }));
        iocFoot.appendChild(again);
      }
      if (gain > 0) award(gain,
        'Separated indicator, behaviour and context: ' + right + '/' + total + ' classified correctly',
        right === total ? '' : 'bad', XP.iocs, '_iocs');
      renderAnalyzeFoot();
      save();
    }

    updateIocFoot();
    renderAnalyzeFoot();
  }

  function renderAnalyzeFoot() {
    var foot = $('#stageFoot');
    foot.innerHTML = '';
    /* the gate is "did you attempt every section", NOT "was every answer right".
       Requiring correctness here used to dead-end the player permanently: answered
       questions render locked, so a single mistake meant no way forward at all. */
    var sections = [
      { key: 'q-persist', label: sectionText('behaviour', 'name the behaviour') },
      { key: 'q-ps', label: sectionText('second', 'read the trail') },
      { key: '_decode', label: sectionText('trail', 'assemble the trail') },
      { key: 'q-attack', label: sectionText('attack', 'map it to attack') },
      { key: 'q-attack-also', label: sectionText('attackAlso', 'supporting techniques') },
      { key: '_iocs', label: sectionText('iocs', 'classify the intelligence') }
    ];
    var answered = function (s) { return s.key === '_decode' ? S.decoded : s.key === '_iocs' ? S.iocsGraded : !!S.graded[s.key]; };
    var done = sections.filter(answered);
    var missed = sections.filter(function (s) { return !answered(s); });
    var wrongCount = done.filter(function (s) {
      return s.key.charAt(0) !== '_' && S.graded[s.key] !== 'right';
    }).length;

    foot.appendChild(note('Analysis sections answered: ' + done.length + ' / ' + sections.length +
      '  ·  score ' + S.xp + ' / ' + S.maxXp));
    if (missed.length) {
      foot.appendChild(note('Still to answer: ' + missed.map(function (s) { return s.label; }).join(', ') + '.'));
    } else if (wrongCount) {
      foot.appendChild(note(wrongCount + ' section' + (wrongCount > 1 ? 's were' : ' was') +
        ' answered imperfectly — you can move on, or use TRY AGAIN on any of them to raise your score.'));
    }
    foot.appendChild(button('WRITE THE ASSESSMENT →', missed.length ? '' : 'btn-major', function () {
      if (missed.length) {
        foot.appendChild(warn('Answer the remaining section' + (missed.length > 1 ? 's' : '') + ' first: ' +
          missed.map(function (s) { return s.label; }).join(', ') + '.'));
        return;
      }
      go(5);
    }));
  }

  /* ============================================================
     STAGE 6 — REPORT
     ============================================================ */
  function stageReport(body, foot) {
    var r = SC.report;

    body.appendChild(rule('scope'));
    question(body, r.host, {
      key: 'r-host', xp: XP.host,
      awardLabel: awardText('host', 'Scoped the incident to a single host'),
      onAfter: renderReportFoot
    });

    body.appendChild(rule('what happened'));
    question(body, r.what, { key: 'r-what', xp: XP.what, awardLabel: 'Wrote an accurate statement of what occurred', onAfter: renderReportFoot });

    body.appendChild(rule('why it is suspicious'));
    question(body, r.why, {
      key: 'r-why', xp: XP.why,
      subtext: 'Select every reason that holds. A finding you cannot justify is a finding nobody will act on.',
      onAfter: renderReportFoot
    });

    body.appendChild(rule('how confident are you'));
    question(body, r.confidence, {
      key: 'r-conf', xp: XP.confidence,
      subtext: 'Confidence is a judgement about evidence, not about how sure you feel. Three independent artifacts that agree with each other support high confidence.',
      onAfter: renderReportFoot
    });

    body.appendChild(rule('what happens next'));
    question(body, r.actions, {
      key: 'r-actions', xp: XP.actions,
      subtext: 'Select exactly three. Intelligence that cannot be acted on is a document, not a product — and the response should be proportionate to the evidence.',
      onAfter: renderReportFoot
    });

    body.appendChild(rule('defend it'));
    var q = SC.reasoning;
    if (S.reasoningDone) {
      var p = el('div', 'panel q');
      p.appendChild(el('h3', 'q-prompt', q.prompt));
      var opts = el('div', 'q-opts');
      q.options.forEach(function (o) {
        var mine = (S.reasoningPicks || []).indexOf(o.id) !== -1;
        var b = el('button', 'opt is-locked' + (o.key ? ' is-right' : (mine ? ' is-miss' : '')));
        b.disabled = true;
        b.appendChild(el('span', 'opt-key', o.id.toUpperCase()));
        var sp = el('span'); sp.appendChild(el('span', '', o.label));
        b.appendChild(sp);
        opts.appendChild(b);
      });
      p.appendChild(opts);
      var fb = el('div', 'fb' + (S.graded['r-reasoning'] === 'right' ? '' : ' bad'));
      fb.innerHTML = '<h5>WHY THE COMBINATION MATTERS MORE THAN ANY SINGLE EVENT</h5><p>' + q.explain + '</p>';
      p.appendChild(fb);
      if (S.graded['r-reasoning'] !== 'right') {
        var again = el('div');
        again.style.marginTop = '16px';
        again.appendChild(note('You can re-pick your three. Re-reading is free — the explanation above is the point.'));
        again.appendChild(button('TRY AGAIN', '', function () {
          S.reasoningDone = false;
          S.reasoningPicks = [];
          delete S.graded['r-reasoning'];
          save();
          go(S.stage);
        }));
        p.appendChild(again);
      }
      body.appendChild(p);
    } else {
      var picks = {}, panel = el('div', 'panel q'), fb2 = el('div'), row = el('div');
      panel.appendChild(el('h3', 'q-prompt', q.prompt));
      panel.appendChild(el('p', 'formnote', 'Choose exactly three. If your case rests on a single artifact, the case is weak.'));
      var opts2 = el('div', 'q-opts');
      row.style.marginTop = '15px';
      /* keep the count warning honest while the analyst is still picking, so it
         never contradicts what is highlighted on screen */
      function syncWarn() {
        var n = Object.keys(picks).filter(function (k) { return picks[k]; }).length;
        var cur = row.querySelector('.warn');
        if (n === 3) { if (cur) cur.remove(); return; }
        if (cur) { cur.textContent = 'Select exactly three. You have ' + n + '.'; return; }
        var w = el('p', 'warn', 'Select exactly three. You have ' + n + '.');
        w.style.cssText = 'font-family:var(--mono);font-size:10.5px;color:var(--amber);margin:0 0 10px;';
        row.insertBefore(w, sub);
      }
      var sub = button('SUBMIT YOUR THREE', function () {
        var chosen = Object.keys(picks).filter(function (k) { return picks[k]; });
        if (chosen.length !== 3) {
          syncWarn();
          return;
        }
        var right = chosen.filter(function (c) {
          return q.options.filter(function (o) { return o.id === c; })[0].key;
        }).length;
        $$('.opt', opts2).forEach(function (o) {
          o.disabled = true; o.classList.add('is-locked');
          var oo = q.options.filter(function (x) { return x.id === o.dataset.id; })[0];
          if (oo.key) o.classList.add('is-right'); else if (picks[o.dataset.id]) o.classList.add('is-miss');
        });
        var w2 = row.querySelector('.warn'); if (w2) w2.remove();
        sub.remove();
        fb2.className = 'fb' + (right === 3 ? '' : ' bad');
        fb2.innerHTML = '<h5>' + (right === 3 ? 'CORRECT' : right + ' OF 3 — HERE IS WHY THE REST IS NOT EVIDENCE') + '</h5><p>' +
          q.explain + '</p>';
        panel.appendChild(fb2);
        S.reasoningPicks = chosen;
        S.reasoningDone = true;
        S.graded['r-reasoning'] = right === 3 ? 'right' : 'wrong';
        /* bank only the improvement, same as question() */
        var banked = S.gradedXp['r-reasoning'] || 0;
        var partial = Math.round(XP.reasoning * right / 3);
        var gain = Math.max(0, partial - banked);
        S.gradedXp['r-reasoning'] = partial;
        var xpTag = el('span', 'xp-award', gain > 0
          ? '+' + gain + ' XP' + (gain < partial ? ' (' + partial + ' XP in total)' : '')
          : 'No further XP for this one — you can still re-pick.');
        fb2.appendChild(xpTag);
        if (gain > 0) award(gain,
          'Defended the assessment with ' + right + '/3 of the strongest artifacts', right === 3 ? '' : 'bad', XP.reasoning, 'r-reasoning');
        renderReportFoot();
        save();
      });
      row.appendChild(sub);
      q.options.forEach(function (o) {
        var b = el('button', 'opt');
        b.dataset.id = o.id;
        b.appendChild(el('span', 'opt-key', o.id.toUpperCase()));
        var sp = el('span'); sp.appendChild(el('span', '', o.label));
        b.appendChild(sp);
        b.addEventListener('click', function () {
          if (b.disabled) return;
          picks[o.id] = !picks[o.id];
          b.classList.toggle('is-picked', picks[o.id]);
          syncWarn();
        });
        opts2.appendChild(b);
      });
      panel.appendChild(opts2); panel.appendChild(fb2); panel.appendChild(row);
      body.appendChild(panel);
    }

    /* live product preview */
    body.appendChild(rule('the product'));
    var preview = EN.reportPreview || { rows: [], note: '' };
    var summary = el('div', 'summary');
    summary.id = 'reportPreview';
    summary.innerHTML =
      '<h4>THREAT INTELLIGENCE ASSESSMENT — ' + SC.caseRef + '</h4>' +
      '<ul>' +
      preview.rows.map(function (row) {
        return '<li><strong>' + row.label + ':</strong> ' + (row.code ? '<code>' + row.value + '</code>' : row.value) + '</li>';
      }).join('') +
      '</ul>' +
      '<p style="margin:12px 0 0;font-style:italic;">' + preview.note + '</p>';
    body.appendChild(summary);

    renderReportFoot();
  }

  function renderReportFoot() {
    var foot = $('#stageFoot');
    foot.innerHTML = '';
    var keys = ['r-host', 'r-what', 'r-why', 'r-conf', 'r-actions', 'r-reasoning'];
    var names = { 'r-host': 'scope', 'r-what': 'what happened', 'r-why': 'why it is suspicious',
      'r-conf': 'confidence', 'r-actions': 'next steps', 'r-reasoning': 'your defence' };
    var done = keys.filter(function (k) { return !!S.graded[k]; });
    var right = keys.filter(function (k) { return S.graded[k] === 'right'; }).length;
    var missed = keys.filter(function (k) { return !S.graded[k]; });

    foot.appendChild(note('Assessment fields answered: ' + done.length + ' / ' + keys.length +
      '  ·  correct ' + right + ' / ' + keys.length + '  ·  score ' + S.xp + ' / ' + S.maxXp));
    /* same rule as stage 05: answer everything and you may file the case. A wrong
       field lowers the score and the rank, it does not trap the player. */
    if (missed.length) {
      foot.appendChild(note('Still to answer: ' + missed.map(function (k) { return names[k]; }).join(', ') + '.'));
    } else if (right < keys.length) {
      foot.appendChild(note((keys.length - right) + ' field' + (keys.length - right > 1 ? 's are' : ' is') +
        ' not fully correct. You can still file the case — TRY AGAIN on any of them to improve the score.'));
    }
    foot.appendChild(button('SUBMIT ANALYSIS', missed.length ? '' : 'btn-major', function () {
      if (missed.length) {
        foot.appendChild(warn('Answer the remaining field' + (missed.length > 1 ? 's' : '') + ' first: ' +
          missed.map(function (k) { return names[k]; }).join(', ') + '.'));
        return;
      }
      finish();
    }));
  }

  /* ============================================================
     DEBRIEF
     ============================================================ */
  function finish() {
    var rank = SC.ranking.filter(function (r) { return S.xp >= r.min; })[0] || SC.ranking[SC.ranking.length - 1];
    $('#debriefRank').textContent = rank.rank;
    $('#debriefNote').textContent = rank.note;
    $('#dbScore').textContent = S.xp;
    $('#debriefStamp').textContent = S.xp >= 75 ? 'FILED' : 'INCOMPLETE';
    $('#dbAssist').textContent = S.assists
      ? S.assists + ' assist call' + (S.assists > 1 ? 's' : '') + ' used'
      : 'No assistance used';

    var bd = $('#debriefBreakdown');
    bd.innerHTML = '';
    S.ledger.forEach(function (L) {
      var full = L.points >= L.max && L.max > 0;
      var d = el('div', 'dbb ' + (full ? 'full' : L.points > 0 ? 'part' : 'none'));
      d.innerHTML =
        '<span class="lbl"><span class="tick">' + (L.points > 0 ? (full ? '✓' : '~') : '×') + '</span>' + L.label + '</span>' +
        '<span class="val">' + (L.points > 0 ? '+' : '') + L.points + '</span>';
      bd.appendChild(d);
    });
    var spent = S.ledger.reduce(function (a, b) { return a + b.points; }, 0);
    var lost = S.maxXp - spent;
    if (lost > 0) {
      var d = el('div', 'dbb none');
      d.innerHTML = '<span class="lbl"><span class="tick">×</span>Not earned</span><span class="val">' + lost + '</span>';
      bd.appendChild(d);
    }

    var ul = $('#debriefIocs');
    ul.innerHTML = '';
    SC.iocs.options.forEach(function (o) {
      ul.appendChild(el('li', o.role === 'indicator' ? '' : o.role, o.label + '  ·  ' + o.role));
    });

    var jr = $('#debriefJournal');
    jr.innerHTML = '';
    if (!S.journal.length) jr.appendChild(el('p', '', 'No journal entries.'));
    S.journal.slice().reverse().forEach(function (j) {
      var d = el('div', 'jentry ' + (j.kind === 'bad' ? 'bad' : 'good'));
      d.appendChild(el('span', 'jstage', j.stage));
      var p = el('p', '', j.text);
      p.style.cssText = 'margin:0;';
      d.appendChild(p);
      jr.appendChild(d);
    });

    debrief.hidden = false;
    openDialog(debrief);
    save();
  }

  /* ============================================================
     ANALYST ASSIST
     ============================================================ */
  function initAssist() {
    var btnEl = $('#assistBtn'), menu = $('#assistMenu');
    var a = SC.assist;
    menu.innerHTML = '<h4>THREE LEVELS OF ASSISTANCE</h4>' +
      '<button class="assist-opt" data-k="nudge"><b>' + a.nudge.label + '</b>' + a.nudge.text + '<br><small>next awarded step × ' + a.nudge.mult + '</small></button>' +
      '<button class="assist-opt" data-k="hint"><b>' + a.hint.label + '</b>' + a.hint.text + '<br><small>next awarded step × ' + a.hint.mult + '</small></button>' +
      '<button class="assist-opt" data-k="explain"><b>' + a.explain.label + '</b>' + a.explain.text + '<br><small>next awarded step × ' + a.explain.mult + '</small></button>' +
      '<p class="assist-note">Assistance never blocks you. It scales the next XP you earn, so the final score ' +
      'still reflects what you found without help.</p>';

    btnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btnEl.setAttribute('aria-expanded', String(!menu.hidden));
    });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('.assist-opt');
      if (!b) return;
      var kind = b.dataset.k;
      S.assists++;
      S.nextMult = a[kind].mult;
      renderXp();
      save();
      menu.hidden = true;
      btnEl.setAttribute('aria-expanded', 'false');
      showModal('<p class="modal-ref">' + a[kind].label.toUpperCase() + '</p>' +
        '<h3>' + (kind === 'nudge' ? 'Look again, with a nudge.' : kind === 'hint' ? 'A hint from a senior analyst.' : 'The full reasoning.') + '</h3>' +
        '<p>' + a[kind].text + '</p>' +
        '<div class="analyst-hint"><h4>COST</h4><p>Your next awarded step is multiplied by <b>' + a[kind].mult +
        '</b>. You will not be blocked, and your rank still reflects your own work.</p></div>');
    });
    document.addEventListener('click', function () {
      if (!menu.hidden) { menu.hidden = true; btnEl.setAttribute('aria-expanded', 'false'); }
    });
  }

  function showModal(html) {
    modalBody.innerHTML = html;
    modal.hidden = false;
    openDialog(modal);
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    if (!SC) {
      document.body.innerHTML = '<p style="padding:40px;font-family:monospace">Scenario data failed to load.</p>';
      return;
    }
    shuffleCase(SC);
    initBrief();
    initAssist();
    renderXp();

    $$('[data-close]').forEach(function (x) {
      x.addEventListener('click', function () { modal.hidden = true; closeDialog(); });
    });
    document.addEventListener('keydown', function (e) {
      if (!modal.hidden) {
        if (e.key === 'Escape') { modal.hidden = true; closeDialog(); }
        else if (e.key === 'Tab') trapTab(modal, e);
        return;
      }
      if (!debrief.hidden) {
        if (e.key === 'Escape') { debrief.hidden = true; closeDialog(); }
        else if (e.key === 'Tab') trapTab(debrief, e);
      }
    });
    $('#replayBtn').addEventListener('click', wipe);

    var resumed = load();
    renderXp();
    if (resumed) {
      $('#resetBtn').hidden = false;
      $('#startBtn').textContent = 'RESUME INVESTIGATION — ' + S.xp + ' XP';
    }
    $('#startBtn').addEventListener('click', function () {
      hud.hidden = false;
      go(Math.max(S.stage, 0));
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
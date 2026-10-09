/* ============================================================
   Correlation board — pinboard with draggable evidence nodes
   and drawn threads. Pointer events only, so mouse + touch work.
   ============================================================ */
(function () {
  'use strict';

  /* every verb a correct thread in the scenario may use has to exist here, or the
     student is asked for a relation they cannot possibly pick */
  var LINK_VERBS = ['connects', 'launches', 'produces', 'holds', 'closes', 'restores', 'creates',
                    'removes', 'downloads from', 'hosts'];

  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function Board(host, scenario, opts) {
    this.host = host;
    this.sc = scenario;
    this.onChange = (opts && opts.onChange) || function () {};
    this.solved = false;
    this.pairs = [];          // {from,to,label,correct}
    this.pos = {};            // nodeId -> {x,y} in px
    this.pending = null;      // node id awaiting target
    this.dragging = null;

    this._onDown = this.onDown.bind(this);
    this._onMove = this.onMove.bind(this);
    this._onUp = this.onUp.bind(this);
    this.host.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    this.host.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.bnode')) e.preventDefault();
    });

    this.build();
  }

  Board.prototype.build = function () {
    var sc = this.sc;
    this.host.innerHTML = '';
    this.host.classList.add('board');

    var self = this;

    var svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.setAttribute('class', 'wires');
    this.host.appendChild(this.svg);

    sc.boardNodes.forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'bnode';
      el.dataset.node = n.id;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', n.label + ', ' + n.sub + '. Select to start a thread, then select a second card.');
      el.style.left = n.x + '%';
      el.style.top = n.y + '%';
      el.innerHTML =
        '<span class="pin" aria-hidden="true"></span>' +
        '<span class="nlabel"></span><span class="nsub"></span>';
      el.querySelector('.nlabel').textContent = n.label;
      el.querySelector('.nsub').textContent = n.sub;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (self.solved) return;
        var id = el.dataset.node;
        if (self.pending && self.pending !== id) self.openPicker(id);
        else if (self.pending === id) self.clearPending();
        else self.arm(id);
      });
      self.host.appendChild(el);
    });

    this.legend = document.createElement('div');
    this.legend.className = 'thread-legend';
    this.legend.innerHTML = '<b>THREADS DRAWN</b>' +
      '<button class="thread-undo" type="button">UNDO LAST</button><ol></ol>';
    this.undoBtn = this.legend.querySelector('.thread-undo');
    this.undoBtn.addEventListener('click', function () { self.undo(); });
    /* the legend is a sibling of the board, never an overlay — as a corner panel it
       covered the right-hand nodes and made them unreadable and unclickable */
    if (this.legend.parentNode) this.legend.parentNode.removeChild(this.legend);
    if (this.host.parentNode) this.host.parentNode.insertBefore(this.legend, this.host.nextSibling);
    else this.host.appendChild(this.legend);

    this.picker = document.createElement('div');
    this.picker.className = 'threadpicker';
    this.picker.hidden = true;
    this.picker.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.clearPending(); }
    });
    this.host.appendChild(this.picker);

    this.nodes = {};
    Array.prototype.forEach.call(this.host.querySelectorAll('.bnode'), function (el) {
      self.nodes[el.dataset.node] = el;
    });

    /* settle initial pixel positions now — callers may lock() and draw() synchronously,
       which happens when a restored board is re-entered */
    this.measure(); this.place(); this.draw();
    /* webfonts land after first paint and change card widths — re-measure once */
    requestAnimationFrame(function () { self.measure(); self.place(); self.draw(); });
  };

  Board.prototype.measure = function () {
    var w = this.host.clientWidth;
    var h = this.host.clientHeight;
    var nodes = this.sc.boardNodes;

    /* Below this width the percentage pinboard layout collapses into a heap, because
       every right-hand node clamps to the same x. Fall back to two staggered columns. */
    if (w < 560) {
      var rowH = h / Math.ceil(nodes.length / 2);
      nodes.forEach(function (n, i) {
        var el = this.nodes[n.id];
        var right = i % 2 === 1;
        this.pos[n.id] = {
          x: right ? Math.max(w - el.offsetWidth - 6, 6) : 6,
          y: Math.min(Math.max(rowH * Math.floor(i / 2) + 6, 6), h - el.offsetHeight - 6)
        };
      }, this);
      return;
    }

    nodes.forEach(function (n) {
      var el = this.nodes[n.id];
      var nw = el.offsetWidth, nh = el.offsetHeight;
      this.pos[n.id] = {
        x: Math.min(Math.max((n.x / 100) * w, 6), w - nw - 6),
        y: Math.min(Math.max((n.y / 100) * h, 6), h - nh - 6)
      };
    }, this);
  };

  Board.prototype.place = function () {
    for (var id in this.pos) {
      var el = this.nodes[id];
      el.style.left = this.pos[id].x + 'px';
      el.style.top = this.pos[id].y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  };

  Board.prototype.center = function (id) {
    var el = this.nodes[id], p = this.pos[id] || { x: 0, y: 0 };
    return { x: p.x + (el ? el.offsetWidth : 0) / 2, y: p.y + (el ? el.offsetHeight : 0) / 2 };
  };

  Board.prototype.onDown = function (e) {
    if (this.solved) return;
    /* the picker and legend live inside the board host — never treat a press on
       them as a node press, or pointerdown tears the picker down before click fires */
    if (e.target.closest('.threadpicker, .thread-legend')) return;
    var el = e.target.closest('.bnode');
    if (!el) { this.clearPending(); return; }
    var id = el.dataset.node;

    if (this.pending && this.pending !== id) {
      this.openPicker(id);
      return;
    }
    if (this.pending === id) { this.clearPending(); return; }

    // start drag
    this.dragging = {
      id: id,
      dx: e.clientX - this.pos[id].x,
      dy: e.clientY - this.pos[id].y,
      moved: false
    };
    var hostRect = this.host.getBoundingClientRect();
    this.dragging.hx = hostRect.left;
    this.dragging.hy = hostRect.top;
    this.dragging.moved = false;
  };

  Board.prototype.onMove = function (e) {
    if (!this.dragging || this.solved) return;
    var d = this.dragging;
    var el = this.nodes[d.id];
    d.moved = true;
    el.style.zIndex = 30;
    var nx = e.clientX - d.hx - d.dx;
    var ny = e.clientY - d.hy - d.dy;
    this.pos[d.id].x = Math.min(Math.max(nx, 0), this.host.clientWidth - el.offsetWidth);
    this.pos[d.id].y = Math.min(Math.max(ny, 0), this.host.clientHeight - el.offsetHeight);
    this.place();
    this.draw();
  };

  Board.prototype.onUp = function () {
    if (!this.dragging) return;
    var d = this.dragging;
    this.dragging = null;
    this.nodes[d.id].style.zIndex = '';
    if (!d.moved) {
      // treat as a tap: arm this node as the link source
      this.arm(d.id);
    }
  };

  Board.prototype.arm = function (id) {
    this.pending = id;
    this.nodes[id].classList.add('linking');
  };

  Board.prototype.clearPending = function () {
    var wasPending = this.pending;
    if (wasPending && this.nodes[wasPending]) this.nodes[wasPending].classList.remove('linking');
    var focusWasInPicker = this.picker.contains(document.activeElement);
    this.pending = null;
    this.picker.hidden = true;
    this.picker.innerHTML = '';
    /* keyboard users must land back on a card, not on <body> */
    if (focusWasInPicker && wasPending && this.nodes[wasPending]) this.nodes[wasPending].focus();
  };

  Board.prototype.openPicker = function (targetId) {
    var self = this;
    var from = this.pending;
    var c = this.center(from), t = this.center(targetId);
    this.picker.innerHTML = '<p class="tp-h">RELATION — ' +
      this.label(from) + ' → ' + this.label(targetId) + '</p>';
    LINK_VERBS.forEach(function (v) {
      var b = document.createElement('button');
      b.textContent = v;
      b.addEventListener('click', function () {
        self.addLink(from, targetId, v);
      });
      self.picker.appendChild(b);
    });

    this.picker.hidden = false;
    var pw = this.picker.offsetWidth, ph = this.picker.offsetHeight;
    var x = Math.min((c.x + t.x) / 2 - pw / 2, this.host.clientWidth - pw - 6);
    var y = Math.min((c.y + t.y) / 2 - ph - 10, this.host.clientHeight - ph - 6);
    this.picker.style.left = Math.max(6, x) + 'px';
    this.picker.style.top = Math.max(6, y) + 'px';

    this.picker.dataset.from = from;
    this.picker.dataset.to = targetId;
    var firstVerb = this.picker.querySelector('button');
    if (firstVerb) firstVerb.focus();
  };

  Board.prototype.label = function (id) {
    var n = this.sc.boardNodes.filter(function (x) { return x.id === id; })[0];
    return n ? n.label : id;
  };

  Board.prototype.addLink = function (from, to, verb) {
    var verdict = this.sc.boardLinks.filter(function (l) {
      return l.from === from && l.to === to && l.label === verb;
    })[0];

    this.pairs.push({ from: from, to: to, label: verb, correct: !!(verdict && verdict.correct) });

    this.clearPending();
    this.syncLinked();
    this.draw();
    this.onChange(this.evaluate());
  };

  /* a wrong thread used to be unremovable, which quietly cost the player XP */
  Board.prototype.undo = function () {
    if (this.solved || !this.pairs.length) return;
    this.pairs.pop();
    this.clearPending();
    this.syncLinked();
    this.draw();
    this.onChange(this.evaluate());
  };

  Board.prototype.syncLinked = function () {
    var self = this;
    for (var id in this.nodes) this.nodes[id].classList.remove('linked');
    this.pairs.forEach(function (p) {
      if (p.correct && self.nodes[p.to]) self.nodes[p.to].classList.add('linked');
    });
  };

  Board.prototype.evaluate = function () {
    var correct = this.pairs.filter(function (p) { return p.correct; }).length;
    var wrong = this.pairs.filter(function (p) { return !p.correct; }).length;
    var needed = this.sc.boardLinks.filter(function (l) { return l.correct; }).length;
    return { correct: correct, wrong: wrong, needed: needed, total: this.pairs.length };
  };

  Board.prototype.draw = function () {
    var svgNS = 'http://www.w3.org/2000/svg';
    var self = this;
    var w = this.host.clientWidth, h = this.host.clientHeight;
    /* rebuild from scratch — appending left removed threads on the board forever */
    this.svg.innerHTML = '';
    this.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    var seen = {};
    this.pairs.forEach(function (p) {
      var key = [p.from, p.to].sort().join('~') + p.label;
      var a = self.center(p.from), b = self.center(p.to);
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.max(Math.hypot(dx, dy), 1);
      var bow = Math.min(34, dist * 0.16);
      var mx = (a.x + b.x) / 2 - (dy / dist) * bow;
      var my = (a.y + b.y) / 2 + (dx / dist) * bow;

      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + my + ' ' + b.x + ' ' + b.y);
      path.setAttribute('class', p.correct ? 'ok' : 'no');

      var title = document.createElementNS(svgNS, 'title');
      title.textContent = self.label(p.from) + ' — ' + p.label + ' → ' + self.label(p.to);
      path.appendChild(title);
      self.svg.appendChild(path);

      if (p.correct && !seen[key]) {
        seen[key] = 1;
        var g = document.createElementNS(svgNS, 'g');
        var mx2 = mx - (dy / dist) * 12, my2 = my + (dx / dist) * 12;
        var bg = document.createElementNS(svgNS, 'rect');
        var tw = p.label.length * 5.6 + 10;
        bg.setAttribute('x', mx2 - tw / 2); bg.setAttribute('y', my2 - 8);
        bg.setAttribute('width', tw); bg.setAttribute('height', 15);
        bg.setAttribute('fill', '#f2ead6'); bg.setAttribute('stroke', '#55613c');
        var tx = document.createElementNS(svgNS, 'text');
        tx.setAttribute('x', mx2); tx.setAttribute('y', my2 + 3);
        tx.setAttribute('text-anchor', 'middle');
        tx.setAttribute('font-family', "'Courier Prime', monospace");
        tx.setAttribute('font-size', '10');
        tx.setAttribute('fill', '#55613c');
        tx.textContent = p.label;
        g.appendChild(bg); g.appendChild(tx);
        self.svg.appendChild(g);
      }
    });

    // legend
    var ol = this.legend.querySelector('ol');
    var needed = this.sc.boardLinks.filter(function (l) { return l.correct; });
    var self2 = this;
    if (this.undoBtn) this.undoBtn.disabled = this.solved || !this.pairs.length;
    ol.innerHTML = '';
    needed.forEach(function (l) {
      var got = self2.pairs.some(function (p) {
        return p.from === l.from && p.to === l.to && p.label === l.label && p.correct;
      });
      var li = document.createElement('li');
      li.textContent = self2.label(l.from) + ' ' + l.label + ' ' + self2.label(l.to);
      if (got) li.className = 'done';
      ol.appendChild(li);
    });

    // what you actually drew, so a wrong thread is visible and removable
    $$('.drawn', this.legend).forEach(function (d) { d.parentNode.removeChild(d); });
    if (this.pairs.length) {
      var dw = document.createElement('div');
      dw.className = 'drawn';
      dw.innerHTML = '<b>DRAWN</b>';
      var bad = this.pairs.filter(function (p) { return !p.correct; }).length;
      var uw = document.createElement('span');
      uw.className = bad ? 'drawn-note has-bad' : 'drawn-note';
      uw.textContent = bad
        ? bad + ' thread' + (bad > 1 ? 's do' : ' does') + ' not describe this activity — undo them or submit the board as it stands.'
        : '';
      if (bad) dw.appendChild(uw);
      this.pairs.forEach(function (p, i) {
        var b = document.createElement('button');
        b.className = 'drawn-t' + (p.correct ? '' : ' wrong');
        b.type = 'button';
        b.textContent = (p.correct ? '✓ ' : '✕ ') + self2.label(p.from) + ' ' + p.label + ' ' + self2.label(p.to);
        b.disabled = self2.solved;
        b.title = 'Remove this thread';
        b.addEventListener('click', function () { self2.removeAt(i); });
        dw.appendChild(b);
      });
      this.legend.appendChild(dw);
    }
  };

  Board.prototype.removeAt = function (i) {
    if (this.solved) return;
    this.pairs.splice(i, 1);
    this.syncLinked();
    this.draw();
    this.onChange(this.evaluate());
  };

  Board.prototype.lock = function () {
    this.solved = true;
    this.clearPending();
    for (var id in this.nodes) this.nodes[id].classList.add('settled');
    this.draw();
  };

  Board.prototype.destroy = function () {
    this.host.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    if (this.legend && this.legend.parentNode) this.legend.parentNode.removeChild(this.legend);
  };

  Board.prototype.reset = function () {
    this.solved = false;
    this.pairs = [];
    this.clearPending();
    for (var id in this.nodes) this.nodes[id].classList.remove('linked');
    this.svg.innerHTML = '';
    this.measure();
    this.place();
    this.draw();
  };

  window.CTIBoard = Board;
})();
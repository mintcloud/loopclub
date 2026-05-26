/* ============================================================
   loop club — animated backdrop
   A living step-sequencer: a full-bleed grid of LED cells with a
   playhead sweeping across it, lighting beats in their track
   colour as it passes — the product itself, breathing, behind the
   hero. Pure canvas, no deps. Honours prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('backdrop');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Instrument LEDs — same palette as the design system tracks. */
  var TRACKS = [
    [255, 92, 124],  /* kick     */
    [255, 175, 92],  /* snare    */
    [92, 255, 198],  /* hat      */
    [92, 182, 255],  /* synth    */
    [255, 138, 92],  /* clap     */
    [92, 255, 175],  /* open-hat */
    [185, 140, 255], /* cowbell  */
    [255, 92, 214],  /* crash    */
    [92, 159, 255]   /* ride     */
  ];

  var W, H, dpr, cols, rows, pitch, grid, head, prevCol;
  var blobs = [];
  var lastT = 0;

  function rr(x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pitch = W < 640 ? 26 : 34;
    cols = Math.ceil(W / pitch) + 2;
    rows = Math.ceil(H / pitch) + 2;

    grid = [];
    for (var r = 0; r < rows; r++) {
      var track = r % TRACKS.length;
      var density = 0.13 + Math.random() * 0.20;
      var row = [];
      for (var c = 0; c < cols; c++) {
        row.push({ on: Math.random() < density, energy: 0, track: track });
      }
      grid.push(row);
    }

    /* Ambient drifting glows beneath the grid — the "liquid" mood. */
    blobs = [];
    for (var b = 0; b < 3; b++) {
      var col = TRACKS[(b * 3) % TRACKS.length];
      blobs.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.012,
        vy: (Math.random() - 0.5) * 0.012,
        col: col,
        r: 0.40 + Math.random() * 0.22
      });
    }

    head = 0;
    prevCol = -1;
  }

  function drawGlows(t) {
    for (var i = 0; i < blobs.length; i++) {
      var bl = blobs[i];
      if (!reduced) {
        bl.x += bl.vx; bl.y += bl.vy;
        if (bl.x < -0.2 || bl.x > 1.2) bl.vx *= -1;
        if (bl.y < -0.2 || bl.y > 1.2) bl.vy *= -1;
      }
      var cx = bl.x * W, cy = bl.y * H;
      var rad = bl.r * Math.max(W, H);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      var c = bl.col;
      g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.11)');
      g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function frame(now) {
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0.016;
    lastT = now;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#020205';
    ctx.fillRect(0, 0, W, H);

    drawGlows(now / 1000);

    /* Advance the playhead — one full sweep every ~7.5s. */
    head += dt * (cols / 7.5);
    if (head >= cols) head -= cols;
    var curCol = Math.floor(head);

    /* On a new column, fire every lit cell in it. */
    if (curCol !== prevCol) {
      for (var rr0 = 0; rr0 < rows; rr0++) {
        var cell = grid[rr0][curCol];
        if (cell && cell.on) cell.energy = 1;
      }
      /* Occasionally mutate the pattern — the loop keeps being written. */
      if (Math.random() < 0.5) {
        var mr = (Math.random() * rows) | 0;
        var mc = (Math.random() * cols) | 0;
        grid[mr][mc].on = !grid[mr][mc].on;
      }
      prevCol = curCol;
    }

    /* Gentle parallax drift of the whole field. */
    var driftX = Math.sin(now / 7000) * 7;
    var driftY = Math.cos(now / 9000) * 7;
    var size = pitch * 0.62;
    var off = (pitch - size) / 2;
    var radius = Math.max(2, size * 0.22);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cl = grid[r][c];
        if (cl.energy > 0) cl.energy -= dt * 1.7;
        if (cl.energy < 0) cl.energy = 0;

        var x = c * pitch - pitch + off + driftX;
        var y = r * pitch - pitch + off + driftY;
        var e = cl.energy;

        if (e > 0.02) {
          var col = TRACKS[cl.track];
          var a = 0.18 + e * 0.82;
          ctx.shadowColor = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (e * 0.9) + ')';
          ctx.shadowBlur = 6 + e * 22;
          ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a + ')';
          rr(x, y, size, size, radius);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          /* Recessed off-cell — a faint dark bezel dot. */
          ctx.fillStyle = cl.on
            ? 'rgba(150,160,200,0.062)'
            : 'rgba(120,130,170,0.026)';
          rr(x, y, size, size, radius);
          ctx.fill();
        }
      }
    }

    /* Playhead — a soft chrome column. */
    var hx = head * pitch - pitch + driftX;
    var pg = ctx.createLinearGradient(hx, 0, hx + pitch, 0);
    pg.addColorStop(0, 'rgba(255,255,255,0)');
    pg.addColorStop(0.5, 'rgba(220,228,245,0.10)');
    pg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(hx - pitch * 0.5, 0, pitch * 2, H);

    if (!reduced) requestAnimationFrame(frame);
  }

  function start() {
    build();
    if (reduced) {
      /* Static frame: seed a sweep mid-grid, render once. */
      head = cols * 0.5; prevCol = -1;
      for (var c = 0; c < cols; c++) {
        var fade = 1 - Math.min(1, Math.abs(c - head) / 7);
        if (fade <= 0) continue;
        for (var r = 0; r < rows; r++) {
          if (grid[r][c].on) grid[r][c].energy = fade;
        }
      }
      lastT = 0;
      requestAnimationFrame(function (t) { frame(t); });
    } else {
      requestAnimationFrame(frame);
    }
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      lastT = 0;
      start();
    }, 180);
  });

  start();
})();

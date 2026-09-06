/* Luqmat Al Malek — scroll film + progressive enhancement.

   The hero is a canvas scrubbed by scroll, not a <video>. `<video>.currentTime`
   scrubbing stutters on seek latency and cannot be made smooth; pre-extracted
   JPEG frames blitted to a canvas can.

   The anti-jank core is the ImageBitmap sliding window: drawImage(HTMLImageElement)
   forces a synchronous JPEG decode on the main thread at first paint and again
   after cache eviction, and those decode spikes ARE the "glitchy frame-by-frame"
   feel. Decoding off-thread around the playhead makes every draw a pure GPU blit.

   TWO FILMS, ONE PAGE (D-018). There are two separately shot cuts of the build —
   a 16:9 landscape macro and a 9:16 portrait counter shot — and each is loaded
   only on the viewport shape it was framed for. This is not a nicety: a canvas
   draws `cover`, so serving the landscape cut to a phone threw away ~68% of the
   frame width AND upscaled the surviving sliver. The portrait cut is a different
   take with a different arc (it ends wrapped, not plated), so its beat timings
   and chapter names are per-set, not shared.

   Only the active set is ever fetched. Switching sets (rotate a phone, drag a
   desktop window narrow) is a real reload, so it is generation-guarded and it
   loads outward from the frame you are actually looking at.

   Everything outside the film is optional polish; the page reads without JS. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var JUMP = new URLSearchParams(location.search).get('jump');
  if (JUMP !== null && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ── Footer year ─────────────────────────────────────────────────────── */
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = String(new Date().getFullYear());

  /* ── Nav condense ────────────────────────────────────────────────────── */
  var nav = document.getElementById('nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('is-stuck', window.scrollY > 40); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Section reveals ─────────────────────────────────────────────────── */
  var targets = document.querySelectorAll('.reveal');
  if (targets.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry, i) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          window.setTimeout(function () { el.classList.add('is-in'); }, i * 90);
          io.unobserve(el);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
      Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
    }
  }

  /* ══ SCROLL FILM ═══════════════════════════════════════════════════════ */
  var canvas = document.getElementById('filmCanvas');
  var driver = document.getElementById('filmDriver');
  if (!canvas || !driver) { window.__ready = true; return; }

  var ctx      = canvas.getContext('2d', { alpha: false });
  var loader   = document.getElementById('filmLoader');
  var loadBar  = document.getElementById('filmBar');
  var seamEl   = document.getElementById('filmSeam');
  var progEl   = document.getElementById('filmProgress');
  var chapEl   = document.getElementById('filmChapter');
  var cueEl    = document.getElementById('filmScrollCue');

  /* ── The two cuts ────────────────────────────────────────────────────────
     `dprCap` is per-set on purpose. 1.5 was measured as the right desktop cap
     (2.0 doubles blit cost for invisible gain on a 2160px-wide canvas). The
     portrait canvas is a fraction of that area, so it can afford 2.0 — and it
     needs it: a 390px-wide phone at DPR 1.5 gives a 585px canvas, which would
     throw away sharpness the 720px-wide source actually has. */
  var FILMS = {
    wide: {
      dir: 'media/frames/', count: 189, dprCap: 1.5,
      bitmapAhead: 9, bitmapKeep: 14, decodeConcurrency: 1,
      chapters: [
        { at: 0.00, name: 'The Fillet' },
        { at: 0.28, name: 'Dressed by Hand' },
        { at: 0.52, name: 'The Crown' },
        { at: 0.74, name: 'Served' },
        { at: 0.90, name: 'Fit for a King' }
      ]
    },
    tall: {
      dir: 'media/frames-9x16/', count: 217, dprCap: 2,
      bitmapAhead: 6, bitmapKeep: 9, decodeConcurrency: 1,
      chapters: [
        { at: 0.00, name: 'The Fillet' },
        { at: 0.15, name: 'The Crown' },
        { at: 0.34, name: 'Dressed by Hand' },
        { at: 0.62, name: 'Wrapped' },
        { at: 0.88, name: 'Fit for a King' }
      ]
    }
  };

  /* Aspect, not device width: the question is only ever "which cut fits this
     viewport", and a narrow desktop window deserves the portrait cut too. */
  var tallMQ = window.matchMedia('(max-aspect-ratio: 1/1)');
  function pickKey() { return tallMQ.matches ? 'tall' : 'wide'; }

  var activeKey = null, film = null, FRAME_COUNT = 0, CHAPTERS = null;
  var framePath = function (i) {
    return film.dir + 'f_' + String(i + 1).padStart(4, '0') + '.jpg';
  };

  var images   = [];
  var loadedCt = 0;
  var displayed = -1;

  /* ── Frame pump: concurrency-capped so the network does not stampede ──
     `order` exists for the switch case. Loading 0..N sequentially is right at
     boot, but a rotate at 60% scroll would otherwise leave the visitor staring
     at a stale frame while 130 frames they cannot see load first. */
  var order = [], orderPos = 0, INFLIGHT = 10, settled = false, gen = 0;

  function buildOrder(startIdx) {
    order = []; orderPos = 0;
    for (var i = startIdx; i < FRAME_COUNT; i++) order.push(i);
    for (var j = startIdx - 1; j >= 0; j--) order.push(j);
  }

  function pump() {
    var myGen = gen;
    while (orderPos < order.length && INFLIGHT > 0) {
      (function (idx) {
        INFLIGHT--;
        var img = new Image();
        img.decoding = 'async';
        img.onload = img.onerror = function () {
          if (myGen !== gen) return;          /* set was swapped mid-flight */
          if (img.naturalWidth) images[idx] = img;
          loadedCt++;
          INFLIGHT++;
          if (loadBar) loadBar.style.width = (loadedCt / FRAME_COUNT * 100).toFixed(1) + '%';
          var want = Math.round(current);
          if (displayed < 0 || idx === want) { ensureBitmaps(want); draw(want); }
          if (!settled && loadedCt >= Math.min(28, FRAME_COUNT)) reveal();
          if (loadedCt === FRAME_COUNT) reveal();
          pump();
        };
        img.src = framePath(idx);
      })(order[orderPos++]);
    }
  }

  /* ── Set switch ──────────────────────────────────────────────────────────
     The old canvas contents are deliberately left standing until a frame from
     the new set arrives — draw() bails when it has nothing, so the film holds
     the last good picture instead of flashing black through the swap. */
  function useFilm(key) {
    activeKey = key;
    film = FILMS[key];
    FRAME_COUNT = film.count;
    CHAPTERS = film.chapters;

    gen++;
    images = new Array(FRAME_COUNT);
    loadedCt = 0; INFLIGHT = 10;
    B_AHEAD = film.bitmapAhead;
    B_KEEP = film.bitmapKeep;
    DECODE_LIMIT = film.decodeConcurrency;
    bitmaps.forEach(function (b) { b.close(); });
    bitmaps.clear();
    decodeQueue = [];
    queued.clear();
    bmpCenter = -999;
    displayed = -1;
    headerSampled = false;

    beats = collectBeats(key);
    var p = filmProgress();
    current = target = p * (FRAME_COUNT - 1);

    resize();
    buildOrder(Math.round(current));
    pump();
  }

  function syncFilm() {
    var k = pickKey();
    if (k === activeKey) return;
    useFilm(k);
  }

  /* A missing frame must never blank the canvas — scan outward. */
  function nearestImage(idx) {
    if (images[idx]) return images[idx];
    for (var d = 1; d < FRAME_COUNT; d++) {
      if (images[idx - d]) return images[idx - d];
      if (images[idx + d]) return images[idx + d];
    }
    return null;
  }

  /* ── ImageBitmap sliding window ──────────────────────────────────────── */
  var bitmaps = new Map(), decoding = new Set(), queued = new Set();
  var decodeQueue = [], activeDecodes = 0;
  var B_AHEAD = 9, B_KEEP = 14, DECODE_LIMIT = 1, bmpCenter = -999;
  var canBitmap = typeof createImageBitmap === 'function';

  function jobKey(generation, idx) { return generation + ':' + idx; }

  function drainDecodes() {
    while (activeDecodes < DECODE_LIMIT && decodeQueue.length) {
      var job = decodeQueue.shift();
      var key = jobKey(job.generation, job.idx);
      queued.delete(key);
      if (job.generation !== gen || !images[job.idx] || bitmaps.has(job.idx)) continue;

      activeDecodes++;
      decoding.add(key);
      (function (job, key, source) {
        createImageBitmap(source).then(function (bmp) {
          if (job.generation !== gen || Math.abs(job.idx - bmpCenter) > B_KEEP) {
            bmp.close();
            return;
          }
          var prior = bitmaps.get(job.idx);
          if (prior) prior.close();
          bitmaps.set(job.idx, bmp);
          stats.maxBitmaps = Math.max(stats.maxBitmaps, bitmaps.size);
          var want = Math.round(current);
          if (displayed < 0 || Math.abs(job.idx - want) < Math.abs(displayed - want)) {
            draw(want, true);
          }
        }).catch(function () {
          /* A failed decode degrades to the nearest retained bitmap. */
        }).finally(function () {
          decoding.delete(key);
          activeDecodes--;
          drainDecodes();
        });
      })(job, key, images[job.idx]);
    }
    stats.maxDecodes = Math.max(stats.maxDecodes, activeDecodes);
  }

  function ensureBitmaps(center) {
    if (!canBitmap) return;
    bmpCenter = center;

    /* Drop queued work that a fast jump has already made irrelevant. Active
       jobs finish safely and close themselves if they land outside the keep
       window. This is the memory bound that prevents mobile renderer crashes. */
    decodeQueue = decodeQueue.filter(function (job) {
      var keep = job.generation === gen && Math.abs(job.idx - center) <= B_KEEP;
      if (!keep) queued.delete(jobKey(job.generation, job.idx));
      return keep;
    });

    var lo = Math.max(0, center - B_AHEAD);
    var hi = Math.min(FRAME_COUNT - 1, center + B_AHEAD);
    for (var i = lo; i <= hi; i++) {
      var key = jobKey(gen, i);
      if (bitmaps.has(i) || decoding.has(key) || queued.has(key) || !images[i]) continue;
      queued.add(key);
      decodeQueue.push({ idx: i, generation: gen });
    }
    decodeQueue.sort(function (a, b) {
      return Math.abs(a.idx - center) - Math.abs(b.idx - center);
    });

    bitmaps.forEach(function (bmp, idx) {
      if (idx < center - B_KEEP || idx > center + B_KEEP) {
        bmp.close();
        bitmaps.delete(idx);
      }
    });
    drainDecodes();
  }

  /* ── Sizing: DPR cap is per-set — see FILMS above for why they differ ── */
  var cw = 0, ch = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, film.dprCap);
    cw = Math.round(canvas.clientWidth  * dpr);
    ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      if (displayed >= 0) draw(displayed, true);
    }
  }

  /* Cheap permanent counters. `fallback` is now a nearest-bitmap draw; normal
     motion never asks an HTMLImageElement to decode synchronously. */
  var stats = { draws: 0, bmpHit: 0, fallback: 0, holds: 0, maxBitmaps: 0, maxDecodes: 0 };
  window.__filmStats = stats;

  function nearestBitmap(idx) {
    if (bitmaps.has(idx)) return { idx: idx, src: bitmaps.get(idx) };
    for (var d = 1; d <= B_KEEP; d++) {
      if (bitmaps.has(idx - d)) return { idx: idx - d, src: bitmaps.get(idx - d) };
      if (bitmaps.has(idx + d)) return { idx: idx + d, src: bitmaps.get(idx + d) };
    }
    return null;
  }

  var lastSrc = null;
  function draw(idx, force) {
    var found = canBitmap ? nearestBitmap(idx) : null;
    var src = found ? found.src : ((!canBitmap || reduced) ? nearestImage(idx) : null);
    var actual = found ? found.idx : idx;
    if (!src || !cw) { stats.holds++; return; }
    if (!force && actual === displayed) { stats.holds++; return; }
    stats.draws++;
    if (found && actual === idx) stats.bmpHit++; else stats.fallback++;
    var iw = src.width, ih = src.height;
    var s = Math.max(cw / iw, ch / ih);          /* cover */
    var w = iw * s, h = ih * s;
    ctx.drawImage(src, (cw - w) / 2, (ch - h) / 2, w, h);
    displayed = actual;
    lastSrc = src;
  }

  /* ── Progress ────────────────────────────────────────────────────────── */
  function filmProgress() {
    var r = driver.getBoundingClientRect();
    var span = r.height - window.innerHeight;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, -r.top / span));
  }

  /* ── Beats ───────────────────────────────────────────────────────────────
     A beat belongs to one cut (`data-film="wide"|"tall"`) or to both. Beats
     scoped to the inactive cut are `hidden`, which keeps their copy out of the
     accessibility tree instead of merely painting it at zero opacity.

     Shared beats carry a second set of `data-tall-*` timings, because the two
     cuts hit their moments at different points: the crown lands at 0.24 in the
     portrait take and not until 0.70 in the landscape one. */
  var beats = [];
  function collectBeats(key) {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.beat'), function (el) {
      var scope = el.dataset.film || 'both';
      /* Reduced motion is one complete static hero, not several invisible
         scroll-only chapters layered on top of it. Excluding the other beats
         from layout/accessibility prevents stranded opacity-zero content. */
      var on = (scope === 'both' || scope === key) &&
               (!reduced || el.classList.contains('beat--hero'));
      el.hidden = !on;
      if (!on) { el.style.opacity = 0; el.classList.remove('is-lit'); return; }
      var t = (key === 'tall' && el.dataset.tallIn !== undefined);
      out.push({
        el: el,
        in:   parseFloat(t ? el.dataset.tallIn   : el.dataset.in),
        peak: parseFloat(t ? el.dataset.tallPeak : el.dataset.peak),
        out:  parseFloat(t ? el.dataset.tallOut  : el.dataset.out)
      });
    });
    return out;
  }

  function beatAlpha(b, p) {
    if (p < b.in || p > b.out) return 0;
    if (p < b.peak) return (p - b.in) / Math.max(1e-4, b.peak - b.in);
    if (b.out > 1.5) return 1;                    /* finale never fades */
    return 1 - (p - b.peak) / Math.max(1e-4, b.out - b.peak);
  }

  /* ── Adaptive header over a changing film ────────────────────────────── */
  var probe = document.createElement('canvas');
  probe.width = 16; probe.height = 4;
  var pctx = probe.getContext('2d', { willReadFrequently: true });
  var lastProbe = 0, headerSampled = false;
  function sampleHeader(now) {
    /* Only the uncondensed header needs adaptive colours, and it only ever
       overlaps the opening frame. Sampling every 200ms after the nav became
       opaque was redundant GPU readback work and caused repeatable scroll
       spikes on Chrome. Resolve the opening treatment once behind the loader. */
    if (!nav || headerSampled || !lastSrc) return;
    if (nav.classList.contains('is-stuck')) { headerSampled = true; return; }
    if (now - lastProbe < 200) return;
    lastProbe = now;
    try {
      /* Sample the SOURCE frame, never the live canvas. Reading back from the
         full-viewport canvas forces a GPU->CPU sync every probe, and that
         showed up directly as ~290ms spikes in the jank meter. */
      pctx.drawImage(lastSrc, 0, 0, lastSrc.width, Math.max(1, lastSrc.height * 0.16), 0, 0, 16, 4);
      var d = pctx.getImageData(0, 0, 16, 4).data, sum = 0;
      for (var i = 0; i < d.length; i += 4) {
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      }
      nav.classList.toggle('on-light', (sum / (d.length / 4)) > 138);
    } catch (e) { /* tainted canvas — skip silently */ }
    headerSampled = true;
  }

  /* ── Tick ────────────────────────────────────────────────────────────── */
  var current = 0, target = 0, raf = null, lastJank = 0, maxDelta = 0, prevT = 0;

  function apply(p, snap) {
    target = p * (FRAME_COUNT - 1);
    if (snap) current = target;
    else current += (target - current) * 0.14;   /* the butter */

    var idx = Math.round(current);
    ensureBitmaps(idx);
    if (idx !== displayed || snap) draw(idx);

    for (var i = 0; i < beats.length; i++) {
      var a = beatAlpha(beats[i], p);
      beats[i].el.style.opacity = a;
      beats[i].el.style.transform = 'translateY(' + ((1 - a) * 14).toFixed(2) + 'px)';
      beats[i].el.classList.toggle('is-lit', a > 0.5);
    }

    if (seamEl) seamEl.style.opacity = p > 0.965 ? ((p - 0.965) / 0.035).toFixed(3) : 0;
    if (progEl) progEl.style.width = (p * 100).toFixed(2) + '%';
    if (cueEl)  cueEl.style.opacity = p > 0.04 ? 0 : 1;
    if (chapEl) {
      var name = CHAPTERS[0].name;
      for (var c = 0; c < CHAPTERS.length; c++) if (p >= CHAPTERS[c].at) name = CHAPTERS[c].name;
      if (chapEl.textContent !== name) chapEl.textContent = name;
    }
  }

  function tick(now) {
    if (prevT) {
      var dt = now - prevT;
      if (dt > maxDelta) maxDelta = dt;
      if (now - lastJank > 2000) {
        if (window.__jank) console.log('[jank] max frame delta', maxDelta.toFixed(1) + 'ms');
        maxDelta = 0; lastJank = now;
      }
    }
    prevT = now;

    var p = filmProgress();
    apply(p, false);
    sampleHeader(now);
    /* Once the playhead has settled at either edge there is nothing left to
       animate. Leaving this loop alive made the page rewrite beat styles and
       measure the driver on every frame throughout the long menu below. */
    var atStart = p <= 0 && current <= 0.05;
    var atEnd = p >= 1 && current >= FRAME_COUNT - 1.05;
    if (atStart || atEnd) {
      raf = null;
      prevT = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function wakeFilm() {
    if (reduced || raf !== null) return;
    var p = filmProgress();
    if ((p <= 0 && current <= 0.05) ||
        (p >= 1 && current >= FRAME_COUNT - 1.05)) return;
    raf = requestAnimationFrame(tick);
  }
  window.addEventListener('scroll', wakeFilm, { passive: true });

  /* ── Reveal + boot ───────────────────────────────────────────────────────
     Warm the bounded playhead window behind the loader. Decode concurrency is
     deliberately capped: mobile Chrome can otherwise retain many completed HD
     bitmaps at once and terminate the renderer during a fast direction change. */
  function warmWindow(cb) {
    if (!canBitmap || reduced) { cb(); return; }
    var c  = Math.round(current);
    /* Wait for the same lo/hi span ensureBitmaps builds, not an arbitrary
       number that can lift the loader while the opening window is incomplete. */
    var lo = Math.max(0, c - B_AHEAD);
    var hi = Math.min(FRAME_COUNT - 1, c + B_AHEAD);
    var want = hi - lo + 1;
    var t0 = performance.now();
    (function poll() {
      /* ensureBitmaps refuses to rescan the same centre, but frames are still
         arriving during warm-up — so force it. The has/decoding guards inside
         make the rescan itself nearly free. */
      bmpCenter = -999;
      ensureBitmaps(c);
      if (bitmaps.size >= want || performance.now() - t0 > 2500) { cb(); return; }
      setTimeout(poll, 40);
    })();
  }

  function reveal() {
    if (settled) return;
    settled = true;
    resize();
    apply(filmProgress(), true);
    warmWindow(function () {
      sampleHeader(performance.now() + 1000);
      if (loader) loader.classList.add('is-done');
      if (!reduced) wakeFilm();
      finish();
    });
  }

  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (JUMP !== null) {
      window.scrollTo(0, parseFloat(JUMP) || 0);
      /* force-settle every scroll-driven value at the jumped position */
      resize();
      apply(filmProgress(), true);
      sampleHeader(performance.now() + 1000);
      if (nav) nav.classList.toggle('is-stuck', window.scrollY > 40);
      /* The jump moved the playhead, so the window warmed at scroll 0 is the
         wrong one. Re-warm before declaring ready, or a capture races it. */
      warmWindow(function () { window.__ready = true; });
      return;
    }
    window.__ready = true;
  }

  /* A rotate fires `resize` too, so syncFilm() must run before resize() —
     otherwise the canvas is sized for the cut we are about to drop. */
  window.addEventListener('resize', function () {
    syncFilm();
    resize();
    apply(filmProgress(), true);
  }, { passive: true });

  if (tallMQ.addEventListener) {
    tallMQ.addEventListener('change', function () {
      syncFilm();
      apply(filmProgress(), true);
    });
  }

  useFilm(pickKey());

  /* Reduced motion: hold one frame, never start the rAF loop. */
  if (reduced) {
    var poster = new Image();
    poster.onload = function () { images[0] = poster; resize(); draw(0, true); reveal(); };
    poster.src = framePath(0);
  }

  /* Never let a stalled network hold the page hostage. */
  setTimeout(reveal, 6000);
})();

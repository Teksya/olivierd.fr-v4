(function () {
  // ── Active nav link ──────────────────────────────
  var path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(function (link) {
    if (link.getAttribute('href') === path) link.classList.add('active');
  });

  // ── Reduced-motion preference ────────────────────
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Cinematic page transition (paint draws itself) ──
  var paintOverlay = document.getElementById('paint-transition');
  var paintSvgText = null;
  if (paintOverlay) {
    fetch('/paint.svg').then(function (r) { return r.text(); })
      .then(function (t) { paintSvgText = t; })
      .catch(function () {});
  }

  function navigateWithPaint(href) {
    if (!paintOverlay || !paintSvgText) { window.location.href = href; return; }
    paintOverlay.innerHTML = paintSvgText;
    void paintOverlay.offsetWidth; // reflow so the CSS sketch animation starts cleanly
    paintOverlay.classList.add('is-on');
    setTimeout(function () { window.location.href = href; }, 850);
  }

  document.querySelectorAll('a').forEach(function (link) {
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || link.target === '_blank' || link.closest('form')) return;
    link.addEventListener('click', function (e) {
      if (href === path) return;
      e.preventDefault();
      if (prefersReducedMotion) { window.location.href = href; return; }
      navigateWithPaint(href);
    });
  });

  // ── Animated counter ─────────────────────────────
  document.querySelectorAll('.stat-number[data-count]').forEach(function (el) {
    var target = parseInt(el.dataset.count, 10) || 0;
    if (prefersReducedMotion) { el.textContent = '+' + target; return; }
    new IntersectionObserver(function (entries, obs) {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      var start = performance.now();
      (function step(now) {
        var t = Math.min((now - start) / 1400, 1);
        var ease = 1 - Math.pow(1 - t, 3);
        el.textContent = '+' + Math.round(target * ease);
        if (t < 1) requestAnimationFrame(step);
      })(start);
    }, { threshold: 0.5 }).observe(el);
  });

  // ── Project modal ────────────────────────────────
  var modal = document.getElementById('project-modal');
  if (modal) {
    var modalImg = document.getElementById('modal-img');
    var modalTitle = document.getElementById('modal-title');
    var modalDesc = document.getElementById('modal-desc');
    var modalChips = document.getElementById('modal-chips');
    var modalTags = document.getElementById('modal-tags');

    var lastFocused = null;

    function openModal(card) {
      lastFocused = card;
      modalImg.src = card.dataset.image || '';
      modalImg.alt = card.dataset.title || '';
      modalTitle.textContent = card.dataset.title || '';
      modalDesc.textContent = card.dataset.desc || '';
      modalChips.innerHTML = (card.dataset.chips || '').split('|||').filter(Boolean).map(function (c) {
        return '<span class="chip">' + c + '</span>';
      }).join('');
      modalTags.innerHTML = (card.dataset.tags || '').split('|||').filter(Boolean).map(function (t) {
        return '<span class="chip">' + t + '</span>';
      }).join('');
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      var closeBtn = document.getElementById('modal-close');
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      modal.classList.remove('open');
      document.body.style.overflow = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    document.querySelectorAll('.project-card').forEach(function (card) {
      card.addEventListener('click', function () { openModal(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(card);
        }
      });
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
  }

  // ── Work: tag filtering ──────────────────────────
  var workFilters = document.getElementById('work-filters');
  if (workFilters) {
    var filterCards = document.querySelectorAll('.project-card');
    var workEmpty = document.getElementById('work-empty');
    workFilters.addEventListener('click', function (e) {
      var btn = e.target.closest('.work-filter');
      if (!btn) return;
      var f = btn.dataset.filter;
      workFilters.querySelectorAll('.work-filter').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      var shown = 0;
      filterCards.forEach(function (card) {
        var tags = (card.dataset.tags || '').split('|||');
        var show = f === 'all' || tags.indexOf(f) !== -1;
        card.style.display = show ? '' : 'none';
        if (show) shown++;
      });
      if (workEmpty) workEmpty.hidden = shown > 0;
    });
  }

  // ── Konami code → confetti ───────────────────────
  var konamiSeq = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var konamiIdx = 0;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === konamiSeq[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === konamiSeq.length) {
        konamiIdx = 0;
        fireConfetti();
      }
    } else {
      konamiIdx = 0;
    }
  });

  function fireConfetti() {
    var colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f97316', '#22c55e', '#f43f5e'];
    for (var i = 0; i < 120; i++) {
      var c = document.createElement('div');
      var size = 4 + Math.random() * 6;
      c.style.cssText = 'position:fixed;border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') +
        ';pointer-events:none;z-index:99999;width:' + size + 'px;height:' + size + 'px;';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.left = Math.random() * 100 + 'vw';
      c.style.top = '-10px';
      c.style.animation = 'confettiFall ' + (1.5 + Math.random() * 2) + 's ease-out forwards';
      c.style.animationDelay = Math.random() * 0.6 + 's';
      document.body.appendChild(c);
      (function (el) { setTimeout(function () { el.remove(); }, 4500); })(c);
    }
  }

  // ── Fine-pointer-only effects (skip if reduced motion) ──
  if (!window.matchMedia('(pointer: fine)').matches || prefersReducedMotion) return;

  // ── Custom cursor ────────────────────────────────
  var dot = document.createElement('div');
  dot.className = 'cursor-dot';
  var ring = document.createElement('div');
  ring.className = 'cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  var mx = -100, my = -100, rx = -100, ry = -100;

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
  });

  (function tickRing() {
    rx += (mx - rx) * 0.25;
    ry += (my - ry) * 0.25;
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';
    requestAnimationFrame(tickRing);
  })();

  document.addEventListener('mouseover', function (e) {
    if (e.target.closest('a, button, [role="button"], input, textarea, select, .tc, .card, .bento-card'))
      ring.classList.add('cursor-hover');
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('a, button, [role="button"], input, textarea, select, .tc, .card, .bento-card'))
      ring.classList.remove('cursor-hover');
  });

  // ── Magnetic buttons ─────────────────────────────
  document.querySelectorAll('.btn').forEach(function (btn) {
    btn.addEventListener('mousemove', function (e) {
      var rect = btn.getBoundingClientRect();
      var dx = e.clientX - rect.left - rect.width / 2;
      var dy = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = 'translate(' + (dx * 0.18) + 'px,' + (dy * 0.18) + 'px)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.transform = '';
    });
  });

  // ── Tilt 3D on home bento cards only (skip hero) ──
  document.querySelectorAll('.bento-page .bento-card:not(.bento-main)').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var rect = card.getBoundingClientRect();
      var rX = ((e.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * -4;
      var rY = ((e.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 4;
      card.style.transform = 'perspective(800px) rotateX(' + rX + 'deg) rotateY(' + rY + 'deg) scale3d(1.01,1.01,1.01)';
    });
    card.addEventListener('mouseleave', function () {
      card.style.transform = '';
    });
  });

  // ── Cursor spotlight glow on cards ───────────────
  document.querySelectorAll('.bento-card, .project-card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    });
  });
})();

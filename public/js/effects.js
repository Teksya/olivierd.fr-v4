(function () {
  'use strict';

  // ── Lien de navigation actif ─────────────────────
  var path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(function (link) {
    if (link.getAttribute('href') === path) link.classList.add('active');
  });

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Compteur animé (chiffres de la home) ─────────
  document.querySelectorAll('[data-count]').forEach(function (el) {
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

  // ── Modal projet ─────────────────────────────────
  var modal = document.getElementById('project-modal');
  if (modal) {
    var modalImg = document.getElementById('modal-img');
    var modalTitle = document.getElementById('modal-title');
    var modalDesc = document.getElementById('modal-desc');
    var modalChips = document.getElementById('modal-chips');
    var modalTags = document.getElementById('modal-tags');
    var lastFocused = null;

    function chipHtml(v) {
      return '<span class="inline-flex items-center rounded-full border border-line bg-surface2 px-3 py-1 text-xs text-body">' + v + '</span>';
    }

    function openModal(card) {
      lastFocused = card;
      modalImg.src = card.dataset.image || '';
      modalImg.alt = card.dataset.title || '';
      modalTitle.textContent = card.dataset.title || '';
      modalDesc.textContent = card.dataset.desc || '';
      modalChips.innerHTML = (card.dataset.chips || '').split('|||').filter(Boolean).map(chipHtml).join('');
      modalTags.innerHTML = (card.dataset.tags || '').split('|||').filter(Boolean).map(chipHtml).join('');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.style.overflow = 'hidden';
      var closeBtn = document.getElementById('modal-close');
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.body.style.overflow = '';
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    document.querySelectorAll('.project-card').forEach(function (card) {
      card.addEventListener('click', function () { openModal(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(card); }
      });
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });
  }

  // ── Filtres par tag (page Travaux) ───────────────
  var workFilters = document.getElementById('work-filters');
  if (workFilters) {
    var filterCards = document.querySelectorAll('.project-card');
    var workEmpty = document.getElementById('work-empty');
    workFilters.addEventListener('click', function (e) {
      var btn = e.target.closest('.work-filter');
      if (!btn) return;
      var f = btn.dataset.filter;
      workFilters.querySelectorAll('.work-filter').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.classList.toggle('border-accent', on);
        b.classList.toggle('text-strong', on);
        b.classList.toggle('border-line', !on);
        b.classList.toggle('text-muted', !on);
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

  // ── Konami → confetti (easter egg) ───────────────
  var konamiSeq = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var konamiIdx = 0;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === konamiSeq[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === konamiSeq.length) { konamiIdx = 0; fireConfetti(); }
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
})();

// Popup de vérification d'authenticité du diplôme (Cyclades Vérif)
(function () {
  const modal = document.getElementById('diploma-modal');
  if (!modal) return;

  const openers = document.querySelectorAll('[data-diploma-verify]');
  const closers = modal.querySelectorAll('[data-diploma-close]');
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    // laisser le temps au navigateur d'appliquer [hidden=false] avant la transition
    requestAnimationFrame(() => modal.classList.add('is-open'));
    const closeBtn = modal.querySelector('.dv-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    const done = () => {
      modal.hidden = true;
      modal.removeEventListener('transitionend', done);
    };
    modal.addEventListener('transitionend', done);
    // filet de sécurité si aucune transition ne se déclenche
    setTimeout(() => { if (!modal.classList.contains('is-open')) modal.hidden = true; }, 300);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  openers.forEach((btn) => btn.addEventListener('click', open));
  closers.forEach((btn) => btn.addEventListener('click', close));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
})();

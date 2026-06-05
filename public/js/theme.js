(function () {
  var button = document.querySelector('.theme-toggle');
  if (!button) return;

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    button.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    button.title = theme === 'light' ? 'Theme sombre' : 'Theme clair';
  }

  applyTheme(currentTheme());

  button.addEventListener('click', function () {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });
})();

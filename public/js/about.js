(function () {
  var aboutConfigNode = document.getElementById('about-config');
  var ABOUT_CONFIG = {};

  if (aboutConfigNode) {
    try {
      ABOUT_CONFIG = JSON.parse(decodeURIComponent(aboutConfigNode.getAttribute('data-config') || '%7B%7D'));
    } catch (e) {
      ABOUT_CONFIG = {};
    }
  }

  (function initSpotifyWidget() {
    var widget = document.getElementById('spotify-widget');
    if (!widget) return;

    var progressTick = null;
    var fallbackTick = null;
    var stream = null;

    function stopProgress() {
      if (progressTick) {
        clearInterval(progressTick);
        progressTick = null;
      }
    }

    function hideWidget() {
      stopProgress();
      widget.style.display = 'none';
    }

    function fmt(ms) {
      var s = Math.floor(ms / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function startProgress(progressMs, durationMs, fetchedAt) {
      stopProgress();
      var bar = document.getElementById('sp-bar');
      var current = document.getElementById('sp-current');
      var duration = document.getElementById('sp-duration');
      if (!bar || !current || !duration) return;

      duration.textContent = fmt(durationMs || 0);
      function tick() {
        var elapsed = Date.now() - (fetchedAt || Date.now());
        var pos = Math.min((progressMs || 0) + elapsed, durationMs || 0);
        var pct = durationMs ? (pos / durationMs) * 100 : 0;
        bar.style.width = pct + '%';
        current.textContent = fmt(pos);
      }
      tick();
      progressTick = setInterval(tick, 1000);
    }

    async function fetchSpotifyState() {
      try {
        var r = await fetch('/api/spotify?ts=' + Date.now(), { cache: 'no-store' });
        var d = await r.json();
        applyState(d);
      } catch (err) {
        hideWidget();
      }
    }

    function startFallbackPolling() {
      if (fallbackTick) return;
      fetchSpotifyState();
      fallbackTick = setInterval(fetchSpotifyState, 2500);
    }

    function stopFallbackPolling() {
      if (!fallbackTick) return;
      clearInterval(fallbackTick);
      fallbackTick = null;
    }

    function applyState(d) {
      var img = document.getElementById('sp-img');
      var title = document.getElementById('sp-title');
      var artist = document.getElementById('sp-artist');
      var label = document.getElementById('sp-label');
      var progress = document.querySelector('.sp-card__progress');
      if (!img || !title || !artist || !label || !progress) return;

      if (!d || !d.playing) {
        hideWidget();
        return;
      }

      img.src = d.image || '';
      img.alt = d.album || '';
      title.textContent = d.title || '';
      title.href = d.url || '#';
      artist.textContent = d.artist || '';
      label.textContent = 'ECOUTE';
      progress.style.display = '';
      widget.style.display = '';
      startProgress(d.progress_ms, d.duration_ms, d.fetched_at);
    }

    if ('EventSource' in window) {
      stream = new EventSource('/api/spotify/stream');
      stream.onopen = stopFallbackPolling;
      stream.onmessage = function (e) {
        try {
          applyState(JSON.parse(e.data));
        } catch (err) {}
      };
      stream.onerror = startFallbackPolling;
    } else {
      startFallbackPolling();
    }

    window.addEventListener('focus', fetchSpotifyState);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) fetchSpotifyState();
    });
    window.addEventListener('beforeunload', function () {
      stopFallbackPolling();
      if (stream) stream.close();
    });
  })();

  (function initGithubWidget() {
    if (!ABOUT_CONFIG.githubEnabled) return;

    function timeAgo(iso) {
      var s = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (s < 60) return 'il y a quelques secondes';
      if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
      if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + 'h';
      return 'il y a ' + Math.floor(s / 86400) + 'j';
    }

    async function pollGithub() {
      try {
        var r = await fetch('/api/github');
        var d = await r.json();
        if (!d.ok) return;
        var action = document.getElementById('gh-act-action');
        var repo = document.getElementById('gh-act-repo');
        var time = document.getElementById('gh-act-time');
        var activity = document.getElementById('gh-activity');
        if (!action || !repo || !time || !activity) return;
        action.textContent = d.action || '';
        action.href = d.url || '#';
        repo.textContent = d.repo || '';
        time.textContent = d.date ? timeAgo(d.date) : '';
        activity.style.display = '';
      } catch (e) {}
    }

    pollGithub();
    setInterval(pollGithub, 120000);
  })();

  (function initHomelabWidget() {
    if (!ABOUT_CONFIG.homelabEnabled) return;

    var card = document.getElementById('ut-card');
    var statusEl = document.getElementById('ut-status');
    var groupsEl = document.getElementById('ut-groups');
    if (!card || !statusEl || !groupsEl) return;

    function dot(up) {
      return '<span class="ut-dot" data-up="' + up + '"></span>';
    }

    async function pollUptime() {
      try {
        var r = await fetch('/api/uptime');
        var d = await r.json();
        if (!d.ok) return;
        statusEl.textContent = d.overall ? 'Tous les systèmes sont opérationnels' : 'Incidents en cours';
        statusEl.dataset.up = d.overall;
        groupsEl.innerHTML = (d.groups || []).map(function (g) {
          return '<div class="ut-group">' + dot(g.up) + '<span class="ut-group__name">' + (g.group || '') + '</span></div>';
        }).join('');
        card.style.display = '';
      } catch (e) {}
    }

    pollUptime();
    setInterval(pollUptime, 60000);
  })();

  (function initDiscordWidget() {
    if (!ABOUT_CONFIG.discordEnabled || !ABOUT_CONFIG.discordUserId) return;

    var userId = String(ABOUT_CONFIG.discordUserId).trim();
    if (!userId) return;

    var widget = document.getElementById('discord-widget');
    var avatar = document.getElementById('dc-avatar');
    var dot = document.getElementById('dc-dot');
    var statusEl = document.getElementById('dc-status');
    var actEl = document.getElementById('dc-activity');
    var actLabel = document.getElementById('dc-act-label');
    var actImgs = document.getElementById('dc-act-imgs');
    var actLarge = document.getElementById('dc-act-large');
    var actSmall = document.getElementById('dc-act-small');
    var actName = document.getElementById('dc-act-name');
    var actDetails = document.getElementById('dc-act-details');
    var actState = document.getElementById('dc-act-state');

    if (!widget || !dot || !statusEl || !actEl || !actLabel || !actImgs || !actLarge || !actSmall || !actName || !actDetails || !actState) return;

    var STATUS_LABELS = {
      online: 'En ligne',
      idle: 'Absent',
      dnd: 'Ne pas deranger',
      offline: 'Hors ligne'
    };

    var ACT_LABELS = {
      0: 'SUR',
      1: 'EN STREAM',
      3: 'REGARDE',
      5: 'COMPETE DANS'
    };

    function assetUrl(appId, img) {
      if (!img) return '';
      if (img.indexOf('mp:') === 0) return 'https://media.discordapp.net/' + img.slice(3);
      if (img.indexOf('spotify:') === 0) return 'https://i.scdn.co/image/' + img.slice(8);
      return 'https://cdn.discordapp.com/app-assets/' + appId + '/' + img + '.png';
    }

    function applyPresence(payload) {
      if (!payload) return;

      var status = payload.discord_status || 'offline';
      dot.dataset.status = status;
      statusEl.textContent = STATUS_LABELS[status] || 'Hors ligne';

      if (payload.discord_user && payload.discord_user.avatar && avatar) {
        var avatarHash = payload.discord_user.avatar;
        var ext = avatarHash.indexOf('a_') === 0 ? 'gif' : 'webp';
        avatar.src = 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatarHash + '.' + ext + '?size=80';
      }

      var activities = Array.isArray(payload.activities) ? payload.activities : [];
      // Hide activity when only Spotify or custom status is present.
      var act = activities.find(function (a) {
        return a && a.type !== 2 && a.type !== 4;
      });

      if (!act) {
        actEl.style.display = 'none';
        return;
      }

      actLabel.textContent = ACT_LABELS[act.type] || 'EN COURS';
      actName.textContent = act.name || '';
      actDetails.textContent = act.details || '';
      actState.textContent = act.state || '';
      actDetails.style.display = act.details ? '' : 'none';
      actState.style.display = act.state ? '' : 'none';

      var large = act.assets && act.assets.large_image;
      var small = act.assets && act.assets.small_image;
      if (large) {
        actLarge.src = assetUrl(act.application_id, large);
        actLarge.alt = (act.assets && act.assets.large_text) || '';
        actImgs.style.display = '';

        if (small) {
          actSmall.src = assetUrl(act.application_id, small);
          actSmall.alt = (act.assets && act.assets.small_text) || '';
          actSmall.style.display = '';
        } else {
          actSmall.style.display = 'none';
        }
      } else {
        actImgs.style.display = 'none';
      }

      actEl.style.display = '';
    }

    async function pollDiscord() {
      try {
        var r = await fetch('https://api.lanyard.rest/v1/users/' + encodeURIComponent(userId));
        var json = await r.json();
        if (!json || !json.success || !json.data) {
          widget.style.display = '';
          return;
        }
        applyPresence(json.data);
      } catch (e) {
        // Keep base card visible with last known status if API fails.
      }
    }

    pollDiscord();
    setInterval(pollDiscord, 15000);
  })();
})();

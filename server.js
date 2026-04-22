const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const projectsPath = path.join(__dirname, 'projects.json');
const adminConfigPath = path.join(__dirname, 'admin-config.json');
function loadProjects() {
	delete require.cache[require.resolve(projectsPath)];
	return require(projectsPath);
}

function saveProjects(projects) {
	fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

function parseBoolean(value) {
	if (typeof value === 'boolean') return value;
	const normalized = String(value || '').trim().toLowerCase();
	return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function loadAdminConfig() {
	const legacySlug = String(process.env.UPTIME_SLUG || '').trim();
	const defaults = {
		SPOTIFY_ENABLED: process.env.SPOTIFY_ENABLED === 'true',
		SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || '',
		SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || '',
		SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN || '',
		DISCORD_ENABLED: process.env.DISCORD_ENABLED !== 'false',
		DISCORD_USER_ID: process.env.DISCORD_USER_ID || '293855276665405440',
		DISCORD_USERNAME: process.env.DISCORD_USERNAME || 'Teksya',
		DISCORD_AVATAR_URL: process.env.DISCORD_AVATAR_URL || 'https://cdn.discordapp.com/avatars/293855276665405440/c0b1517c692b47673ddcfc35214514f3.webp?size=80',
		GITHUB_ENABLED: process.env.GITHUB_ENABLED !== 'false',
		GITHUB_USERNAME: process.env.GITHUB_USERNAME || 'Teksya',
		GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
		HOMELAB_ENABLED: process.env.HOMELAB_ENABLED !== 'false',
		HOMELAB_NAME: process.env.HOMELAB_NAME || 'Homelab',
		KENER_BASE: process.env.KENER_BASE || process.env.UPTIME_BASE || 'status.olivierd.fr',
		KENER_PAGE_PATH: process.env.KENER_PAGE_PATH || (legacySlug && legacySlug !== 'global' ? legacySlug : '')
	};

	if (!fs.existsSync(adminConfigPath)) return defaults;

	try {
		const parsed = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
		const has = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
		const kenerBase = has('KENER_BASE') ? parsed.KENER_BASE : (has('UPTIME_BASE') ? parsed.UPTIME_BASE : defaults.KENER_BASE);
		const kenerPagePathRaw = has('KENER_PAGE_PATH') ? parsed.KENER_PAGE_PATH : (has('UPTIME_SLUG') ? parsed.UPTIME_SLUG : defaults.KENER_PAGE_PATH);
		return {
			...defaults,
			...parsed,
			KENER_BASE: String(kenerBase || '').trim(),
			KENER_PAGE_PATH: normalizeKenerPagePath(kenerPagePathRaw),
			SPOTIFY_ENABLED: has('SPOTIFY_ENABLED') ? parseBoolean(parsed.SPOTIFY_ENABLED) : defaults.SPOTIFY_ENABLED,
			DISCORD_ENABLED: has('DISCORD_ENABLED') ? parseBoolean(parsed.DISCORD_ENABLED) : defaults.DISCORD_ENABLED,
			GITHUB_ENABLED: has('GITHUB_ENABLED') ? parseBoolean(parsed.GITHUB_ENABLED) : defaults.GITHUB_ENABLED,
			HOMELAB_ENABLED: has('HOMELAB_ENABLED') ? parseBoolean(parsed.HOMELAB_ENABLED) : defaults.HOMELAB_ENABLED
		};
	} catch (e) {
		console.error('Admin config parse error:', e.message);
		return defaults;
	}
}

function saveAdminConfig(config) {
	const sanitized = {
		SPOTIFY_ENABLED: parseBoolean(config.SPOTIFY_ENABLED),
		SPOTIFY_CLIENT_ID: String(config.SPOTIFY_CLIENT_ID || '').trim(),
		SPOTIFY_CLIENT_SECRET: String(config.SPOTIFY_CLIENT_SECRET || '').trim(),
		SPOTIFY_REFRESH_TOKEN: String(config.SPOTIFY_REFRESH_TOKEN || '').trim(),
		DISCORD_ENABLED: parseBoolean(config.DISCORD_ENABLED),
		DISCORD_USER_ID: String(config.DISCORD_USER_ID || '').trim(),
		DISCORD_USERNAME: String(config.DISCORD_USERNAME || '').trim(),
		DISCORD_AVATAR_URL: String(config.DISCORD_AVATAR_URL || '').trim(),
		GITHUB_ENABLED: parseBoolean(config.GITHUB_ENABLED),
		GITHUB_USERNAME: String(config.GITHUB_USERNAME || '').trim(),
		GITHUB_TOKEN: String(config.GITHUB_TOKEN || '').trim(),
		HOMELAB_ENABLED: parseBoolean(config.HOMELAB_ENABLED),
		HOMELAB_NAME: String(config.HOMELAB_NAME || '').trim(),
		KENER_BASE: String(config.KENER_BASE || '').trim(),
		KENER_PAGE_PATH: normalizeKenerPagePath(config.KENER_PAGE_PATH)
	};

	fs.writeFileSync(adminConfigPath, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
	return sanitized;
}

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// parse form bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const turnstileSiteKey = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '';
const turnstileSecretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '';

const adminAccessCode = String(process.env.ADMIN_ACCESS_CODE || '').trim();
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || 'change-this-admin-session-secret';
const adminSessionCookie = 'admin_session';
const adminSessionDurationMs = 8 * 60 * 60 * 1000;

if (!/^\d{6}$/.test(adminAccessCode)) {
	console.warn('ADMIN_ACCESS_CODE is missing or invalid. Use a 6-digit code in .env to enable admin login.');
}

function parseCookies(header) {
	const cookies = {};
	if (!header) return cookies;

	header.split(';').forEach((entry) => {
		const idx = entry.indexOf('=');
		if (idx <= 0) return;
		const key = entry.slice(0, idx).trim();
		const value = entry.slice(idx + 1).trim();
		cookies[key] = decodeURIComponent(value);
	});

	return cookies;
}

function createAdminSessionValue() {
	const issuedAt = Date.now();
	const nonce = crypto.randomBytes(16).toString('hex');
	const payload = `${issuedAt}.${nonce}`;
	const sig = crypto.createHmac('sha256', adminSessionSecret).update(payload).digest('hex');
	return `${payload}.${sig}`;
}

function verifyAdminSessionValue(value) {
	if (!value) return false;
	const parts = value.split('.');
	if (parts.length !== 3) return false;

	const [issuedAtRaw, nonce, sig] = parts;
	if (!/^\d+$/.test(issuedAtRaw) || !nonce || !sig) return false;

	const payload = `${issuedAtRaw}.${nonce}`;
	const expected = crypto.createHmac('sha256', adminSessionSecret).update(payload).digest('hex');
	const sigBuf = Buffer.from(sig);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length) return false;
	if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

	const issuedAt = Number(issuedAtRaw);
	return Number.isFinite(issuedAt) && Date.now() - issuedAt <= adminSessionDurationMs;
}

function setAdminSessionCookie(res, value, maxAgeMs) {
	const attrs = [
		`${adminSessionCookie}=${encodeURIComponent(value)}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Strict',
		`Max-Age=${Math.floor(maxAgeMs / 1000)}`
	];

	if (process.env.NODE_ENV === 'production') attrs.push('Secure');

	res.setHeader('Set-Cookie', attrs.join('; '));
}

function requireAdmin(req, res, next) {
	const cookies = parseCookies(req.headers.cookie || '');
	if (verifyAdminSessionValue(cookies[adminSessionCookie])) return next();
	return res.redirect('/admin/login');
}

// ── Spotify ───────────────────────────────────────────
let spotifyConfig = loadAdminConfig();

function getAboutConfig() {
    return {
		spotifyEnabled: parseBoolean(spotifyConfig.SPOTIFY_ENABLED),
		discordEnabled: parseBoolean(spotifyConfig.DISCORD_ENABLED),
		discordUserId: String(spotifyConfig.DISCORD_USER_ID || '').trim(),
		discordUsername: String(spotifyConfig.DISCORD_USERNAME || '').trim() || 'Discord',
		discordAvatarUrl: String(spotifyConfig.DISCORD_AVATAR_URL || '').trim(),
		githubEnabled: parseBoolean(spotifyConfig.GITHUB_ENABLED),
		githubUsername: String(spotifyConfig.GITHUB_USERNAME || '').trim() || 'github',
		homelabEnabled: parseBoolean(spotifyConfig.HOMELAB_ENABLED),
		homelabName: String(spotifyConfig.HOMELAB_NAME || '').trim() || 'Homelab'
	};
}

let spotifyAccessToken = null;
let spotifyTokenExpires = 0;
let spotifyTokenKey = '';

function getSpotifyRedirectUri() {
	return 'http://localhost:' + (process.env.PORT || 3000) + '/callback';
}

function spotifyPost(path, body, config) {
	return new Promise((resolve, reject) => {
		const postData = querystring.stringify(body);
		const auth = Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`).toString('base64');
		const opts = {
			hostname: 'accounts.spotify.com',
			path,
			method: 'POST',
			headers: {
				'Authorization': `Basic ${auth}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(postData)
			}
		};

		const req = https.request(opts, (res) => {
			let d = '';
			res.on('data', (c) => d += c);
			res.on('end', () => {
				try {
					resolve(JSON.parse(d || '{}'));
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', reject);
		req.write(postData);
		req.end();
	});
}

function spotifyGet(path, token) {
	return new Promise((resolve, reject) => {
		const opts = {
			hostname: 'api.spotify.com',
			path,
			method: 'GET',
			headers: { 'Authorization': `Bearer ${token}` }
		};

		const req = https.request(opts, (res) => {
			let d = '';
			res.on('data', (c) => d += c);
			res.on('end', () => {
				if (res.statusCode === 204 || !d) return resolve(null);
				try {
					resolve(JSON.parse(d));
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', reject);
		req.end();
	});
}

// ── Infrastructure (Kener) ───────────────────────────
function normalizeKenerBasePath(pathname) {
	const value = String(pathname || '').trim();
	if (!value || value === '/') return '';
	return '/' + value.replace(/^\/+|\/+$/g, '');
}

function normalizeKenerPagePath(pathname) {
	const value = String(pathname || '').trim();
	if (!value || value === '/' || value.toLowerCase() === 'global') return '';
	return value.replace(/^\/+|\/+$/g, '');
}

function getKenerConfig() {
	const rawBase = String(spotifyConfig.KENER_BASE || spotifyConfig.UPTIME_BASE || '').trim();
	const rawPagePath = String(spotifyConfig.KENER_PAGE_PATH || spotifyConfig.UPTIME_SLUG || '').trim();
	const apiKey = String(process.env.KENER_API_KEY || '').trim();

	if (!rawBase) {
		return {
			hostname: '',
			port: null,
			basePath: '',
			pagePath: normalizeKenerPagePath(rawPagePath),
			apiKey
		};
	}

	const candidate = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;

	try {
		const parsed = new URL(candidate);
		return {
			hostname: parsed.hostname,
			port: parsed.port ? Number(parsed.port) : null,
			basePath: normalizeKenerBasePath(parsed.pathname),
			pagePath: normalizeKenerPagePath(rawPagePath),
			apiKey
		};
	} catch (e) {
		return {
			hostname: '',
			port: null,
			basePath: '',
			pagePath: normalizeKenerPagePath(rawPagePath),
			apiKey
		};
	}
}

function kenerGet(config, endpointPath) {
	const requestPath = `${config.basePath || ''}${endpointPath}`.replace(/\/+/g, '/');

	return new Promise((resolve, reject) => {
		const opts = {
			hostname: config.hostname,
			path: requestPath,
			method: 'GET',
			headers: {
				'User-Agent': 'olivierd.fr',
				'Authorization': `Bearer ${config.apiKey}`
			}
		};

		if (config.port) opts.port = config.port;

		const req = https.request(opts, (r) => {
			let d = '';
			r.on('data', (c) => d += c);
			r.on('end', () => {
				if (r.statusCode >= 400) return reject(new Error(`HTTP ${r.statusCode}`));
				try {
					resolve(JSON.parse(d || '{}'));
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', reject);
		req.end();
	});
}

function isMonitorUp(status) {
	return String(status || '').trim().toUpperCase() === 'UP';
}

function fallbackMonitorUp(monitor) {
	const status = String(monitor && monitor.status || '').trim().toUpperCase();
	if (!status || status === 'ACTIVE' || status === 'UP' || status === 'OK') return true;
	if (status === 'DOWN' || status === 'INACTIVE' || status === 'PAUSED') return false;

	const defaultStatus = String(monitor && monitor.default_status || '').trim().toUpperCase();
	if (defaultStatus === 'DOWN') return false;
	return true;
}

function computeMonitorUptime(dataPoints) {
	if (!Array.isArray(dataPoints) || !dataPoints.length) return 100;
	const upCount = dataPoints.filter((point) => isMonitorUp(point.status)).length;
	return Math.round((upCount / dataPoints.length) * 1000) / 10;
}

function pickKenerPage(pages, pagePath) {
	if (!Array.isArray(pages) || !pages.length) return null;
	const normalizedPath = normalizeKenerPagePath(pagePath);
	if (!normalizedPath) return pages[0];
	return pages.find((page) => normalizeKenerPagePath(page.page_path) === normalizedPath) || null;
}

async function loadKenerGroups(kenerConfig) {
	const [pagesResponse, monitorsResponse] = await Promise.all([
		kenerGet(kenerConfig, '/api/v4/pages'),
		kenerGet(kenerConfig, '/api/v4/monitors')
	]);

	const pages = Array.isArray(pagesResponse.pages) ? pagesResponse.pages : [];
	const page = pickKenerPage(pages, kenerConfig.pagePath);
	if (!page || !Array.isArray(page.monitors) || !page.monitors.length) return [];

	const monitors = Array.isArray(monitorsResponse.monitors) ? monitorsResponse.monitors : [];
	const monitorMap = new Map(monitors.map((monitor) => [String(monitor.tag || ''), monitor]));
	const endTs = Math.floor(Date.now() / 1000);
	const startTs = endTs - 24 * 60 * 60;

	const orderedMonitors = [...page.monitors].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
	const groups = await Promise.all(orderedMonitors.map(async (pageMonitor) => {
		const tag = String(pageMonitor.monitor_tag || '').trim();
		if (!tag) return null;

		const monitor = monitorMap.get(tag) || {};
		const name = String(monitor.name || tag).trim();

		try {
			const monitorData = await kenerGet(
				kenerConfig,
				`/api/v4/monitors/${encodeURIComponent(tag)}/data?start_ts=${startTs}&end_ts=${endTs}`
			);
			const dataPoints = Array.isArray(monitorData.data) ? monitorData.data : [];
			const latest = dataPoints[dataPoints.length - 1] || null;
			const up = latest ? isMonitorUp(latest.status) : fallbackMonitorUp(monitor);
			const uptime = computeMonitorUptime(dataPoints);

			return {
				group: name,
				up,
				monitors: [{ name, up, uptime }]
			};
		} catch (e) {
			const up = fallbackMonitorUp(monitor);
			return {
				group: name,
				up,
				monitors: [{ name, up, uptime: up ? 100 : 0 }]
			};
		}
	}));

	return groups.filter(Boolean);
}

let uptimeCache = null;
let uptimeCacheAt = 0;

app.get('/api/uptime', async (req, res) => {
	if (uptimeCache && Date.now() - uptimeCacheAt < 60000) return res.json(uptimeCache);
	try {
		if (!parseBoolean(spotifyConfig.HOMELAB_ENABLED)) return res.json({ ok: false });
		const kener = getKenerConfig();
		if (!kener.hostname || !kener.apiKey) return res.json({ ok: false });

		const groups = await loadKenerGroups(kener);
		if (!groups.length) return res.json({ ok: false });

		const overall = groups.every((group) => group.up);
		uptimeCache = { ok: true, overall, groups };
		uptimeCacheAt = Date.now();
		res.json(uptimeCache);
	} catch (e) {
		console.error('Kener API error:', e.message);
		res.json({ ok: false });
	}
});

async function getSpotifyToken() {
	const tokenKey = `${spotifyConfig.SPOTIFY_CLIENT_ID}:${spotifyConfig.SPOTIFY_REFRESH_TOKEN}`;
	if (tokenKey !== spotifyTokenKey) {
		spotifyAccessToken = null;
		spotifyTokenExpires = 0;
		spotifyTokenKey = tokenKey;
	}

	if (spotifyAccessToken && Date.now() < spotifyTokenExpires) return spotifyAccessToken;
	const data = await spotifyPost('/api/token', {
		grant_type: 'refresh_token',
		refresh_token: spotifyConfig.SPOTIFY_REFRESH_TOKEN
	}, spotifyConfig);
	spotifyAccessToken  = data.access_token;
	spotifyTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
	return spotifyAccessToken;
}

// ── Spotify OAuth (setup temporaire) ──────────────────
app.get('/spotify-auth', requireAdmin, (req, res) => {
	if (!spotifyConfig.SPOTIFY_ENABLED || !spotifyConfig.SPOTIFY_CLIENT_ID || !spotifyConfig.SPOTIFY_CLIENT_SECRET) {
		return res.status(400).send('Spotify non configuré.');
	}

	const scope = 'user-read-currently-playing user-read-playback-state user-read-recently-played';
	const url = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
		client_id: spotifyConfig.SPOTIFY_CLIENT_ID,
		response_type: 'code',
		redirect_uri: getSpotifyRedirectUri(),
		scope
	});
	res.redirect(url);
});

app.get('/callback', requireAdmin, async (req, res) => {
	if (!spotifyConfig.SPOTIFY_CLIENT_ID || !spotifyConfig.SPOTIFY_CLIENT_SECRET) {
		return res.status(400).send('Spotify non configuré.');
	}

	const code = req.query.code;
	if (!code) return res.send('Erreur : pas de code.');
	try {
		const data = await spotifyPost('/api/token', {
			grant_type: 'authorization_code',
			code,
			redirect_uri: getSpotifyRedirectUri()
		}, spotifyConfig);
		res.send(`<pre style="font:1rem monospace;padding:2rem;background:#111;color:#4ade80">
refresh_token obtenu :

${data.refresh_token}

Valeur détectée :
SPOTIFY_REFRESH_TOKEN=${data.refresh_token}

Tu peux aussi la coller depuis l'admin.
</pre>`);
	} catch(e) {
		res.send('Erreur : ' + e.message);
	}
});

// ── Spotify helpers ───────────────────────────────────
async function fetchSpotifyState() {
	if (!spotifyConfig.SPOTIFY_ENABLED) return { playing: false };
	if (!spotifyConfig.SPOTIFY_CLIENT_ID || !spotifyConfig.SPOTIFY_CLIENT_SECRET || !spotifyConfig.SPOTIFY_REFRESH_TOKEN) {
		return { playing: false };
	}

	try {
		const token = await getSpotifyToken();
		const data  = await spotifyGet('/v1/me/player/currently-playing', token);
		if (!data || !data.item) return { playing: false };
		return {
			playing:      data.is_playing,
			title:        data.item.name,
			artist:       data.item.artists.map(a => a.name).join(', '),
			album:        data.item.album.name,
			image:        data.item.album.images[1]?.url || data.item.album.images[0]?.url,
			url:          data.item.external_urls.spotify,
			progress_ms:  data.progress_ms || 0,
			duration_ms:  data.item.duration_ms || 0,
			fetched_at:   Date.now()
		};
	} catch(e) {
		console.error('Spotify poll error:', e.message);
		return { playing: false };
	}
}

// ── SSE: Spotify live stream ──────────────────────────
const sseClients = new Set();
let lastSpotifyState = null;
let lastPushAt = 0;

function pushToClients(payload) {
	const msg = `data: ${JSON.stringify(payload)}\n\n`;
	sseClients.forEach(c => c.write(msg));
}

setInterval(async () => {
	if (sseClients.size === 0) return; // pas de clients, pas d'appel API
	const state = await fetchSpotifyState();
	const now = Date.now();
	const trackChanged = !lastSpotifyState
		|| state.playing !== lastSpotifyState.playing
		|| state.title   !== lastSpotifyState.title;
	const resyncDue = state.playing && (now - lastPushAt > 10000);
	if (trackChanged || resyncDue) {
		lastSpotifyState = state;
		lastPushAt = now;
		pushToClients(state);
	}
}, 500);

app.get('/api/spotify/stream', async (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	sseClients.add(res);

	// envoie l'état courant immédiatement à la connexion
	const state = lastSpotifyState || await fetchSpotifyState();
	lastSpotifyState = state;
	res.write(`data: ${JSON.stringify(state)}\n\n`);

	req.on('close', () => sseClients.delete(res));
});

// ── API Spotify Now Playing (REST fallback) ────────────
app.get('/api/spotify', async (req, res) => {
	res.json(await fetchSpotifyState());
});

// ── API GitHub dernière activité ──────────────────────
let ghCache = null;
let ghCacheAt = 0;

function githubGet(path) {
	return new Promise((resolve, reject) => {
		const opts = {
			hostname: 'api.github.com',
			path,
			method: 'GET',
			headers: { 'User-Agent': 'olivierd.fr', 'Accept': 'application/vnd.github+json' }
		};
		const githubToken = String(spotifyConfig.GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
		if (githubToken) opts.headers['Authorization'] = 'Bearer ' + githubToken;
		const req = https.request(opts, (res) => {
			let d = '';
			res.on('data', c => d += c);
			res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
		});
		req.on('error', reject);
		req.end();
	});
}

function formatGhEvent(ev) {
	const repo = ev.repo?.name?.replace('Teksya/', '') || ev.repo?.name || '';
	switch (ev.type) {
		case 'PushEvent': {
			const n = ev.payload?.commits?.length || 1;
			return { action: `${n} commit${n > 1 ? 's' : ''} pushés`, repo, url: `https://github.com/${ev.repo?.name}` };
		}
		case 'CreateEvent':
			return { action: `${ev.payload?.ref_type} créé`, repo, url: `https://github.com/${ev.repo?.name}` };
		case 'DeleteEvent':
			return { action: `${ev.payload?.ref_type} supprimé`, repo, url: `https://github.com/${ev.repo?.name}` };
		case 'PullRequestEvent':
			return { action: `PR #${ev.payload?.number} ${ev.payload?.action}`, repo, url: ev.payload?.pull_request?.html_url || `https://github.com/${ev.repo?.name}` };
		case 'IssuesEvent':
			return { action: `Issue #${ev.payload?.issue?.number} ${ev.payload?.action}`, repo, url: ev.payload?.issue?.html_url || `https://github.com/${ev.repo?.name}` };
		case 'WatchEvent':
			return { action: 'Star ajouté', repo, url: `https://github.com/${ev.repo?.name}` };
		case 'ForkEvent':
			return { action: 'Fork', repo, url: `https://github.com/${ev.repo?.name}` };
		default:
			return { action: ev.type.replace('Event', ''), repo, url: `https://github.com/${ev.repo?.name}` };
	}
}

app.get('/api/github', async (req, res) => {
	try {
		if (!parseBoolean(spotifyConfig.GITHUB_ENABLED)) return res.json({ ok: false });
		const githubUsername = String(spotifyConfig.GITHUB_USERNAME || '').trim();
		if (!githubUsername) return res.json({ ok: false });
		if (ghCache && Date.now() - ghCacheAt < 120000) return res.json(ghCache);
		const events = await githubGet(`/users/${encodeURIComponent(githubUsername)}/events/public?per_page=1`);
		if (!Array.isArray(events) || !events[0]) return res.json({ ok: false });
		const ev = events[0];
		const fmt = formatGhEvent(ev);
		ghCache = { ok: true, ...fmt, date: ev.created_at };
		ghCacheAt = Date.now();
		res.json(ghCache);
	} catch(e) {
		console.error('GitHub API error:', e.message);
		res.json({ ok: false });
	}
});

const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const fromEmail = process.env.FROM_EMAIL || 'no-reply@olivierd.fr';
const toEmail = process.env.TO_EMAIL || 'contact@olivierd.fr';

let transporter = null;
if (smtpHost && smtpUser) {
	transporter = nodemailer.createTransport({
		host: smtpHost,
		port: smtpPort,
		secure: smtpPort === 465, // true for 465, false for other ports
		auth: {
			user: smtpUser,
			pass: smtpPass
		}
	});
}

app.get('/', (req, res) => res.render('index', { 
	title: 'Olivier D - Accueil',
	description: 'Étudiant en Bac Pro CIEL recherchant une alternance BTS SIO SISR. Passionné par les réseaux, administration système et développement web.',
	url: 'https://www.olivierd.fr',
	ogImage: 'https://www.olivierd.fr/og-image.png'
}));

app.get('/about', (req, res) => res.render('about', { 
	title: 'Olivier D - À propos',
	description: 'En savoir plus sur mon parcours, mes compétences en réseaux et systèmes, et mes projets.',
	url: 'https://www.olivierd.fr/about',
	ogImage: 'https://www.olivierd.fr/og-image.png',
	aboutConfig: getAboutConfig()
}));

app.get('/work', (req, res) => res.render('work', { 
	title: 'Olivier D - Travaux',
	description: 'Découvrez mes projets en réseaux, administration système et développement web.',
	url: 'https://www.olivierd.fr/work',
	ogImage: 'https://www.olivierd.fr/og-image.png',
	projects: loadProjects()
}));

app.get('/contact', (req, res) => res.render('contact', { 
	title: 'Olivier D - Contact', 
	turnstileSiteKey, 
	error: null, 
	success: null,
	description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.',
	url: 'https://www.olivierd.fr/contact',
	ogImage: 'https://www.olivierd.fr/og-image.png'
}));

function verifyTurnstile(token, remoteip) {
	return new Promise((resolve, reject) => {
		const postData = querystring.stringify({
			secret: turnstileSecretKey,
			response: token,
			remoteip: remoteip
		});

		const options = {
			hostname: 'challenges.cloudflare.com',
			path: '/turnstile/v0/siteverify',
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(postData)
			}
		};

		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					resolve(json);
				} catch (err) {
					reject(err);
				}
			});
		});

		req.on('error', (err) => reject(err));
		req.write(postData);
		req.end();
	});
}

app.post('/contact', async (req, res) => {
	const name = req.body.name;
	const email = req.body.email;
	const message = req.body.message;
	const token = req.body['cf-turnstile-response'];

	if (!token) {
		return res.status(400).render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, error: 'Validation Turnstile manquante.', success: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
	}

	try {
		const result = await verifyTurnstile(token, req.ip);
		if (result && result.success) {
			if (transporter) {
				try {
					await transporter.sendMail({
						from: fromEmail,
						to: toEmail,
						subject: `Nouveau message de contact - ${name} <${email}>`,
						text: `Nom: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
						html: `<p><strong>Nom:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong></p><p>${message}</p>`
					});
					return res.render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, success: 'Message envoyé avec succès.', error: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
				} catch (mailErr) {
					console.error('Mail send error:', mailErr);
					return res.status(500).render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, error: "Impossible d'envoyer l'email.", success: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
				}
			} else {
				// No transporter configured
				console.warn('SMTP transporter not configured; skipping email send.');
				return res.render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, success: 'Validation Turnstile réussie (email non envoyé, SMTP non configuré).', error: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
			}
		} else {
			return res.status(400).render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, error: 'Échec de la vérification Turnstile.', success: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
		}
	} catch (err) {
		console.error('Turnstile verification error:', err);
		return res.status(500).render('contact', { title: 'Olivier D - Contact', turnstileSiteKey, error: 'Erreur serveur lors de la vérification Turnstile.', success: null, description: 'Contactez-moi pour discuter d\'opportunités d\'alternance ou de projets.', url: 'https://www.olivierd.fr/contact', ogImage: 'https://www.olivierd.fr/og-image.png' });
	}
});

// ── Admin ─────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
	res.render('admin-login', {
		title: 'Admin Login',
		error: null,
		description: 'Connexion administrateur.',
		url: 'https://www.olivierd.fr/admin/login',
		ogImage: 'https://www.olivierd.fr/og-image.png'
	});
});

app.post('/admin/login', (req, res) => {
	const code = String(req.body.code || '').trim();

	if (!/^\d{6}$/.test(code)) {
		return res.status(400).render('admin-login', {
			title: 'Admin Login',
			error: 'Le code doit contenir exactement 6 chiffres.',
			description: 'Connexion administrateur.',
			url: 'https://www.olivierd.fr/admin/login',
			ogImage: 'https://www.olivierd.fr/og-image.png'
		});
	}

	if (!/^\d{6}$/.test(adminAccessCode)) {
		return res.status(500).render('admin-login', {
			title: 'Admin Login',
			error: 'ADMIN_ACCESS_CODE n\'est pas configuré correctement sur le serveur.',
			description: 'Connexion administrateur.',
			url: 'https://www.olivierd.fr/admin/login',
			ogImage: 'https://www.olivierd.fr/og-image.png'
		});
	}

	if (code !== adminAccessCode) {
		return res.status(401).render('admin-login', {
			title: 'Admin Login',
			error: 'Code invalide.',
			description: 'Connexion administrateur.',
			url: 'https://www.olivierd.fr/admin/login',
			ogImage: 'https://www.olivierd.fr/og-image.png'
		});
	}

	setAdminSessionCookie(res, createAdminSessionValue(), adminSessionDurationMs);
	return res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => {
	setAdminSessionCookie(res, '', 0);
	return res.redirect('/admin/login');
});

function renderAdminView(req, res, view, options = {}) {
	const hasOwn = (key) => Object.prototype.hasOwnProperty.call(options, key);
	const success = hasOwn('success') ? options.success : (req.query.success || null);
	const error = hasOwn('error') ? options.error : (req.query.error || null);

	return res.status(options.status || 200).render(view, {
		title: options.title || 'Administration',
		error,
		success,
		spotifyConfig,
		aboutConfig: getAboutConfig(),
		projects: options.projects || loadProjects(),
		activePage: options.activePage || 'dashboard',
		description: options.description || 'Administration du portfolio.',
		url: `https://www.olivierd.fr${req.path}`,
		ogImage: 'https://www.olivierd.fr/og-image.png'
	});
}

app.get('/admin', requireAdmin, (req, res) => {
	return renderAdminView(req, res, 'admin', {
		title: 'Administration - Dashboard',
		activePage: 'dashboard'
	});
});

app.get('/admin/about', requireAdmin, (req, res) => {
	return renderAdminView(req, res, 'admin-spotify', {
		title: 'Administration - À propos',
		activePage: 'about'
	});
});

app.get('/admin/spotify', requireAdmin, (req, res) => res.redirect('/admin/about'));

app.get('/admin/projects', requireAdmin, (req, res) => {
	return renderAdminView(req, res, 'admin-projects', {
		title: 'Administration - Projets',
		activePage: 'projects'
	});
});

app.get('/admin/projects/new', requireAdmin, (req, res) => {
	return renderAdminView(req, res, 'admin-project-new', {
		title: 'Administration - Nouveau projet',
		activePage: 'project-new'
	});
});

function handleAdminAboutSave(req, res) {
	try {
		ghCache = null;
		ghCacheAt = 0;
		uptimeCache = null;
		uptimeCacheAt = 0;

		spotifyConfig = saveAdminConfig({
			SPOTIFY_ENABLED: parseBoolean(req.body.SPOTIFY_ENABLED),
			SPOTIFY_CLIENT_ID: req.body.SPOTIFY_CLIENT_ID,
			SPOTIFY_CLIENT_SECRET: req.body.SPOTIFY_CLIENT_SECRET,
			SPOTIFY_REFRESH_TOKEN: req.body.SPOTIFY_REFRESH_TOKEN,
			DISCORD_ENABLED: parseBoolean(req.body.DISCORD_ENABLED),
			DISCORD_USER_ID: req.body.DISCORD_USER_ID,
			DISCORD_USERNAME: req.body.DISCORD_USERNAME,
			DISCORD_AVATAR_URL: req.body.DISCORD_AVATAR_URL,
			GITHUB_ENABLED: parseBoolean(req.body.GITHUB_ENABLED),
			GITHUB_USERNAME: req.body.GITHUB_USERNAME,
			GITHUB_TOKEN: req.body.GITHUB_TOKEN,
			HOMELAB_ENABLED: parseBoolean(req.body.HOMELAB_ENABLED),
			HOMELAB_NAME: req.body.HOMELAB_NAME,
			KENER_BASE: req.body.KENER_BASE,
			KENER_PAGE_PATH: req.body.KENER_PAGE_PATH
		});

		spotifyAccessToken = null;
		spotifyTokenExpires = 0;
		spotifyTokenKey = '';

		return res.redirect('/admin/about?success=' + encodeURIComponent('Configuration À propos enregistrée.'));
	} catch (e) {
		console.error('Admin Spotify update error:', e.message);
		return renderAdminView(req, res, 'admin-spotify', {
			status: 500,
			activePage: 'about',
			title: 'Administration - À propos',
			error: 'Impossible d\'enregistrer la configuration À propos.',
			success: null
		});
	}
}

app.post('/admin/about', requireAdmin, handleAdminAboutSave);
app.post('/admin/spotify', requireAdmin, handleAdminAboutSave);

function splitCsv(input) {
	return String(input || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function normalizeProjectPayload(body, baseProject = {}) {
	return {
		...baseProject,
		title: String(body.title || '').trim(),
		description: String(body.description || '').trim(),
		image: String(body.image || '').trim(),
		tags: splitCsv(body.tags),
		chips: splitCsv(body.chips),
		featured: parseBoolean(body.featured)
	};
}

function ensureSingleFeatured(projects, featuredId) {
	return projects.map((project) => ({
		...project,
		featured: Number(project.id) === Number(featuredId)
	}));
}

function parseProjectOrder(input) {
	return String(input || '')
		.split(',')
		.map((value) => Number(value.trim()))
		.filter((value) => Number.isFinite(value));
}

function reorderProjectsByIds(projects, orderedIds) {
	const normalizedIds = orderedIds.map((value) => Number(value));
	const uniqueIds = Array.from(new Set(normalizedIds));

	if (uniqueIds.length !== projects.length) {
		throw new Error('Ordre invalide.');
	}

	const projectById = new Map(projects.map((project) => [Number(project.id), project]));
	if (!uniqueIds.every((id) => projectById.has(id))) {
		throw new Error('Ordre invalide.');
	}

	return uniqueIds.map((id) => projectById.get(id));
}

app.post('/admin/projects/create', requireAdmin, (req, res) => {
	try {
		const projects = loadProjects();
		const maxId = projects.reduce((acc, p) => Math.max(acc, Number(p.id) || 0), 0);
		const created = normalizeProjectPayload(req.body, {
			id: maxId + 1,
			featured: false
		});

		if (!created.title || !created.description) {
			throw new Error('Titre et description obligatoires.');
		}

		let updatedProjects = [...projects, created];
		if (created.featured) {
			updatedProjects = ensureSingleFeatured(updatedProjects, created.id);
		}

		saveProjects(updatedProjects);
		return res.redirect('/admin/projects?success=' + encodeURIComponent('Projet ajouté avec succès.'));
	} catch (e) {
		console.error('Admin project create error:', e.message);
		return renderAdminView(req, res, 'admin-project-new', {
			status: 400,
			activePage: 'project-new',
			title: 'Administration - Nouveau projet',
			error: e.message || 'Impossible d\'ajouter le projet.',
			success: null
		});
	}
});

app.post('/admin/projects/reorder', requireAdmin, (req, res) => {
	try {
		const projects = loadProjects();
		const orderedIds = parseProjectOrder(req.body.order);
		const reorderedProjects = reorderProjectsByIds(projects, orderedIds);

		saveProjects(reorderedProjects);
		return res.redirect('/admin/projects?success=' + encodeURIComponent('Ordre des projets enregistré.'));
	} catch (e) {
		console.error('Admin project reorder error:', e.message);
		return renderAdminView(req, res, 'admin-projects', {
			status: 400,
			activePage: 'projects',
			title: 'Administration - Projets',
			error: e.message || 'Impossible de réordonner les projets.',
			success: null
		});
	}
});

app.post('/admin/projects/:id/update', requireAdmin, (req, res) => {
	try {
		const projectId = Number(req.params.id);
		const projects = loadProjects();
		const index = projects.findIndex((p) => Number(p.id) === projectId);
		if (index === -1) throw new Error('Projet introuvable.');

		const updated = normalizeProjectPayload(req.body, { ...projects[index], id: projects[index].id });
		if (!updated.title || !updated.description) throw new Error('Titre et description obligatoires.');

		projects[index] = updated;
		let finalProjects = projects;
		if (updated.featured) {
			finalProjects = ensureSingleFeatured(projects, updated.id);
		}

		saveProjects(finalProjects);
		return res.redirect('/admin/projects?success=' + encodeURIComponent('Projet mis à jour.'));
	} catch (e) {
		console.error('Admin project update error:', e.message);
		return renderAdminView(req, res, 'admin-projects', {
			status: 400,
			activePage: 'projects',
			title: 'Administration - Projets',
			error: e.message || 'Impossible de modifier le projet.',
			success: null
		});
	}
});

app.post('/admin/projects/:id/delete', requireAdmin, (req, res) => {
	try {
		const projectId = Number(req.params.id);
		const projects = loadProjects();
		const nextProjects = projects.filter((p) => Number(p.id) !== projectId);

		if (nextProjects.length === projects.length) throw new Error('Projet introuvable.');

		saveProjects(nextProjects);
		return res.redirect('/admin/projects?success=' + encodeURIComponent('Projet supprimé.'));
	} catch (e) {
		console.error('Admin project delete error:', e.message);
		return renderAdminView(req, res, 'admin-projects', {
			status: 400,
			activePage: 'projects',
			title: 'Administration - Projets',
			error: e.message || 'Impossible de supprimer le projet.',
			success: null
		});
	}
});

// ── Gestion des erreurs 404 ────────────────────────────
app.use((req, res) => {
	res.status(404).render('error404', { 
		title: 'Olivier D - Page non trouvée',
		description: 'La page que vous cherchez n\'existe pas.',
		url: `https://www.olivierd.fr${req.originalUrl}`,
		ogImage: 'https://www.olivierd.fr/og-image.png'
	});
});

// ── Gestion des erreurs 500 ────────────────────────────
app.use((err, req, res, next) => {
	console.error(err);
	res.status(500).render('error500', { 
		title: 'Olivier D - Erreur serveur',
		description: 'Une erreur serveur est survenue.',
		url: 'https://www.olivierd.fr',
		ogImage: 'https://www.olivierd.fr/og-image.png'
	});
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port} \nStarted successfully`));

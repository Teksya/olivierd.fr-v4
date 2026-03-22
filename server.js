const express = require('express');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const nodemailer = require('nodemailer');
const fs = require('fs');
require('dotenv').config();

const projectsPath = path.join(__dirname, 'projects.json');
function loadProjects() {
	delete require.cache[require.resolve(projectsPath)];
	return require(projectsPath);
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

// ── Spotify ────────────────────────────────────────────
const spotifyEnabled      = process.env.SPOTIFY_ENABLED === 'true';
const spotifyClientId     = process.env.SPOTIFY_CLIENT_ID || '';
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
const spotifyRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN || '';
const spotifyRedirectUri  = 'http://localhost:' + (process.env.PORT || 3000) + '/callback';

let spotifyAccessToken  = null;
let spotifyTokenExpires = 0;

function spotifyPost(path, body) {
	return new Promise((resolve, reject) => {
		const postData = querystring.stringify(body);
		const auth = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
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
			res.on('data', c => d += c);
			res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
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
			res.on('data', c => d += c);
			res.on('end', () => {
				if (res.statusCode === 204 || !d) return resolve(null);
				try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
			});
		});
		req.on('error', reject);
		req.end();
	});
}

async function getSpotifyToken() {
	if (spotifyAccessToken && Date.now() < spotifyTokenExpires) return spotifyAccessToken;
	const data = await spotifyPost('/api/token', { grant_type: 'refresh_token', refresh_token: spotifyRefreshToken });
	spotifyAccessToken  = data.access_token;
	spotifyTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
	return spotifyAccessToken;
}

// ── Spotify OAuth (setup temporaire) ──────────────────
if (spotifyEnabled) {
	app.get('/spotify-auth', (req, res) => {
		const scope = 'user-read-currently-playing user-read-playback-state user-read-recently-played';
		const url = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
			client_id: spotifyClientId,
			response_type: 'code',
			redirect_uri: spotifyRedirectUri,
			scope
		});
		res.redirect(url);
	});

	app.get('/callback', async (req, res) => {
		const code = req.query.code;
		if (!code) return res.send('Erreur : pas de code.');
		try {
			const data = await spotifyPost('/api/token', {
				grant_type: 'authorization_code',
				code,
				redirect_uri: spotifyRedirectUri
			});
			res.send(`<pre style="font:1rem monospace;padding:2rem;background:#111;color:#4ade80">
refresh_token obtenu :

${data.refresh_token}

Copie cette valeur dans ton .env :
SPOTIFY_REFRESH_TOKEN=${data.refresh_token}

Puis supprime les routes /spotify-auth et /callback de server.js.
</pre>`);
		} catch(e) {
			res.send('Erreur : ' + e.message);
		}
	});
}

// ── Spotify helpers ───────────────────────────────────
async function fetchSpotifyState() {
	if (!spotifyClientId || !spotifyClientSecret || !spotifyRefreshToken) return { playing: false };
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
		if (process.env.GITHUB_TOKEN) opts.headers['Authorization'] = 'Bearer ' + process.env.GITHUB_TOKEN;
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
	const repo = ev.repo?.name?.replace('olivierdti/', '') || ev.repo?.name || '';
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
		if (ghCache && Date.now() - ghCacheAt < 120000) return res.json(ghCache);
		const events = await githubGet('/users/olivierdti/events/public?per_page=1');
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

// ── API Uptime Kuma ───────────────────────────────────
let uptimeCache = null;
let uptimeCacheAt = 0;
const UPTIME_BASE = 'status.olivierd.fr';
const UPTIME_SLUG = 'global';

function uptimeGet(path) {
	return new Promise((resolve, reject) => {
		const opts = { hostname: UPTIME_BASE, path, method: 'GET', headers: { 'User-Agent': 'olivierd.fr' } };
		const req = https.request(opts, (r) => {
			let d = '';
			r.on('data', c => d += c);
			r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
		});
		req.on('error', reject);
		req.end();
	});
}

app.get('/api/uptime', async (req, res) => {
	if (uptimeCache && Date.now() - uptimeCacheAt < 60000) return res.json(uptimeCache);
	try {
		const [page, hb] = await Promise.all([
			uptimeGet(`/api/status-page/${UPTIME_SLUG}`),
			uptimeGet(`/api/status-page/heartbeat/${UPTIME_SLUG}`)
		]);
		const groups = (page.publicGroupList || []).filter(g => g.name !== 'Global');
		const hbList  = hb.heartbeatList || {};
		const upList  = hb.uptimeList   || {};
		const result  = groups.map(g => {
			const monitors = (g.monitorList || []).map(m => {
				const beats  = hbList[String(m.id)] || [];
				const last   = beats[beats.length - 1];
				const up     = last ? last.status === 1 : true;
				const uptime = upList[m.id + '_24'] ?? 1;
				return { name: m.name, up, uptime: Math.round(uptime * 1000) / 10 };
			});
			const allUp = monitors.every(m => m.up);
			return { group: g.name, up: allUp, monitors };
		});
		const overall = result.every(g => g.up);
		uptimeCache = { ok: true, overall, groups: result };
		uptimeCacheAt = Date.now();
		res.json(uptimeCache);
	} catch(e) {
		console.error('Uptime Kuma error:', e.message);
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
	ogImage: 'https://www.olivierd.fr/og-image.png'
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

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));

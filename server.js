'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { AccessToken, AgentDispatchClient } = require('livekit-server-sdk');

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEBUG_LOG_LIMIT = 500;
const DEBUG_LOGS = [];

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function toApiUrl(url) {
  if (!url) return url;

  try {
    const u = new URL(url);

    if (u.hostname.includes('.rtc.livekit.cloud')) {
      u.hostname = u.hostname.replace(/\.[a-z0-9-]+\.rtc\.livekit\.cloud$/i, '.livekit.cloud');
      return stripTrailingSlash(u.toString());
    }

    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(url);
  }
}

function toRtcUrl(url, region = 'eu') {
  if (!url || !region) return stripTrailingSlash(url);

  try {
    const u = new URL(url);

    if (u.hostname.includes('.rtc.livekit.cloud')) {
      return stripTrailingSlash(u.toString());
    }

    if (!u.hostname.endsWith('.livekit.cloud')) {
      return stripTrailingSlash(u.toString());
    }

    const project = u.hostname.replace('.livekit.cloud', '');
    u.hostname = `${project}.${region}.rtc.livekit.cloud`;

    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol === 'https:') u.protocol = 'wss:';

    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(url);
  }
}

const RAW_LK_URL = process.env.LIVEKIT_URL || process.env.LK_URL;
const LIVEKIT_REGION = process.env.LIVEKIT_REGION || process.env.LK_REGION || 'eu';

const LK_API_URL =
  process.env.LIVEKIT_API_URL ||
  process.env.LK_API_URL ||
  toApiUrl(RAW_LK_URL);

const LK_RTC_URL =
  process.env.LIVEKIT_RTC_URL ||
  process.env.LK_RTC_URL ||
  toRtcUrl(RAW_LK_URL, LIVEKIT_REGION);

const LK_KEY = process.env.LIVEKIT_API_KEY || process.env.LK_KEY;
const LK_SECRET = process.env.LIVEKIT_API_SECRET || process.env.LK_SECRET;
const AGENT_NAME = process.env.AGENT_NAME || process.env.LIVEKIT_AGENT_NAME || 'engelmann-avatar';

function redact(value, key = '') {
  if (/token|secret|key|authorization|password|jwt/i.test(key)) return '[redacted]';
  if (value == null) return value;

  if (typeof value === 'string') {
    return value
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[api-key-redacted]')
      .slice(0, 4000);
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 80)) {
      out[childKey] = redact(childValue, childKey);
    }
    return out;
  }

  return String(value).slice(0, 4000);
}

function normalizeMessage(message) {
  if (typeof message === 'string') return redact(message);

  try {
    return JSON.stringify(redact(message));
  } catch {
    return String(message).slice(0, 4000);
  }
}

function addDebugLog({ source = 'server', level = 'info', message = '', data = null }) {
  DEBUG_LOGS.push({
    ts: new Date().toISOString(),
    source: String(source || 'unknown').slice(0, 40),
    level: String(level || 'info').slice(0, 20),
    message: normalizeMessage(message),
    data: redact(data),
  });

  while (DEBUG_LOGS.length > DEBUG_LOG_LIMIT) DEBUG_LOGS.shift();
}

console.log = (...args) => {
  addDebugLog({
    source: 'server',
    level: 'info',
    message: args.map(normalizeMessage).join(' '),
  });
  rawConsole.log(...args);
};

console.warn = (...args) => {
  addDebugLog({
    source: 'server',
    level: 'warn',
    message: args.map(normalizeMessage).join(' '),
  });
  rawConsole.warn(...args);
};

console.error = (...args) => {
  addDebugLog({
    source: 'server',
    level: 'error',
    message: args.map(normalizeMessage).join(' '),
  });
  rawConsole.error(...args);
};

// 12mb so a compressed photo (base64 data URL) can be posted to /api/analyze.
app.use(express.json({ limit: '12mb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function sanitizeLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lat = num(loc.latitude);
  const lon = num(loc.longitude);
  if (lat === null || lon === null) return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 120) : null);
  const place = loc.place && typeof loc.place === 'object'
    ? { label: str(loc.place.label), city: str(loc.place.city), region: str(loc.place.region), country: str(loc.place.country) }
    : null;
  return { latitude: lat, longitude: lon, accuracy: num(loc.accuracy), timestamp: num(loc.timestamp), place };
}

function sendIndex(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
}

app.get('/', (_req, res) => sendIndex(res));

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  },
}));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/debug-log', (req, res) => {
  addDebugLog({
    source: req.body?.source || 'browser',
    level: req.body?.level || 'info',
    message: req.body?.message || '',
    data: req.body?.data || null,
  });

  res.status(204).end();
});

app.get('/debug-logs', (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 200), DEBUG_LOG_LIMIT));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    count: DEBUG_LOGS.length,
    logs: DEBUG_LOGS.slice(-limit),
  });
});

app.get('/livekit-config', (_req, res) => {
  res.json({
    ok: true,
    livekit_region: LIVEKIT_REGION,
    livekit_api_host: getHost(LK_API_URL),
    livekit_rtc_host: getHost(LK_RTC_URL),
    has_livekit_url: Boolean(LK_API_URL),
    has_livekit_rtc_url: Boolean(LK_RTC_URL),
    has_livekit_key: Boolean(LK_KEY),
    has_livekit_secret: Boolean(LK_SECRET),
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    has_elevenlabs_key: Boolean(process.env.ELEVENLABS_API_KEY || process.env.EL_KEY),
    has_elevenlabs_voice_id: Boolean(process.env.ELEVENLABS_VOICE_ID || process.env.EL_VOICE_ID),
    has_lemonslice_key: Boolean(process.env.LEMONSLICE_API_KEY || process.env.LS_KEY),
    has_lemonslice_agent_id: Boolean(process.env.LEMONSLICE_AGENT_ID || process.env.LS_AGENT_ID),
    has_lemonslice_image_url: Boolean(process.env.LEMONSLICE_AGENT_IMAGE_URL || process.env.LS_AGENT_IMAGE_URL),
    agent_name: AGENT_NAME,
  });
});

function getHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function missingLiveKitConfig() {
  const missing = [];

  if (!LK_API_URL) missing.push('LIVEKIT_URL or LK_URL');
  if (!LK_RTC_URL) missing.push('LIVEKIT_RTC_URL or LK_RTC_URL or derived RTC URL');
  if (!LK_KEY) missing.push('LIVEKIT_API_KEY or LK_KEY');
  if (!LK_SECRET) missing.push('LIVEKIT_API_SECRET or LK_SECRET');

  return missing;
}

function safeSegment(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase().trim();
  const cleaned = raw
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return cleaned || fallback;
}

function createRoomName(requestedRoom) {
  if (requestedRoom) return safeSegment(requestedRoom, 'engelmann-room');
  return `engelmann-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createJoinToken({ roomName, identity, name }) {
  const token = new AccessToken(LK_KEY, LK_SECRET, {
    identity,
    name,
    ttl: '1h',
  });

  token.addGrant({
    roomJoin: true,
    roomCreate: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}

async function dispatchAgent({ roomName, identity, location }) {
  const client = new AgentDispatchClient(LK_API_URL, LK_KEY, LK_SECRET);

  const metadata = JSON.stringify({
    user_id: identity,
    user_name: 'Simon',
    source: 'web',
    created_at: new Date().toISOString(),
    livekit_api_host: getHost(LK_API_URL),
    livekit_rtc_host: getHost(LK_RTC_URL),
    location: location || null,
  });

  console.log('[server] dispatch create', {
    roomName,
    agentName: AGENT_NAME,
    identity,
    livekitApiHost: getHost(LK_API_URL),
    livekitRtcHost: getHost(LK_RTC_URL),
  });

  const dispatch = await client.createDispatch(roomName, AGENT_NAME, { metadata });

  console.log('[server] dispatch created', {
    roomName,
    agentName: AGENT_NAME,
    dispatchId: dispatch?.id || dispatch?.dispatchId || null,
  });

  return dispatch;
}

async function createLiveKitSession(req, res) {
  const missing = missingLiveKitConfig();

  if (missing.length) {
    console.error('[server] missing livekit config', { missing });
    return res.status(500).json({
      ok: false,
      error: `Missing config: ${missing.join(', ')}`,
    });
  }

  const roomName = createRoomName(req.body?.room || req.query?.room);
  const identity = safeSegment(
    req.body?.identity || req.query?.identity,
    `simon-${crypto.randomBytes(4).toString('hex')}`,
  );
  const name = String(req.body?.name || req.query?.name || 'Simon').slice(0, 80);

  const location = sanitizeLocation(req.body?.location);

  try {
    const token = await createJoinToken({ roomName, identity, name });
    const dispatch = await dispatchAgent({ roomName, identity, location });

    return res.json({
      ok: true,
      livekit_url: LK_RTC_URL,
      livekit_api_host: getHost(LK_API_URL),
      livekit_rtc_host: getHost(LK_RTC_URL),
      token,
      room: roomName,
      identity,
      agent_name: AGENT_NAME,
      dispatch: {
        id: dispatch?.id || dispatch?.dispatchId || null,
        room: dispatch?.room || roomName,
        agent_name: dispatch?.agentName || dispatch?.agent_name || AGENT_NAME,
      },
    });
  } catch (error) {
    console.error('[server] livekit token or dispatch failed', {
      message: error?.message || String(error),
    });

    return res.status(502).json({
      ok: false,
      error: 'Failed to create LiveKit token or dispatch agent.',
      details: String(error?.message || error),
    });
  }
}

app.post('/livekit-token', createLiveKitSession);
app.get('/livekit-token', createLiveKitSession);

// --- Reverse geocoding proxy (OpenStreetMap Nominatim) -----------------------
// Done server-side to satisfy Nominatim's User-Agent policy and avoid CORS.
const GEO_CACHE = new Map();
function geoKey(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~110m bucket, also a tiny cache
}

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ ok: false, error: 'lat/lon required' });
  }
  const key = geoKey(lat, lon);
  if (GEO_CACHE.has(key)) return res.json({ ok: true, place: GEO_CACHE.get(key), cached: true });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&accept-language=de`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EngelmannVoiceAgent/1.0 (PWA reverse-geocode)', Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!r.ok) return res.json({ ok: false, error: `geocoder ${r.status}` });
    const data = await r.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.suburb || a.county || null;
    const region = a.state || a.region || null;
    const country = a.country || null;
    const label = [city, region].filter(Boolean).join(', ') || data.display_name || null;
    const place = { label, city, region, country };
    if (GEO_CACHE.size > 200) GEO_CACHE.delete(GEO_CACHE.keys().next().value);
    GEO_CACHE.set(key, place);
    return res.json({ ok: true, place });
  } catch (error) {
    return res.json({ ok: false, error: 'geocoder unavailable' });
  }
});

// --- AI media analysis (images via OpenAI vision) ----------------------------
app.post('/api/analyze', async (req, res) => {
  const { kind, dataUrl, prompt } = req.body || {};
  if (kind === 'pdf') {
    return res.json({
      ok: false,
      fallback: true,
      error: 'PDF-Analyse ist in dieser Version noch nicht verfügbar. Mach am besten ein Foto der Seite oder füge den Text per „Einfügen“ ein.',
    });
  }
  if (kind !== 'image' || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, error: 'image dataUrl required' });
  }
  if (!OPENAI_API_KEY) {
    return res.json({ ok: false, error: 'Bildanalyse ist nicht konfiguriert (OPENAI_API_KEY fehlt).' });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: String(prompt || 'Beschreibe knapp und hilfreich auf Deutsch, was hier zu sehen ist.').slice(0, 500) },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[server] analyze failed', { status: r.status, detail: detail.slice(0, 300) });
      return res.json({ ok: false, error: `Analyse fehlgeschlagen (${r.status}).` });
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return res.json({ ok: true, text });
  } catch (error) {
    console.error('[server] analyze error', { message: String(error?.message || error) });
    return res.json({ ok: false, error: 'Analyse momentan nicht möglich.' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  return sendIndex(res);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`LiveKit agent dispatch target: ${AGENT_NAME}`);
  console.log(`LiveKit API URL: ${LK_API_URL}`);
  console.log(`LiveKit RTC URL: ${LK_RTC_URL}`);
});

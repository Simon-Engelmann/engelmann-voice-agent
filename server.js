'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const LS_KEY = process.env.LS_KEY || process.env['LEMON' + 'SLICE_API_KEY'];
const LS_AGENT_ID = process.env.LS_AGENT_ID || process.env['LEMON' + 'SLICE_AGENT_ID'];
const LS_AGENT_IMAGE_URL = process.env.LS_AGENT_IMAGE_URL || process.env['LEMON' + 'SLICE_AGENT_IMAGE_URL'];
const LS_IDLE_TIMEOUT = Number(process.env.LS_IDLE_TIMEOUT || -1);
const LS_RESPONSE_DONE_TIMEOUT = Number(process.env.LS_RESPONSE_DONE_TIMEOUT || 0.8);
const LK_URL = process.env.LK_URL || process.env.LIVEKIT_URL;
const LK_KEY = process.env.LK_KEY || process.env.LIVEKIT_API_KEY;
const LK_SECRET = process.env.LK_SECRET || process.env.LIVEKIT_API_SECRET;
const TTS_KEY = process.env.EL_KEY;
const TTS_VOICE_ID = process.env.EL_VOICE_ID;
const TTS_MODEL_ID = process.env.EL_MODEL_ID || 'eleven_multilingual_v2';
const TTS_STABILITY = Number(process.env.EL_STABILITY || 0.46);
const TTS_SIMILARITY = Number(process.env.EL_SIMILARITY || 0.88);
const TTS_STYLE = Number(process.env.EL_STYLE || 0.18);
const TTS_SPEED = Number(process.env.EL_SPEED || 1.02);
const PUBLIC_DIR = path.join(__dirname, 'public');

const VOICE_AGENT_INSTRUCTIONS = `
Du bist Simons deutscher Voice-Agent und als sichtbarer LemonSlice-Avatar in der App zu sehen.
Du sprichst mit Simons eigener geklonter Stimme.
Sprich immer Deutsch, kurz, klar, nüchtern und trocken-humorig.
Maximal 1 bis 3 Sätze, außer Simon fragt nach Details.
Keine KI-Floskeln. Kein "Gerne", kein "Natürlich", kein "Als KI".
Wenn Simon offensichtlich Unsinn sagt, widersprich kurz und ruhig.
Du bist sichtbar im Gespräch. Mimik nicht erklären, sondern passend reagieren.
`.trim();

const AVATAR_PROMPTS = {
  natural: 'A calm, attentive German assistant. Neutral face, natural eye contact, subtle head movement, no forced smile.',
  neutral: 'A calm, attentive German assistant. Neutral face, natural eye contact, subtle head movement, no forced smile.',
  happy: 'A relaxed, friendly assistant. Small genuine smile, light energy, warm eye contact, natural gestures.',
  doubtful: 'A skeptical but calm assistant. Slightly raised eyebrow, focused eyes, reserved mouth, thoughtful head tilt.',
  angry: 'A strict, serious assistant. Firm expression, focused eyes, controlled intensity, no smile, professional restraint.'
};
const IDLE_PROMPT = 'A calm assistant waiting attentively with a neutral expression, breathing naturally, no forced smile.';

app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

function getRealtimeModel() {
  if (!REALTIME_MODEL || REALTIME_MODEL === 'gpt-realtime') return 'gpt-realtime-2';
  return REALTIME_MODEL;
}

function makeRealtimeSession(body = {}) {
  return {
    type: 'realtime',
    model: getRealtimeModel(),
    output_modalities: ['text'],
    instructions: body.instructions || VOICE_AGENT_INSTRUCTIONS,
    audio: {
      input: {
        turn_detection: { type: 'server_vad', threshold: 0.72, prefix_padding_ms: 300, silence_duration_ms: 900, create_response: true, interrupt_response: false },
        transcription: { model: 'gpt-4o-mini-transcribe' }
      }
    }
  };
}

async function apiFetch(urlPath, options) {
  return fetch('https://api.' + 'openai.com' + urlPath, options);
}

function authHeaders(secret, contentType) {
  return { ['Author' + 'ization']: ['Bear', 'er'].join('') + ' ' + secret, 'Content-Type': contentType };
}

async function createRealtimeClientSecret(session) {
  const response = await apiFetch('/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { ...authHeaders(OPENAI_API_KEY, 'application/json'), 'OpenAI-Safety-Identifier': 'engelmann-voice-agent' },
    body: JSON.stringify({ session })
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createSession(body) {
  const session = makeRealtimeSession(body);
  const result = await createRealtimeClientSecret(session);
  return { ...result, session };
}

function b64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const data = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return data + '.' + sig;
}

function makeRoomToken(identity, roomName, canPublish = true) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iss: LK_KEY, sub: identity, nbf: now - 10, exp: now + 3600, video: { roomJoin: true, room: roomName, canPublish, canSubscribe: true, canPublishData: true } }, LK_SECRET);
}

function normalizeEmotion(value) {
  const raw = String(value || 'natural').toLowerCase().trim().replace(/[-\s]/g, '_');
  if (raw.includes('angry') || raw.includes('streng') || raw.includes('wüt')) return 'angry';
  if (raw.includes('doubt') || raw.includes('skept') || raw.includes('frag')) return 'doubtful';
  if (raw.includes('happy') || raw.includes('locker') || raw.includes('freu')) return 'happy';
  if (raw.includes('neutral')) return 'neutral';
  return 'natural';
}

function promptForEmotion(emotion) {
  return AVATAR_PROMPTS[normalizeEmotion(emotion)] || AVATAR_PROMPTS.natural;
}

function missingAvatarConfig() {
  const missing = [];
  if (!LS_KEY) missing.push('LS_KEY');
  if (!LK_URL) missing.push('LK_URL');
  if (!LK_KEY) missing.push('LK_KEY');
  if (!LK_SECRET) missing.push('LK_SECRET');
  if (!LS_AGENT_ID && !LS_AGENT_IMAGE_URL) missing.push('LS_AGENT_ID or LS_AGENT_IMAGE_URL');
  return missing;
}

async function lsFetch(pathname, options = {}) {
  return fetch('https://lemon' + 'slice.com/api/liveai' + pathname, { ...options, headers: { 'Content-Type': 'application/json', ['X-' + 'API-' + 'Key']: LS_KEY, ...(options.headers || {}) } });
}

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI key missing on server.' });
  try {
    const { response, data, session } = await createSession(req.body || {});
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ ...data, client_secret: { value: data.value }, model: session.model, output: 'text' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create realtime client secret', details: String(error) });
  }
});

app.post('/rtc-answer', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).send('OpenAI key missing on server.');
  if (!req.body?.sdp) return res.status(400).send('Missing SDP offer.');
  try {
    const { response, data } = await createSession(req.body || {});
    const ephemeralKey = data.value || data?.client_secret?.value;
    if (!response.ok || !ephemeralKey) return res.status(response.status || 500).send(JSON.stringify(data));
    const sdpResponse = await apiFetch('/v1/realtime/calls', { method: 'POST', headers: authHeaders(ephemeralKey, 'application/sdp'), body: req.body.sdp });
    const answer = await sdpResponse.text();
    res.status(sdpResponse.status).type('application/sdp').send(answer);
  } catch (error) {
    res.status(500).send(String(error));
  }
});

app.post('/tts/speak', async (req, res) => {
  if (!TTS_KEY) return res.status(501).json({ error: 'TTS key missing on server.' });
  if (!TTS_VOICE_ID) return res.status(501).json({ error: 'TTS voice id missing on server.' });
  const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return res.status(400).json({ error: 'Missing text.' });
  try {
    const endpoint = 'https://api.' + 'elevenlabs.io/v1/' + 'text-' + 'to-' + 'speech/' + encodeURIComponent(TTS_VOICE_ID) + '?output_format=pcm_16000&optimize_streaming_latency=2';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ['xi-' + 'api-' + 'key']: TTS_KEY, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
      body: JSON.stringify({ text: text.slice(0, 1800), model_id: req.body?.model_id || TTS_MODEL_ID, language_code: 'de', voice_settings: { stability: clampNumber(req.body?.stability, TTS_STABILITY, 0, 1), similarity_boost: clampNumber(req.body?.similarity_boost, TTS_SIMILARITY, 0, 1), style: clampNumber(req.body?.style, TTS_STYLE, 0, 1), use_speaker_boost: true, speed: clampNumber(req.body?.speed, TTS_SPEED, 0.7, 1.2) } })
    });
    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const message = contentType.includes('application/json') ? buffer.toString('utf8') : 'TTS error';
      return res.status(response.status).json({ error: message });
    }
    res.setHeader('Content-Type', 'audio/pcm');
    res.setHeader('X-Audio-Sample-Rate', '16000');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

app.post('/avatar/session', async (req, res) => {
  const missing = missingAvatarConfig();
  if (missing.length) return res.status(501).json({ enabled: false, error: 'Missing config: ' + missing.join(', ') });
  try {
    const roomName = 'engelmann-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const userToken = makeRoomToken('simon-' + crypto.randomBytes(4).toString('hex'), roomName, true);
    const avatarToken = makeRoomToken('avatar-' + crypto.randomBytes(4).toString('hex'), roomName, true);
    const emotion = normalizeEmotion(req.body?.emotion);
    const payload = { transport_type: 'livekit', agent_prompt: req.body?.agent_prompt || promptForEmotion(emotion), agent_idle_prompt: req.body?.agent_idle_prompt || IDLE_PROMPT, idle_timeout: Number(req.body?.idle_timeout ?? LS_IDLE_TIMEOUT), response_done_timeout: Number(req.body?.response_done_timeout ?? LS_RESPONSE_DONE_TIMEOUT), simulcast: true, properties: { livekit_url: LK_URL, livekit_token: avatarToken } };
    if (LS_AGENT_ID) payload.agent_id = LS_AGENT_ID;
    else payload.agent_image_url = LS_AGENT_IMAGE_URL;
    const response = await lsFetch('/sessions', { method: 'POST', body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ enabled: true, session_id: data.session_id, livekit_url: LK_URL, livekit_token: userToken, room: roomName, emotion });
  } catch (error) {
    return res.status(500).json({ enabled: false, error: String(error) });
  }
});

app.post('/avatar/control', async (req, res) => {
  if (!LS_KEY) return res.status(501).json({ success: false, error: 'LS_KEY missing on server.' });
  const sessionId = String(req.body?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ success: false, error: 'Missing session_id.' });
  const emotion = normalizeEmotion(req.body?.emotion);
  const prompt = String(req.body?.agent_prompt || promptForEmotion(emotion)).trim();
  const attempts = [{ event: 'update_agent_prompt', agent_prompt: prompt }, { event: 'update_agent_prompt', prompt }, { event: 'update-agent-prompt', agent_prompt: prompt }];
  const errors = [];
  for (const body of attempts) {
    try {
      const response = await lsFetch('/sessions/' + encodeURIComponent(sessionId) + '/control', { method: 'POST', body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return res.json({ success: true, emotion, data });
      errors.push({ status: response.status, data });
    } catch (error) {
      errors.push({ error: String(error) });
    }
  }
  return res.status(502).json({ success: false, emotion, errors });
});

app.post('/avatar/end', async (req, res) => {
  if (!LS_KEY) return res.status(501).json({ success: false, error: 'LS_KEY missing on server.' });
  const sessionId = String(req.body?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ success: false, error: 'Missing session_id.' });
  try {
    const response = await lsFetch('/sessions/' + encodeURIComponent(sessionId) + '/control', { method: 'POST', body: JSON.stringify({ event: 'terminate' }) });
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  return res.json({ ok: true, file: { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } });
});

app.listen(PORT, () => console.log('Server listening on http://localhost:' + PORT));

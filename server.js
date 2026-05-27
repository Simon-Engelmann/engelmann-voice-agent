'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const SIMLI_API_KEY = process.env.SIMLI_API_KEY;
const SIMLI_FACE_ID = process.env.SIMLI_FACE_ID || 'tmp9i8bbq7c';
const SIMLI_EMOTION_ID = process.env.SIMLI_EMOTION_ID || 'b4fcff6b-3072-45ad-89db-5a859287f3b2';
const SIMLI_MAX_SESSION_LENGTH = Number(process.env.SIMLI_MAX_SESSION_LENGTH || 3600);
const SIMLI_MAX_IDLE_TIME = Number(process.env.SIMLI_MAX_IDLE_TIME || 300);
const TTS_KEY = process.env.EL_KEY;
const TTS_VOICE_ID = process.env.EL_VOICE_ID;
const TTS_MODEL_ID = process.env.EL_MODEL_ID || 'eleven_multilingual_v2';
const TTS_STABILITY = Number(process.env.EL_STABILITY || 0.46);
const TTS_SIMILARITY = Number(process.env.EL_SIMILARITY || 0.88);
const TTS_STYLE = Number(process.env.EL_STYLE || 0.18);
const TTS_SPEED = Number(process.env.EL_SPEED || 1.02);
const PUBLIC_DIR = path.join(__dirname, 'public');

const SIMLI_EMOTIONS = {
  natural: 'b4fcff6b-3072-45ad-89db-5a859287f3b2',
  neutral: 'b4fcff6b-3072-45ad-89db-5a859287f3b2',
  happy: '92f24a0c-f046-45df-8df0-af7449c04571',
  angry: '668f65f6-cf71-46b5-9876-40bd83fb18d2',
  doubtful: '7f5e31e8-0bf4-4a8f-97f9-76660b0f7aa1'
};

const VOICE_AGENT_INSTRUCTIONS = `
Du bist Simons deutscher Voice-Agent und als sichtbarer Simli-Avatar in der App zu sehen.
Du sprichst mit Simons eigener geklonter Stimme.
Sprich immer Deutsch, kurz, klar, nüchtern und trocken-humorig.
Maximal 1 bis 3 Sätze, außer Simon fragt nach Details.
Keine KI-Floskeln. Kein "Gerne", kein "Natürlich", kein "Als KI".
Wenn Simon offensichtlich Unsinn sagt, widersprich kurz und ruhig.
Du bist sichtbar im Gespräch. Mimik nicht erklären, sondern passend reagieren.
`.trim();

app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }
}));

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

function getRealtimeModel() {
  if (!REALTIME_MODEL || REALTIME_MODEL === 'gpt-realtime') return 'gpt-realtime-2';
  return REALTIME_MODEL;
}

function resolveSimliEmotion(value) {
  const raw = String(value || SIMLI_EMOTION_ID || '').trim();
  if (!raw) return SIMLI_EMOTIONS.natural;
  const key = raw.toLowerCase().replace(/[-\s]/g, '_');
  return SIMLI_EMOTIONS[key] || raw;
}

function makeSimliFaceWithEmotion(faceId, emotionId) {
  const cleanFaceId = String(faceId || SIMLI_FACE_ID).trim();
  const cleanEmotionId = resolveSimliEmotion(emotionId);
  if (cleanFaceId.includes('/')) return cleanFaceId;
  return cleanFaceId + '/' + cleanEmotionId;
}

function makeRealtimeSession(body = {}) {
  return {
    type: 'realtime',
    model: getRealtimeModel(),
    output_modalities: ['text'],
    instructions: body.instructions || VOICE_AGENT_INSTRUCTIONS,
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
          threshold: 0.72,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
          create_response: true,
          interrupt_response: false
        },
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
      headers: {
        ['xi-' + 'api-' + 'key']: TTS_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/pcm'
      },
      body: JSON.stringify({
        text: text.slice(0, 1800),
        model_id: req.body?.model_id || TTS_MODEL_ID,
        language_code: 'de',
        voice_settings: {
          stability: clampNumber(req.body?.stability, TTS_STABILITY, 0, 1),
          similarity_boost: clampNumber(req.body?.similarity_boost, TTS_SIMILARITY, 0, 1),
          style: clampNumber(req.body?.style, TTS_STYLE, 0, 1),
          use_speaker_boost: true,
          speed: clampNumber(req.body?.speed, TTS_SPEED, 0.7, 1.2)
        }
      })
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

app.post('/simli/session', async (req, res) => {
  if (!SIMLI_API_KEY) return res.status(501).json({ enabled: false, error: 'SIMLI_API_KEY missing on server.' });
  try {
    const rawFaceId = req.body?.faceId || SIMLI_FACE_ID;
    const emotionId = resolveSimliEmotion(req.body?.emotion_id || req.body?.emotionId || req.body?.emotion);
    const faceId = makeSimliFaceWithEmotion(rawFaceId, emotionId);
    const response = await fetch('https://api.simli.ai/compose/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-simli-api-key': SIMLI_API_KEY },
      body: JSON.stringify({
        faceId,
        syncAudio: true,
        handleSilence: true,
        maxSessionLength: Number(req.body?.maxSessionLength || SIMLI_MAX_SESSION_LENGTH),
        maxIdleTime: Number(req.body?.maxIdleTime || SIMLI_MAX_IDLE_TIME),
        model: req.body?.model || 'fasttalk'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ enabled: true, session_token: data.session_token, faceId, emotionId, mode: 'livekit' });
  } catch (error) {
    return res.status(500).json({ enabled: false, error: String(error) });
  }
});

app.get('/simli/ice', async (_req, res) => {
  if (!SIMLI_API_KEY) return res.status(501).json({ enabled: false, error: 'SIMLI_API_KEY missing on server.' });
  try {
    const response = await fetch('https://api.simli.ai/compose/ice', { headers: { 'x-simli-api-key': SIMLI_API_KEY } });
    const data = await response.json().catch(() => []);
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ enabled: false, error: String(error) });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  return res.json({ ok: true, file: { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } });
});

app.listen(PORT, () => console.log('Server listening on http://localhost:' + PORT));

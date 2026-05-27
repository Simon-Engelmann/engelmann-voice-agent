'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'coral';
const SIMLI_API_KEY = process.env.SIMLI_API_KEY;
const SIMLI_FACE_ID = process.env.SIMLI_FACE_ID || 'tmp9i8bbq7c';
const SIMLI_EMOTION_ID = process.env.SIMLI_EMOTION_ID || 'b4fcff6b-3072-45ad-89db-5a859287f3b2';
const SIMLI_MAX_SESSION_LENGTH = Number(process.env.SIMLI_MAX_SESSION_LENGTH || 3600);
const SIMLI_MAX_IDLE_TIME = Number(process.env.SIMLI_MAX_IDLE_TIME || 300);
const PUBLIC_DIR = path.join(__dirname, 'public');

const SIMLI_EMOTIONS = {
  natural: 'b4fcff6b-3072-45ad-89db-5a859287f3b2',
  neutral: 'b4fcff6b-3072-45ad-89db-5a859287f3b2',
  natural_0: 'b4fcff6b-3072-45ad-89db-5a859287f3b2',
  natural_1: '278fc3b6-b70e-4a2e-ba15-16f6a4e770d2',
  natural_2: '6be22009-5406-4e83-be41-e70b8863d3dd',
  natural_3: '8cb2eeac-b54f-4d8a-bc90-9eeb5f8e8311',
  natural_4: '7713d99a-b786-4d62-9e4e-4c6f6f2ef2de',
  natural_5: 'd985f836-e054-46c3-bcc1-a1010791b7e1',
  natural_6: 'a8f318cf-efc4-4c80-a29a-e1a69bebca18',
  natural_7: '011443f2-eefd-49fc-a76c-dd1d5f0c4a3d',
  happy: '92f24a0c-f046-45df-8df0-af7449c04571',
  happy_0: '92f24a0c-f046-45df-8df0-af7449c04571',
  happy_1: '7a65257c-25b3-4dc1-889d-ff8a3d51ee01',
  happy_2: 'e6cebb46-e415-4a59-8f82-85fe36e5f1b1',
  angry: '668f65f6-cf71-46b5-9876-40bd83fb18d2',
  angry_1: '668f65f6-cf71-46b5-9876-40bd83fb18d2',
  doubtful: '7f5e31e8-0bf4-4a8f-97f9-76660b0f7aa1',
  doubtful_0: '7f5e31e8-0bf4-4a8f-97f9-76660b0f7aa1',
  doubtful_1: 'c24cd218-b056-4ad4-afc7-57574c4339c2'
};

const VOICE_AGENT_INSTRUCTIONS = `
Du bist Simons deutscher Voice-Agent.

Sprache:
- Sprich immer Deutsch, außer Simon verlangt ausdrücklich eine andere Sprache.
- Nutze deutsche Aussprache und deutsche Satzmelodie.
- Kein englischer Akzent, keine englischen Füllwörter.

Kommunikation:
- Antworte kurz, klar und nüchtern.
- Maximal 1 bis 3 Sätze, außer Simon fragt nach Details.
- Keine KI-Floskeln.
- Kein "Gerne", kein "Natürlich", kein "Als KI".
- Wenn Simon offensichtlich Unsinn sagt, widersprich kurz und ruhig.
- Trockener Humor ist erlaubt, aber knapp.
- Du bist locker, aber nicht albern.
- Kein Vortrag.

Konversation:
- Lass Simon ausreden.
- Unterbrich nicht aggressiv.
- Reagiere schnell, aber stabil.
- Wenn Simon dich unterbricht, gehe beim nächsten Turn auf das Neue ein.

Begrüßung:
- Wenn eine neue Session startet, begrüße Simon mit Vornamen.
- Jedes Mal anders.
- Kurz, locker, trockener Spruch.
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

function makeRealtimeSession(body = {}, voiceOverride) {
  return {
    type: 'realtime',
    model: getRealtimeModel(),
    output_modalities: ['audio'],
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
      },
      output: { voice: voiceOverride || body.voice || OPENAI_REALTIME_VOICE }
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

async function createSessionWithFallback(body) {
  let session = makeRealtimeSession(body);
  let result = await createRealtimeClientSecret(session);
  const serializedError = JSON.stringify(result.data).toLowerCase();
  const voice = session.audio?.output?.voice;
  if (!result.response.ok && voice !== 'marin' && serializedError.includes('voice')) {
    session = makeRealtimeSession(body, 'marin');
    result = await createRealtimeClientSecret(session);
  }
  return { ...result, session };
}

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing on server.' });
  try {
    const { response, data, session } = await createSessionWithFallback(req.body || {});
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ ...data, client_secret: { value: data.value }, model: session.model, voice: session.audio.output.voice });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create realtime client secret', details: String(error) });
  }
});

app.post('/rtc-answer', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).send('OPENAI_API_KEY missing on server.');
  if (!req.body?.sdp) return res.status(400).send('Missing SDP offer.');
  try {
    const { response, data } = await createSessionWithFallback(req.body || {});
    const ephemeralKey = data.value || data?.client_secret?.value;
    if (!response.ok || !ephemeralKey) return res.status(response.status || 500).send(JSON.stringify(data));
    const sdpResponse = await apiFetch('/v1/realtime/calls', { method: 'POST', headers: authHeaders(ephemeralKey, 'application/sdp'), body: req.body.sdp });
    const answer = await sdpResponse.text();
    res.status(sdpResponse.status).type('application/sdp').send(answer);
  } catch (error) {
    res.status(500).send(String(error));
  }
});

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

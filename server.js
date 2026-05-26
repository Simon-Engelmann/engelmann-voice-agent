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
const SIMLI_MAX_SESSION_LENGTH = Number(process.env.SIMLI_MAX_SESSION_LENGTH || 3600);
const SIMLI_MAX_IDLE_TIME = Number(process.env.SIMLI_MAX_IDLE_TIME || 300);
const PUBLIC_DIR = path.join(__dirname, 'public');

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
    const faceId = req.body?.faceId || SIMLI_FACE_ID;
    const response = await fetch('https://api.simli.ai/compose/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-simli-api-key': SIMLI_API_KEY },
      body: JSON.stringify({
        faceId,
        handleSilence: false,
        maxSessionLength: Number(req.body?.maxSessionLength || SIMLI_MAX_SESSION_LENGTH),
        maxIdleTime: Number(req.body?.maxIdleTime || SIMLI_MAX_IDLE_TIME),
        model: req.body?.model || 'fasttalk'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ enabled: true, session_token: data.session_token, faceId, mode: 'livekit' });
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

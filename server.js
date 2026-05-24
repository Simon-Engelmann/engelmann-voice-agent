'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'coral';

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

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

function getRealtimeModel() {
  if (!REALTIME_MODEL || REALTIME_MODEL === 'gpt-realtime') {
    return 'gpt-realtime-2';
  }

  return REALTIME_MODEL;
}

function makeRealtimeSession(req, voiceOverride) {
  return {
    type: 'realtime',
    model: getRealtimeModel(),
    output_modalities: ['audio'],
    instructions: req.body?.instructions || VOICE_AGENT_INSTRUCTIONS,
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
        transcription: {
          model: 'gpt-4o-mini-transcribe'
        }
      },
      output: {
        voice: voiceOverride || req.body?.voice || OPENAI_REALTIME_VOICE
      }
    }
  };
}

async function createRealtimeClientSecret(session) {
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': 'engelmann-voice-agent'
    },
    body: JSON.stringify({ session })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY missing on server.'
    });
  }

  try {
    let session = makeRealtimeSession(req);
    let { response, data } = await createRealtimeClientSecret(session);

    const serializedError = JSON.stringify(data).toLowerCase();
    const voice = session.audio?.output?.voice;

    if (!response.ok && voice !== 'marin' && serializedError.includes('voice')) {
      session = makeRealtimeSession(req, 'marin');
      ({ response, data } = await createRealtimeClientSecret(session));
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      ...data,
      client_secret: {
        value: data.value
      },
      model: session.model,
      voice: session.audio.output.voice
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create realtime client secret',
      details: String(error)
    });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded.'
    });
  }

  return res.json({
    ok: true,
    file: {
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

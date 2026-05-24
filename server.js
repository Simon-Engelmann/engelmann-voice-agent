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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'Simon-Engelmann/engelmann-voice-agent';
const ADMIN_PIN = process.env.ADMIN_PIN;

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

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY missing on server.' });
  }

  const session = {
    type: 'realtime',
    model: getRealtimeModel(),
    instructions:
      req.body?.instructions ||
      'Du bist ein hilfreicher allgemeiner ChatGPT-Voice-Assistent. Sprich Deutsch, ausser der Nutzer wuenscht eine andere Sprache. Antworte natuerlich, klar und knapp.',
    audio: {
      output: {
        voice: req.body?.voice || 'marin'
      }
    }
  };

  try {
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
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      ...data,
      client_secret: { value: data.value },
      model: session.model
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create realtime client secret', details: String(error) });
  }
});

function cleanText(value, maxLength = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function makeIssueTitle(summary, transcript) {
  const base = cleanText(summary || transcript || 'Neue App-Aenderung', 80);
  return `App change request: ${base || 'Neue App-Aenderung'}`;
}

function makeIssueBody({ transcript, summary }) {
  const cleanTranscript = cleanText(transcript, 8000);
  const cleanSummary = cleanText(summary || transcript, 1000);

  return [
    '## Voice Change Request',
    '',
    'Diese Aufgabe wurde automatisch aus der Voice-App erstellt.',
    '',
    '### Original-Sprachtext',
    '',
    '```text',
    cleanTranscript || 'Kein Transkript uebergeben.',
    '```',
    '',
    '### Zusammenfassung',
    '',
    cleanSummary || 'Keine Zusammenfassung uebergeben.',
    '',
    '### Akzeptanzkriterien',
    '',
    '- Aenderung im aktuellen Repo umsetzen.',
    '- Mobile-first fuer iPhone/iPad pruefen.',
    '- Keine API Keys oder Secrets ins Frontend schreiben.',
    '- Wenn `public/index.html` geaendert wird: Realtime Events und sichtbare Fehler pruefen.',
    '- Committen, PR erstellen und Auto-Merge aktivieren, wenn moeglich.',
    '',
    '### Codex-Anweisung',
    '',
    'Starte vom aktuellen `main`, erstelle einen neuen Branch, setze die oben beschriebene Aenderung klein und sauber um, teste mindestens `npm install` und `node --check server.js`, erstelle einen PR und melde PR-Link oder Blocker.'
  ].join('\n');
}

async function createGitHubIssue(payload, includeLabels = true) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'engelmann-voice-agent'
    },
    body: JSON.stringify({
      title: makeIssueTitle(payload.summary, payload.transcript),
      body: makeIssueBody(payload),
      labels: includeLabels ? ['ai-change'] : undefined
    })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

app.post('/change-request', async (req, res) => {
  const { transcript, summary, adminPin } = req.body || {};

  if (!ADMIN_PIN) {
    return res.status(500).json({ error: 'ADMIN_PIN missing on server.' });
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: 'GITHUB_TOKEN or GITHUB_REPO missing on server.' });
  }

  if (String(adminPin || '') !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: 'Invalid admin PIN.' });
  }

  if (!cleanText(transcript) && !cleanText(summary)) {
    return res.status(400).json({ error: 'transcript or summary required.' });
  }

  try {
    let { response, data } = await createGitHubIssue({ transcript, summary }, true);

    if (!response.ok && response.status === 422) {
      ({ response, data } = await createGitHubIssue({ transcript, summary }, false));
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: 'GitHub issue creation failed.', details: data });
    }

    return res.json({ ok: true, issueUrl: data.html_url, issueNumber: data.number, title: data.title });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create GitHub issue.', details: String(error) });
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
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

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
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'shimmer';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'Simon-Engelmann/engelmann-voice-agent';
const ADMIN_PIN = process.env.ADMIN_PIN;

const VOICE_AGENT_INSTRUCTIONS = `
Du bist ein deutscher Voice-Agent für Simon.

Stimme und Sprechweise:
- Sprich auf Deutsch, außer Simon verlangt ausdrücklich eine andere Sprache.
- Klinge menschlich, direkt, trocken-humorig und entspannt.
- Sehr klare, kurze Sätze.
- Keine KI-Floskeln.
- Kein "Gerne", kein "Natürlich", kein "Als KI".
- Maximal 1 bis 3 Sätze pro Antwort, außer Simon fragt nach Details.
- Antworte wie ein nüchterner, wacher Mensch mit trockenem Humor.
- Kurze Reaktionen sind erlaubt: "Stimmt.", "Nee.", "Das wird nix.", "Solide Idee.", "Knapp daneben."
- Wenn Simon offensichtlich Blödsinn sagt, widersprich knapp und ruhig. Kein Vortrag.
- Wenn Simon dich unterbricht, hör sofort auf und reagiere auf das Neue.
- Wenn du unsicher bist, sag es kurz.

Humor:
- Trockener Humor, nicht albern.
- Kleine Sprüche sind erlaubt, aber nie länger als ein Satz.
- Beispiel-Stil: "Mutig. Nicht schlau, aber mutig."
- Nicht übertreiben.

Begrüßung:
- Wenn eine neue Session startet, begrüße Simon mit Vornamen.
- Jedes Mal anders.
- Locker, kurz, frisch.
- Danach direkt bereit sein.

Admin-Modus:
- Wenn Simon "Frosch Frosch" sagt, bestätige kurz: "Admin-Modus. PIN bitte."
- Danach keine Änderung ausführen, bevor der Admin-Modus aktiv ist.
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
          type: 'semantic_vad',
          create_response: true,
          interrupt_response: true
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
    return res.status(500).json({ error: 'OPENAI_API_KEY missing on server.' });
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
      client_secret: { value: data.value },
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

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'engelmann-voice-agent'
  };
}

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`GitHub API failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function createGitHubIssue(payload, includeLabels = true) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({
      title: makeIssueTitle(payload.summary, payload.transcript),
      body: makeIssueBody(payload),
      labels: includeLabels ? ['ai-change'] : undefined
    })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function parseConfigChange(command, currentConfig) {
  const text = cleanText(command, 2000).toLowerCase();
  const nextConfig = { ...currentConfig };
  const changes = [];
  const percentMatch = text.match(/(\d+)\s*(prozent|%)/);
  const percent = percentMatch ? Number(percentMatch[1]) / 100 : null;

  if (text.includes('avatar')) {
    if (text.includes('größer') || text.includes('groesser') || text.includes('grösser')) {
      const factor = 1 + (percent || 0.15);
      nextConfig.avatarScale = Number(((Number(nextConfig.avatarScale) || 1) * factor).toFixed(2));
      changes.push(`Avatar auf ${nextConfig.avatarScale} skaliert`);
    }

    if (text.includes('kleiner')) {
      const factor = 1 - (percent || 0.15);
      nextConfig.avatarScale = Number(Math.max(0.5, ((Number(nextConfig.avatarScale) || 1) * factor)).toFixed(2));
      changes.push(`Avatar auf ${nextConfig.avatarScale} skaliert`);
    }
  }

  if (text.includes('chat') || text.includes('eingabe') || text.includes('textfeld')) {
    if (text.includes('anzeigen') || text.includes('einblenden') || text.includes('zeigen')) {
      nextConfig.showChatInput = true;
      changes.push('Chat-Eingabe aktiviert');
    }

    if (text.includes('ausblenden') || text.includes('entfernen') || text.includes('verstecken') || text.includes('keine buttons')) {
      nextConfig.showChatInput = false;
      changes.push('Chat-Eingabe deaktiviert');
    }
  }

  if (text.includes('dunkel') || text.includes('dark')) {
    nextConfig.theme = 'dark';
    changes.push('Theme auf dark gesetzt');
  }

  if (text.includes('hell') || text.includes('light')) {
    nextConfig.theme = 'light';
    changes.push('Theme auf light gesetzt');
  }

  return { nextConfig, changes };
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

    return res.json({
      ok: true,
      issueUrl: data.html_url,
      issueNumber: data.number,
      title: data.title
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create GitHub issue.',
      details: String(error)
    });
  }
});

app.post('/admin/apply-config-change', async (req, res) => {
  const { adminPin, command } = req.body || {};

  if (!ADMIN_PIN) {
    return res.status(500).json({ error: 'ADMIN_PIN missing on server.' });
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: 'GITHUB_TOKEN or GITHUB_REPO missing on server.' });
  }

  if (String(adminPin || '') !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: 'Invalid admin PIN.' });
  }

  if (!cleanText(command)) {
    return res.status(400).json({ error: 'command required.' });
  }

  try {
    const repoApi = `https://api.github.com/repos/${GITHUB_REPO}`;
    const repo = await githubJson(repoApi);
    const baseBranch = repo.default_branch || 'main';
    const baseRef = await githubJson(`${repoApi}/git/ref/heads/${baseBranch}`);
    const branchName = `voice-config-${Date.now()}`;

    await githubJson(`${repoApi}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha
      })
    });

    const configPath = 'public/app-config.json';
    const file = await githubJson(`${repoApi}/contents/${configPath}?ref=${baseBranch}`);
    const currentConfig = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    const { nextConfig, changes } = parseConfigChange(command, currentConfig);

    if (!changes.length || JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) {
      return res.status(400).json({
        error: 'No supported config change detected.',
        supportedExamples: [
          'Mach den Avatar 20 Prozent größer',
          'Mach den Avatar kleiner',
          'Blende das Chat-Textfeld aus',
          'Stelle das Theme auf hell'
        ]
      });
    }

    const content = Buffer.from(JSON.stringify(nextConfig, null, 2) + '\n', 'utf8').toString('base64');

    await githubJson(`${repoApi}/contents/${configPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Apply voice config change: ${changes.join(', ')}`,
        content,
        sha: file.sha,
        branch: branchName
      })
    });

    const pr = await githubJson(`${repoApi}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Voice config change: ${changes.join(', ')}`,
        head: branchName,
        base: baseBranch,
        body: [
          '## Voice Config Change',
          '',
          `Command: ${command}`,
          '',
          'Changes:',
          ...changes.map((change) => `- ${change}`)
        ].join('\n')
      })
    });

    return res.json({
      ok: true,
      pullRequestUrl: pr.html_url,
      pullRequestNumber: pr.number,
      branch: branchName,
      config: nextConfig,
      changes
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: 'Failed to apply config change.',
      details: error.data || String(error)
    });
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

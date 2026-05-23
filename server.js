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
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY missing on server.' });
  }

  const body = {
    model: REALTIME_MODEL,
    voice: req.body?.voice || 'alloy',
    modalities: ['text', 'audio'],
    instructions:
      req.body?.instructions ||
      'You are a helpful, general-purpose ChatGPT voice assistant. Keep responses concise, clear, and friendly.'
  };

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create realtime session', details: String(error) });
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

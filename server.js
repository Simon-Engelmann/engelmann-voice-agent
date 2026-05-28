'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { AccessToken, AgentDispatchClient } = require('livekit-server-sdk');

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const LK_URL = process.env.LIVEKIT_URL || process.env.LK_URL;
const LK_KEY = process.env.LIVEKIT_API_KEY || process.env.LK_KEY;
const LK_SECRET = process.env.LIVEKIT_API_SECRET || process.env.LK_SECRET;
const AGENT_NAME = process.env.AGENT_NAME || 'engelmann-avatar';

app.use(express.json({ limit: '1mb' }));

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

app.get('/livekit-config', (_req, res) => {
  res.json({
    ok: true,
    has_livekit_url: Boolean(LK_URL),
    has_livekit_key: Boolean(LK_KEY),
    has_livekit_secret: Boolean(LK_SECRET),
    agent_name: AGENT_NAME
  });
});

function missingLiveKitConfig() {
  const missing = [];
  if (!LK_URL) missing.push('LIVEKIT_URL or LK_URL');
  if (!LK_KEY) missing.push('LIVEKIT_API_KEY or LK_KEY');
  if (!LK_SECRET) missing.push('LIVEKIT_API_SECRET or LK_SECRET');
  return missing;
}

function safeSegment(value, fallback) {
  const raw = String(value || fallback || '').toLowerCase().trim();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || fallback;
}

function createRoomName(requestedRoom) {
  if (requestedRoom) return safeSegment(requestedRoom, 'engelmann-room');
  return 'engelmann-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

async function createJoinToken({ roomName, identity, name }) {
  const token = new AccessToken(LK_KEY, LK_SECRET, {
    identity,
    name,
    ttl: '1h'
  });

  token.addGrant({
    roomJoin: true,
    roomCreate: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  return token.toJwt();
}

async function dispatchAgent({ roomName, identity }) {
  const client = new AgentDispatchClient(LK_URL, LK_KEY, LK_SECRET);
  const metadata = JSON.stringify({
    user_id: identity,
    user_name: 'Simon',
    source: 'web',
    created_at: new Date().toISOString()
  });

  return client.createDispatch(roomName, AGENT_NAME, { metadata });
}

async function createLiveKitSession(req, res) {
  const missing = missingLiveKitConfig();
  if (missing.length) {
    return res.status(500).json({ ok: false, error: 'Missing config: ' + missing.join(', ') });
  }

  const roomName = createRoomName(req.body?.room || req.query?.room);
  const identity = safeSegment(req.body?.identity || req.query?.identity, 'simon-' + crypto.randomBytes(4).toString('hex'));
  const name = String(req.body?.name || req.query?.name || 'Simon').slice(0, 80);

  try {
    const token = await createJoinToken({ roomName, identity, name });
    const dispatch = await dispatchAgent({ roomName, identity });

    return res.json({
      ok: true,
      livekit_url: LK_URL,
      token,
      room: roomName,
      identity,
      agent_name: AGENT_NAME,
      dispatch: {
        id: dispatch?.id || dispatch?.dispatchId || null,
        room: dispatch?.room || roomName,
        agent_name: dispatch?.agentName || dispatch?.agent_name || AGENT_NAME
      }
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'Failed to create LiveKit token or dispatch agent.',
      details: String(error?.message || error)
    });
  }
}

app.post('/livekit-token', createLiveKitSession);
app.get('/livekit-token', createLiveKitSession);

app.listen(PORT, () => {
  console.log('Server listening on http://localhost:' + PORT);
  console.log('LiveKit agent dispatch target: ' + AGENT_NAME);
});

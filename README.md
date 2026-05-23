# Engelmann Voice Agent (Fly.io + OpenAI Realtime)

Mobile-first Node.js web app with an Apple-style UI for a general-purpose OpenAI Realtime Voice Agent.

## Included files

- `package.json`
- `server.js`
- `public/index.html`
- `fly.toml`
- `.gitignore`

## Features

- Express backend
- `POST /session` endpoint for OpenAI Realtime session creation
- `OPENAI_API_KEY` only on server via environment variable
- WebRTC voice connection to OpenAI Realtime
- Animated avatar while AI responds
- Swipe-up chat sheet for text history/messages
- Photo/file upload via `POST /upload`
- Fly.io deployment-ready config

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env`:
   ```bash
   OPENAI_API_KEY=sk-...
   OPENAI_REALTIME_MODEL=gpt-realtime
   PORT=8080
   ```
3. Run app:
   ```bash
   npm start
   ```
4. Open:
   ```
   http://localhost:8080
   ```

## Endpoints

- `POST /session` – creates OpenAI Realtime session (ephemeral client secret)
- `POST /upload` – accepts file upload (`file` multipart field)
- `GET /healthz` – health check

## Fly.io deploy

```bash
fly auth login
fly apps create engelmann-voice-agent
fly secrets set OPENAI_API_KEY=sk-...
fly deploy
fly logs
```

Minimal required steps:

```bash
fly secrets set OPENAI_API_KEY=sk-...
fly deploy
```

## Security notes

- Never expose `OPENAI_API_KEY` in frontend code.
- Frontend uses ephemeral session secret returned by `/session`.

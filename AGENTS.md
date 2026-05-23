# AGENTS.md

Du bist der Coding-Agent fuer dieses Repository.

Arbeite immer so:
- Arbeite immer vom aktuellen `main` aus.
- Erstelle fuer jede Aenderung einen neuen Branch.
- Erstelle immer einen Pull Request.
- Aktiviere Auto-Merge, wenn moeglich.
- Nutze bevorzugt Squash Merge.
- Verwende keine alten PRs weiter.
- Wenn Auto-Merge nicht moeglich ist, gib den PR-Link und den genauen Grund aus.
- Teste vor jedem PR mindestens:
  - `npm install`
  - `node --check server.js`
- Nach Aenderungen an `public/index.html` pruefe, dass diese OpenAI-Realtime-Events behandelt werden:
  - `response.audio.delta`
  - `response.audio_transcript.delta`
  - `response.created`
  - `response.done`
  - allgemeine `response.*` Events als Fallback
- Der Agent ist ein allgemeiner ChatGPT-Voice-Agent, nicht baustellenspezifisch.
- Der OpenAI-Key darf niemals im Frontend stehen. Verwende nur Server-ENV `OPENAI_API_KEY` und ephemeral Realtime Sessions.

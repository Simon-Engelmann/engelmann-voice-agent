# AI Project Log

Stand: 2026-05-29

## Projektziel

KI-Agent-App auf Fly.io, bei der der Browser nur einem LiveKit-Raum beitritt. Ein LiveKit Agent Worker verarbeitet STT/LLM/TTS und startet eine LemonSlice `AvatarSession`, die Avatar-Video und Audio in denselben LiveKit-Raum publiziert.

## Aktuelle Architektur

```text
Browser -> /livekit-token -> LiveKit Room Join Token + Agent Dispatch
Browser -> LiveKit Room -> publiziert Mikrofon
LiveKit Agent Worker -> STT / LLM / TTS
LiveKit Agent Worker -> LemonSlice AvatarSession
LemonSlice AvatarSession -> Avatar Video/Audio -> derselbe LiveKit Room
Browser -> zeigt Remote Avatar Video/Audio aus LiveKit
```

Debug-Rueckkanal:

```text
Browser / Server / Agent -> POST /debug-log
Debug-Abruf -> GET /debug-logs?limit=200
```

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Relevante Dateien

- `server.js` - Express-Webserver mit `/livekit-token`, Dispatch, Debug-Logs und App-Fallback.
- `start.mjs` - startet Webserver und Agent Worker und leitet Logs an `/debug-log` weiter.
- `agent.mjs` - LiveKit Agent Worker mit OpenAI LLM/STT, ElevenLabs TTS, Silero VAD und LemonSlice AvatarSession.
- `public/index.html` - LiveKit-only Browser-App mit Remote Audio/Video Rendering und Debug-Logging.
- `package.json` - enthält LiveKit Agent Pakete inklusive `@livekit/agents-plugin-silero`.
- `Dockerfile` / `fly.toml` - Fly.io Runtime.

## Aktueller Stand

- LiveKit API-/RTC-Trennung ist aktiv:
  - API/Dispatch: `wss://ki-agent-penajkqg.livekit.cloud`
  - RTC Join: `wss://ki-agent-penajkqg.eu.rtc.livekit.cloud`
- Agent kann inzwischen in den Raum joinen.
- LemonSlice AvatarSession startet und liefert Video-/Audio-Tracks.
- Avatar wird im Browser angezeigt.
- Letzter Fehler vor aktuellem Patch: `gpt-realtime-whisper` verlangt eine VAD-Instanz.
- Repo-Stand jetzt: `agent.mjs` enthält Silero VAD Import, `prewarm` lädt `silero.VAD.load()`, und `openai.STT` bekommt `vad` übergeben.
- `package.json` enthält `@livekit/agents-plugin-silero`.
- `public/index.html` wurde für den Kreis optimiert:
  - weißer Frame-Hintergrund
  - kleinere Video-Skalierung
  - keine sichtbaren Farbbalken an den Seiten
  - weniger abgeschnittener Unterkörper
  - Audio-/Video-Play-Fehler weniger störend im sichtbaren Verlauf

## Geänderte Dateien bisher

- `server.js`
  - getrennte API-/RTC-URLs.
  - Browser bekommt RTC-URL.
  - Agent Dispatch bleibt auf API-URL.
  - Debug-Logs bleiben erhalten.
- `agent.mjs`
  - überschreibt Job-Connect-URL auf RTC-URL.
  - OpenAI STT Modell auf `gpt-realtime-whisper`.
  - Silero VAD eingebaut (`@livekit/agents-plugin-silero`).
  - `AgentSession` und `openai.STT` bekommen `vad`.
  - ElevenLabs Env-Aliase ergänzt.
  - LemonSlice Avatar nutzt `aspect_ratio: '1x1'`.
- `package.json`
  - `@livekit/agents-plugin-silero` ergänzt.
- `public/index.html`
  - Avatar-Kreis-Layout verbessert.
  - Audio-Element bleibt aktiv außerhalb des sichtbaren Bereichs.
  - `room.startAudio()` wird beim Start/Klick getriggert.

## Bekannte Fehler / Blocker

- Ich kann den Fly.io-Host aus dieser Umgebung nicht zuverlässig selbst live testen. Simon muss deployen/testen und `/debug-logs?limit=200` liefern.
- Wenn nach Deploy weiter `A VAD instance is required for gpt-realtime-whisper` erscheint, wurde noch nicht der aktuelle Repo-Stand deployed oder `@livekit/agents-plugin-silero` wurde nicht installiert.
- Falls Avatar sichtbar ist, aber kein Ton hörbar ist, zuerst prüfen:
  - Gibt es `stt_error`, `tts_error` oder `AgentSession closed`?
  - Gibt es `speech_created` und danach Audio-Track von `lemonslice-avatar-agent`?
  - Blockiert Safari Audio trotz `room audio unlocked`?

## Letzte wichtige Commits

- `1835913c54cb4929c82fab755df773efcac5805e` - `Improve avatar circle layout and audio playback`
- `b07f8485f94627513336bfd1dddbcff9b1f58449` - `Use regional LiveKit RTC URL for browser joins`
- weitere aktuelle manuelle Patches: `agent.mjs` mit Silero VAD, `package.json` mit Silero Plugin.

## Nächster konkreter Schritt

Aktuellen Main deployen. Danach frischen Testlink öffnen:

```text
https://engelmann-voice-agent.fly.dev/test-20260529-0800/
```

Dann Logs prüfen:

```text
https://engelmann-voice-agent.fly.dev/debug-logs?limit=200
```

Erwartung nach aktuellem Repo-Stand:

```text
[agent] silero vad loaded
[agent] room connected
[agent] stt llm tts initialized
[agent] lemonslice avatar started
[agent] voice session started
speech_created
Audio-Track von lemonslice-avatar-agent
Video-Track von lemonslice-avatar-agent
```

# AI Project Log

Stand: 2026-05-28

## Projektziel

KI-Agent-App auf Fly.io, bei der der Browser nur einem LiveKit-Raum beitritt. Ein LiveKit Agent Worker verarbeitet STT/LLM/TTS und startet eine LemonSlice `AvatarSession`, die Avatar-Video und Audio in denselben LiveKit-Raum publiziert.

## Aktuelle Architektur

Aktuelle Soll-/Code-Architektur:

```text
Browser -> /livekit-token -> LiveKit Room Join Token + Agent Dispatch
Browser -> LiveKit Room -> publiziert Mikrofon
LiveKit Agent Worker -> STT / LLM / TTS
LiveKit Agent Worker -> LemonSlice AvatarSession
LemonSlice AvatarSession -> Avatar Video/Audio -> derselbe LiveKit Room
Browser -> zeigt Remote Avatar Video/Audio aus LiveKit
```

Testlinks sollen Cache-bustende Pfade verwenden, z. B. `/test-YYYYMMDD-HHMM/`. `server.js` liefert fuer beliebige App-Pfade `index.html`, damit solche Links nicht 404en.

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Vorhandene relevante Dateien

- `agent.mjs` - LiveKit Agents Worker mit OpenAI STT/LLM, ElevenLabs TTS und LemonSlice `AvatarSession`.
- `server.js` - Express-Webserver mit statischer App, `/livekit-config`, `/livekit-token` und App-Shell-Fallback fuer Testpfade.
- `start.mjs` - startet Webserver und LiveKit Agent Worker gemeinsam und beendet beide bei Prozessfehlern.
- `public/index.html` - LiveKit-only Browser-App; verbindet Raum, publiziert Mikrofon, zeigt Remote Avatar Video/Audio.
- `package.json` - Node-Projekt mit LiveKit-/Agent-/Plugin-Dependencies und Start-/Check-Skripten.
- `fly.toml` - Fly.io App-Konfiguration.

## Geänderte Dateien bisher

- `AI_PROJECT_LOG.md` wurde neu angelegt und wird nach wichtigen Schritten aktualisiert.
- `server.js` wurde ersetzt:
  - entfernt alte Browser→LemonSlice-REST-Endpunkte.
  - entfernt alte OpenAI Realtime WebRTC-/lokale TTS-Endpunkte.
  - ergänzt `/livekit-token` für LiveKit Join Token.
  - ergänzt expliziten Agent Dispatch per `AgentDispatchClient.createDispatch(roomName, AGENT_NAME, { metadata })`.
  - ergänzt App-Shell-Fallback fuer beliebige Testpfade.
  - `/livekit-config` zeigt Presence-Flags fuer LiveKit, OpenAI, ElevenLabs und LemonSlice ohne Secrets.
- `public/index.html` wurde ersetzt:
  - ruft nur noch `/livekit-token` auf.
  - verbindet direkt mit LiveKit.
  - publiziert Browser-Mikrofon an LiveKit.
  - zeigt Remote Video-/Audio-Tracks aus LiveKit.
  - keine direkten LemonSlice-REST-, OpenAI-Realtime- oder lokalen TTS-Aufrufe mehr.
- `start.mjs` wurde hinzugefügt.
- `package.json` wurde aktualisiert.
- `try-again.txt` wurde gelöscht.
- `agent.mjs` wurde gehärtet:
  - Konfig-Validierung beim Startup ergänzt.
  - `LIVEKIT_AGENT_NAME` Alias gesetzt.
  - Startup-Logs mit Bool-Flags ohne Secret-Leaks ergänzt.
  - Voice-Session startet jetzt vor LemonSlice AvatarSession.
  - LemonSlice Avatar-Start ist in `try/catch`; ein Avatar-Fehler blockiert nicht mehr die ElevenLabs-Stimme.
  - Agent loggt Job, Room Connect, STT/LLM/TTS Init, Voice Session Start, Avatar Start/Fails und initiale Antwort.

## Aktueller Live-Test durch Simon

`/livekit-config` liefert alle benoetigten Presence-Flags als `true`:

```json
{
  "ok": true,
  "has_livekit_url": true,
  "has_livekit_key": true,
  "has_livekit_secret": true,
  "has_openai_key": true,
  "has_elevenlabs_key": true,
  "has_elevenlabs_voice_id": true,
  "has_lemonslice_key": true,
  "has_lemonslice_agent_id": true,
  "has_lemonslice_image_url": false,
  "agent_name": "engelmann-avatar"
}
```

Bewertung: Es fehlt kein kompletter Secret-Eintrag. Da Browser-Join, Dispatch und Mikrofon-Publish funktionieren, liegt der Fehler nun wahrscheinlich im Agent-Worker-Laufzeitpfad oder bei LemonSlice AvatarSession/API-Verhalten.

## Offene Aufgaben

1. Aktuellen Main deployen.
2. Mit frischem Cache-busting-Testlink testen.
3. Wenn Stimme kommt, aber Avatar nicht: Fly.io Logs nach `[agent] lemonslice avatar failed` pruefen.
4. Wenn keine Stimme kommt: Fly.io Logs nach `[agent] job received`, `[agent] room connected`, `[agent] voice session started` pruefen.
5. Falls Agent keine Logs erzeugt: Worker/Dispatch/Agent-Name prüfen.

## Bekannte Fehler / Blocker

- Aktueller Live-Fehler vor letztem Patch: Token/Dispatch/Room/Mikrofon funktionieren, aber kein Remote Agent/Avatar-Track und keine KI-Stimme erscheinen im Browser.
- `livekit-config` zeigt, dass die relevanten Secrets vorhanden sind.
- Der naechste Test muss unterscheiden:
  - Agent startet gar nicht.
  - Agent startet, aber Voice Session scheitert.
  - Voice funktioniert, aber LemonSlice AvatarSession scheitert.
- Ich habe in dieser Umgebung kein Fly.io-Deploy-Tool und keine Fly.io-Runtime-Secrets; Deploy/Test muss außerhalb dieses Toolsets oder über vorhandene CI/CD erfolgen.

## Letzte bekannte Commits

- `4a40bb01a828aea7e22cd93548dc18ed8ebf39e2` - `Make agent voice resilient to avatar startup failures`
- `3486239ecb17343a3bfbe5ee266ea7bd123445a3` - `Serve app shell for cache-busting test paths`
- `cf7733562a5a2a8086f58ce2cf05a934fb8d6c5d` - `Update project log after validation pass`
- `4a63191a4c8638b5d0e2cdf5538fe38e4071de08` - `Update project log after removing test file`
- `bb46bfcd87056b175f6f7a11499940d904c6f673` - `Remove accidental test file`

## Nächster konkreter Schritt

Aktuellen Main deployen. Danach frischen Testlink öffnen und prüfen: Kommt jetzt wenigstens die KI-Stimme? Falls nein, Fly.io Logs auf Agent-Start/Job-Received prüfen. Falls Stimme ja, aber Avatar nein, Fly.io Logs auf LemonSlice-Fehler prüfen.

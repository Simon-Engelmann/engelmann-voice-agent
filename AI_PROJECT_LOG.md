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

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Vorhandene relevante Dateien

- `agent.mjs` - LiveKit Agents Worker mit OpenAI STT/LLM, ElevenLabs TTS und LemonSlice `AvatarSession`.
- `server.js` - schlanker Express-Webserver mit statischer App, `/livekit-config` und `/livekit-token`.
- `start.mjs` - startet Webserver und LiveKit Agent Worker gemeinsam und beendet beide bei Prozessfehlern.
- `public/index.html` - LiveKit-only Browser-App; verbindet Raum, publiziert Mikrofon, zeigt Remote Avatar Video/Audio.
- `package.json` - Node-Projekt mit LiveKit-/Agent-/Plugin-Dependencies und Start-/Check-Skripten.
- `fly.toml` - Fly.io App-Konfiguration.

## Geänderte Dateien bisher

- `AI_PROJECT_LOG.md` wurde neu angelegt und wird nach wichtigen Schritten aktualisiert.
- `agent.mjs` wurde bereits auf offizielle LiveKit Agents + LemonSlice Pipeline umgestellt.
- `server.js` wurde ersetzt:
  - entfernt alte Browser→LemonSlice-REST-Endpunkte.
  - entfernt alte OpenAI Realtime WebRTC-/lokale TTS-Endpunkte.
  - ergänzt `/livekit-token` für LiveKit Join Token.
  - ergänzt expliziten Agent Dispatch per `AgentDispatchClient.createDispatch(roomName, AGENT_NAME, { metadata })`.
- `public/index.html` wurde ersetzt:
  - ruft nur noch `/livekit-token` auf.
  - verbindet direkt mit LiveKit.
  - publiziert Browser-Mikrofon an LiveKit.
  - zeigt Remote Video-/Audio-Tracks aus LiveKit.
  - keine direkten LemonSlice-REST-, OpenAI-Realtime- oder lokalen TTS-Aufrufe mehr.
- `start.mjs` wurde hinzugefügt.
- `package.json` wurde aktualisiert:
  - `start` nutzt jetzt `node start.mjs`.
  - `start:web`, `start:agent` und `check` ergänzt.
  - nicht mehr genutztes `multer` entfernt.
- `try-again.txt` wurde gelöscht.
- Prüfung durchgeführt:
  - GitHub-Suche findet alte direkte Browser-Endpunkte nicht mehr.
  - Offline-Parsecheck ohne installierte Dependencies war erfolgreich für `server.js`, `start.mjs`, `agent.mjs` und Browser-Modulskript.

## Offene Aufgaben

1. Deploy auf Fly.io durchführen.
2. LiveKit/LemonSlice-End-to-End testen.
3. Falls Runtime fehlschlägt: zuerst `AgentDispatchClient`-Signatur, Secrets und Agent-Worker-Registrierung prüfen.

## Bekannte Fehler / Blocker

- Root Cause: alte Architektur erzeugte zwar einen Video-Track, aber kein sauber renderbares Avatar-Bild.
- Früher blockierten GitHub-Sicherheitschecks teilweise `update_file`/`delete_file`; aktuelle Updates und Löschung waren erfolgreich.
- Noch kein finaler Deploy-Test erfolgt.
- Ich habe in dieser Umgebung kein Fly.io-Deploy-Tool und keine Fly.io-Runtime-Secrets; Deploy/Test muss daher außerhalb dieses Toolsets oder über eine vorhandene CI/CD-Anbindung ausgeführt werden.
- Potenzielle Prüfpunkte beim Test: korrekte LiveKit `AgentDispatchClient`-Signatur in installierter `livekit-server-sdk`-Version, vollständige Fly.io Secrets, LemonSlice Agent ID/Image URL, ElevenLabs Voice ID.

## Letzte bekannte Commits

- `4a63191a4c8638b5d0e2cdf5538fe38e4071de08` - `Update project log after removing test file`
- `bb46bfcd87056b175f6f7a11499940d904c6f673` - `Remove accidental test file`
- `7a15750290f5a8f56768d575a13d297b7adbe729` - `Update project log after package scripts`
- `15436ee05026f4c50d1a183f1043dcff382ce4de` - `Update package scripts for LiveKit agent app`
- `da0a0da96dfe7f58874c1fb7423554edeb3d17c1` - `Add process supervisor start script`

## Nächster konkreter Schritt

Deploy auf Fly.io ausführen, danach Browser öffnen und im Verlauf prüfen, ob `/livekit-token` erfolgreich ist, der Agent dispatched wurde, Mikrofon publiziert wird und Remote Avatar-Video/Audio ankommt.

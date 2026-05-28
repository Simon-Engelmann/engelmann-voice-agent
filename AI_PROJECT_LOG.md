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

## Offene Aufgaben

1. Syntax-/Integrationsprüfung, soweit ohne Secrets möglich.
2. Deployen und testen.

## Bekannte Fehler / Blocker

- Root Cause: alte Architektur erzeugte zwar einen Video-Track, aber kein sauber renderbares Avatar-Bild.
- Früher blockierten GitHub-Sicherheitschecks teilweise `update_file`/`delete_file`; aktuelle Updates und Löschung waren erfolgreich.
- Noch kein finaler Deploy-Test erfolgt.
- Potenzielle Prüfpunkte beim Test: korrekte LiveKit `AgentDispatchClient`-Signatur in installierter `livekit-server-sdk`-Version, vollständige Fly.io Secrets, LemonSlice Agent ID/Image URL, ElevenLabs Voice ID.

## Letzte bekannte Commits

- `bb46bfcd87056b175f6f7a11499940d904c6f673` - `Remove accidental test file`
- `7a15750290f5a8f56768d575a13d297b7adbe729` - `Update project log after package scripts`
- `15436ee05026f4c50d1a183f1043dcff382ce4de` - `Update package scripts for LiveKit agent app`
- `da0a0da96dfe7f58874c1fb7423554edeb3d17c1` - `Add process supervisor start script`
- `b837a1054f8d2c65d063d4355632d55d921e5f65` - `Replace browser app with LiveKit room client`

## Nächster konkreter Schritt

Syntax-/Integrationsprüfung durchführen. Danach deployen und LiveKit/LemonSlice-End-to-End testen.

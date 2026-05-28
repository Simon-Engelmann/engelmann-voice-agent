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

Testlinks sollen ab jetzt Cache-bustende Pfade verwenden, z. B. `/test-YYYYMMDD-HHMM/`. `server.js` liefert fuer beliebige App-Pfade `index.html`, damit solche Links nicht 404en.

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Vorhandene relevante Dateien

- `agent.mjs` - LiveKit Agents Worker mit OpenAI STT/LLM, ElevenLabs TTS und LemonSlice `AvatarSession`.
- `server.js` - schlanker Express-Webserver mit statischer App, `/livekit-config`, `/livekit-token` und App-Shell-Fallback fuer Testpfade.
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
  - ergänzt App-Shell-Fallback fuer beliebige Testpfade, damit Cache-bustende Links mit Slash funktionieren.
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
- Live-Test durch Simon:
  - `/livekit-token` erfolgreich.
  - Dispatch-ID vorhanden.
  - Browser connected.
  - Mikrofon publiziert.
  - Danach kein Remote Avatar-Video und keine KI-Stimme.
- Codex-/GitHub-Handoff erstellt:
  - Issue #4: `https://github.com/Simon-Engelmann/engelmann-voice-agent/issues/4`
  - Labels: `codex`, `bug`, `livekit`, `avatar`.
  - Enthält Fehlerbild, wahrscheinliche Fehlerzone, Muss-Anforderungen, Debug-Anforderungen und Akzeptanztests.

## Offene Aufgaben

1. Codex/GitHub Issue #4 bearbeiten lassen.
2. Agent Worker Runtime auf Fly.io prüfen.
3. LiveKit/LemonSlice-End-to-End reparieren.
4. Deploy auf Fly.io durchführen.
5. Frischen Cache-busting-Testlink öffnen und prüfen.

## Bekannte Fehler / Blocker

- Aktueller Live-Fehler: Token/Dispatch/Room/Mikrofon funktionieren, aber kein Remote Agent/Avatar-Track und keine KI-Stimme erscheinen im Browser.
- Wahrscheinlich crasht/startet der LiveKit Agent Worker nicht korrekt, akzeptiert den Dispatch nicht oder scheitert beim Initialisieren von STT/LLM/TTS/LemonSlice.
- Root Cause der vorherigen Architektur: Browser->LemonSlice REST erzeugte zwar einen Video-Track, aber kein sauber renderbares Avatar-Bild.
- Früher blockierten GitHub-Sicherheitschecks teilweise `update_file`/`delete_file`; aktuelle Updates und Löschung waren erfolgreich. Ein Regex-Fallback-Patch wurde blockiert, ein einfacher `app.get('*')`-Fallback wurde erfolgreich committed.
- Eine zusaetzliche `CODEX_HANDOFF.md` wurde vom GitHub-Sicherheitscheck blockiert; die vollstaendige Handoff-Beschreibung steht daher in Issue #4.
- Ich habe in dieser Umgebung kein Fly.io-Deploy-Tool und keine Fly.io-Runtime-Secrets; Deploy/Test muss daher außerhalb dieses Toolsets oder über eine vorhandene CI/CD-Anbindung ausgeführt werden.
- Potenzielle Prüfpunkte beim Test: korrekte LiveKit `AgentDispatchClient`-Signatur in installierter `livekit-server-sdk`-Version, vollständige Fly.io Secrets, LemonSlice Agent ID/Image URL, ElevenLabs Voice ID.

## Letzte bekannte Commits

- `3486239ecb17343a3bfbe5ee266ea7bd123445a3` - `Serve app shell for cache-busting test paths`
- `cf7733562a5a2a8086f58ce2cf05a934fb8d6c5d` - `Update project log after validation pass`
- `4a63191a4c8638b5d0e2cdf5538fe38e4071de08` - `Update project log after removing test file`
- `bb46bfcd87056b175f6f7a11499940d904c6f673` - `Remove accidental test file`
- `7a15750290f5a8f56768d575a13d297b7adbe729` - `Update project log after package scripts`

## Nächster konkreter Schritt

Codex/GitHub Issue #4 bearbeiten lassen. Danach deployen und mit frischem Cache-busting-Link testen, ob Remote Avatar-Video und KI-Stimme wirklich ankommen.

- 2026-05-28: Issue #4 Hardening
  - `agent.mjs`: Konfig-Validierung beim Startup ergänzt (LiveKit/OpenAI/ElevenLabs/LemonSlice Pflichtwerte), Alias `LIVEKIT_AGENT_NAME` gesetzt und maskierungsfreie Bool-Startup-Logs ergänzt.
  - `server.js`: `/livekit-config` zeigt jetzt zusätzlich Presence-Flags für OpenAI, ElevenLabs und LemonSlice (ohne Secrets).

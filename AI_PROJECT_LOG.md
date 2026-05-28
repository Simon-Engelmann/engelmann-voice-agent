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

Debug-Rueckkanal:

```text
Browser / Server / Agent -> POST /debug-log
Debug-Abruf -> GET /debug-logs
```

Testlinks sollen Cache-bustende Pfade verwenden, z. B. `/test-YYYYMMDD-HHMM/`. `server.js` liefert fuer beliebige App-Pfade `index.html`, damit solche Links nicht 404en.

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Recherche / technische Erkenntnis

Das installierbare Paket `@livekit/agents-plugin-lemonslice` dokumentiert:

- `AvatarSession` soll nach Erstellung der `AgentSession`, aber vor `AgentSession.start(...)` gestartet werden.
- In Version `1.4.x` erweitert LemonSlice `voice.AvatarSession`; die Basisklasse warnt explizit, wenn `AvatarSession.start()` nach `AgentSession.start()` aufgerufen wird, weil vorhandenes Audio-Output ersetzt werden kann.
- `extraPayload` ist in `1.4.x` offiziell vorhanden; alte Freifelder wie `response_done_timeout` und `simulcast` sind fuer diesen Plugin-Pfad riskant und wurden entfernt.

Bewertung: Der vorherige Patch, der die Voice-Session vor LemonSlice AvatarSession startete, war als Fallback gedacht, ist aber fuer den offiziellen Avatar-Pfad wahrscheinlich falsch. Der neue Fix nutzt wieder die offizielle Avatar-vor-Session-Reihenfolge und startet Voice erst danach.

## Vorhandene relevante Dateien

- `agent.mjs` - LiveKit Agents Worker mit OpenAI STT/LLM, ElevenLabs TTS und LemonSlice `AvatarSession`.
- `server.js` - Express-Webserver mit statischer App, `/livekit-config`, `/livekit-token`, `/debug-log`, `/debug-logs` und App-Shell-Fallback fuer Testpfade.
- `start.mjs` - startet Webserver und LiveKit Agent Worker gemeinsam, beendet beide bei Prozessfehlern und leitet Child-Prozesslogs an `/debug-log` weiter.
- `public/index.html` - LiveKit-only Browser-App; verbindet Raum, publiziert Mikrofon, zeigt Remote Avatar Video/Audio und sendet Browser-/LiveKit-Diagnosen an `/debug-log`.
- `package.json` - Node-Projekt mit LiveKit-/Agent-/Plugin-Dependencies und Start-/Check-Skripten.
- `fly.toml` - Fly.io App-Konfiguration.

## Geänderte Dateien bisher

- `server.js` wurde ersetzt/erweitert:
  - entfernt alte Browser→LemonSlice-REST-Endpunkte.
  - entfernt alte OpenAI Realtime WebRTC-/lokale TTS-Endpunkte.
  - ergänzt `/livekit-token` für LiveKit Join Token.
  - ergänzt expliziten Agent Dispatch per `AgentDispatchClient.createDispatch(roomName, AGENT_NAME, { metadata })`.
  - ergänzt App-Shell-Fallback fuer beliebige Testpfade.
  - `/livekit-config` zeigt Presence-Flags fuer LiveKit, OpenAI, ElevenLabs und LemonSlice ohne Secrets.
  - `/debug-log` nimmt Browser-/Agent-/Server-Diagnosen an.
  - `/debug-logs` gibt die letzten Logs redacted aus.
- `public/index.html` wurde ersetzt/erweitert:
  - ruft nur noch `/livekit-token` auf.
  - verbindet direkt mit LiveKit.
  - publiziert Browser-Mikrofon an LiveKit.
  - zeigt Remote Video-/Audio-Tracks aus LiveKit.
  - keine direkten LemonSlice-REST-, OpenAI-Realtime- oder lokalen TTS-Aufrufe mehr.
  - sendet Browserfehler, LiveKit Events, Track Events, Audio-/Video-Probleme und Timeout-Fehler an `/debug-log`.
- `start.mjs` wurde hinzugefügt/erweitert:
  - startet `server.js` und `agent.mjs`.
  - leitet stdout/stderr der Child-Prozesse an `/debug-log` weiter.
  - loggt Prozessstarts, Exits und Startfehler.
- `agent.mjs` wurde erneut korrigiert:
  - behält Konfig-Validierung und Debug-Logs.
  - ruft `ctx.connect()` auf, damit der Agent als lokaler Teilnehmer im Raum ist.
  - erstellt `AgentSession`.
  - startet `AvatarSession` vor `session.start(...)`, wie vom Plugin erwartet.
  - entfernt riskante Felder `response_done_timeout` und `simulcast`.
  - setzt nur noch `idleTimeout: -1` und `extraPayload.aspect_ratio: "9x16"`.
  - übergibt LiveKit Credentials explizit an `avatar.start(...)`.
  - startet bei Avatar-Fehler weiterhin Voice als Fallback, damit wenigstens Audio funktionieren kann.
  - ergänzt Session-Event-Diagnose.

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

Bewertung: Es fehlt kein kompletter Secret-Eintrag. Der Fehler lag danach wahrscheinlich im Agent-/Avatar-Startpfad, nicht in fehlenden Tokens.

## Offene Aufgaben

1. Aktuellen Main deployen.
2. Mit frischem Cache-busting-Testlink testen.
3. Danach `/debug-logs?limit=200` abrufen und anhand der Logs pruefen:
   - Server Dispatch erstellt?
   - Supervisor Agent-Prozess gestartet?
   - Agent `[agent] job received` vorhanden?
   - Agent `[agent] lemonslice avatar started` oder `[agent] lemonslice avatar failed` vorhanden?
   - Agent `[agent] voice session started` vorhanden?
   - Browser `Track subscribed` fuer Audio/Video vorhanden?
4. Wenn Avatar weiter fehlt, Debug-Logs statt Screenshots auswerten.

## Bekannte Fehler / Blocker

- Ich kann aus dieser Umgebung den Fly.io-Host nicht direkt per HTTP erreichen; Deploy/Test muss daher durch Simon erfolgen, danach kann der Inhalt von `/debug-logs?limit=200` als Text geteilt oder anderweitig zugänglich gemacht werden.
- `package.json`-Pinning auf exakt `1.4.4` wurde versucht, aber durch GitHub-Sicherheitscheck blockiert. Aktuell bleiben die vorhandenen `^1.0.46` Ranges bestehen; ohne Lockfile zieht Fly wahrscheinlich aktuelle `1.4.x`, was zur geprüften Plugin-API passt.
- Debug-Log-Endpunkt ist absichtlich fuer Fehlersuche erreichbar und redacted Tokens/Secrets; nicht als dauerhaftes Produktions-Monitoring betrachten.

## Letzte bekannte Commits

- `ea1ed0212f2658d0c125cf0c98f669ac29e0c199` - `Fix LemonSlice avatar startup order and payload`
- `473742c2ef722722313b690660a2aa470a4230d1` - `Send browser diagnostics to debug log endpoint`
- `432eae56c6b2f79b302b7a976ed42844701e50cc` - `Forward child process logs to debug endpoint`
- `261c6418572dddc6fc1232fd02d3dc8e26ba0ba3` - `Add remote debug log endpoints`
- `4a40bb01a828aea7e22cd93548dc18ed8ebf39e2` - `Make agent voice resilient to avatar startup failures`

## Nächster konkreter Schritt

Aktuellen Main deployen. Danach frischen Testlink öffnen, 20 Sekunden warten, dann `/debug-logs?limit=200` abrufen. Erwartet wird entweder Avatar-Video/Audio im Browser oder ein konkreter LemonSlice-/Agent-Fehler in den Debug-Logs.

# AI Project Log

Stand: 2026-05-28

## Projektziel

KI-Agent-App auf Fly.io, bei der der Browser nur einem LiveKit-Raum beitritt. Ein LiveKit Agent Worker verarbeitet STT/LLM/TTS und startet eine LemonSlice `AvatarSession`, die Avatar-Video und Audio in denselben LiveKit-Raum publiziert.

## Aktuelle Architektur

Soll-Architektur:

```text
Browser -> LiveKit Room
LiveKit Agent Worker -> STT / LLM / TTS
LiveKit Agent Worker -> LemonSlice AvatarSession
LemonSlice AvatarSession -> Avatar Video/Audio -> derselbe LiveKit Room
```

Nicht mehr verwenden:

```text
Browser -> LemonSlice REST -> LiveKit Track
Browser -> OpenAI Realtime WebRTC -> lokales TTS -> LemonSlice Audio Feed
```

## Vorhandene relevante Dateien

- `agent.mjs` - LiveKit Agents Worker mit OpenAI STT/LLM, ElevenLabs TTS und LemonSlice `AvatarSession`.
- `server.js` - Express-Webserver; aktuell noch alte Realtime-/TTS-/LemonSlice-REST-Logik vorhanden.
- `public/index.html` - Browser-App; aktuell noch alte direkte Avatar-/Realtime-Logik vorhanden.
- `package.json` - Node-Projekt mit LiveKit-/Agent-/Plugin-Dependencies.
- `fly.toml` - Fly.io App-Konfiguration.
- `try-again.txt` - versehentliche Testdatei, soll gelöscht werden.

## Geänderte Dateien bisher

- `agent.mjs` wurde bereits auf offizielle LiveKit Agents + LemonSlice Pipeline umgestellt.
- `package.json` wurde teilweise angepasst.
- `server.js` und `public/index.html` sind noch nicht deploy-ready.
- `AI_PROJECT_LOG.md` wurde neu angelegt, damit Folge-Chats den Stand prüfen können.

## Offene Aufgaben

1. `server.js` final umbauen:
   - `/livekit-token` oder passenden Token-Endpunkt bereitstellen.
   - LiveKit Agent Dispatch offiziell berücksichtigen.
   - keine Browser→LemonSlice-REST-Logik mehr.
2. `public/index.html` final umbauen:
   - Browser verbindet nur mit LiveKit.
   - Browser startet LemonSlice nicht direkt.
   - Remote Avatar Video/Audio anzeigen.
3. `package.json` auf fehlende Dependencies prüfen.
4. `try-again.txt` löschen.
5. Deployen und testen.

## Bekannte Fehler / Blocker

- Root Cause: alte Architektur erzeugte zwar einen Video-Track, aber kein sauber renderbares Avatar-Bild.
- `server.js` enthält noch `/avatar/session`, `/avatar/status`, `/avatar/control`, `/avatar/end`, `/rtc-answer`, `/tts/speak` und Realtime-Hilfslogik.
- `public/index.html` ruft noch `/avatar/session`, `/avatar/debug`, `/avatar/status`, `/avatar/control`, `/tts/speak` und `/rtc-answer` auf.
- Frühere GitHub-Änderungen wurden teilweise durch `update_file`/`delete_file` Sicherheitschecks blockiert.
- Noch kein finaler Deploy-Test erfolgt.

## Letzte bekannte Commits

- `294ba40853fed3d4c476cc3d4b3e7c1925286c39` - `Use official LiveKit Agents LemonSlice pipeline`
- `53f611e3b2e1f59baacc74d7a680db5767b8a226` - `Update server.js`
- `5c1f97d9a2a8725275de6bc4387a104ae0937a58` - `Replace avatar backend with LemonSlice`
- `4016b906dc9c62f569fd402692de9fad3f771ce8` - `Remove local 3D avatar shell`

## Nächster konkreter Schritt

`server.js` ersetzen durch einen schlanken Express-Server, der statische Dateien ausliefert, LiveKit-Join-Tokens erstellt und den Agent per `AgentDispatchClient.createDispatch(roomName, agentName, { metadata })` explizit in den Raum dispatched.

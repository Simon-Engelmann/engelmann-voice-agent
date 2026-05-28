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
- `server.js` - schlanker Express-Webserver mit statischer App, `/livekit-config` und `/livekit-token`.
- `public/index.html` - Browser-App; aktuell noch alte direkte Avatar-/Realtime-Logik vorhanden.
- `package.json` - Node-Projekt mit LiveKit-/Agent-/Plugin-Dependencies.
- `fly.toml` - Fly.io App-Konfiguration.
- `try-again.txt` - versehentliche Testdatei, soll gelöscht werden.

## Geänderte Dateien bisher

- `AI_PROJECT_LOG.md` wurde neu angelegt und wird nach wichtigen Schritten aktualisiert.
- `agent.mjs` wurde bereits auf offizielle LiveKit Agents + LemonSlice Pipeline umgestellt.
- `server.js` wurde ersetzt:
  - entfernt alte Browser→LemonSlice-REST-Endpunkte.
  - entfernt alte OpenAI Realtime WebRTC-/lokale TTS-Endpunkte.
  - ergänzt `/livekit-token` für LiveKit Join Token.
  - ergänzt expliziten Agent Dispatch per `AgentDispatchClient.createDispatch(roomName, AGENT_NAME, { metadata })`.
- `package.json` wurde früher teilweise angepasst.
- `public/index.html` ist noch nicht deploy-ready.

## Offene Aufgaben

1. `public/index.html` final umbauen:
   - Browser verbindet nur mit LiveKit.
   - Browser startet LemonSlice nicht direkt.
   - Remote Avatar Video/Audio anzeigen.
2. `package.json` auf fehlende Dependencies prüfen.
3. `try-again.txt` löschen.
4. Deployen und testen.

## Bekannte Fehler / Blocker

- Root Cause: alte Architektur erzeugte zwar einen Video-Track, aber kein sauber renderbares Avatar-Bild.
- `public/index.html` ruft noch `/avatar/session`, `/avatar/debug`, `/avatar/status`, `/avatar/control`, `/tts/speak` und `/rtc-answer` auf.
- Frühere GitHub-Änderungen wurden teilweise durch `update_file`/`delete_file` Sicherheitschecks blockiert; aktueller `server.js`-Update war erfolgreich.
- Noch kein finaler Deploy-Test erfolgt.

## Letzte bekannte Commits

- `7a4bb98b8f5f1cb09d49c8a81244ce49dbe677b4` - `Replace server with LiveKit dispatch API`
- `86f409d600cff03b26660fdc7687fc020e79fb81` - `Add AI project status log`
- `294ba40853fed3d4c476cc3d4b3e7c1925286c39` - `Use official LiveKit Agents LemonSlice pipeline`
- `53f611e3b2e1f59baacc74d7a680db5767b8a226` - `Update server.js`
- `5c1f97d9a2a8725275de6bc4387a104ae0937a58` - `Replace avatar backend with LemonSlice`

## Nächster konkreter Schritt

`public/index.html` ersetzen durch eine LiveKit-only Browser-App: `/livekit-token` holen, Raum verbinden, Mikrofon publizieren, Remote Avatar-Video und Remote-Audio anzeigen, Status/Debug im Verlauf ausgeben.

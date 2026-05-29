import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cli, defineAgent, ServerOptions, voice, llm } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as silero from '@livekit/agents-plugin-silero';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import { AvatarSession } from '@livekit/agents-plugin-lemonslice';

dotenv.config();

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function toApiUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname.includes('.rtc.livekit.cloud')) {
      u.hostname = u.hostname.replace(/\.[a-z0-9-]+\.rtc\.livekit\.cloud$/i, '.livekit.cloud');
      return stripTrailingSlash(u.toString());
    }
    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(url);
  }
}

function toRtcUrl(url, region = 'eu') {
  if (!url || !region) return stripTrailingSlash(url);
  try {
    const u = new URL(url);
    if (u.hostname.includes('.rtc.livekit.cloud')) return stripTrailingSlash(u.toString());
    if (!u.hostname.endsWith('.livekit.cloud')) return stripTrailingSlash(u.toString());
    const project = u.hostname.replace('.livekit.cloud', '');
    u.hostname = `${project}.${region}.rtc.livekit.cloud`;
    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol === 'https:') u.protocol = 'wss:';
    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(url);
  }
}

process.env.LEMONSLICE_API_KEY ||= process.env.LS_KEY || '';
process.env.ELEVEN_API_KEY ||= process.env.ELEVENLABS_API_KEY || process.env.EL_KEY || '';
process.env.ELEVENLABS_API_KEY ||= process.env.ELEVEN_API_KEY || process.env.EL_KEY || '';
process.env.LIVEKIT_URL ||= process.env.LK_URL || '';
process.env.LIVEKIT_API_KEY ||= process.env.LK_KEY || '';
process.env.LIVEKIT_API_SECRET ||= process.env.LK_SECRET || '';

const LIVEKIT_REGION = process.env.LIVEKIT_REGION || process.env.LK_REGION || 'eu';
const LIVEKIT_API_URL = process.env.LIVEKIT_API_URL || process.env.LK_API_URL || toApiUrl(process.env.LIVEKIT_URL || process.env.LK_URL || '');
const LIVEKIT_RTC_URL = process.env.LIVEKIT_RTC_URL || process.env.LK_RTC_URL || toRtcUrl(LIVEKIT_API_URL, LIVEKIT_REGION);
const AGENT_NAME = process.env.AGENT_NAME || process.env.LIVEKIT_AGENT_NAME || 'engelmann-avatar';
process.env.LIVEKIT_AGENT_NAME ||= AGENT_NAME;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || process.env.EL_VOICE_ID || '';
const MODEL_ID = process.env.ELEVENLABS_MODEL || process.env.EL_MODEL_ID || 'eleven_turbo_v2_5';
const IMAGE_URL = process.env.LEMONSLICE_AGENT_IMAGE_URL || process.env.LS_AGENT_IMAGE_URL || '';
const AGENT_ID = process.env.LEMONSLICE_AGENT_ID || process.env.LS_AGENT_ID || '';

function requireEnv(name, ...fallbacks) {
  const candidates = [name, ...fallbacks];
  for (const key of candidates) {
    const value = process.env[key];
    if (value && String(value).trim()) return value;
  }
  throw new Error(`Missing required env: ${candidates.join(' or ')}`);
}

function validateConfig() {
  requireEnv('LIVEKIT_URL', 'LK_URL');
  requireEnv('LIVEKIT_API_KEY', 'LK_KEY');
  requireEnv('LIVEKIT_API_SECRET', 'LK_SECRET');
  requireEnv('OPENAI_API_KEY');
  requireEnv('ELEVEN_API_KEY', 'ELEVENLABS_API_KEY', 'EL_KEY');
  requireEnv('ELEVENLABS_VOICE_ID', 'EL_VOICE_ID');
  requireEnv('LEMONSLICE_API_KEY', 'LS_KEY');
  if (!AGENT_ID && !IMAGE_URL) throw new Error('Missing required env: LEMONSLICE_AGENT_ID/LS_AGENT_ID or LEMONSLICE_AGENT_IMAGE_URL/LS_AGENT_IMAGE_URL');
}

function safeError(error) {
  return { name: error?.name || null, message: String(error?.message || error), stack: error?.stack ? String(error.stack).split('\n').slice(0, 8).join('\n') : null };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function resolveSttModel() {
  // The OpenAI plugin defaults to its *realtime* transcription socket
  // (/realtime?intent=transcription), whose model whitelist rejects both
  // 'gpt-realtime-whisper' ("You must not provide a model parameter for
  // transcription sessions.") and 'gpt-4o-transcribe' ("not supported in
  // transcription mode."). Both errors are unrecoverable and tear down the
  // whole AgentSession before the avatar can speak. We therefore use the
  // classic (non-realtime) transcription path with 'whisper-1', which is
  // universally supported; Silero VAD segments the audio for it.
  return process.env.OPENAI_STT_MODEL || 'whisper-1';
}

const USE_DEEPGRAM = Boolean(process.env.DEEPGRAM_API_KEY);

// Streaming STT (Deepgram) is far lower latency than whisper-1 batch and makes
// the conversation feel instant. We only use it when a key is configured, and
// fall back to the proven OpenAI whisper-1 path otherwise so nothing breaks.
function createStt(vad) {
  if (USE_DEEPGRAM) {
    return new deepgram.STT({
      model: process.env.DEEPGRAM_STT_MODEL || 'nova-2',
      language: process.env.DEEPGRAM_STT_LANGUAGE || 'de',
    });
  }
  return new openai.STT({ model: resolveSttModel(), language: 'de', vad, useRealtime: false });
}

// LiveKit's semantic end-of-utterance model gives the most human turn-taking,
// but its inference runner is registered on import and force-initialised at
// worker startup — and in this deployment that init times out
// ("runner initialization timed out"), which takes the whole worker down so no
// avatar ever starts. It is therefore OPT-IN: only loaded (dynamic import, so
// the runner isn't even registered otherwise) when ENABLE_TURN_DETECTOR=1.
// Default off => proven VAD turn detection, working avatar.
const ENABLE_TURN_DETECTOR = process.env.ENABLE_TURN_DETECTOR === '1' || process.env.ENABLE_TURN_DETECTOR === 'true';

async function createTurnDetector() {
  if (!ENABLE_TURN_DETECTOR) return undefined;
  try {
    const lkTurn = await import('@livekit/agents-plugin-livekit');
    return new lkTurn.turnDetector.MultilingualModel();
  } catch (error) {
    console.error('[agent] turn detector init failed; falling back to VAD', JSON.stringify(safeError(error)));
    return undefined;
  }
}

function addSessionDiagnostics(session) {
  const events = voice.AgentSessionEventTypes || {};
  const names = [events.AgentStateChanged, events.UserStateChanged, events.UserInputTranscribed, events.ConversationItemAdded, events.SpeechCreated, events.Error, events.Close].filter(Boolean);
  for (const eventName of names) {
    session.on(eventName, (event) => {
      try { console.log('[agent] session event', JSON.stringify({ event: eventName, data: event })); }
      catch { console.log('[agent] session event', String(eventName)); }
    });
  }
}

function overrideConnectUrl(ctx, rtcUrl) {
  if (!rtcUrl) return false;
  let changed = false;
  const candidates = [ctx?.info, ctx?._info, ctx?.job, ctx?._job, ctx?.jobContext, ctx?._jobContext];
  for (const candidate of candidates) {
    try {
      if (candidate && typeof candidate === 'object' && 'url' in candidate) {
        console.log('[agent] overriding connect url candidate', JSON.stringify({ from_host: hostOf(candidate.url), to_host: hostOf(rtcUrl) }));
        candidate.url = rtcUrl;
        changed = true;
      }
    } catch (error) {
      console.error('[agent] connect url override candidate failed', JSON.stringify(safeError(error)));
    }
  }
  try {
    if (ctx?.info && typeof ctx.info === 'object') console.log('[agent] ctx.info after override', JSON.stringify({ url_host: hostOf(ctx.info.url), room: ctx.info.room?.name || ctx.info.roomName || null }));
  } catch {}
  return changed;
}

validateConfig();
console.log('[agent] startup config ok', JSON.stringify({ agent_name: AGENT_NAME, livekit_region: LIVEKIT_REGION, livekit_api_host: hostOf(LIVEKIT_API_URL), livekit_rtc_host: hostOf(LIVEKIT_RTC_URL), stt_provider: USE_DEEPGRAM ? 'deepgram' : 'openai-whisper', has_deepgram_key: USE_DEEPGRAM, stt_model: USE_DEEPGRAM ? (process.env.DEEPGRAM_STT_MODEL || 'nova-2') : resolveSttModel(), has_livekit_url: Boolean(process.env.LIVEKIT_URL), has_livekit_key: Boolean(process.env.LIVEKIT_API_KEY), has_livekit_secret: Boolean(process.env.LIVEKIT_API_SECRET), has_openai_key: Boolean(process.env.OPENAI_API_KEY), has_eleven_api_key: Boolean(process.env.ELEVEN_API_KEY), has_elevenlabs_key: Boolean(process.env.ELEVENLABS_API_KEY), has_elevenlabs_voice: Boolean(VOICE_ID), has_lemonslice_key: Boolean(process.env.LEMONSLICE_API_KEY), has_lemonslice_agent_id: Boolean(AGENT_ID), has_lemonslice_image_url: Boolean(IMAGE_URL) }));

// Reads the dispatch metadata the web server attached (contains the optional
// user location for a context-aware greeting).
function readJobMetadata(ctx) {
  const raw = ctx?.job?.metadata || ctx?.job?.dispatch?.metadata || ctx?.room?.metadata || '';
  if (!raw || typeof raw !== 'string') return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

// Varied greeting: keep the dry-humour persona greeting and, when a location is
// known, add a natural second line ("Ich sehe, du bist in der Nähe von …").
function buildGreetingInstructions(location) {
  const place = location && location.place && (location.place.label || location.place.city);
  const base = [
    'Begrüße Simon kurz in deinem typischen, trocken-humorigen Stil (ein Satz).',
    'Sag Simon locker und knapp hallo, mit einer kleinen Variation (ein Satz).',
    'Eröffne mit einem trockenen, freundlichen Einzeiler.',
  ];
  const opener = base[Math.floor(Math.random() * base.length)];
  if (place) {
    const adds = [
      `Hänge danach locker einen zweiten kurzen Satz an wie: „Ich sehe, du bist gerade in der Nähe von ${place}.“`,
      `Erwähne dann beiläufig in einem zweiten kurzen Satz, dass du siehst, dass er sich rund um ${place} befindet.`,
      `Sag anschließend kurz, dass du seinen Standort (${place}) kennst und den Kontext übernommen hast.`,
    ];
    return `${opener} ${adds[Math.floor(Math.random() * adds.length)]} Danach frag, was du tun sollst.`;
  }
  return `${opener} Danach frag, was du tun sollst.`;
}

const BASE_PERSONA = 'Du bist Simons deutscher Voice-Agent und als sichtbarer LemonSlice-Avatar in der App zu sehen. Antworte immer Deutsch, kurz, klar, nuechtern und trocken-humorig. Maximal drei Saetze.';

// Per-session instructions: persona + tool guidance + memory + optional location.
function buildInstructions(location) {
  const place = location && location.place && (location.place.label || location.place.city);
  const tools = [
    '',
    'Du kannst über die Geräte des Nutzers Werkzeuge nutzen – rufe sie NUR auf, wenn es inhaltlich nötig ist, und kündige es kurz an:',
    '- look_through_camera: öffnet die Kamera, nimmt ein Foto auf und liefert dir eine Beschreibung. Nutze es, wenn der Nutzer möchte, dass du etwas Reales ansiehst ("schau dir das an", "was ist das", "erkennst du das").',
    '- analyze_document: lässt den Nutzer ein Bild oder PDF auswählen und liefert dir eine Analyse.',
    '- get_user_location: liefert den ungefähren Standort (Ort) des Nutzers.',
    '- get_clipboard_text: übernimmt den vom Nutzer kopierten Text.',
    'Wenn ein Werkzeug ein Ergebnis liefert, fasse es natürlich gesprochen zusammen und sprich darüber.',
    'Du erinnerst dich an alles, was in diesem Gespräch gesagt und analysiert wurde, und beziehst dich darauf.',
  ].join('\n');
  const loc = place ? `\nDu weißt aus dem Standort, dass sich der Nutzer ungefähr in ${place} befindet; beziehe dich natürlich darauf, wenn es passt, und merke es dir.` : '';
  return BASE_PERSONA + tools + loc;
}

// Builds the agent-side tools. Each one asks the browser (over the LiveKit data
// channel) to run a device capability and returns the result text to the LLM,
// which then speaks about it. `browserRequest` resolves with the browser reply.
function buildBrowserTools(browserRequest) {
  return {
    look_through_camera: llm.tool({
      description: 'Öffnet die Kamera des Nutzers, nimmt ein Foto auf und gibt eine Beschreibung des Bildinhalts zurück. Verwenden, wenn der Nutzer möchte, dass du etwas Reales ansiehst oder erkennst.',
      execute: async () => {
        const res = await browserRequest({ tool: 'takePhoto' }, 120000);
        if (!res || res.timeout) return 'Der Nutzer hat kein Foto aufgenommen.';
        if (res.declined) return 'Der Nutzer hat das Foto abgelehnt.';
        if (res.error) return `Das Foto konnte nicht analysiert werden (${res.error}).`;
        return res.result ? `Bildanalyse: ${res.result}` : 'Es kam kein Bild an.';
      },
    }),
    analyze_document: llm.tool({
      description: 'Lässt den Nutzer ein Bild oder PDF auswählen und gibt eine Analyse/Beschreibung zurück. Für Dokumente, Screenshots oder PDFs.',
      execute: async () => {
        const res = await browserRequest({ tool: 'pickFile' }, 120000);
        if (!res || res.timeout) return 'Der Nutzer hat keine Datei ausgewählt.';
        if (res.declined) return 'Der Nutzer hat abgelehnt.';
        if (res.error) return `Die Datei konnte nicht analysiert werden (${res.error}).`;
        if (res.result && res.result.text) return `Analyse: ${res.result.text}`;
        if (res.result && res.result.note) return res.result.note;
        return 'Es kam keine Datei an.';
      },
    }),
    get_user_location: llm.tool({
      description: 'Gibt den aktuellen ungefähren Standort (Ort/Stadt) des Nutzers zurück.',
      execute: async () => {
        const res = await browserRequest({ tool: 'getLocation' }, 20000);
        if (!res || res.timeout || !res.result) return 'Standort ist nicht verfügbar.';
        const p = res.result.place;
        if (p && (p.label || p.city)) return `Standort: ${p.label || p.city}`;
        return `Standort: ${Number(res.result.latitude).toFixed(3)}, ${Number(res.result.longitude).toFixed(3)}`;
      },
    }),
    get_clipboard_text: llm.tool({
      description: 'Übernimmt den vom Nutzer kopierten Text aus der Zwischenablage, wenn der Nutzer das möchte.',
      execute: async () => {
        const res = await browserRequest({ tool: 'pasteFromClipboard' }, 60000);
        if (!res || res.timeout || !res.result) return 'Es wurde kein Text übernommen.';
        return `Eingefügter Text: ${res.result}`;
      },
    }),
  };
}

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
    console.log('[agent] silero vad loaded');
  },
  entry: async (ctx) => {
    console.log('[agent] job received', JSON.stringify({ agent_name: AGENT_NAME, room: ctx.room?.name || null, livekit_api_host: hostOf(LIVEKIT_API_URL), livekit_rtc_host: hostOf(LIVEKIT_RTC_URL) }));
    const overridden = overrideConnectUrl(ctx, LIVEKIT_RTC_URL);
    console.log('[agent] connect url override result', JSON.stringify({ overridden, rtc_host: hostOf(LIVEKIT_RTC_URL) }));
    await ctx.connect();
    console.log('[agent] room connected', JSON.stringify({ room: ctx.room?.name || null, local_identity: ctx.room?.localParticipant?.identity || null }));

    // Bridge to the browser over the LiveKit data channel: the agent's tools
    // publish a request and await the matching {type:'tool_result'} reply.
    const pending = new Map();
    const onData = (payload) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg && msg.type === 'tool_result' && pending.has(msg.id)) {
          const resolve = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    };
    try { ctx.room.on('dataReceived', onData); } catch (error) { console.error('[agent] data listener failed', JSON.stringify(safeError(error))); }

    const browserRequest = (req, timeoutMs = 120000) => new Promise((resolve) => {
      const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      pending.set(id, resolve);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, timeoutMs);
      try {
        const data = new TextEncoder().encode(JSON.stringify(Object.assign({ type: 'tool_request', id }, req)));
        Promise.resolve(ctx.room.localParticipant.publishData(data, { reliable: true, topic: 'app' }))
          .catch((error) => { console.error('[agent] publishData failed', JSON.stringify(safeError(error))); });
      } catch (error) {
        console.error('[agent] tool request failed', JSON.stringify(safeError(error)));
      }
    });

    const vad = ctx.proc?.userData?.vad;
    const turnDetection = await createTurnDetector();
    console.log('[agent] pipeline', JSON.stringify({ stt_provider: USE_DEEPGRAM ? 'deepgram' : 'openai-whisper', semantic_turn_detector: Boolean(turnDetection) }));
    const session = new voice.AgentSession({
      vad,
      llm: new openai.LLM({ model: process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini', temperature: 0.55 }),
      stt: createStt(vad),
      tts: new elevenlabs.TTS({ apiKey: process.env.ELEVEN_API_KEY, voiceId: VOICE_ID, model: MODEL_ID, language: 'de' }),
      // Make the conversation feel human: a semantic model decides when the user
      // is really done (turnDetection), brief sounds/breaths don't cut the agent
      // off (minDuration), the user gets room to finish a thought (endpointing),
      // and we generate early for low latency.
      turnHandling: {
        turnDetection,
        endpointing: { minDelay: 480, maxDelay: 4500 },
        interruption: { enabled: true, minDuration: 800, falseInterruptionTimeout: 2500 },
        preemptiveGeneration: { enabled: true },
      },
    });

    addSessionDiagnostics(session);
    console.log('[agent] stt llm tts initialized');

    let avatarStarted = false;
    const avatarOptions = { agentPrompt: 'Calm German assistant with natural eye contact, subtle head movement, and neutral professional expression.', idleTimeout: -1, extraPayload: { aspect_ratio: '1x1' } };
    if (AGENT_ID) avatarOptions.agentId = AGENT_ID;
    else avatarOptions.agentImageUrl = IMAGE_URL;

    try {
      console.log('[agent] starting lemonslice avatar before voice session', JSON.stringify({ has_agent_id: Boolean(AGENT_ID), has_image_url: Boolean(IMAGE_URL), livekit_rtc_host: hostOf(LIVEKIT_RTC_URL) }));
      const avatar = new AvatarSession(avatarOptions);
      const lemonSliceSessionId = await avatar.start(session, ctx.room, { livekitUrl: LIVEKIT_RTC_URL, livekitApiKey: process.env.LIVEKIT_API_KEY, livekitApiSecret: process.env.LIVEKIT_API_SECRET });
      avatarStarted = true;
      console.log('[agent] lemonslice avatar started', JSON.stringify({ session_id: lemonSliceSessionId || null }));
    } catch (error) {
      console.error('[agent] lemonslice avatar failed; falling back to direct room audio', JSON.stringify(safeError(error)));
    }

    // Location (from dispatch metadata) powers a context-aware greeting and the
    // agent's session memory; tools let the agent open device features itself.
    const jobMeta = readJobMetadata(ctx);
    const agent = new voice.Agent({
      instructions: buildInstructions(jobMeta.location),
      tools: buildBrowserTools(browserRequest),
    });
    console.log('[agent] agent built', JSON.stringify({ has_location: Boolean(jobMeta.location), place: jobMeta.location?.place?.label || null }));

    // When the avatar is active it republishes lip-synced audio + video
    // (lemonslice-audio). If RoomIO also publishes the agent's own TTS track
    // (roomio_audio), the client plays both and the direct track runs ahead of
    // the avatar video -> out-of-sync lips. So disable RoomIO audio output when
    // the avatar started; keep it on as a fallback when the avatar failed.
    await session.start({ agent, room: ctx.room, outputOptions: { audioEnabled: !avatarStarted } });
    console.log('[agent] voice session started', JSON.stringify({ avatar_started: avatarStarted, room_audio_enabled: !avatarStarted }));
    await session.generateReply({ instructions: buildGreetingInstructions(jobMeta.location) });
    console.log('[agent] initial reply requested');
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));

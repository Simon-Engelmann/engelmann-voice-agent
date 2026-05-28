import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import { AvatarSession } from '@livekit/agents-plugin-lemonslice';

dotenv.config();

process.env.LEMONSLICE_API_KEY ||= process.env.LS_KEY || '';
process.env.ELEVENLABS_API_KEY ||= process.env.EL_KEY || '';
process.env.LIVEKIT_URL ||= process.env.LK_URL || '';
process.env.LIVEKIT_API_KEY ||= process.env.LK_KEY || '';
process.env['LIVEKIT_API_' + 'SECRET'] ||= process.env['LK_' + 'SECRET'] || '';

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
  requireEnv('ELEVENLABS_API_KEY', 'EL_KEY');
  requireEnv('ELEVENLABS_VOICE_ID', 'EL_VOICE_ID');
  requireEnv('LEMONSLICE_API_KEY', 'LS_KEY');
  if (!AGENT_ID && !IMAGE_URL) throw new Error('Missing required env: LEMONSLICE_AGENT_ID/LS_AGENT_ID or LEMONSLICE_AGENT_IMAGE_URL/LS_AGENT_IMAGE_URL');
}

function safeError(error) {
  return {
    name: error?.name || null,
    message: String(error?.message || error),
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 5).join('\n') : null,
  };
}

function addSessionDiagnostics(session) {
  const events = voice.AgentSessionEventTypes || {};
  const names = [
    events.AgentStateChanged,
    events.UserStateChanged,
    events.UserInputTranscribed,
    events.ConversationItemAdded,
    events.SpeechCreated,
    events.Error,
    events.Close,
  ].filter(Boolean);

  for (const eventName of names) {
    session.on(eventName, (event) => {
      try {
        console.log('[agent] session event', JSON.stringify({ event: eventName, data: event }));
      } catch {
        console.log('[agent] session event', String(eventName));
      }
    });
  }
}

validateConfig();
console.log('[agent] startup config ok', JSON.stringify({
  agent_name: AGENT_NAME,
  has_livekit_url: Boolean(process.env.LIVEKIT_URL),
  has_livekit_key: Boolean(process.env.LIVEKIT_API_KEY),
  has_livekit_secret: Boolean(process.env.LIVEKIT_API_SECRET),
  has_openai_key: Boolean(process.env.OPENAI_API_KEY),
  has_elevenlabs_key: Boolean(process.env.ELEVENLABS_API_KEY),
  has_elevenlabs_voice: Boolean(VOICE_ID),
  has_lemonslice_key: Boolean(process.env.LEMONSLICE_API_KEY),
  has_lemonslice_agent_id: Boolean(AGENT_ID),
  has_lemonslice_image_url: Boolean(IMAGE_URL),
}));

const INSTRUCTIONS = `Du bist Simons deutscher Voice-Agent und als sichtbarer LemonSlice-Avatar in der App zu sehen. Antworte immer Deutsch, kurz, klar, nuechtern und trocken-humorig. Maximal drei Saetze.`;

class Assistant extends voice.Agent { constructor() { super({ instructions: INSTRUCTIONS }); } }

export default defineAgent({
  entry: async (ctx) => {
    console.log('[agent] job received', JSON.stringify({ agent_name: AGENT_NAME, room: ctx.room?.name || null }));

    await ctx.connect();
    console.log('[agent] room connected', JSON.stringify({ room: ctx.room?.name || null, local_identity: ctx.room?.localParticipant?.identity || null }));

    const session = new voice.AgentSession({
      llm: new openai.LLM({ model: process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini', temperature: 0.55 }),
      stt: new openai.STT({ model: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe', language: 'de' }),
      tts: new elevenlabs.TTS({ voiceId: VOICE_ID, model: MODEL_ID, language: 'de' }),
    });

    addSessionDiagnostics(session);
    console.log('[agent] stt llm tts initialized');

    let avatarStarted = false;
    const avatarOptions = {
      agentPrompt: 'Calm German assistant with natural eye contact, subtle head movement, and neutral professional expression.',
      idleTimeout: -1,
      extraPayload: {
        aspect_ratio: '9x16',
      },
    };

    if (AGENT_ID) avatarOptions.agentId = AGENT_ID;
    else avatarOptions.agentImageUrl = IMAGE_URL;

    try {
      console.log('[agent] starting lemonslice avatar before voice session', JSON.stringify({ has_agent_id: Boolean(AGENT_ID), has_image_url: Boolean(IMAGE_URL), aspect_ratio: '9x16' }));
      const avatar = new AvatarSession(avatarOptions);
      const lemonSliceSessionId = await avatar.start(session, ctx.room, {
        livekitUrl: process.env.LIVEKIT_URL,
        livekitApiKey: process.env.LIVEKIT_API_KEY,
        livekitApiSecret: process.env.LIVEKIT_API_SECRET,
      });
      avatarStarted = true;
      console.log('[agent] lemonslice avatar started', JSON.stringify({ session_id: lemonSliceSessionId || null }));
    } catch (error) {
      console.error('[agent] lemonslice avatar failed; falling back to direct room audio', JSON.stringify(safeError(error)));
    }

    await session.start({ agent: new Assistant(), room: ctx.room });
    console.log('[agent] voice session started', JSON.stringify({ avatar_started: avatarStarted }));

    await session.generateReply({ instructions: 'Begruesse Simon kurz in einem Satz.' });
    console.log('[agent] initial reply requested');
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));

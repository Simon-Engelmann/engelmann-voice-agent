import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import { AvatarSession } from '@livekit/agents-plugin-lemonslice';

dotenv.config();

process.env.LEMONSLICE_API_KEY ||= process.env.LS_KEY || '';
process.env.ELEVENLABS_API_KEY ||= process.env.EL_KEY || '';

const AGENT_NAME = process.env.AGENT_NAME || 'engelmann-avatar';
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || process.env.EL_VOICE_ID || '';
const MODEL_ID = process.env.ELEVENLABS_MODEL || process.env.EL_MODEL_ID || 'eleven_turbo_v2_5';
const IMAGE_URL = process.env.LEMONSLICE_AGENT_IMAGE_URL || process.env.LS_AGENT_IMAGE_URL || '';
const AGENT_ID = process.env.LEMONSLICE_AGENT_ID || process.env.LS_AGENT_ID || '';

const INSTRUCTIONS = `Du bist Simons deutscher Voice-Agent und als sichtbarer LemonSlice-Avatar in der App zu sehen. Antworte immer Deutsch, kurz, klar, nuechtern und trocken-humorig. Maximal drei Saetze.`;

class Assistant extends voice.Agent {
  constructor() {
    super({ instructions: INSTRUCTIONS });
  }
}

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();

    const session = new voice.AgentSession({
      llm: new openai.LLM({ model: process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini', temperature: 0.55 }),
      stt: new openai.STT({ model: process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe', language: 'de' }),
      tts: new elevenlabs.TTS({ voiceId: VOICE_ID, model: MODEL_ID, language: 'de' }),
    });

    const avatarOptions = {
      agentPrompt: 'A calm German female assistant, natural eye contact, subtle head movement, neutral professional expression.',
      extraPayload: { aspect_ratio: '1x1', idle_timeout: -1, response_done_timeout: 0.8, simulcast: false },
    };
    if (AGENT_ID) avatarOptions.agentId = AGENT_ID;
    else avatarOptions.agentImageUrl = IMAGE_URL;

    const avatar = new AvatarSession(avatarOptions);
    await avatar.start(session, ctx.room);

    await session.start({ agent: new Assistant(), room: ctx.room });
    session.generateReply({ instructions: 'Begruesse Simon kurz in einem Satz.' });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));

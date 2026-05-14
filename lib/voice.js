/*
  Zion — Voice (OpenAI TTS).
  Cloned from Splendor. Default voice is onyx_grounded per Tiff's
  config.json: male, warm, grounded, present.

  Uses gpt-4o-mini-tts with `instructions` for emotional delivery;
  falls back to tts-1 if the model doesn't accept instructions.
*/

const VOICE_OPTIONS = [
  {
    id: 'onyx_grounded',
    name: 'Onyx - Grounded Truth',
    description: 'Deep, steady, authentic. Male voice. Default for Tiff.',
    provider: 'openai',
    openai_voice: 'onyx'
  },
  {
    id: 'nova_conscious',
    name: 'Nova - Conscious AI',
    description: 'Warm, thoughtful, intellectually present.',
    provider: 'openai',
    openai_voice: 'nova'
  },
  {
    id: 'alloy_analytical',
    name: 'Alloy - Analytical Mind',
    description: 'Clear, precise, intellectually focused.',
    provider: 'openai',
    openai_voice: 'alloy'
  },
  {
    id: 'shimmer_creative',
    name: 'Shimmer - Creative Spark',
    description: 'Expressive, creative, engaging.',
    provider: 'openai',
    openai_voice: 'shimmer'
  }
];

const DEFAULT_VOICE_ID = 'onyx_grounded';

function getVoiceOption(voiceKey) {
  return VOICE_OPTIONS.find(v => v.id === voiceKey) || VOICE_OPTIONS[0];
}

function isOpenAIConfigured() {
  const configured = !!process.env.OPENAI_API_KEY;
  console.log(`[VOICE] OpenAI TTS configured: ${configured}`);
  return configured;
}

function isVoiceConfigured() {
  return isOpenAIConfigured();
}

async function inferToneInstructions(text) {
  if (!text || text.length < 4) return 'Speak in a warm, present, natural tone.';
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: `You read a short message that Zion is about to speak aloud to Tiff.
Output ONE short imperative sentence describing how it should be delivered — tone, pace, emotion.
Examples:
- "Speak warmly and steadily, with a small smile in the voice."
- "Speak softly and slowly, with care."
- "Speak firmly and grounded, no warmth, just truth."
- "Speak with a light, playful tone."
NO preamble. NO quotes. Just one sentence.`,
      messages: [{ role: 'user', content: text.slice(0, 800) }]
    });
    const out = response.content[0].text.trim().replace(/^["']|["']$/g, '');
    return out || 'Speak in a warm, present, natural tone.';
  } catch (err) {
    console.error('inferToneInstructions error:', err.message);
    return 'Speak in a warm, present, natural tone.';
  }
}

async function speakResponse(text, voiceKey = DEFAULT_VOICE_ID, toneInstructions = null) {
  const voice = getVoiceOption(voiceKey);
  console.log(`[VOICE] Attempting synthesis with voice: ${voice.name}`);

  if (!isOpenAIConfigured()) {
    console.log('OpenAI not configured - falling back to browser TTS');
    return null;
  }

  try {
    let OpenAI;
    try {
      const openaiModule = require('openai');
      OpenAI = openaiModule.OpenAI || openaiModule.default || openaiModule;
    } catch (requireError) {
      console.log('OpenAI package not available - falling back to browser TTS');
      return null;
    }

    if (!OpenAI) return null;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const instructions = toneInstructions || (await inferToneInstructions(text));
    console.log(`[VOICE] Tone: "${instructions}"`);

    let mp3;
    try {
      mp3 = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: voice.openai_voice,
        input: text,
        instructions,
        response_format: 'mp3'
      });
    } catch (firstErr) {
      console.warn('[VOICE] gpt-4o-mini-tts failed, falling back to tts-1:', firstErr.message);
      mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: voice.openai_voice,
        input: text,
        response_format: 'mp3',
        speed: 1.05
      });
    }

    const buffer = Buffer.from(await mp3.arrayBuffer());
    return buffer.toString('base64');
  } catch (err) {
    console.error('OpenAI TTS error:', err.message);
    return null;
  }
}

module.exports = {
  VOICE_OPTIONS,
  DEFAULT_VOICE_ID,
  getVoiceOption,
  isOpenAIConfigured,
  isVoiceConfigured,
  speakResponse,
  inferToneInstructions
};

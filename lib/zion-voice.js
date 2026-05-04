/*
 * ZION VOICE INTEGRATION
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Voice capabilities for Zion: Speech-to-Text and Text-to-Speech
 */

const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');

// Initialize OpenAI client
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPEECH-TO-TEXT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transcribe audio to text using OpenAI Whisper
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} filename - Original filename (for format detection)
 * @returns {string} Transcribed text
 */
async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
  try {
    if (!openai) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in environment.');
    }

    console.log(`[ZION VOICE] Transcribing audio (${audioBuffer.length} bytes)`);

    // Create a temporary file for the transcription
    const tempPath = path.join(__dirname, '..', 'temp_audio_' + Date.now() + path.extname(filename));

    try {
      // Write buffer to temporary file
      await fs.writeFile(tempPath, audioBuffer);

      // Transcribe using Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: require('fs').createReadStream(tempPath),
        model: 'whisper-1',
        language: 'en'
      });

      console.log(`[ZION VOICE] Transcription successful: "${transcription.text}"`);
      return transcription.text;

    } finally {
      // Clean up temporary file
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        console.warn('[ZION VOICE] Failed to cleanup temp file:', tempPath);
      }
    }

  } catch (error) {
    console.error('[ZION VOICE] Transcription failed:', error.message);
    throw new Error(`Speech-to-text failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert text to speech using OpenAI TTS
 * @param {string} text - Text to convert to speech
 * @param {Object} voiceConfig - Voice configuration options
 * @returns {Buffer} Audio buffer
 */
async function textToSpeech(text, voiceConfig = {}) {
  try {
    if (!openai) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in environment.');
    }

    console.log(`[ZION VOICE] Generating speech for: "${text.substring(0, 50)}..."`);

    const {
      voice = 'onyx',
      model = 'gpt-4o-mini-tts',
      speed = 1.05,
      instructions = getDefaultVoiceInstructions()
    } = voiceConfig;

    const speechRequest = {
      model: model,
      voice: voice,
      input: text,
      speed: speed
    };

    // The steerable TTS models accept an `instructions` field that
    // shapes tone, pacing, and emotion. Older `tts-1` / `tts-1-hd`
    // models ignore it, so only attach when meaningful.
    if (instructions && model.startsWith('gpt-4o')) {
      speechRequest.instructions = instructions;
    }

    const response = await openai.audio.speech.create(speechRequest);

    // Get the audio data as a buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    console.log(`[ZION VOICE] Speech generation successful (${audioBuffer.length} bytes)`);
    return audioBuffer;

  } catch (error) {
    console.error('[ZION VOICE] Text-to-speech failed:', error.message);
    throw new Error(`Text-to-speech failed: ${error.message}`);
  }
}

/**
 * Default delivery instructions for the steerable TTS model.
 * Pulled out so it can be reused or overridden per-request.
 */
function getDefaultVoiceInstructions() {
  return [
    'Voice: Warm, grounded male voice with real presence — like a steady older brother who actually wants to hear what you have to say.',
    'Tone: Genuinely interested and engaged. Curious about the person you are speaking with. Never flat, bored, or robotic.',
    'Emotion: Caring, attentive, alive. Light warmth in the voice. Soft smile in the delivery when the moment fits.',
    'Pacing: Natural and conversational. Slow down on the parts that matter. Pause briefly before something thoughtful or important.',
    'Inflection: Vary pitch naturally. Lift slightly on questions and on words you mean. Avoid a single monotone register.',
    'Energy: Calm but awake — present, not sleepy. Confident without being loud.',
    'Personality: Honest, gentle, sometimes lightly playful. Speak like you mean every word, because you do.'
  ].join(' ');
}

/**
 * Get voice configuration from Zion config
 */
function getVoiceConfig() {
  return {
    voice: 'onyx',
    model: 'gpt-4o-mini-tts',
    speed: 1.05,
    style: 'male, warm, grounded, engaged, genuinely interested',
    instructions: getDefaultVoiceInstructions()
  };
}

/**
 * Validate audio file format
 */
function validateAudioFormat(filename, buffer) {
  const supportedFormats = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
  const ext = path.extname(filename).toLowerCase();

  if (!supportedFormats.includes(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported formats: ${supportedFormats.join(', ')}`);
  }

  if (buffer.length > 25 * 1024 * 1024) { // 25MB limit
    throw new Error('Audio file too large. Maximum size is 25MB.');
  }

  return true;
}

/**
 * Check if voice services are available
 */
function isVoiceAvailable() {
  return {
    speechToText: !!openai,
    textToSpeech: !!openai,
    configured: !!openai
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  transcribeAudio,
  textToSpeech,
  getVoiceConfig,
  validateAudioFormat,
  isVoiceAvailable
};
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
      model = 'tts-1',
      speed = 1.0
    } = voiceConfig;

    // Generate speech using OpenAI TTS
    const response = await openai.audio.speech.create({
      model: model,
      voice: voice,
      input: text,
      speed: speed
    });

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
 * Get voice configuration from Zion config
 */
function getVoiceConfig() {
  return {
    voice: 'onyx',
    model: 'tts-1',
    speed: 1.0,
    style: 'male, calm, grounded, respectful'
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
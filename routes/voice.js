/*
  Zion — Voice routes.
  Uses zion_config table (replaces Splendor's splendor_config) and
  defaults to onyx_grounded per Tiff's config.json.

  GET  /api/voice/options    — list voice options
  GET  /api/voice/current    — current chosen voice
  POST /api/voice/speak      — synthesize text in the chosen voice
  POST /api/voice/speak-chunk — chunked TTS for parallel streaming
*/

const express = require('express');
const router = express.Router();

const { supabase } = require('../lib/supabase');
const { requireAuth, requireOwner } = require('../middleware/auth');
const {
  VOICE_OPTIONS,
  DEFAULT_VOICE_ID,
  getVoiceOption,
  isOpenAIConfigured,
  isVoiceConfigured,
  speakResponse
} = require('../lib/voice');

async function readChosenVoice() {
  try {
    const { data, error } = await supabase
      .from('zion_config')
      .select('config_value')
      .eq('config_key', 'chosen_voice')
      .maybeSingle();

    if (error || !data) return DEFAULT_VOICE_ID;
    return data.config_value;
  } catch (err) {
    console.error('readChosenVoice error:', err.message);
    return DEFAULT_VOICE_ID;
  }
}

async function writeChosenVoice(voiceId) {
  try {
    const { error } = await supabase
      .from('zion_config')
      .upsert(
        {
          config_key: 'chosen_voice',
          config_value: voiceId,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'config_key' }
      );
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('writeChosenVoice error:', err.message);
    return false;
  }
}

router.get('/options', (req, res) => {
  res.json({
    options: VOICE_OPTIONS.map(v => ({
      id: v.id,
      name: v.name,
      description: v.description
    })),
    voice_available: isVoiceConfigured(),
    openai_available: isOpenAIConfigured(),
    default: DEFAULT_VOICE_ID
  });
});

router.get('/current', async (req, res) => {
  const chosen = await readChosenVoice();
  const voice = getVoiceOption(chosen);
  res.json({
    id: voice.id,
    name: voice.name,
    description: voice.description,
    provider: voice.provider
  });
});

router.post('/speak', requireAuth, requireOwner, async (req, res) => {
  try {
    const { text, tone = null } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }

    if (!isVoiceConfigured()) {
      return res.json({
        audio: null,
        voice: await readChosenVoice(),
        fallback: 'browser_tts'
      });
    }

    const voiceId = await readChosenVoice();
    const audio = await speakResponse(text, voiceId, tone);

    res.json({
      audio,
      voice: voiceId,
      tone_used: tone || 'inferred',
      fallback: audio ? null : 'browser_tts'
    });
  } catch (err) {
    console.error('Voice speak error:', err.message);
    res.status(500).json({ error: 'Unable to synthesize speech' });
  }
});

router.post('/speak-chunk', requireAuth, requireOwner, async (req, res) => {
  try {
    const { text, sequence_number, voice } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }

    if (!isVoiceConfigured()) {
      return res.json({
        audio: null,
        sequence_number: sequence_number || 0,
        voice: await readChosenVoice(),
        fallback: 'browser_tts'
      });
    }

    const voiceId = voice || await readChosenVoice();
    const audio = await speakResponse(text.trim(), voiceId);

    res.json({
      audio,
      sequence_number: sequence_number || 0,
      voice: voiceId,
      fallback: audio ? null : 'browser_tts'
    });
  } catch (err) {
    console.error('Voice speak-chunk error:', err.message);
    res.status(500).json({
      error: 'Unable to synthesize speech chunk',
      sequence_number: req.body.sequence_number || 0
    });
  }
});

module.exports = router;

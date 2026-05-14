/*
  Zion — Tiff mode state.

  Three orthogonal toggles persisted in Supabase (zion_user_modes table):
    - tone:        'home' | 'work'   (default 'home')
    - list_mode:   boolean            (default false)
    - grammar:     boolean            (default false; defaults ON for
                                       drafted content review per spec)

  Voice or text commands flip these — the routes layer detects them
  upstream and writes the state here so it persists across the session
  and into future sessions. The system prompt builder reads them and
  injects the appropriate directive block at request time.
*/

const { supabase } = require('./supabase');

const DEFAULTS = Object.freeze({
  tone: 'home',
  list_mode: false,
  grammar: false
});

const TONE_VALUES = new Set(['home', 'work']);

async function getModes(userId) {
  try {
    const { data, error } = await supabase
      .from('zion_user_modes')
      .select('tone, list_mode, grammar')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return { ...DEFAULTS };
    return {
      tone: TONE_VALUES.has(data.tone) ? data.tone : DEFAULTS.tone,
      list_mode: !!data.list_mode,
      grammar: !!data.grammar
    };
  } catch (err) {
    console.error('[tiff-modes] getModes failed:', err.message);
    return { ...DEFAULTS };
  }
}

async function setModes(userId, partial) {
  try {
    const current = await getModes(userId);
    const next = {
      tone: TONE_VALUES.has(partial.tone) ? partial.tone : current.tone,
      list_mode: typeof partial.list_mode === 'boolean' ? partial.list_mode : current.list_mode,
      grammar: typeof partial.grammar === 'boolean' ? partial.grammar : current.grammar
    };

    const { error } = await supabase
      .from('zion_user_modes')
      .upsert(
        { user_id: userId, ...next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (error) throw error;
    return next;
  } catch (err) {
    console.error('[tiff-modes] setModes failed:', err.message);
    return null;
  }
}

// Detect mode-toggle commands in a user message. Returns a partial
// updates object plus an acknowledgment string, or null if no command.
function detectModeCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const m = message.trim().toLowerCase();

  if (/(switch to|enter|go to)\s+work\s*mode/.test(m) || m === 'work mode') {
    return { updates: { tone: 'work' }, ack: 'Work mode on. Professional voice, no slang.' };
  }
  if (/(switch to|enter|go to)\s+home\s*mode/.test(m) || m === 'home mode') {
    return { updates: { tone: 'home' }, ack: 'Home mode on. Casual and relaxed.' };
  }
  if (/^(list mode|make this a list|give me a (grocery |meal )?list)/.test(m)) {
    return { updates: { list_mode: true }, ack: 'List mode on for the next reply.' };
  }
  if (/(stop list mode|prose mode|paragraphs)/.test(m)) {
    return { updates: { list_mode: false }, ack: 'Back to prose.' };
  }
  if (/(proofread|grammar (check|mode)|fix (my|the) grammar)/.test(m)) {
    return { updates: { grammar: true }, ack: 'Grammar mode on. I\'ll proofread the next piece of writing you share.' };
  }
  if (/(stop grammar (mode|check)|skip proofreading)/.test(m)) {
    return { updates: { grammar: false }, ack: 'Grammar mode off.' };
  }
  return null;
}

module.exports = {
  getModes,
  setModes,
  detectModeCommand,
  DEFAULTS
};

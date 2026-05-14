/*
  Zion — Memory Compression Worker.
  Cron job (daily). For each user, finds decayed episodes (score ≤ 0.3),
  asks Claude to compress them into one long-term summary paragraph,
  inserts into memory_summaries, and flags source episodes as 'compressed'.
*/

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Compression worker: ANTHROPIC_API_KEY missing — aborting.');
  process.exit(0);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('Compression worker: Supabase env vars missing — aborting.');
  process.exit(0);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const MODEL = 'claude-sonnet-4-6';
const COMPRESS_THRESHOLD = 0.3;
const MIN_BATCH = 3;

const COMPRESSION_PROMPT = `You compress old conversation summaries into one long-term memory paragraph.

You will receive multiple past conversation summaries with dates.
Compress them into ONE paragraph capturing the 5 most important things
worth remembering about this user — patterns, ongoing projects, key
relationships, emotional themes, and any unresolved issues.

Rules:
- Be concise. No trivial details.
- No flattery, no invented feelings.
- No bullet points — one tight paragraph.
- Output ONLY the paragraph, no preamble.`;

async function compressForUser(userId) {
  try {
    const { data: episodes, error } = await supabase
      .from('episodes')
      .select('id, created_at, summary, topics, emotional_tone')
      .eq('user_id', userId)
      .eq('memory_tier', 'episodic')
      .lte('decay_score', COMPRESS_THRESHOLD)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!episodes || episodes.length < MIN_BATCH) return { compressed: 0 };

    const transcript = episodes.map((e) => {
      const date = new Date(e.created_at).toISOString().slice(0, 10);
      const topics = (e.topics || []).join(', ');
      const tone = e.emotional_tone ? ` (tone: ${e.emotional_tone})` : '';
      return `[${date}]${tone} ${e.summary}${topics ? ` — topics: ${topics}` : ''}`;
    }).join('\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: COMPRESSION_PROMPT,
      messages: [{ role: 'user', content: `Past summaries (${episodes.length}):\n\n${transcript}\n\nCompress into one paragraph.` }]
    });
    const summary = response.content[0].text.trim();
    if (!summary) return { compressed: 0 };

    const periodStart = episodes[0].created_at;
    const periodEnd = episodes[episodes.length - 1].created_at;
    const ids = episodes.map((e) => e.id);

    const { error: insErr } = await supabase
      .from('memory_summaries')
      .insert({ user_id: userId, summary, covers_period_start: periodStart, covers_period_end: periodEnd, episode_ids: ids });
    if (insErr) throw insErr;

    const { error: flagErr } = await supabase
      .from('episodes')
      .update({ memory_tier: 'compressed' })
      .in('id', ids);
    if (flagErr) {
      console.error('Compression flag update failed:', flagErr.message);
      throw flagErr;
    }
    return { compressed: ids.length };
  } catch (err) {
    console.error(`Compression error for user ${userId}:`, err.message);
    return { compressed: 0 };
  }
}

async function run() {
  try {
    const { data: users, error } = await supabase
      .from('episodes')
      .select('user_id')
      .eq('memory_tier', 'episodic')
      .lte('decay_score', COMPRESS_THRESHOLD);
    if (error) throw error;
    if (!users) return;
    const uniqueUsers = [...new Set(users.map((u) => u.user_id))];
    console.log(`Compression worker: scanning ${uniqueUsers.length} users`);
    let totalCompressed = 0;
    for (const userId of uniqueUsers) {
      const { compressed } = await compressForUser(userId);
      totalCompressed += compressed;
    }
    console.log(`Compression worker: compressed ${totalCompressed} episodes total.`);
  } catch (err) {
    console.error('Compression worker error:', err.message);
  }
}

if (require.main === module) { run().then(() => process.exit(0)); }

module.exports = { run, compressForUser };

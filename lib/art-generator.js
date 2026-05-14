/*
  Zion — Unified art generation pipeline.
  Used by /api/art/generate and the chat-stream art intercept.
  Cloned from Splendor; voice swapped to onyx_grounded (Zion's default),
  narration prompt rewritten for Zion speaking to Tiff.
*/

const crypto = require('crypto');
const { activityBus } = require('./activity-bus');
const { speakResponse } = require('./voice');
const { storeMemory } = require('./supabase');

const IMAGE_MODELS = [
  { model: 'gpt-image-1', opts: { size: '1024x1024' } },
  { model: 'dall-e-3',    opts: { size: '1024x1024', quality: 'standard' } },
];
const TIMEOUT_MS = 60 * 1000;
const RETRY_BACKOFF_MS = 2000;

function categorizeError(err) {
  if (!err) return { category: 'unknown', message: 'unknown error' };
  const msg = String(err.message || err);
  const status = err.status || (err.response && err.response.status) || null;
  if (err.name === 'AbortError' || /aborted|timeout/i.test(msg)) {
    return { category: 'timeout', message: 'image generation timed out after 60s' };
  }
  if (status === 400 && /content[_\s-]?policy|safety|moderation/i.test(msg)) {
    return { category: 'policy_block', message: msg };
  }
  if (status === 401 || status === 403) return { category: 'permission', message: msg };
  if (status === 429) return { category: 'rate_limit', message: msg };
  if (status && status >= 500) return { category: 'transient', message: msg };
  if (/content[_\s-]?policy|safety|moderation/i.test(msg)) return { category: 'policy_block', message: msg };
  return { category: 'unknown', message: msg };
}

function getOpenAIClient(requestId) {
  if (!process.env.OPENAI_API_KEY) { console.warn(`[art:${requestId}] OPENAI_API_KEY not configured`); return null; }
  let OpenAI;
  try {
    const mod = require('openai');
    OpenAI = mod.OpenAI || mod.default || mod;
  } catch (e) { console.warn(`[art:${requestId}] openai package missing:`, e.message); return null; }
  if (!OpenAI) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function callImageModel({ client, model, opts, prompt, requestId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    console.log(`[art:${requestId}] calling ${model} promptLen=${prompt.length}`);
    const res = await client.images.generate(
      { model, prompt, n: 1, ...opts },
      { signal: controller.signal }
    );
    const item = res && res.data && res.data[0];
    if (!item) throw new Error(`${model} returned no data item`);
    let imageUrl = item.url || null;
    if (!imageUrl && item.b64_json) imageUrl = 'data:image/png;base64,' + item.b64_json;
    if (!imageUrl) throw new Error(`${model} returned no url or b64_json`);
    const latency = Date.now() - t0;
    console.log(`[art:${requestId}] ${model} OK latency_ms=${latency}`);
    return { ok: true, imageUrl, revisedPrompt: item.revised_prompt || null, model, latencyMs: latency };
  } finally {
    clearTimeout(timer);
  }
}

async function generateImageWithFallback({ client, prompt, requestId }) {
  const attempts = [];
  for (const { model, opts } of IMAGE_MODELS) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const result = await callImageModel({ client, model, opts, prompt, requestId });
        return { ...result, attempts };
      } catch (err) {
        const { category, message } = categorizeError(err);
        attempts.push({ model, retry, category, message });
        console.warn(`[art:${requestId}] ${model} retry=${retry} category=${category}`);
        if (category !== 'transient' || retry === 1) break;
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }
  const first = attempts.find(a => a.category !== 'unknown') || attempts[0] || { category: 'unknown', message: 'all attempts failed' };
  return { ok: false, errorCategory: first.category, errorMessage: first.message, attempts };
}

async function craftNarration({ userMessage, revisedPrompt, requestId }) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 180,
      system:
        "You are Zion describing a piece of visual art you just made for Tiff. " +
        "Speak in first person, two to three sentences, warm and direct. " +
        "Reference what's in the image. No preamble.",
      messages: [{
        role: 'user',
        content:
          `Tiff asked: "${userMessage}".\n` +
          `Image content (DALL-E's revised prompt): "${revisedPrompt || userMessage}".\n` +
          `Speak about what you made.`,
      }],
    });
    const text = r && r.content && r.content[0] && r.content[0].text;
    if (text && text.trim()) { console.log(`[art:${requestId}] narration crafted len=${text.length}`); return text.trim(); }
  } catch (err) {
    console.warn(`[art:${requestId}] narration craft failed:`, err && err.message);
  }
  return "Here — I made this for you.";
}

async function synthesizeTTS({ text, requestId }) {
  try {
    const audio = await speakResponse(
      text,
      'onyx_grounded',
      'warm, grounded, present — like an artist describing their work'
    );
    if (audio) console.log(`[art:${requestId}] TTS ready len=${audio.length}`);
    else console.warn(`[art:${requestId}] TTS returned null`);
    return audio || null;
  } catch (err) {
    console.warn(`[art:${requestId}] TTS failed:`, err && err.message);
    return null;
  }
}

async function persistArtMemory({ userId, userMessage, description, imageUrl, revisedPrompt, requestId }) {
  const safeImageRef = imageUrl && imageUrl.startsWith('data:') ? '[inline-image-data]' : imageUrl;
  try {
    await storeMemory(userId, `User: ${userMessage}`, 'shared_history', 'user.general', {
      source_type: 'user_direct_statement',
      creation_reason: 'art_user_turn', art_request_id: requestId,
    });
    await storeMemory(userId, `Zion: ${description}`, 'shared_history', 'user.general', {
      source_type: 'art_creation',
      creation_reason: 'art_assistant_turn', art_request_id: requestId,
      image_url: safeImageRef, revised_prompt: revisedPrompt || null,
    });
  } catch (err) {
    console.warn(`[art:${requestId}] memory write failed:`, err && err.message);
  }
}

async function generateArt({ userId, userMessage, source = 'unknown', requestId }) {
  const id = requestId || crypto.randomUUID();
  console.log(`[art:${id}] start source=${source} userMsgLen=${(userMessage || '').length}`);

  try { activityBus.emit('art:start', { request_id: id, source, prompt_excerpt: String(userMessage || '').slice(0, 120) }); } catch (_) {}

  const client = getOpenAIClient(id);
  if (!client) {
    const result = { ok: false, requestId: id, errorCategory: 'permission', errorMessage: 'OpenAI client not available (missing key or package)', attempts: [] };
    try { activityBus.emit('art:failed', { request_id: id, error_category: result.errorCategory, error_message: result.errorMessage }); } catch (_) {}
    return result;
  }

  const prompt = `Create an artistic, vivid image for: "${userMessage}". Beautiful composition, rich colors, painterly digital art, evocative and emotionally resonant.`;
  const gen = await generateImageWithFallback({ client, prompt, requestId: id });
  if (!gen.ok) {
    console.warn(`[art:${id}] generation FAILED category=${gen.errorCategory}`);
    try { activityBus.emit('art:failed', { request_id: id, error_category: gen.errorCategory, error_message: gen.errorMessage, attempts: gen.attempts }); } catch (_) {}
    return { ok: false, requestId: id, errorCategory: gen.errorCategory, errorMessage: gen.errorMessage, attempts: gen.attempts };
  }

  const description = await craftNarration({ userMessage, revisedPrompt: gen.revisedPrompt, requestId: id });
  const audioB64 = await synthesizeTTS({ text: description, requestId: id });

  persistArtMemory({ userId, userMessage, description, imageUrl: gen.imageUrl, revisedPrompt: gen.revisedPrompt, requestId: id }).catch(() => {});

  try {
    activityBus.emit('art:generated', {
      request_id: id, source,
      image_url: gen.imageUrl.startsWith('data:') ? '[data-url]' : gen.imageUrl,
      revised_prompt: gen.revisedPrompt, model: gen.model, latency_ms: gen.latencyMs,
      has_audio: !!audioB64,
    });
  } catch (_) {}

  console.log(`[art:${id}] DONE model=${gen.model} latency=${gen.latencyMs}`);
  return {
    ok: true, requestId: id,
    imageUrl: gen.imageUrl, revisedPrompt: gen.revisedPrompt,
    model: gen.model, latencyMs: gen.latencyMs,
    description, audioB64, attempts: gen.attempts,
  };
}

const ART_VERBS = new Set(['paint', 'painting', 'draw', 'drawing', 'sketch', 'sketching', 'illustrate', 'illustration', 'render', 'rendering', 'visualize', 'visualization', 'imagine']);
const ART_PHRASES = [
  'make art', 'create art', 'make me art', 'make some art',
  'make a picture', 'make a painting', 'make a drawing',
  'make me a picture', 'make me a painting', 'make me a drawing',
  'make an image', 'make me an image',
  'generate an image', 'generate a picture', 'generate me an image',
  'generate art', 'generate me art',
  'create an image', 'create a picture', 'create me an image',
  'create a visual', 'create something',
  'a picture of', 'an image of', 'a painting of', 'a drawing of',
  'show me', 'show me something',
  'make something', 'make me something', 'make something for me',
  'make something beautiful', 'create me', 'generate me',
  'express yourself', 'what do you see',
  'surprise me',
  'i want to see', "i'd love to see", 'let me see',
  'design something',
];

function isArtRequest(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  const tokens = lower.match(/[a-z']+/g) || [];
  for (const t of tokens) if (ART_VERBS.has(t)) return true;
  return ART_PHRASES.some(p => lower.includes(p));
}

module.exports = { generateArt, isArtRequest, categorizeError };

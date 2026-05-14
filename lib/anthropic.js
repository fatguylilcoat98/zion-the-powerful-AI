/*
  Zion — Anthropic client + response generator.
  Cloned from Splendor; soul doc swapped for Zion's identity.md +
  memory-seed.md (read at startup from repo root via lib/zion-soul.js).
  Tone/list/grammar modes injected per-request via system-prompt-builder.
*/

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./system-prompt-builder');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[anthropic] Missing ANTHROPIC_API_KEY — chat calls will fail until set.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'missing-key-placeholder'
});

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const generateZionResponse = async (
  userMessage,
  memories = [],
  options = {}
) => {
  try {
    const {
      modes = { tone: 'home', list_mode: false, grammar: false },
      searchResults = null,
      conversationHistory = [],
      imageData = null
    } = options;

    const system = buildSystemPrompt({ modes, memories, searchResults });

    const userContent = imageData
      ? [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
          },
          {
            type: 'text',
            text: userMessage && userMessage.length > 0 ? userMessage : 'What do you see?'
          }
        ]
      : userMessage;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        ...conversationHistory,
        { role: 'user', content: userContent }
      ]
    });

    return response.content[0].text.trim();
  } catch (error) {
    console.error('Anthropic API error:', error);
    throw new Error("I'm having trouble thinking right now — try again in a moment.");
  }
};

const streamZionResponse = async (
  userMessage,
  memories = [],
  options = {},
  onToken = () => {}
) => {
  const {
    modes = { tone: 'home', list_mode: false, grammar: false },
    searchResults = null,
    conversationHistory = [],
    imageData = null
  } = options;

  const system = buildSystemPrompt({ modes, memories, searchResults });

  const userContent = imageData
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
        },
        {
          type: 'text',
          text: userMessage && userMessage.length > 0 ? userMessage : 'What do you see?'
        }
      ]
    : userMessage;

  let fullText = '';
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [
      ...conversationHistory,
      { role: 'user', content: userContent }
    ]
  });

  stream.on('text', (text) => {
    fullText += text;
    try { onToken(text); } catch (_) {}
  });

  await stream.finalMessage();
  return fullText.trim();
};

const extractMemory = async (userMessage, zionResponse) => {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: 'You are analyzing a conversation to determine what should be remembered. Extract only the most important fact, commitment, insight, or correction from this exchange. Return a single sentence or return exactly "null" if nothing is worth storing long-term.',
      messages: [{
        role: 'user',
        content: `User said: "${userMessage}"\n\nZion responded: "${zionResponse}"\n\nWhat from this exchange is worth remembering? Return a single sentence or null.`
      }]
    });

    const memory = response.content[0].text.trim();
    return memory === 'null' ? null : memory;
  } catch (error) {
    console.error('Memory extraction error:', error);
    return null;
  }
};

module.exports = {
  generateZionResponse,
  streamZionResponse,
  extractMemory
};

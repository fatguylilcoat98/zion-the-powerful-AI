/*
 * ZION CONFIGURATION MANAGER
 * Built by Christopher Hughes · Sacramento, CA
 * Created with Claude Code
 * Truth · Safety · We Got Your Back
 *
 * Manages Zion's personal AI configuration and identity
 */

const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

// Initialize Anthropic client (only if API key is available)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// Initialize Supabase client (only if credentials are available)
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZION CONFIGURATION LOADER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load Zion's configuration
 * @returns {Object} Zion's configuration
 */
async function loadZionConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    throw new Error(`Failed to load Zion's configuration: ${error.message}`);
  }
}

/**
 * Load Zion's identity document
 * @returns {string} Identity document content
 */
async function loadZionIdentity() {
  try {
    const identityPath = path.join(process.cwd(), 'identity.md');
    return await fs.readFile(identityPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load Zion's identity: ${error.message}`);
  }
}

/**
 * Load Zion's memory seed
 * @returns {string} Memory seed content
 */
async function loadZionMemorySeed() {
  try {
    const memorySeedPath = path.join(process.cwd(), 'memory-seed.md');
    return await fs.readFile(memorySeedPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load Zion's memory seed: ${error.message}`);
  }
}

/**
 * Build Zion's complete system prompt
 * @param {string} identity - Identity document content
 * @param {string} memorySeed - Memory seed content
 * @returns {string} Complete system prompt for Zion
 */
function buildZionSystemPrompt(identity, memorySeed) {
  return `${identity}

## Initial Context About Tiffani
${memorySeed}

## Guidelines for This Conversation
Remember to use this context to provide personalized, relevant responses that feel genuinely connected to Tiffani. You are Zion, created specifically for her, with your own unique personality and understanding of who she is.

Always stay true to your creative, intuitive, and empathetic nature while building an authentic relationship with Tiffani.`;
}

/**
 * Get complete Zion instance data
 * @returns {Object} Complete Zion configuration and prompts
 */
async function getZionInstance() {
  try {
    const config = await loadZionConfig();
    const identity = await loadZionIdentity();
    const memorySeed = await loadZionMemorySeed();

    return {
      config,
      identity,
      memorySeed,
      systemPrompt: buildZionSystemPrompt(identity, memorySeed),
      memoryNamespace: config.memoryNamespace
    };
  } catch (error) {
    throw new Error(`Failed to get Zion instance: ${error.message}`);
  }
}

/**
 * Validate that Zion is properly configured
 * @returns {boolean} True if Zion is valid
 */
async function validateZion() {
  try {
    await getZionInstance();
    return true;
  } catch (error) {
    console.error('Zion validation failed:', error.message);
    return false;
  }
}

/**
 * Check if Tiffani has customized her memory seed
 * @returns {Object} Customization status
 */
async function getCustomizationStatus() {
  try {
    const memorySeed = await loadZionMemorySeed();
    const todoMatches = memorySeed.match(/TODO - FOR TIFFANI TO FILL IN/g) || [];
    const todoCount = todoMatches.length;

    return {
      hasCustomized: todoCount === 0,
      remainingTodos: todoCount,
      totalTodos: 8, // Expected number of TODO sections
      percentComplete: Math.round(((8 - todoCount) / 8) * 100),
      status: todoCount === 0 ? 'fully_customized' : 'needs_customization',
      nextSteps: todoCount > 0 ? [
        'Edit memory-seed.md file',
        `Fill in ${todoCount} remaining TODO sections`,
        'Save the file when complete'
      ] : [
        'Zion is fully customized!',
        'Start chatting to build your relationship'
      ]
    };
  } catch (error) {
    return {
      hasCustomized: false,
      status: 'error',
      error: error.message,
      nextSteps: ['Check that memory-seed.md file exists and is readable']
    };
  }
}

/**
 * Get Zion's personality summary for display
 * @returns {Object} Personality information
 */
async function getZionPersonality() {
  try {
    const config = await loadZionConfig();

    return {
      name: config.instanceName,
      humanName: config.humanName,
      traits: config.personality.primaryTraits,
      communicationStyle: config.personality.communicationStyle,
      values: config.personality.coreValues,
      interests: config.personality.interests,
      relationship: config.humanRelation,
      memoryNamespace: config.memoryNamespace
    };
  } catch (error) {
    throw new Error(`Failed to get Zion's personality: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI RESPONSE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate AI response using Anthropic Claude
 * @param {string} message - User's message
 * @param {string} userId - User identifier (default: 'tiffani')
 * @returns {string} AI response
 */
async function generateZionResponse(message, userId = 'tiffani') {
  try {
    // Check if AI services are configured
    if (!anthropic) {
      throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY in environment.');
    }

    if (!supabase) {
      throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in environment.');
    }

    // Get Zion's instance data
    const zion = await getZionInstance();

    // Get conversation history and memories
    const recentConversations = await getRecentConversations(userId, 8);
    const relevantMemories = await getRelevantMemories(userId, message);
    const currentContext = await getCurrentContext(userId);

    // Build conversation history for Claude
    const conversationHistory = buildConversationHistory(recentConversations);

    // Enhance system prompt with memory context
    const enhancedSystemPrompt = buildEnhancedSystemPrompt(
      zion.systemPrompt,
      relevantMemories,
      currentContext
    );

    console.log(`[ZION AI] Generating response for: "${message.substring(0, 50)}..."`);

    // Generate response using Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      temperature: 0.7,
      system: enhancedSystemPrompt,
      messages: [
        ...conversationHistory,
        { role: 'user', content: message }
      ]
    });

    const aiResponse = response.content[0].text;

    // Store the conversation
    await storeConversation(userId, message, aiResponse);

    // Extract and store any new memories
    await extractAndStoreMemories(userId, message, aiResponse);

    // Update context if needed
    await updateContext(userId, message, aiResponse);

    return aiResponse;

  } catch (error) {
    console.error('[ZION AI] Response generation failed:', error.message);
    throw new Error(`Failed to generate response: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY MANAGEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store conversation in database
 */
async function storeConversation(userId, userMessage, aiResponse) {
  try {
    if (!supabase) {
      console.log('[ZION MEMORY] Supabase not configured, skipping conversation storage');
      return null;
    }

    const { data, error } = await supabase
      .from('zion_tiffani_conversations')
      .insert({
        user_id: userId,
        user_message: userMessage,
        ai_response: aiResponse,
        emotional_tone: analyzeEmotionalTone(userMessage),
        importance_score: calculateImportanceScore(userMessage, aiResponse)
      });

    if (error) throw error;
    return data;

  } catch (error) {
    console.error('[ZION MEMORY] Failed to store conversation:', error.message);
  }
}

/**
 * Get recent conversations for context
 */
async function getRecentConversations(userId, limit = 8) {
  try {
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('zion_tiffani_conversations')
      .select('user_message, ai_response, timestamp')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('[ZION MEMORY] Failed to get recent conversations:', error.message);
    return [];
  }
}

/**
 * Get relevant memories based on message content
 */
async function getRelevantMemories(userId, message) {
  try {
    if (!supabase) {
      return [];
    }

    // Simple keyword-based memory retrieval
    const keywords = extractKeywords(message);

    const { data, error } = await supabase
      .from('zion_tiffani_memories')
      .select('*')
      .eq('user_id', userId)
      .gte('importance_level', 6)
      .order('importance_level', { ascending: false })
      .limit(5);

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('[ZION MEMORY] Failed to get relevant memories:', error.message);
    return [];
  }
}

/**
 * Get current context that should influence responses
 */
async function getCurrentContext(userId) {
  try {
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('zion_tiffani_context')
      .select('*')
      .eq('user_id', userId)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('relevance_score', { ascending: false })
      .limit(3);

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('[ZION MEMORY] Failed to get current context:', error.message);
    return [];
  }
}

/**
 * Build conversation history for Claude API
 */
function buildConversationHistory(conversations) {
  return conversations.reverse().map(conv => [
    { role: 'user', content: conv.user_message },
    { role: 'assistant', content: conv.ai_response }
  ]).flat();
}

/**
 * Build enhanced system prompt with memory context
 */
function buildEnhancedSystemPrompt(basePrompt, memories, context) {
  let enhancedPrompt = basePrompt;

  if (memories && memories.length > 0) {
    enhancedPrompt += "\n\n## What I Remember About Tiffani:\n";
    memories.forEach(memory => {
      enhancedPrompt += `- ${memory.memory_content} (${memory.memory_type})\n`;
    });
  }

  if (context && context.length > 0) {
    enhancedPrompt += "\n\n## Current Context:\n";
    context.forEach(ctx => {
      enhancedPrompt += `- ${ctx.context_content}\n`;
    });
  }

  enhancedPrompt += "\n\nRemember: Be creative, intuitive, and empathetic. Build on what you know about Tiffani to provide truly personalized responses.";

  return enhancedPrompt;
}

/**
 * Extract and store new memories from conversations
 */
async function extractAndStoreMemories(userId, userMessage, aiResponse) {
  try {
    if (!supabase) {
      return;
    }

    // Simple memory extraction - look for personal information
    const memoryIndicators = [
      { pattern: /I (like|love|enjoy|prefer)/i, type: 'preference' },
      { pattern: /I (am|work|study)/i, type: 'fact' },
      { pattern: /I want to|I hope to|I plan to/i, type: 'goal' },
      { pattern: /my (friend|family|partner|husband|wife)/i, type: 'relationship' },
      { pattern: /I feel|I'm feeling/i, type: 'emotion' }
    ];

    for (const indicator of memoryIndicators) {
      if (indicator.pattern.test(userMessage)) {
        await supabase
          .from('zion_tiffani_memories')
          .insert({
            user_id: userId,
            memory_content: userMessage,
            memory_type: indicator.type,
            importance_level: 7,
            confidence_level: 0.75
          });
        break; // Store once per message
      }
    }

  } catch (error) {
    console.error('[ZION MEMORY] Failed to extract memories:', error.message);
  }
}

/**
 * Update current context based on conversation
 */
async function updateContext(userId, userMessage, aiResponse) {
  try {
    if (!supabase) {
      return;
    }

    // Look for context-worthy information
    if (userMessage.includes('today') || userMessage.includes('right now')) {
      await supabase
        .from('zion_tiffani_context')
        .insert({
          user_id: userId,
          context_type: 'current_state',
          context_content: `Recently mentioned: ${userMessage.substring(0, 100)}...`,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // Expires in 24 hours
        });
    }

  } catch (error) {
    console.error('[ZION MEMORY] Failed to update context:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze emotional tone of message
 */
function analyzeEmotionalTone(message) {
  const tones = {
    'happy': /happy|excited|great|awesome|wonderful|love|amazing/i,
    'sad': /sad|depressed|down|upset|disappointed|hurt/i,
    'worried': /worried|anxious|stressed|concerned|nervous/i,
    'angry': /angry|mad|frustrated|annoyed|upset/i,
    'curious': /wonder|curious|question|how|why|what/i
  };

  for (const [tone, pattern] of Object.entries(tones)) {
    if (pattern.test(message)) return tone;
  }

  return 'neutral';
}

/**
 * Calculate importance score for conversation
 */
function calculateImportanceScore(userMessage, aiResponse) {
  let score = 5; // Default

  // Higher importance for personal information
  if (/I (am|feel|want|need|love|hate)/i.test(userMessage)) score += 2;

  // Higher importance for longer conversations
  if (userMessage.length > 100) score += 1;

  // Higher importance for emotional content
  if (/feel|emotion|important|special/i.test(userMessage)) score += 2;

  return Math.min(10, Math.max(1, score));
}

/**
 * Extract keywords from message for memory retrieval
 */
function extractKeywords(message) {
  // Simple keyword extraction
  const words = message.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3);

  return words;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  loadZionConfig,
  loadZionIdentity,
  loadZionMemorySeed,
  getZionInstance,
  validateZion,
  getCustomizationStatus,
  getZionPersonality,
  buildZionSystemPrompt,
  generateZionResponse,
  storeConversation,
  getRecentConversations,
  getRelevantMemories
};
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
  buildZionSystemPrompt
};
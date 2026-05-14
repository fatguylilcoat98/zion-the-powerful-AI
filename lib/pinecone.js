/*
  Zion — Pinecone semantic memory.
  Cloned from Splendor; INDEX_NAME default flipped to zion-memory.
  Disabled silently when PINECONE_API_KEY is missing — retrieve
  returns [] and store is a no-op so chat keeps working.
*/

const { Pinecone } = require('@pinecone-database/pinecone');
const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.PINECONE_API_KEY) {
  console.warn('PINECONE_API_KEY not found - semantic memory will be disabled');
}

const pc = process.env.PINECONE_API_KEY ? new Pinecone({ apiKey: process.env.PINECONE_API_KEY }) : null;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const INDEX_NAME = process.env.PINECONE_INDEX || 'zion-memory';

async function getIndex() {
  if (!pc) {
    throw new Error('Pinecone not configured');
  }
  return pc.index(INDEX_NAME);
}

// Simple hash-based embedding (placeholder; Splendor uses the same
// shape and treats Pinecone as a stable hash-mapped lookup until a
// real embedding provider is wired in PR 3+).
async function embed(text) {
  return createSimpleEmbedding(text);
}

async function createSimpleEmbedding(text) {
  const words = text.toLowerCase().split(/\s+/);
  const vector = new Array(1024).fill(0);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) - hash + word.charCodeAt(j)) & 0xffffffff;
    }
    const index = Math.abs(hash) % 1024;
    vector[index] += 1 / Math.sqrt(words.length);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return magnitude > 0 ? vector.map(val => val / magnitude) : vector;
}

const { stringToUUID } = require('./supabase');

async function storeMemory(memoryId, content, userId, memoryType) {
  try {
    if (!pc) return;
    const index = await getIndex();
    const vector = await embed(content);
    const uuid = stringToUUID(userId);
    await index.upsert([{
      id: memoryId,
      values: vector,
      metadata: {
        userId: uuid,
        content: content.substring(0, 500),
        memoryType,
        createdAt: new Date().toISOString()
      }
    }]);
    console.log(`Memory stored in Pinecone: ${memoryId}`);
  } catch (error) {
    console.error('Pinecone storage error:', error);
  }
}

async function storeFoundationalRule(ruleId, content, establishedDate) {
  try {
    if (!pc) return;
    const index = await getIndex();
    const vector = await embed(content);
    await index.upsert([{
      id: ruleId,
      values: vector,
      metadata: {
        userId: 'global',
        content: content,
        memoryType: 'foundational_rule',
        semanticType: 'foundational_rule',
        priority: 1000,
        neverDecays: true,
        establishedDate,
        createdAt: new Date().toISOString()
      }
    }]);
    console.log(`Foundational rule stored in Pinecone: ${ruleId}`);
  } catch (error) {
    console.error('Pinecone foundational rule storage error:', error);
  }
}

async function retrieveMemories(query, userId, topK = 5) {
  try {
    if (!pc) return [];
    const index = await getIndex();
    const vector = await embed(query);

    const foundationalResults = await index.query({
      vector,
      topK: 50,
      filter: { semanticType: 'foundational_rule' },
      includeMetadata: true
    });
    const foundationalRules = foundationalResults.matches
      .filter(m => m.metadata.neverDecays === true)
      .sort((a, b) => (b.metadata.priority || 0) - (a.metadata.priority || 0))
      .map(m => ({
        content: m.metadata.content,
        type: m.metadata.memoryType,
        score: 1.0,
        createdAt: m.metadata.createdAt,
        priority: m.metadata.priority || 0,
        foundational: true
      }));

    const uuid = stringToUUID(userId);
    const userResults = await index.query({
      vector,
      topK,
      filter: { userId: uuid },
      includeMetadata: true
    });
    const userMemories = userResults.matches
      .filter(m => m.score > 0.1 && m.metadata.semanticType !== 'foundational_rule')
      .map(m => ({
        content: m.metadata.content,
        type: m.metadata.memoryType,
        score: m.score,
        createdAt: m.metadata.createdAt,
        foundational: false
      }));

    return [...foundationalRules, ...userMemories];
  } catch (error) {
    console.error('Pinecone retrieval error:', error);
    return [];
  }
}

async function deleteMemory(memoryId) {
  try {
    if (!pc) return;
    const index = await getIndex();
    await index.deleteOne(memoryId);
  } catch (error) {
    console.error('Pinecone deletion error:', error);
  }
}

module.exports = {
  storeMemory,
  storeFoundationalRule,
  retrieveMemories,
  deleteMemory,
  isPineconeConfigured: () => !!pc
};

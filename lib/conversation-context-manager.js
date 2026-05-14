/*
  Zion — Conversation Context Manager.
  Tracks active conversation per user; surfaces context-switch info.
  Cloned from Splendor.
*/

const activeContexts = new Map();

function createConversationContext(userId, currentSpeaker = 'user') {
  return {
    userId,
    currentSpeaker,
    conversationHistory: [],
    lastInteraction: Date.now(),
    contextThread: [],
    memorySequence: 0
  };
}

function getConversationContext(userId) {
  if (!activeContexts.has(userId)) {
    activeContexts.set(userId, createConversationContext(userId));
  }
  return activeContexts.get(userId);
}

function updateConversationContext(userId, speaker, message, response) {
  const context = getConversationContext(userId);

  context.conversationHistory.push({
    sequence: context.memorySequence++,
    timestamp: Date.now(),
    speaker,
    message,
    response,
    contextTransition: speaker !== context.currentSpeaker
  });

  if (speaker !== context.currentSpeaker) {
    context.contextThread.push({
      from: context.currentSpeaker,
      to: speaker,
      timestamp: Date.now(),
      sequence: context.memorySequence
    });
  }

  context.currentSpeaker = speaker;
  context.lastInteraction = Date.now();

  if (context.conversationHistory.length > 50) {
    context.conversationHistory = context.conversationHistory.slice(-50);
  }

  activeContexts.set(userId, context);
  return context;
}

function clearConversationContext(userId) {
  activeContexts.delete(userId);
}

module.exports = {
  getConversationContext,
  updateConversationContext,
  clearConversationContext,
  createConversationContext
};

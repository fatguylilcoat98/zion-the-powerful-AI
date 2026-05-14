/*
  Zion — Supabase client + memory primitives.
  Cloned from Splendor (lib/supabase.js); branding stripped.
*/

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { activityBus } = require('./activity-bus');

let supabase;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('[supabase] Missing SUPABASE_URL / SUPABASE_ANON_KEY — using stub client (DB calls will return errors).');
  const stubError = { message: 'Supabase not configured', code: 'SUPABASE_NOT_CONFIGURED' };
  const stubBuilder = {
    select: () => stubBuilder, insert: () => stubBuilder, update: () => stubBuilder,
    delete: () => stubBuilder, upsert: () => stubBuilder, eq: () => stubBuilder,
    in: () => stubBuilder, order: () => stubBuilder, limit: () => stubBuilder,
    gte: () => stubBuilder, lte: () => stubBuilder, lt: () => stubBuilder,
    gt: () => stubBuilder, single: async () => ({ data: null, error: stubError }),
    maybeSingle: async () => ({ data: null, error: stubError }),
    then: (resolve) => resolve({ data: null, error: stubError })
  };
  supabase = {
    from: () => stubBuilder,
    auth: { getUser: async () => ({ data: { user: null }, error: stubError }) }
  };
} else {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  supabase = createClient(process.env.SUPABASE_URL, serviceKey);
}

function stringToUUID(str) {
  if (str === null || str === undefined) str = 'anonymous';
  if (typeof str !== 'string') str = String(str);
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUUID(id) {
  if (typeof id === 'string' && UUID_RE.test(id)) return id;
  return stringToUUID(id);
}

const ALLOWED_CATEGORIES = ['user.general', 'user.preferences', 'system.events'];

const RETRIEVABLE_MEMORY_TYPES = [
  'user_fact',
  'interpretation',
  'shared_history',
  'user_preference'
];

const ALLOWED_OWNERS = ['zion', 'user.general'];

const getMemoriesForUser = async (userId, limit = 10) => {
  try {
    const uuid = ensureUUID(userId);
    const { data, error } = await supabase
      .from('memory_items')
      .select('content, memory_type, created_at, category')
      .eq('user_id', uuid)
      .eq('active', true)
      .eq('approval_status', 'approved')
      .in('memory_type', RETRIEVABLE_MEMORY_TYPES)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    try { activityBus.emit('memory:read', { count: (data || []).length }); } catch (_) {}
    return data || [];
  } catch (error) {
    console.error('Error fetching memories:', error);
    return [];
  }
};

const storeMemory = async (userId, content, memoryType = 'user_fact', category = 'user.general', sourceContext = {}) => {
  try {
    const uuid = ensureUUID(userId);
    const validCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'user.general';

    const timestamp = new Date().toISOString();
    const memoryId = require('crypto').randomUUID();

    let provenance = 'zion_conversation';
    if (sourceContext.provenance) {
      provenance = sourceContext.provenance;
    } else {
      const sourceType = sourceContext.source_type || 'conversation';
      if (sourceType === 'user_direct_statement') provenance = 'USER_STATED';
      else if (sourceType === 'external_search' || sourceType === 'web_search') provenance = 'VERIFIED_FACT';
      else if (sourceType === 'system_event' || sourceType === 'system') provenance = 'SYSTEM_EVENT';
      else if (sourceType === 'generated' || sourceType === 'ai_generated') provenance = 'GENERATED';
    }

    const memoryData = {
      id: memoryId,
      user_id: uuid,
      owner: 'zion',
      content: content.trim(),
      memory_type: memoryType,
      category: validCategory,
      source_type: sourceContext.source_type || 'conversation',
      source_id: sourceContext.source_id || memoryId,
      source_metadata: {
        timestamp,
        session_id: sourceContext.session_id,
        conversation_turn: sourceContext.conversation_turn,
        extraction_method: sourceContext.extraction_method || 'automatic',
        confidence_source: sourceContext.confidence_source || 'inference'
      },
      provenance,
      confidence: sourceContext.confidence || 0.8,
      importance: sourceContext.importance || 0.5,
      active: true,
      approval_status: 'approved',
      created_at: timestamp,
      expires_at: sourceContext.expires_at || null,
      lineage: {
        created_by: 'zion',
        creation_reason: sourceContext.creation_reason || 'user_interaction',
        validation_status: 'pending'
      }
    };

    const { data, error } = await supabase
      .from('memory_items')
      .insert([memoryData])
      .select();

    if (error) throw error;
    console.log(`[MEMORY] Stored memory ${memoryId} for user ${userId}`);

    try {
      activityBus.emit('memory:write', {
        memory_type: memoryType,
        category: validCategory,
        source_type: memoryData.source_type,
        provenance
      });
    } catch (_) {}

    return data?.[0];
  } catch (error) {
    console.error('Error storing memory:', error);
    return null;
  }
};

const verifyUser = async (token) => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    return user;
  } catch (error) {
    console.error('Error verifying user:', error);
    return null;
  }
};

module.exports = {
  supabase,
  getMemoriesForUser,
  storeMemory,
  verifyUser,
  stringToUUID,
  ensureUUID,
  ALLOWED_CATEGORIES,
  ALLOWED_OWNERS
};

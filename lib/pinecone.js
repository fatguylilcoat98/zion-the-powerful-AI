/*
  Zion — Pinecone stub.

  PR 1 ships Supabase-only memory. Pinecone semantic memory lands in
  PR 2 with the consciousness layer. This stub returns no-op results
  so memory routes keep working with the same API surface.
*/

const enabled = !!process.env.PINECONE_API_KEY;

async function storeMemory(_memoryId, _content, _userId, _type) {
  if (!enabled) return null;
  return null;
}

async function deleteMemory(_memoryId) {
  if (!enabled) return null;
  return null;
}

async function searchMemories(_userId, _query, _limit) {
  return [];
}

module.exports = {
  storeMemory,
  deleteMemory,
  searchMemories
};

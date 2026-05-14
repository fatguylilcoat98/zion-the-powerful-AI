/*
  Zion — Memory routes.
  Cloned from Splendor; Pinecone path stripped (returns no-op via
  lib/pinecone.js stub in PR 1; full semantic memory lands in PR 2).
*/

const express = require('express');
const router = express.Router();
const { requireAuth, requireOwner } = require('../middleware/auth');
const { getMemoriesForUser, storeMemory, verifyUser, supabase, stringToUUID, ALLOWED_OWNERS } = require('../lib/supabase');
const { storeMemory: storePineconeMemory, deleteMemory: deletePineconeMemory } = require('../lib/pinecone');

router.get('/check', requireAuth, requireOwner, async (req, res) => {
  try {
    const { userid: userId, authtoken: authToken } = req.headers;

    if (!userId) {
      return res.status(400).json({ error: 'userId header required' });
    }

    const uuid = stringToUUID(userId);

    if (authToken) {
      const user = await verifyUser(authToken);
      if (!user || user.id !== userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { data, error } = await supabase
      .from('memory_items')
      .select('*')
      .eq('user_id', uuid)
      .in('owner', ALLOWED_OWNERS)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ count: data.length, memories: data, userId, uuid });
  } catch (err) {
    console.error('Memory check error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:userId', requireAuth, requireOwner, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot access other users data' });
    }
    const userId = req.user.id;
    const memories = await getMemoriesForUser(userId, 50);

    res.json({
      memories: memories.map(m => ({
        content: m.content,
        type: m.memory_type,
        date: m.created_at
      }))
    });
  } catch (error) {
    console.error('Memory fetch error:', error);
    res.status(500).json({ error: 'Unable to fetch memories' });
  }
});

router.post('/:userId', requireAuth, requireOwner, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot access other users data' });
    }
    const userId = req.user.id;
    const { content, type = 'general', owner = 'self' } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content required' });
    }

    const memory = await storeMemory(userId, content, type, owner);

    if (memory) {
      try {
        await storePineconeMemory(memory.id, content, userId, type);
      } catch (error) {
        console.error('Pinecone store skipped:', error.message);
      }
    }

    res.json({
      success: true,
      memory: {
        content: memory?.content,
        type: memory?.memory_type,
        owner: memory?.owner,
        date: memory?.created_at
      }
    });
  } catch (error) {
    console.error('Memory storage error:', error);
    res.status(500).json({ error: 'Unable to store memory' });
  }
});

router.delete('/:userId/:memoryId', requireAuth, requireOwner, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot access other users data' });
    }
    const userId = req.user.id;
    const { memoryId } = req.params;

    const { error } = await supabase
      .from('memory_items')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', userId);

    if (error) throw error;

    try {
      await deletePineconeMemory(memoryId);
    } catch (error) {
      console.error('Pinecone delete skipped:', error.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Memory deletion error:', error);
    res.status(500).json({ error: 'Unable to delete memory' });
  }
});

module.exports = router;

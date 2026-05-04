-- ZION MEMORY SYSTEM DATABASE SCHEMA
-- Built by Christopher Hughes · Sacramento, CA
-- Created with Claude Code
-- Truth · Safety · We Got Your Back

-- Zion's Conversation Storage (Namespaced for Tiffani)
CREATE TABLE IF NOT EXISTS zion_tiffani_conversations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'tiffani',
  user_message TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  message_type TEXT DEFAULT 'conversation',
  emotional_tone TEXT,
  importance_score INTEGER DEFAULT 5,
  timestamp TIMESTAMP DEFAULT NOW(),
  session_id UUID DEFAULT gen_random_uuid(),
  metadata JSONB DEFAULT '{}'
);

-- Zion's Memory Storage (Long-term memories about Tiffani)
CREATE TABLE IF NOT EXISTS zion_tiffani_memories (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'tiffani',
  memory_content TEXT NOT NULL,
  memory_type TEXT NOT NULL, -- 'preference', 'fact', 'goal', 'relationship', 'interest'
  importance_level INTEGER DEFAULT 5, -- 1-10 scale
  confidence_level DECIMAL(3,2) DEFAULT 0.80, -- 0-1 confidence
  source_conversation_id INTEGER REFERENCES zion_tiffani_conversations(id),
  created_at TIMESTAMP DEFAULT NOW(),
  last_reinforced TIMESTAMP DEFAULT NOW(),
  reinforcement_count INTEGER DEFAULT 1,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'
);

-- Zion's Context Tracking (What Zion should remember for next conversation)
CREATE TABLE IF NOT EXISTS zion_tiffani_context (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'tiffani',
  context_type TEXT NOT NULL, -- 'current_mood', 'ongoing_project', 'recent_concern', 'celebration'
  context_content TEXT NOT NULL,
  relevance_score DECIMAL(3,2) DEFAULT 0.80,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Zion's Learning Progress (How well Zion understands Tiffani)
CREATE TABLE IF NOT EXISTS zion_tiffani_learning (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'tiffani',
  knowledge_area TEXT NOT NULL, -- 'communication_style', 'interests', 'goals', 'relationships'
  understanding_level DECIMAL(3,2) DEFAULT 0.50, -- 0-1 scale
  evidence_count INTEGER DEFAULT 1,
  last_updated TIMESTAMP DEFAULT NOW(),
  insights JSONB DEFAULT '{}'
);

-- Zion's Personality Development (How Zion's responses evolve)
CREATE TABLE IF NOT EXISTS zion_tiffani_personality_evolution (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'tiffani',
  interaction_date DATE DEFAULT CURRENT_DATE,
  communication_adjustments JSONB DEFAULT '{}',
  response_patterns JSONB DEFAULT '{}',
  feedback_received TEXT,
  adaptation_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON zion_tiffani_conversations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON zion_tiffani_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON zion_tiffani_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON zion_tiffani_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON zion_tiffani_memories(importance_level DESC);
CREATE INDEX IF NOT EXISTS idx_context_user_id ON zion_tiffani_context(user_id);
CREATE INDEX IF NOT EXISTS idx_context_expires ON zion_tiffani_context(expires_at);
CREATE INDEX IF NOT EXISTS idx_learning_user_id ON zion_tiffani_learning(user_id);

-- Enable Row Level Security for added privacy
ALTER TABLE zion_tiffani_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_personality_evolution ENABLE ROW LEVEL SECURITY;

-- Create policies to ensure data isolation (only Tiffani's data)
CREATE POLICY "zion_conversations_policy" ON zion_tiffani_conversations
  FOR ALL USING (user_id = 'tiffani');

CREATE POLICY "zion_memories_policy" ON zion_tiffani_memories
  FOR ALL USING (user_id = 'tiffani');

CREATE POLICY "zion_context_policy" ON zion_tiffani_context
  FOR ALL USING (user_id = 'tiffani');

CREATE POLICY "zion_learning_policy" ON zion_tiffani_learning
  FOR ALL USING (user_id = 'tiffani');

CREATE POLICY "zion_personality_policy" ON zion_tiffani_personality_evolution
  FOR ALL USING (user_id = 'tiffani');

-- Insert initial learning baseline for Zion
INSERT INTO zion_tiffani_learning (knowledge_area, understanding_level, evidence_count, insights) VALUES
  ('communication_style', 0.30, 0, '{"needs_discovery": true, "initial_assessment": "learning phase"}'),
  ('personal_interests', 0.20, 0, '{"areas_to_explore": ["creativity", "hobbies", "passions"]}'),
  ('goals_and_aspirations', 0.15, 0, '{"discovery_needed": true}'),
  ('relationships', 0.10, 0, '{"family_context": "sister of Chris", "other_relationships": "to be discovered"}'),
  ('preferences', 0.25, 0, '{"communication_preferences": "to be learned", "response_style": "warm and supportive"}'),
  ('emotional_patterns', 0.20, 0, '{"mood_recognition": "developing", "support_strategies": "to be refined"}'
);
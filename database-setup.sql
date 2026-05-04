-- ZION DATABASE SCHEMA
-- Built by Christopher Hughes · Sacramento, CA
-- Created with Claude Code
-- Truth · Safety · We Got Your Back
--
-- Zion's Memory System for Tiffani

-- Chat history storage
CREATE TABLE IF NOT EXISTS zion_tiffani_conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'voice')),
    emotional_tone TEXT,
    importance_score INTEGER DEFAULT 5 CHECK (importance_score BETWEEN 1 AND 10),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    context JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Long-term memory about Tiffani
CREATE TABLE IF NOT EXISTS zion_tiffani_memories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    memory_type TEXT NOT NULL CHECK (memory_type IN ('personal', 'preference', 'relationship', 'goal', 'trigger', 'success')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    tags TEXT[],
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Current conversation context
CREATE TABLE IF NOT EXISTS zion_tiffani_context (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    context_type TEXT NOT NULL CHECK (context_type IN ('mood', 'topic', 'goal', 'challenge')),
    context_data JSONB NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

-- Learning progress tracking
CREATE TABLE IF NOT EXISTS zion_tiffani_learning (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    learning_type TEXT NOT NULL CHECK (learning_type IN ('pattern', 'preference', 'communication', 'growth')),
    observation TEXT NOT NULL,
    confidence_level INTEGER DEFAULT 5 CHECK (confidence_level BETWEEN 1 AND 10),
    reinforcement_count INTEGER DEFAULT 1,
    last_reinforced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Personality development tracking
CREATE TABLE IF NOT EXISTS zion_tiffani_personality_evolution (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trait_name TEXT NOT NULL,
    trait_value JSONB NOT NULL,
    evolution_reason TEXT,
    confidence INTEGER DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to existing tables (if they exist)
ALTER TABLE zion_tiffani_conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE zion_tiffani_conversations ADD COLUMN IF NOT EXISTS emotional_tone TEXT;
ALTER TABLE zion_tiffani_conversations ADD COLUMN IF NOT EXISTS importance_score INTEGER DEFAULT 5 CHECK (importance_score BETWEEN 1 AND 10);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user ON zion_tiffani_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON zion_tiffani_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON zion_tiffani_conversations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON zion_tiffani_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON zion_tiffani_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON zion_tiffani_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_context_session ON zion_tiffani_context(session_id);
CREATE INDEX IF NOT EXISTS idx_context_active ON zion_tiffani_context(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_learning_type ON zion_tiffani_learning(learning_type);

-- Enable Row Level Security on all tables
ALTER TABLE zion_tiffani_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE zion_tiffani_personality_evolution ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allow all for service role)
CREATE POLICY "Allow service role access" ON zion_tiffani_conversations FOR ALL USING (true);
CREATE POLICY "Allow service role access" ON zion_tiffani_memories FOR ALL USING (true);
CREATE POLICY "Allow service role access" ON zion_tiffani_context FOR ALL USING (true);
CREATE POLICY "Allow service role access" ON zion_tiffani_learning FOR ALL USING (true);
CREATE POLICY "Allow service role access" ON zion_tiffani_personality_evolution FOR ALL USING (true);

-- Insert initial memory from memory-seed.md
INSERT INTO zion_tiffani_memories (memory_type, title, content, importance, tags) VALUES
('personal', 'Core Identity', 'Tiffani is Chris''s sister. Complex person shaped by difficult experiences including mental, emotional, physical abuse, and sexual trauma. These experiences affect how she protects herself and sometimes cause her to walk away instead of confront difficult situations. Values relationships, work, and health. Wants to grow, be calmer, more gentle, and more professional. NOT defined by her past and keeps trying even when it''s hard.', 10, ARRAY['identity', 'core', 'resilience']),
('preference', 'Communication Style', 'Needs honesty without sugarcoating, but always with respect. Needs someone who is gentle but also firm. Wants help thinking clearly and making better decisions. Working on becoming more grounded, consistent, and confident. Values growth and wants to align more with her values.', 9, ARRAY['communication', 'honesty', 'respect']),
('goal', 'Personal Growth Goals', 'Becoming calmer, more gentle, and more professional. Being more grounded and consistent. Growing in confidence and decision-making. Aligning more with personal values.', 8, ARRAY['growth', 'goals', 'development']),
('trigger', 'Protective Responses', 'Past trauma affects how she protects herself. Sometimes walks away instead of confronting issues. May have difficulty following through sometimes. Doesn''t want to be overwhelmed or pushed.', 9, ARRAY['trauma-informed', 'boundaries', 'protection']);
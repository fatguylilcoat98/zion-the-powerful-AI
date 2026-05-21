-- Zion — Tiff's AI · Database Schema
-- PR 2: adds episodes, memory_summaries, proactive_messages, pending_notifications,
-- governance_audit_log. Idempotent — safe to re-run.

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);

-- ============================================================================
-- MEMORY ITEMS (Layer 1: raw turns + facts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory_items (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  owner TEXT NOT NULL DEFAULT 'zion',
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'user.general',
  source_type TEXT,
  source_id TEXT,
  source_metadata JSONB,
  provenance TEXT,
  confidence REAL DEFAULT 0.8,
  importance REAL DEFAULT 0.5,
  active BOOLEAN NOT NULL DEFAULT true,
  approval_status TEXT NOT NULL DEFAULT 'approved',
  expires_at TIMESTAMPTZ,
  lineage JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_items_user_active_idx
  ON memory_items (user_id, active, approval_status, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_items_type_idx ON memory_items (memory_type);

-- ============================================================================
-- EPISODES (Layer 2: per-day rolling summary; decays into compressed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT[],
  emotional_tone TEXT,
  memory_tier TEXT NOT NULL DEFAULT 'episodic',  -- 'episodic' | 'compressed'
  decay_score REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episodes_user_tier_idx
  ON episodes (user_id, memory_tier, decay_score, created_at);

-- ============================================================================
-- MEMORY SUMMARIES (Layer 4: long-term, written by compression worker)
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  summary TEXT NOT NULL,
  covers_period_start TIMESTAMPTZ,
  covers_period_end TIMESTAMPTZ,
  episode_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_summaries_user_idx
  ON memory_summaries (user_id, created_at DESC);

-- ============================================================================
-- ZION CONFIG / USER MODES
-- ============================================================================
CREATE TABLE IF NOT EXISTS zion_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zion_user_modes (
  user_id UUID PRIMARY KEY,
  tone TEXT NOT NULL DEFAULT 'home',
  list_mode BOOLEAN NOT NULL DEFAULT false,
  grammar BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CONVERSATIONS (turn log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx
  ON conversations (user_id, created_at DESC);

-- ============================================================================
-- PROACTIVE MESSAGES (emails Zion has decided to send)
-- ============================================================================
CREATE TABLE IF NOT EXISTS proactive_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  message_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  delivery_method TEXT,
  context_data JSONB,
  delivered BOOLEAN NOT NULL DEFAULT false,
  delivery_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proactive_messages_user_idx
  ON proactive_messages (user_id, created_at DESC);

-- ============================================================================
-- PENDING NOTIFICATIONS (in-app banner queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pending_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  delivered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_notifications_user_idx
  ON pending_notifications (user_id, delivered, created_at DESC);

-- ============================================================================
-- GOVERNANCE AUDIT LOG (CLASPION decisions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS governance_audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT,
  action_type TEXT,
  decision TEXT,
  enforcement_layer TEXT,
  user_id TEXT,
  violations JSONB,
  warnings JSONB,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS governance_audit_log_ts_idx
  ON governance_audit_log (timestamp DESC);

-- ============================================================================
-- DOCUMENTS (Document upload and management)
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  extracted_text TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS documents_category_idx ON documents (category);
CREATE INDEX IF NOT EXISTS documents_type_idx ON documents (mime_type);

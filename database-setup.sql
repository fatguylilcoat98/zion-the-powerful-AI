-- Zion — Tiff's AI · Database Schema
-- PR 1: Core auth + memory + per-user modes + config kv store.
-- PR 2 will add the 6-layer memory, continuity tables, and consciousness state.

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
-- MEMORY ITEMS
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

CREATE INDEX IF NOT EXISTS memory_items_type_idx
  ON memory_items (memory_type);

-- ============================================================================
-- ZION CONFIG (key-value, used for chosen_voice, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS zion_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ZION USER MODES (Tiff-specific tone / list / grammar toggles)
-- ============================================================================
CREATE TABLE IF NOT EXISTS zion_user_modes (
  user_id UUID PRIMARY KEY,
  tone TEXT NOT NULL DEFAULT 'home',
  list_mode BOOLEAN NOT NULL DEFAULT false,
  grammar BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CONVERSATIONS (turn log — kept simple for PR 1)
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

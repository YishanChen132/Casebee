CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  contact_handle TEXT NOT NULL,
  last_contact_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_connections (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE,
  account_email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  project_item TEXT NOT NULL,
  quote_amount INTEGER,
  expected_deadline TEXT,
  submission_deadline TEXT,
  publish_deadline TEXT,
  next_action TEXT,
  next_action_source TEXT,
  required_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  provided_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'normal',
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_at TIMESTAMPTZ,
  excluded_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cases ADD COLUMN IF NOT EXISTS submission_deadline TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS publish_deadline TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS next_action_source TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS required_materials JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS provided_materials JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cases ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  thread_id TEXT NOT NULL,
  case_id TEXT REFERENCES cases(id),
  raw_payload JSONB,
  excluded_at TIMESTAMPTZ,
  excluded_reason TEXT,
  reply_status TEXT NOT NULL DEFAULT 'no_reply_needed',
  reply_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reply_status_source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS excluded_reason TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_status TEXT NOT NULL DEFAULT 'no_reply_needed';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_status_source TEXT NOT NULL DEFAULT 'system';

CREATE TABLE IF NOT EXISTS message_reply_status_history (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_reply_status_history_message_id_changed_at
  ON message_reply_status_history (message_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS message_exclusion_rules (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_message_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, match_type, match_value)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_alerts_missing_field_active
  ON alerts (case_id, type, ((metadata->>'field')))
  WHERE resolved_at IS NULL AND type = 'missing_fields';

CREATE TABLE IF NOT EXISTS ai_extractions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  client_name TEXT,
  project_item TEXT,
  quote_amount INTEGER,
  expected_deadline TEXT,
  submission_deadline TEXT,
  publish_deadline TEXT,
  next_action TEXT,
  next_action_source TEXT,
  required_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  provided_materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent TEXT NOT NULL,
  case_status TEXT NOT NULL,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  suggested_reply TEXT NOT NULL DEFAULT '',
  model_name TEXT,
  overall_confidence NUMERIC,
  field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  inherited_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicting_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_human_review BOOLEAN NOT NULL DEFAULT false,
  review_status TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS submission_deadline TEXT;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS publish_deadline TEXT;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS next_action_source TEXT;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS required_materials JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS provided_materials JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS overall_confidence NUMERIC;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS inherited_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS conflicting_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS needs_human_review BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_extractions ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS ai_review_items (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  alert_id TEXT REFERENCES alerts(id),
  field TEXT NOT NULL,
  existing_value JSONB,
  suggested_value JSONB,
  source TEXT NOT NULL,
  is_conflict BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_review_history (
  id TEXT PRIMARY KEY,
  review_item_id TEXT NOT NULL REFERENCES ai_review_items(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  field TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value JSONB,
  suggested_value JSONB,
  final_value JSONB,
  actor TEXT NOT NULL DEFAULT 'local-user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_examples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  project_item TEXT NOT NULL,
  quote_amount INTEGER,
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  reply_example TEXT NOT NULL,
  embedding JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  case_type TEXT,
  project_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  typical_missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  quote_range_min INTEGER,
  quote_range_max INTEGER,
  success_pattern TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS case_type TEXT;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS project_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS typical_missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS quote_range_min INTEGER;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS quote_range_max INTEGER;
ALTER TABLE rag_examples ADD COLUMN IF NOT EXISTS success_pattern TEXT;

CREATE TABLE IF NOT EXISTS business_profiles (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  business_accounting_no TEXT,
  business_name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'unknown',
  status_code TEXT,
  status_desc TEXT,
  capital_amount BIGINT,
  paid_in_capital_amount BIGINT,
  responsible_name TEXT,
  registered_address TEXT,
  register_organization TEXT,
  setup_date TEXT,
  last_change_date TEXT,
  source TEXT NOT NULL DEFAULT 'mock',
  raw_payload JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_risk_scores (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  business_profile_id TEXT REFERENCES business_profiles(id),
  score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  positive_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  negative_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

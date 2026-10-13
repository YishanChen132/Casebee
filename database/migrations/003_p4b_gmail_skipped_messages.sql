CREATE TABLE IF NOT EXISTS gmail_skipped_messages (
  id TEXT PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  gmail_thread_id TEXT,
  connection_scope TEXT,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  skipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_retry_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  restored_message_id TEXT REFERENCES messages(id),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_skipped_messages_skipped_at
  ON gmail_skipped_messages (skipped_at DESC);

CREATE INDEX IF NOT EXISTS idx_gmail_skipped_messages_category
  ON gmail_skipped_messages (category);

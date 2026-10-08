CREATE TABLE IF NOT EXISTS kv_store (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS kv_store_expires_idx ON kv_store(expires_at)
  WHERE expires_at IS NOT NULL;
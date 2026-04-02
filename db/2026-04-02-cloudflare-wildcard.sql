ALTER TABLE address ADD COLUMN expires_at DATETIME;
UPDATE address
SET expires_at = datetime(created_at, '+90 day')
WHERE expires_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_address_expires_at ON address(expires_at);

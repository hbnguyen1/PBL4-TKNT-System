ALTER TABLE ai_driving_events
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(24) NULL,
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(16) NULL,
    ADD COLUMN IF NOT EXISTS reviewed_utc DATETIME(6) NULL,
    ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(20) NULL,
    ADD INDEX IF NOT EXISTS ix_ai_driving_events_type (event_type, id);

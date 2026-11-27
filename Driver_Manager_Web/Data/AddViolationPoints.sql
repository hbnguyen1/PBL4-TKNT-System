ALTER TABLE ai_driving_events
    ADD COLUMN IF NOT EXISTS points_deducted TINYINT UNSIGNED
        GENERATED ALWAYS AS (
            CASE event_type WHEN 'phone_use' THEN 3 WHEN 'drowsy' THEN 1 ELSE 0 END
        ) STORED;

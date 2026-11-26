CREATE TABLE IF NOT EXISTS ai_driving_events (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    driver_id VARCHAR(20) NOT NULL,
    vehicle_plate VARCHAR(32) NOT NULL,
    session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    captured_utc DATETIME(6) NOT NULL,
    evidence_jpeg MEDIUMBLOB NOT NULL,
    UNIQUE KEY ux_ai_driving_event (event_id),
    KEY ix_ai_driving_events_driver (driver_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

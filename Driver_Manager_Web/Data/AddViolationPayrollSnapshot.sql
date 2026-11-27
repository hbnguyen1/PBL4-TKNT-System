ALTER TABLE salarypayments
    ADD COLUMN IF NOT EXISTS disciplinary_penalty DECIMAL(18,2) NULL;

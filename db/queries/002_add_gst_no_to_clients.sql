  -- ============================================================
  -- FILE: db/migrations/002_add_gst_no_to_clients.sql
  -- Add gst_no column to clients table.
  -- ============================================================

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clients' AND column_name = 'gst_no'
    ) THEN
      ALTER TABLE clients ADD COLUMN gst_no VARCHAR(15);
      RAISE NOTICE 'Added column: clients.gst_no';
    ELSE
      RAISE NOTICE 'Column already exists, skipping: clients.gst_no';
    END IF;
  END $$;

  -- Verify
  SELECT
    column_name,
    data_type,
    is_nullable
  FROM information_schema.columns
  WHERE table_name = 'clients'
  ORDER BY ordinal_position;

-- Migration: Set up monthly partitioning for user_interaction_logs table
-- This script should be run after the initial table creation migration

-- Note: Prisma doesn't support partitioning directly, so this is a manual SQL migration
-- Run this after creating the user_interaction_logs table via Prisma migration

-- Step 1: Convert the table to a partitioned table (if not already partitioned)
-- This assumes the table already exists from Prisma migration
-- If the table is new, we can create it as partitioned from the start

-- For existing table, we would need to:
-- 1. Create a new partitioned table
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table

-- For new table (recommended approach), create as partitioned:

-- Drop the existing table if it exists (only for initial setup)
-- DROP TABLE IF EXISTS user_interaction_logs CASCADE;

-- Create partitioned table
CREATE TABLE IF NOT EXISTS user_interaction_logs (
  id BIGSERIAL NOT NULL,
  "userId" BIGINT NOT NULL,
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "interactionType" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  content TEXT,
  metadata JSONB,
  status TEXT NOT NULL,
  "errorMessage" TEXT,
  "chatId" BIGINT,
  "chatType" TEXT,
  "messageId" BIGINT,
  CONSTRAINT "user_interaction_logs_pkey" PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create indexes on the partitioned table (will be inherited by partitions)
CREATE INDEX IF NOT EXISTS "user_interaction_logs_userId_timestamp_idx" ON user_interaction_logs ("userId", timestamp);
CREATE INDEX IF NOT EXISTS "user_interaction_logs_interactionType_timestamp_idx" ON user_interaction_logs ("interactionType", timestamp);
CREATE INDEX IF NOT EXISTS "user_interaction_logs_eventType_timestamp_idx" ON user_interaction_logs ("eventType", timestamp);
CREATE INDEX IF NOT EXISTS "user_interaction_logs_timestamp_idx" ON user_interaction_logs (timestamp);

-- Add foreign key constraint
ALTER TABLE user_interaction_logs 
  ADD CONSTRAINT "user_interaction_logs_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create initial partition for current month
-- This function creates partitions automatically
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name TEXT, start_date DATE)
RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  end_date DATE;
BEGIN
  partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
  end_date := (start_date + INTERVAL '1 month')::DATE;
  
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    table_name,
    start_date,
    end_date
  );
END;
$$ LANGUAGE plpgsql;

-- Create partition for current month
SELECT create_monthly_partition('user_interaction_logs', date_trunc('month', CURRENT_DATE)::DATE);

-- Create partition for next month (pre-create)
SELECT create_monthly_partition('user_interaction_logs', (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE);

-- Function to auto-create partitions (can be called by a scheduled job)
CREATE OR REPLACE FUNCTION ensure_monthly_partitions()
RETURNS VOID AS $$
DECLARE
  current_month DATE;
  next_month DATE;
  partition_exists BOOLEAN;
BEGIN
  current_month := date_trunc('month', CURRENT_DATE)::DATE;
  next_month := (current_month + INTERVAL '1 month')::DATE;
  
  -- Check if current month partition exists
  SELECT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'user_interaction_logs_' || to_char(current_month, 'YYYY_MM')
  ) INTO partition_exists;
  
  IF NOT partition_exists THEN
    PERFORM create_monthly_partition('user_interaction_logs', current_month);
  END IF;
  
  -- Check if next month partition exists
  SELECT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'user_interaction_logs_' || to_char(next_month, 'YYYY_MM')
  ) INTO partition_exists;
  
  IF NOT partition_exists THEN
    PERFORM create_monthly_partition('user_interaction_logs', next_month);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Note: This migration should be run manually or via a migration tool
-- Prisma migrations don't support partitioning directly, so this is a post-migration step


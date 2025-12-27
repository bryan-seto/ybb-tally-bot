-- Add split percentage columns to transactions table
-- Run this SQL directly on your Supabase database

ALTER TABLE "transactions" 
ADD COLUMN IF NOT EXISTS "bryanPercentage" DOUBLE PRECISION DEFAULT 0.7,
ADD COLUMN IF NOT EXISTS "hweiYeenPercentage" DOUBLE PRECISION DEFAULT 0.3;

-- Update existing transactions to have default values if they're NULL
UPDATE "transactions" 
SET "bryanPercentage" = 0.7, "hweiYeenPercentage" = 0.3 
WHERE "bryanPercentage" IS NULL OR "hweiYeenPercentage" IS NULL;


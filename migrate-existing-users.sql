-- Migration script for existing users
-- This sets hasUsedTrial = true for existing users (Bryan and HweiYeen)
-- so they won't get free trials in new groups (they'll need to subscribe)

-- Update existing users to mark them as having used trial
-- This means any new groups they create will start as "locked" and require payment
UPDATE "users" 
SET "hasUsedTrial" = true 
WHERE "role" IN ('Bryan', 'HweiYeen') 
  AND ("hasUsedTrial" IS NULL OR "hasUsedTrial" = false);

-- Optional: If you want to set telegramId for existing users based on their role
-- (assuming Bryan's telegram ID is 109284773 and HweiYeen's is 424894363)
UPDATE "users" 
SET "telegramId" = 109284773 
WHERE "role" = 'Bryan' AND "telegramId" IS NULL;

UPDATE "users" 
SET "telegramId" = 424894363 
WHERE "role" = 'HweiYeen' AND "telegramId" IS NULL;

-- Note: Subscription status is GROUP-based, not USER-based
-- So existing users don't need a new role - they're just regular users
-- The subscription/trial logic applies to GROUPS, not individual users


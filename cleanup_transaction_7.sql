-- SQL script to clean up transaction ID 7
-- This script splits a combined transaction into separate transactions
-- 
-- STEP 1: First, check what transaction 7 looks like
SELECT 
  id,
  amount_sgd,
  currency,
  category,
  description,
  payer_id,
  date,
  "splitType",
  "isSettled",
  "createdAt",
  "updatedAt"
FROM "Transaction" 
WHERE id = 7;

-- STEP 2: Based on the query above, update the values below and run the INSERT statements
-- Replace the placeholder values with actual values from transaction 7

-- Example: If transaction 7 shows:
-- - amount_sgd: 41.74
-- - payer_id: 424894363 (Hwei Yeen)
-- - date: 2025-12-27
-- - category: Food
-- 
-- And it should be split into:
-- - Botak Porridge: 9.04
-- - Guzman y Gomez: 32.70

BEGIN;

-- Delete the combined transaction
DELETE FROM "Transaction" WHERE id = 7;

-- Create separate transaction for Botak Porridge
-- UPDATE THESE VALUES based on transaction 7:
INSERT INTO "Transaction" (
  amount_sgd, 
  currency, 
  category, 
  description, 
  payer_id, 
  date, 
  "splitType", 
  "isSettled", 
  "createdAt", 
  "updatedAt"
)
VALUES (
  9.04,                    -- Amount for Botak Porridge
  'SGD',                   -- Currency (from transaction 7)
  'Food',                  -- Category (from transaction 7, or change if different)
  'Botak Porridge',        -- Description
  424894363,               -- payer_id (from transaction 7 - replace with actual value)
  '2025-12-27'::timestamp, -- date (from transaction 7 - replace with actual value)
  'FULL',                  -- splitType (from transaction 7)
  false,                   -- isSettled (from transaction 7)
  NOW(),                   -- createdAt
  NOW()                    -- updatedAt
);

-- Create separate transaction for Guzman y Gomez
INSERT INTO "Transaction" (
  amount_sgd, 
  currency, 
  category, 
  description, 
  payer_id, 
  date, 
  "splitType", 
  "isSettled", 
  "createdAt", 
  "updatedAt"
)
VALUES (
  32.70,                   -- Amount for Guzman y Gomez
  'SGD',                    -- Currency (from transaction 7)
  'Food',                   -- Category (from transaction 7, or change if different)
  'Guzman y Gomez',         -- Description
  424894363,                -- payer_id (from transaction 7 - replace with actual value)
  '2025-12-27'::timestamp, -- date (from transaction 7 - replace with actual value)
  'FULL',                   -- splitType (from transaction 7)
  false,                    -- isSettled (from transaction 7)
  NOW(),                    -- createdAt
  NOW()                     -- updatedAt
);

-- Verify the new transactions were created
SELECT * FROM "Transaction" WHERE description IN ('Botak Porridge', 'Guzman y Gomez') ORDER BY id DESC LIMIT 2;

-- If everything looks good, commit the transaction
COMMIT;

-- If something went wrong, you can rollback:
-- ROLLBACK;


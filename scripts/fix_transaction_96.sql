-- Production Fix: Transaction /96 Verification and Fix
-- Run this in your production Supabase SQL editor

-- Step 1: Check Transaction /96 Details
SELECT 
  t.id,
  t."amountSGD",
  t."payerId",
  u.name as payer_name,
  u.role as payer_role,
  t."bryanPercentage",
  t."hweiYeenPercentage",
  t."isSettled",
  pg_typeof(t."bryanPercentage") as bryan_type,
  pg_typeof(t."hweiYeenPercentage") as hy_type
FROM transactions t
LEFT JOIN users u ON t."payerId" = u.id
WHERE t."amountSGD" = 252.55;

-- Step 2: Get HY's User ID
SELECT id, name, role FROM users WHERE role = 'HweiYeen';

-- Step 3: Fix Transaction /96 (UNCOMMENT AND RUN AFTER VERIFYING STEP 1 & 2)
-- Replace 424894363 with the actual HY user ID from Step 2
/*
UPDATE transactions 
SET 
  "bryanPercentage" = 1.0,
  "hweiYeenPercentage" = 0.0,
  "payerId" = 424894363,  -- Replace with actual HY user ID from Step 2
  "isSettled" = false
WHERE "amountSGD" = 252.55
RETURNING id, "amountSGD", "payerId", "bryanPercentage", "hweiYeenPercentage", "isSettled";
*/


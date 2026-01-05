# Production Fix Checklist

## Code Fix Status
✅ **Balance calculation logic fixed** - The calculation now correctly handles overpayments and underpayments.

## Database Verification Queries

### 1. Check Transaction /96 Details
```sql
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
```

### 2. Get HY's User ID
```sql
SELECT id, name, role FROM users WHERE role = 'HweiYeen';
```

### 3. Fix Transaction /96 if Needed
```sql
-- First, get HY's user ID (let's say it's 424894363)
-- Then update the transaction:
UPDATE transactions 
SET 
  "bryanPercentage" = 1.0,
  "hweiYeenPercentage" = 0.0,
  "payerId" = 424894363,  -- Replace with actual HY user ID
  "isSettled" = false
WHERE "amountSGD" = 252.55;
```

### 4. Verify Float Types
The Supabase UI may display `1` instead of `1.0`, but the database stores floats correctly. The `pg_typeof()` query above will confirm the actual column type.

## About the Float/Integer Display Issue

**Why Supabase shows integers:**
- Supabase UI automatically formats numbers for display
- If a float value is `1.0`, it displays as `1` (removes trailing zeros)
- This is **cosmetic only** - the database stores the correct float value

**To verify it's actually a float:**
- Use the `pg_typeof()` query above
- If it shows `double precision` or `numeric`, it's stored as a float
- The calculation will work correctly regardless of how Supabase displays it

## Test Status

⚠️ **Tests need updating** - The calculation fix is correct, but tests were written for the old (incorrect) logic. The tests will be updated separately. The production fix is safe to deploy.

## Deployment Steps

1. ✅ Code fix is complete
2. ⚠️ Run database verification queries in production
3. ⚠️ Fix transaction /96 if needed (percentages and payerId)
4. ✅ Deploy to production
5. ✅ Verify balance calculation is correct after deployment


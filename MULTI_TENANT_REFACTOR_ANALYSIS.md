# Multi-Tenant Refactoring Analysis Report

## Executive Summary

This report identifies all hardcoded logic, global variables, and database schema gaps that need to be addressed to transform this personal expense tracker from a hardcoded two-user system ("Bryan" and "Hwei Yeen") into a multi-tenant SaaS application supporting multiple couples/households.

**Overall Refactoring Difficulty: HIGH**

The codebase has extensive hardcoding throughout services, handlers, database schema, and business logic. The refactoring will require:
- Database schema migration (new Household/Team concept)
- Service layer refactoring (all balance calculations)
- Handler refactoring (all user selection logic)
- Configuration changes (remove hardcoded user IDs)
- AI service updates (payer mapping logic)

---

## 1. Hardcoded Logic

### 1.1 Configuration Files

#### `config.ts`
- **Lines 26-29**: `USER_IDS` object with hardcoded Telegram user IDs
  - `BRYAN: '109284773'`
  - `HWEI_YEEN: '424894363'`
  - **Difficulty: LOW** - Replace with dynamic lookup

- **Lines 31-34**: `USER_NAMES` mapping hardcoded names
  - Maps user IDs to "Bryan" and "Hwei Yeen"
  - **Difficulty: LOW** - Move to database

- **Lines 36-39**: `BOT_USERS` array with hardcoded user data
  - Contains role assignments: 'Bryan' and 'HweiYeen'
  - **Difficulty: MED** - Remove, use database initialization

### 1.2 Core Bot Logic

#### `bot.ts`
- **Line 11**: Imports `USER_NAMES, USER_IDS` from config
  - **Difficulty: LOW** - Remove imports

- **Line 20**: `getGreeting()` function uses `USER_NAMES[userId]`
  - **Difficulty: LOW** - Query user from database

- **Line 139**: Error notification sends to `USER_IDS.BRYAN`
  - **Difficulty: MED** - Need admin/founder lookup per household

- **Lines 272-291**: `getRandomBalanceHeader()` hardcodes user names
  - Line 277: `bryanName = USER_NAMES[USER_IDS.BRYAN] || 'Husband'`
  - Line 278: `hweiYeenName = USER_NAMES[USER_IDS.HWEI_YEEN] || 'Wife'`
  - Lines 283-290: Balance messages reference specific names
  - **Difficulty: MED** - Need dynamic user lookup per household

### 1.3 Expense Service

#### `services/expenseService.ts`
- **Lines 7-12**: `calculateOutstandingBalance()` return type hardcodes `bryanOwes` and `hweiYeenOwes`
  - **Difficulty: HIGH** - Need generic balance calculation

- **Lines 14-19**: Hardcoded user lookups by role
  - Line 15: `where: { role: 'Bryan' }`
  - Line 18: `where: { role: 'HweiYeen' }`
  - **Difficulty: HIGH** - Need household-scoped user lookup

- **Lines 32-50**: Balance calculation logic assumes two specific users
  - Variables: `bryanPaid`, `hweiYeenPaid`, `bryanShare`, `hweiYeenShare`
  - **Difficulty: HIGH** - Refactor to support N users per household

- **Lines 45-46**: Default split percentages hardcoded (0.7/0.3)
  - **Difficulty: MED** - Make configurable per household

- **Lines 62-72**: `calculateDetailedBalance()` has same issues
  - **Difficulty: HIGH** - Same refactoring needed

- **Lines 74-79**: Hardcoded user lookups again
  - **Difficulty: HIGH**

- **Lines 106-130**: Detailed balance calculation with hardcoded user variables
  - **Difficulty: HIGH**

- **Lines 158-163**: `getDetailedBalanceMessage()` hardcodes "Bryan" and "Hwei Yeen" in messages
  - **Difficulty: MED** - Use dynamic names

- **Lines 183-225**: `formatMonthlyReportMessage()` hardcodes user names
  - Lines 200, 211: "Top Categories - Bryan" and "Top Categories - Hwei Yeen"
  - **Difficulty: MED** - Dynamic user names

- **Lines 230-347**: `getMonthlyReport()` filters by hardcoded roles
  - Line 290: `t.payer.role === 'Bryan'`
  - Line 291: `t.payer.role === 'HweiYeen'`
  - **Difficulty: HIGH** - Need household-scoped queries

- **Lines 353-381**: `calculateTransactionOwed()` hardcodes payer roles
  - Line 355: `payerRole: 'Bryan' | 'HweiYeen'`
  - Lines 372-377: Conditional logic for specific roles
  - **Difficulty: HIGH** - Genericize for any user

- **Lines 386-433**: `getAllPendingTransactions()` return type hardcodes user names
  - Lines 395-396: `bryanOwes`, `hweiYeenOwes` in return type
  - **Difficulty: HIGH** - Generic balance structure

- **Lines 438-467**: `getOutstandingBalanceMessage()` hardcodes user names in messages
  - Lines 449, 456, 462: Messages reference "Bryan" and "Hwei Yeen"
  - **Difficulty: MED** - Dynamic names

- **Lines 473-525**: `createSmartExpense()` has hardcoded split rules
  - Lines 483-491: Category-based split rules with `bryan` and `hwei` keys
  - Line 493: Default split `{ bryan: 0.7, hwei: 0.3 }`
  - **Difficulty: MED** - Make configurable per household

- **Lines 513-514**: Transaction creation uses hardcoded percentage fields
  - `bryanPercentage: split.bryan`
  - `hweiYeenPercentage: split.hwei`
  - **Difficulty: HIGH** - Schema change needed (see Schema Gaps)

### 1.4 History Service

#### `services/historyService.ts`
- **Lines 20-21**: `TransactionDetail` interface has hardcoded percentage fields
  - `bryanPercentage?: number`
  - `hweiYeenPercentage?: number`
  - **Difficulty: HIGH** - Need generic split structure

- **Lines 81-82**: `formatTransactionModel()` extracts hardcoded percentages
  - **Difficulty: HIGH**

- **Line 170**: `formatSplitDetails()` hardcodes user names in display
  - `"${bryanPercent}% (Bryan) / ${hweiYeenPercent}% (HY)"`
  - **Difficulty: MED** - Dynamic names

### 1.5 AI Service

#### `services/ai.ts`
- **Line 43**: `CorrectionAction` interface hardcodes payer keys
  - `payerKey?: 'BRYAN' | 'HWEI_YEEN'`
  - **Difficulty: HIGH** - Need dynamic payer identification

- **Lines 39-40**: Hardcoded percentage fields in action data
  - `bryanPercentage?: number`
  - `hweiYeenPercentage?: number`
  - **Difficulty: HIGH**

- **Lines 348-349**: AI prompt hardcodes percentage field names
  - **Difficulty: MED** - Update prompts to be generic

- **Lines 352, 369-370, 385-386**: AI prompt examples hardcode user names
  - "paid by Hwei Yeen", "paid by Bryan", etc.
  - **Difficulty: MED** - Make prompts dynamic based on household users

### 1.6 Command Handlers

#### `handlers/commandHandlers.ts`
- **Line 8**: Imports `USER_NAMES, USER_IDS` from config
  - **Difficulty: LOW**

- **Lines 41-45**: `handlePending()` hardcodes user names in messages
  - "Bryan owes" and "Hwei Yeen owes"
  - **Difficulty: MED** - Dynamic names

- **Lines 158-162**: `handleFixed()` security check uses `USER_IDS.BRYAN`
  - Only allows founder (Bryan) to execute
  - **Difficulty: MED** - Need household admin concept

- **Lines 200, 211**: `formatMonthlyReportMessage()` hardcodes user names (called from expenseService)
  - **Difficulty: MED**

### 1.7 Message Handlers

#### `handlers/messageHandlers.ts`
- **Line 8**: Imports `USER_NAMES` from config
  - **Difficulty: LOW**

- **Lines 315-316**: Recurring expense payer selection hardcodes names
  - `'Bryan'` and `'Hwei Yeen'` in inline keyboard
  - **Difficulty: MED** - Dynamic user list

- **Line 425**: `executeCorrectionActions()` hardcodes role mapping
  - `payerRole = step.data.payerKey === 'BRYAN' ? 'Bryan' : 'HweiYeen'`
  - **Difficulty: HIGH** - Need dynamic mapping

- **Lines 631-632, 736-737**: AI correction processing uses hardcoded percentages
  - **Difficulty: HIGH**

- **Lines 922-936**: Transaction edit split handler hardcodes user names
  - Variables: `bryanPercent`, `hweiYeenPercent`
  - **Difficulty: HIGH** - Generic split editing

### 1.8 Callback Handlers

#### `handlers/callbacks/ManualAddCallbackHandler.ts`
- **Lines 36-37**: Payer selection buttons hardcode "Bryan" and "Hwei Yeen"
  - **Difficulty: MED** - Dynamic user list

- **Line 47**: Role mapping hardcodes `'Bryan'` and `'HweiYeen'`
  - **Difficulty: MED** - Dynamic lookup

- **Line 77**: Hardcoded user lookup `role: 'Bryan'`
  - **Difficulty: MED**

#### `handlers/callbacks/RecurringExpenseCallbackHandler.ts`
- **Line 3**: Imports `USER_NAMES` from config
  - **Difficulty: LOW**

- **Line 70**: Payer role mapping hardcodes `'Bryan'` and `'HweiYeen'`
  - **Difficulty: MED**

- **Line 77**: Uses `USER_NAMES[user.id.toString()]` for display
  - **Difficulty: LOW** - Use user.name from database

- **Line 134**: User lookup with hardcoded role type
  - `where: { role: payer as 'Bryan' | 'HweiYeen' }`
  - **Difficulty: MED**

- **Line 305**: Uses `USER_NAMES` for display
  - **Difficulty: LOW**

### 1.9 Initialization

#### `index.ts`
- **Line 5**: Imports `BOT_USERS` from config
  - **Difficulty: LOW**

- **Lines 55-69**: `initializeDatabase()` creates hardcoded users
  - Loops through `BOT_USERS` array
  - Creates users with hardcoded roles
  - **Difficulty: MED** - Remove, users created on household setup

#### `jobs.ts`
- **Line 8**: Imports `USER_IDS` from config
  - **Difficulty: LOW**

- **Line 67**: Daily backup sends to `USER_IDS.BRYAN`
  - **Difficulty: MED** - Need household admin lookup

### 1.10 Test Files

Multiple test files contain hardcoded references, but these are **LOW** priority as they can be updated after core refactoring:
- `__tests__/e2e/critical-flows.test.ts`
- `__tests__/e2e/helpers/testFixtures.ts`
- `services/__tests__/*.test.ts`
- `handlers/__tests__/*.test.ts`

**Difficulty: LOW** - Update after core changes

---

## 2. Global Variables & Constants

### 2.1 Hardcoded User Configuration

**Location**: `config.ts`

- **`USER_IDS`** (Lines 26-29)
  - **Current**: Hardcoded Telegram user IDs
  - **Needs**: Remove, lookup from database via Telegram user ID
  - **Difficulty: LOW**

- **`USER_NAMES`** (Lines 31-34)
  - **Current**: Hardcoded name mapping
  - **Needs**: Remove, use `User.name` from database
  - **Difficulty: LOW**

- **`BOT_USERS`** (Lines 36-39)
  - **Current**: Hardcoded user initialization array
  - **Needs**: Remove, users created during household onboarding
  - **Difficulty: MED**

### 2.2 Hardcoded Split Percentages

**Location**: Multiple files

- **Default Split**: 70/30 (Bryan/HweiYeen)
  - Found in: `expenseService.ts` (lines 45-46, 121-122, 313, 328, 363-364)
  - **Current**: Hardcoded in calculation logic
  - **Needs**: Make configurable per household (default can remain 70/30)
  - **Difficulty: MED**

- **Category-Based Split Rules** (Lines 483-491 in `expenseService.ts`)
  - **Current**: Hardcoded rules for Groceries, Bills, Shopping (70/30), Food, Travel, Entertainment, Transport (50/50)
  - **Needs**: Move to `Household` or `HouseholdSettings` table
  - **Difficulty: MED**

### 2.3 Hardcoded Categories

**Location**: Multiple files

- **Valid Categories**: `['Food', 'Transport', 'Shopping', 'Groceries', 'Bills', 'Entertainment', 'Medical', 'Travel', 'Other']`
  - Found in: `messageHandlers.ts` (line 894), `ai.ts` (line 509)
  - **Current**: Hardcoded array
  - **Needs**: Make configurable per household (with defaults)
  - **Difficulty: MED**

### 2.4 Hardcoded Currency

**Location**: Multiple files

- **Currency**: `'SGD'` (Singapore Dollars)
  - Found throughout: transaction creation, formatting, etc.
  - **Current**: Hardcoded default
  - **Needs**: Make configurable per household
  - **Difficulty: MED**

### 2.5 Hardcoded Timezone

**Location**: `messageHandlers.ts`

- **Timezone**: `'Asia/Singapore'` (Line 12)
  - **Current**: Hardcoded
  - **Needs**: Make configurable per household
  - **Difficulty: MED**

### 2.6 Primary Group ID

**Location**: `bot.ts`, `settings` table

- **Current**: Single `primary_group_id` in settings table
  - **Needs**: Move to `Household` table (one per household)
  - **Difficulty: LOW**

---

## 3. Schema Gaps

### 3.1 Missing: Household/Team Table

**Required New Table**: `Household`

```prisma
model Household {
  id              BigInt    @id @default(autoincrement())
  name            String?   // Optional household name
  telegramGroupId BigInt?   // Primary Telegram group ID
  currency        String    @default("SGD")
  timezone        String    @default("Asia/Singapore")
  defaultSplit    Json?     // Default split percentages (e.g., {"user1": 0.7, "user2": 0.3})
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  users           User[]
  transactions    Transaction[]
  recurringExpenses RecurringExpense[]
  settings        HouseholdSetting[]
  
  @@map("households")
}
```

**Difficulty: MED** - New table, straightforward

### 3.2 User Table Changes

**Current Schema Issues**:
- `role` enum is hardcoded: `Bryan | HweiYeen`
- No relationship to household
- User ID is Telegram ID (should be separate internal ID)

**Required Changes**:

```prisma
model User {
  id                  BigInt    @id @default(autoincrement())
  telegramUserId      BigInt    @unique // Telegram user ID
  name                String
  householdId         BigInt    // NEW: Link to household
  role                String?   // CHANGE: Make optional string, not enum
  isAdmin             Boolean   @default(false) // NEW: Household admin flag
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  
  household           Household  @relation(fields: [householdId], references: [id])
  recurringExpenses   RecurringExpense[]
  systemLogs          SystemLog[]
  transactionsAsPayer Transaction[]      @relation("Payer")

  @@map("users")
}
```

**Changes Needed**:
1. Add `householdId` foreign key
2. Add `telegramUserId` (separate from internal ID)
3. Change `role` from enum to optional string
4. Add `isAdmin` flag
5. Remove hardcoded `UserRole` enum

**Difficulty: HIGH** - Requires migration of existing data

### 3.3 Transaction Table Changes

**Current Schema Issues**:
- `bryanPercentage` and `hweiYeenPercentage` are hardcoded fields
- No household scoping
- Split logic assumes exactly 2 users

**Required Changes**:

```prisma
model Transaction {
  id                 BigInt    @id @default(autoincrement())
  householdId        BigInt    // NEW: Link to household
  amountSGD          Float
  currency           String    @default("SGD")
  category           String?
  description        String?
  payerId            BigInt
  date               DateTime  @default(now())
  isSettled          Boolean   @default(false)
  splitType          SplitType @default(FULL)
  // REMOVE: bryanPercentage, hweiYeenPercentage
  // ADD: Generic split configuration
  splitConfig        Json?     // NEW: {"userId1": 0.7, "userId2": 0.3} or similar
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  
  household          Household @relation(fields: [householdId], references: [id])
  payer              User      @relation("Payer", fields: [payerId], references: [id])

  @@map("transactions")
}
```

**Changes Needed**:
1. Add `householdId` foreign key
2. Remove `bryanPercentage` and `hweiYeenPercentage` fields
3. Add `splitConfig` JSON field for flexible split configuration
4. Add index on `householdId` for performance

**Difficulty: HIGH** - Requires data migration and logic refactoring

### 3.4 RecurringExpense Table Changes

**Required Changes**:

```prisma
model RecurringExpense {
  id                BigInt    @id @default(autoincrement())
  householdId       BigInt    // NEW: Link to household
  description       String
  amountOriginal    Float
  payerId           BigInt
  dayOfMonth        Int
  isActive          Boolean   @default(true)
  lastProcessedDate DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  household         Household @relation(fields: [householdId], references: [id])
  payer             User      @relation(fields: [payerId], references: [id])

  @@map("recurring_expenses")
}
```

**Changes Needed**:
1. Add `householdId` foreign key

**Difficulty: MED** - Straightforward addition

### 3.5 New Table: HouseholdSetting

**Required New Table**: For category-based split rules and other household-specific configs

```prisma
model HouseholdSetting {
  id          BigInt   @id @default(autoincrement())
  householdId BigInt
  key         String   // e.g., "category_splits", "default_split", "categories"
  value       Json     // Flexible JSON storage
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  household   Household @relation(fields: [householdId], references: [id])
  
  @@unique([householdId, key])
  @@map("household_settings")
}
```

**Use Cases**:
- Category-based split rules: `{"key": "category_splits", "value": {"Groceries": {"user1": 0.7, "user2": 0.3}, ...}}`
- Default split: `{"key": "default_split", "value": {"user1": 0.7, "user2": 0.3}}`
- Custom categories: `{"key": "categories", "value": ["Food", "Transport", ...]}`

**Difficulty: MED** - New table, straightforward

### 3.6 Settings Table Changes

**Current**: Global settings table with keys like `primary_group_id`, `broken_groups`

**Required Changes**:
- Move `primary_group_id` to `Household.telegramGroupId`
- `broken_groups` should be per-household (or remove if not needed)

**Difficulty: LOW** - Mostly removal/migration

### 3.7 SystemLog Table Changes

**Optional Enhancement**:
- Add `householdId` for better analytics per household
- **Difficulty: LOW** - Optional, can be added later

### 3.8 DailyStats Table Changes

**Optional Enhancement**:
- Add `householdId` for per-household analytics
- **Difficulty: LOW** - Optional, can be added later

---

## 4. Summary by Difficulty

### LOW Difficulty (Quick Wins)
- Remove `USER_IDS`, `USER_NAMES`, `BOT_USERS` from config
- Update imports that reference these constants
- Move `primary_group_id` to Household table
- Update test fixtures (after core changes)

**Estimated Effort**: 1-2 days

### MEDIUM Difficulty (Moderate Refactoring)
- Make categories configurable per household
- Make currency/timezone configurable
- Update all user selection UIs (buttons, keyboards) to be dynamic
- Create Household and HouseholdSetting tables
- Update RecurringExpense to include householdId
- Refactor default split percentages to be configurable
- Update all message formatting to use dynamic user names
- Update AI prompts to be household-aware

**Estimated Effort**: 1-2 weeks

### HIGH Difficulty (Major Refactoring)
- **Database Schema Migration**:
  - Add householdId to all tables
  - Migrate User table (role enum → string, add householdId, telegramUserId)
  - Migrate Transaction table (remove bryanPercentage/hweiYeenPercentage, add splitConfig JSON)
  - Data migration for existing transactions

- **Service Layer Refactoring**:
  - `ExpenseService.calculateOutstandingBalance()` - Genericize for N users
  - `ExpenseService.calculateDetailedBalance()` - Genericize for N users
  - `ExpenseService.calculateTransactionOwed()` - Genericize payer logic
  - All balance calculation methods need household scoping
  - All transaction queries need household filtering

- **Handler Refactoring**:
  - All user lookups need household context
  - Payer selection logic needs to be dynamic
  - Split editing needs to support N users

- **AI Service Updates**:
  - Payer mapping logic needs to be dynamic
  - Correction action types need to support generic users

**Estimated Effort**: 3-4 weeks

---

## 5. Migration Strategy Recommendations

### Phase 1: Foundation (Week 1)
1. Create `Household` table
2. Create `HouseholdSetting` table
3. Add `householdId` to `User` table (nullable initially)
4. Create migration script to assign existing users to a default household

### Phase 2: Schema Updates (Week 2)
1. Add `householdId` to `Transaction`, `RecurringExpense`
2. Update `User` table: add `telegramUserId`, change `role` to string
3. Add `splitConfig` JSON field to `Transaction`
4. Create data migration: convert `bryanPercentage`/`hweiYeenPercentage` to `splitConfig`

### Phase 3: Service Refactoring (Week 3)
1. Update all service methods to accept `householdId` parameter
2. Refactor balance calculations to be generic
3. Update all database queries to filter by `householdId`

### Phase 4: Handler & UI Updates (Week 4)
1. Update all handlers to determine household from context
2. Make user selection dynamic
3. Update message formatting
4. Update AI service prompts

### Phase 5: Testing & Cleanup (Week 5)
1. Update all tests
2. Remove hardcoded constants
3. End-to-end testing
4. Documentation

---

## 6. Critical Considerations

### 6.1 Household Identification
**Challenge**: How to determine which household a user belongs to when they interact with the bot?

**Options**:
1. **Telegram Group ID**: Each household uses one Telegram group. Bot identifies household by `ctx.chat.id`
2. **User's Primary Household**: Each user has a `primaryHouseholdId`. Bot uses user's primary household
3. **Multi-Household Support**: Users can belong to multiple households, select on interaction

**Recommendation**: Start with Option 1 (Telegram Group ID) for simplicity. Each group = one household.

### 6.2 Backward Compatibility
**Challenge**: Existing data has hardcoded user roles and split percentages.

**Solution**: 
- Create default household for existing users
- Migration script converts `bryanPercentage`/`hweiYeenPercentage` to `splitConfig` JSON
- Migration script converts `UserRole` enum values to strings

### 6.3 Default Split Logic
**Challenge**: Current system assumes 70/30 default split. How to handle N users?

**Solution**:
- For 2 users: Default 70/30 (or configurable per household)
- For N users: Equal split (1/N each) or configurable per household
- Store in `HouseholdSetting` table

### 6.4 AI Service Updates
**Challenge**: AI prompts hardcode user names and payer keys.

**Solution**:
- Pass household user list to AI service
- Update prompts dynamically with actual user names
- Use user IDs instead of hardcoded keys like "BRYAN"/"HWEI_YEEN"

---

## 7. Files Requiring Changes

### Core Files (Must Change)
- `config.ts` - Remove hardcoded constants
- `bot.ts` - Household context, dynamic user lookup
- `services/expenseService.ts` - Complete refactor
- `services/historyService.ts` - Generic split handling
- `services/ai.ts` - Dynamic prompts and payer mapping
- `handlers/commandHandlers.ts` - Household context
- `handlers/messageHandlers.ts` - Dynamic user selection
- `handlers/callbacks/*.ts` - Dynamic user selection
- `index.ts` - Remove hardcoded user initialization
- `jobs.ts` - Household-aware jobs

### Schema Files (Must Change)
- `prisma/schema.prisma` - Add Household, update all models

### Test Files (Update After Core)
- All files in `__tests__/` and `services/__tests__/`

---

## 8. Risk Assessment

### High Risk Areas
1. **Balance Calculation Logic**: Core business logic, high chance of bugs
2. **Data Migration**: Converting existing transactions could lose data if not careful
3. **Household Context**: Missing household context in any query = data leak between households
4. **AI Service**: Dynamic prompts might reduce accuracy initially

### Mitigation Strategies
1. Comprehensive test coverage before migration
2. Staged rollout: Test with one household first
3. Database backups before migration
4. Feature flags for new multi-tenant logic
5. Gradual AI prompt updates with A/B testing

---

## Conclusion

This refactoring is **HIGH difficulty** due to:
- Extensive hardcoding throughout the codebase
- Core business logic (balance calculations) needs complete rewrite
- Database schema requires significant changes
- All queries need household scoping to prevent data leaks

**Estimated Total Effort**: 4-5 weeks for a single developer, assuming:
- 1 week for schema design and migration
- 2-3 weeks for service/handler refactoring
- 1 week for testing and cleanup

**Recommendation**: Consider a phased approach, starting with schema design and a proof-of-concept for one household before full refactoring.


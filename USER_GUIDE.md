# 📘 Expense Bot: The Ultimate Guide

> **Quick Summary:** Your personal finance assistant for tracking expenses, splitting bills, and settling debts.

---

## ⚡ Cheatsheet (Top Commands)

| Action | Command/Example | Notes |
|--------|----------------|-------|
| Record Expense | `15 lunch` or `130 groceries` | Quick text entry - amount + description |
| Record from Receipt | Send photo(s) | AI extracts amount, merchant, category automatically |
| Check Balance | `/balance` | View current split and who owes what |
| View History | `/history` | View last 20 transactions |
| View Transaction | `/105` | Direct access by transaction ID |
| Settle Up | /settle or Button | Generates a snapshot preview to confirm clearing debts |
| Undo Entry | `Undo` Button | Available immediately after recording |
| Edit Transaction | `edit /15 20` or `@bot change amount to 20` | Two methods: command or natural language |
| Configure Splits | Tools Menu → Split Rules | Customize category-based split percentages |
| View Dashboard | `/menu` or `/start` | Main hub with balance and recent activity |

---

## 📸 Recording Expenses

Here is how to track your expenses. You have two methods:

### Method A: Receipt Scanning (Recommended)

**How it works:**
1. Take a photo of your receipt (or screenshot from banking app)
2. Send it to the chat
3. **Wait:** The AI scans for Merchant, Items, Total, and Category
4. Transaction is automatically created and your balance updates

**Pro Tips:**
- You can send **multiple photos at once!** The bot waits 10 seconds to bundle them together
- Works with paper receipts, YouTrip screenshots, banking app screenshots, or any clear image showing transaction details
- You can send multiple parts of one long receipt, or multiple receipts from the same shopping trip

**What the AI extracts:**
- Total amount
- Merchant name
- Category (Food, Transport, Groceries, etc.)
- Individual items (if visible)
- Date

**Example confirmation:**
```
✅ Recorded 1 expense:
• Starbucks Coffee: SGD $12.50 (Food)
📊 Split: User A 50% ($6.25) / User B 50% ($6.25)

💰 Balance: User A owes User B $5.20
```

### Method B: Quick Text Input

**How it works:**
Type the amount followed by what it was for. The AI will parse it automatically.

**Pattern:** `amount description`

**Examples:**
- `12.50 uber home`
- `50 groceries`
- `130 lunch at restaurant`
- `25.99 coffee`

**What happens:**
1. AI parses the amount, category, and description
2. Transaction is created with category-based default split (varies by category)
3. You see a confirmation with split details and an **Undo** button (available immediately)

**Example confirmation:**
```
🛒 Stocked up! groceries - $50.00 (Groceries)
📊 Split: User A 70% ($35.00) / User B 30% ($15.00)

💰 Balance: User B owes User A $15.00

💡 Tip: Tap 'Undo' if you made a mistake!
```

---

## ✂️ Editing & Corrections

Made a mistake? Just talk to the bot like a human. Here are two ways to fix it:

### Natural Language Editing (Easiest)

Tag the bot and tell it what to change:

**Examples:**
- `@bot split venchi 50-50` - Change split to 50/50
- `@bot change amount to 20` - Update the amount
- `@bot change category to Transport` - Change category
- `@bot change description to lunch` - Update description

**How it works:**
1. Tag the bot with `@bot` followed by your instruction
2. The AI understands your request and updates the most recent transaction
3. You see a diff view showing what changed

**Example response:**
```
✅ Updated /15

💵 Amount: $12.50 ➡️ $20.00
📝 Description: "coffee" ➡️ "lunch"
```

### Traditional Edit Commands

Use the `edit` command with transaction ID:

**Format:** `edit /<transaction_id> <new_value>`

**Examples:**
- `edit /15 20` - Change amount to $20
- `edit /15 lunch` - Change description to "lunch"
- `edit /15 Transport` - Change category to Transport

**All editable fields:**
- **Amount:** `edit /15 20` (changes to $20.00)
- **Description:** `edit /15 lunch` (changes description)
- **Category:** `edit /15 Transport` (changes category)
- **Split:** Use natural language: `@bot split 50-50`
- **Payer:** Use natural language: `@bot change payer to User A` (use your configured names)
- **Date:** Use natural language: `@bot change date to 2024-01-15`
- **Time:** Use natural language: `@bot change time to 14:30`

**Pro Tip:** Natural language editing is usually faster and more intuitive!

---

## ⚖️ Review & Settle Up

### The Dashboard

The Dashboard is your main hub. Access it with `/menu` or `/start`.

**What it shows:**
- **Balance Header:** Who owes whom and how much (e.g., "User A owes User B $25.50")
- **Recent Activity:** Last 3 transactions with status indicators
  - 🔴 = Unsettled transaction
  - ✅ = Settled transaction
- **Quick Actions:** Buttons for Settle Up, History, and Menu

**Tools Menu:**
Click **☰ Menu** to access additional tools:
- **🔍 Search** - Find transactions by keyword
- **📊 Reports** - View monthly spending reports with charts
- **🔄 Recurring** - Set up recurring expenses
- **⚙️ Split Rules** - Configure category-based split percentages
- **❓ User Guide** - Link to this documentation

**Example Dashboard:**
```
📈 Scoreboard: User B is up by $25.50

📋 Latest Activity:
/105 🔴 15 Jan - Starbucks Coffee - $12.50 - User A
/104 ✅ 14 Jan - Groceries - $50.00 - User B
/103 🔴 13 Jan - Uber - $15.00 - User A

👇 Quick Record: Send a photo or type '5 Coffee'.
💡 Tip: Made a mistake? Type 'edit /15 20' to change amount...
```

### Settling Debts

Stop guessing. The bot now uses a **Snapshot System** to ensure you never settle accidental bills.

**When to use:** End of month, end of trip, or whenever you want to clear the balance.

**How it Works:**

1. **Trigger:** Tap **💸 Settle Up** in the menu or type `/settle`.

2. **The Snapshot:** The bot freezes the current state and shows you a summary:
   ```
   Ready to settle 12 transactions for SGD $450.00?
   
   ⚠️ This will mark all unsettled transactions as paid.
   ```
   *This snapshot excludes bills added after this message.*

3. **Decide:**
   * **✅ Confirm** (or **✅ Yes, Settle**): Immediately marks those specific transactions as paid.
   * **❌ Cancel:** Aborts the process. No data is changed.

**Note:** If a friend adds a new bill *while* you are looking at the preview, it will **not** be included. You must generate a new settlement to include it.

**Understanding Category-Based Splits:**

Expenses are automatically split based on the category. Each category has a default split ratio that you can customize:

**Default Splits by Category:**
- **Groceries, Bills, Shopping:** 70% / 30% (household expenses)
- **Food, Travel, Entertainment, Transport:** 50% / 50% (personal expenses)
- **Other categories:** 70% / 30% (default fallback)

**Example calculation (Groceries at 70/30):**
- User A paid $100, User B paid $50
- Total spending: $150
- User A's share (70%): $105
- User B's share (30%): $45
- Since User A paid $100 but owes $105, **User A owes User B $5**

**Customizing Splits:**
- **Category Defaults:** Configure default splits for each category (see "⚙️ Configuring Split Rules" section below)
- **Per-Transaction Overrides:** Change the split for individual transactions using edit commands (see Editing section)

---

## ⚙️ Configuring Split Rules

Split rules let you customize how expenses are automatically divided between you and your partner for each category. This is perfect for couples with different spending patterns or shared vs personal expenses.

### Accessing Split Settings

1. Open the **Dashboard** (click `/menu` or `/start`)
2. Click **☰ Menu** button
3. Click **⚙️ Split Rules** in the Tools Menu
4. You'll see a list of all categories with their current split percentages

**Example split settings list:**
```
⚙️ Split Rules Settings

Select a category to edit:

🛒 Groceries (70/30)
🍔 Food (50/50)
💸 Bills (70/30)
🛍️ Shopping (70/30)
✈️ Travel (50/50)
🎬 Entertainment (50/50)
🚗 Transport (50/50)
🏥 Medical (70/30)
📦 Other (70/30)

« Back to Main Menu
```

### Understanding Category Defaults

Each category has a default split that applies to new expenses:

| Category | Default Split | Typical Use Case |
|----------|---------------|------------------|
| Groceries | 70% / 30% | Household essentials |
| Bills | 70% / 30% | Shared utilities |
| Shopping | 70% / 30% | Household items |
| Food | 50% / 50% | Dining out together |
| Travel | 50% / 50% | Shared trips |
| Entertainment | 50% / 50% | Shared activities |
| Transport | 50% / 50% | Commuting together |
| Medical | 70% / 30% | Health expenses |
| Other | 70% / 30% | Default fallback |

**Note:** These are just defaults. You can customize any category to match your spending patterns.

### Changing Split Percentages

When you click on a category, you'll see the edit menu with two options:

#### Method 1: Preset Buttons

Choose from common split ratios:
- **50/50** - Equal split (e.g., "User A 50% / User B 50%")
- **60/40** - Slightly weighted (e.g., "User A 60% / User B 40%")
- **70/30** - Household split (e.g., "User A 70% / User B 30%")

**Example:**
```
Editing split for **Groceries**.

Current: User A 70% / User B 30%

[User A 50% / User B 50%] [User A 60% / User B 40%]
[User A 70% / User B 30%]
[Custom Input] [« Back]
```

#### Method 2: Custom Input

For precise control, enter a custom percentage:

1. Click **Custom Input**
2. Enter User A's percentage (0-100)
3. Bot automatically calculates User B's share
4. Click **❌ Cancel** to abort

**Example:**
```
Enter User A's percentage (0-100) for **Groceries**:

[❌ Cancel]
```

Type `65` and the bot will set it to 65% / 35%.

### What Happens When You Change a Rule

**Important:** Changing a split rule only affects **NEW** expenses in that category.

- ✅ **New expenses** in that category will use the updated split
- ✅ **Existing transactions** keep their original splits (unchanged)
- ✅ You can still override per-transaction using edit commands

**Example:**
- You change Groceries from 70/30 to 60/40
- All **future** grocery expenses will use 60/40
- All **past** grocery expenses remain at 70/30
- You can still edit individual transactions to use a different split

### Example Workflow

**Scenario:** "I want Groceries to be 60/40 instead of 70/30"

1. Open Dashboard → Click **☰ Menu** → Click **⚙️ Split Rules**
2. Click **🛒 Groceries (70/30)**
3. Click **User A 60% / User B 40%** button
4. Bot confirms: "✅ Updated: User A 60% / User B 40%"
5. Returns to category list showing updated split
6. All future grocery expenses will now use 60/40 split

**Pro Tip:** Configure your most common categories first (Groceries, Food, Bills) to match your actual spending patterns!

---

## 📜 History & Auditing

### Viewing Transaction History

**Quick access:**
- Type `/history` to see a list of transactions
- Click **📜 History** button from the dashboard

**What you see:**
- **List View:** Last 20 transactions in a compact format
- **Format:** `/<id> <status> *merchant* - $amount`
  - 🔴 = Unsettled transaction
  - ✅ = Settled transaction
- **Pagination:** Use the **⬇️ Load More** button to see older transactions (20 per page)

**Example history list:**
```
📜 Transaction History

/105 🔴 15 Jan - Starbucks Coffee - $12.50 - User A
/104 ✅ 14 Jan - Groceries - $50.00 - User B
/103 🔴 13 Jan - Uber - $15.00 - User A
/102 ✅ 12 Jan - Lunch - $30.00 - User A
...
```

**Sorting:** Transactions are sorted by when they were recorded (most recent first), not by transaction date.

### Viewing Transaction Details

**How to view details:**
1. Click on any transaction ID (e.g., `/105`) from the history list
2. Or type the ID directly: `/105`

**What you see:**
- Full transaction details card showing:
  - Date and time
  - Merchant/Description
  - Amount
  - Category
  - Payer
  - Split information
  - Status (settled/unsettled)

**Action buttons available:**
- **✅ Settle** - Mark this transaction as settled (only if unsettled)
- **✨ AI Edit** - Edit using natural language
- **🗑️ Delete** - Remove this transaction
- **« Back** - Return to history list

**Example detail card:**
```
📋 Transaction /105

📅 Date: 15 Jan 2024, 14:30
🏪 Merchant: Starbucks Coffee
💵 Amount: SGD $12.50
📂 Category: Food
👤 Paid by: User A
📊 Split: User A 50% ($6.25) / User B 50% ($6.25)
🔴 Status: Unsettled
```

---

## ❓ FAQ & Troubleshooting

### Common Issues

**Q: The bot didn't reply to my photo.**
- Check your internet connection
- Wait 30 seconds - AI processing can take time
- If no reply after 30s, try sending the photo again
- Make sure the photo is clear and shows transaction details

**Q: I entered the wrong amount.**
- **Quick fix:** Use the **Undo** button immediately after recording (available for a few seconds)
- **After Undo expires:** Use `edit /<id> <correct_amount>` or `@bot change amount to <correct_amount>`

**Q: How do I change the split ratio?**
- **For a specific transaction:** Use natural language: `@bot split 50-50` or `@bot split this 60-40`. The bot will update the most recent transaction by default. To edit a specific transaction, first view it with `/105`, then use the **✨ AI Edit** button.
- **For all future expenses in a category:** Go to Tools Menu → **⚙️ Split Rules**, select the category, and choose your preferred split. This sets the default for all new expenses in that category. See the "⚙️ Configuring Split Rules" section for details.

**Q: Can I delete a transaction?**
- Yes! View the transaction detail (click the ID), then click **🗑️ Delete**
- Or use natural language: `@bot delete this` (for most recent transaction)

**Q: The bot didn't understand my edit command.**
- Make sure you're tagging the bot: `@bot <your instruction>`
- Be specific: "change amount to 20" is better than "fix it"
- Try the traditional format: `edit /15 20`

**Q: How do I see who owes what?**
- Use `/balance` command
- Or click **💸 Settle Up** to see the detailed breakdown
- The dashboard also shows a summary at the top

**Q: Can I send multiple receipts at once?**
- Yes! Send all photos within 10 seconds
- The bot will collect them and process as a batch
- Each receipt becomes a separate transaction

**Q: What if I want to record an expense manually?**
- Use quick text: `50 groceries` (fastest)
- Or use the menu: Click **☰ Menu** → **➕ Add Manual Expense** (step-by-step wizard)

**Q: How do I view older transactions?**
- Use `/history` and click **⬇️ Load More** to see older entries
- Transactions are paginated (20 per page)

**Q: What categories are available?**
- Food, Transport, Groceries, Shopping, Bills, Entertainment, Medical, Travel, Other
- The AI usually picks the right category automatically
- You can change it using edit commands

---

## 🎯 Quick Tips

1. **Record expenses immediately** after making a purchase to avoid forgetting
2. **Use photos when possible** - it's faster and more accurate than typing
3. **Settle up regularly** (e.g., weekly or monthly) to keep balances manageable
4. **Use natural language editing** - it's more intuitive than remembering command syntax
5. **Check the dashboard regularly** to stay on top of who owes what
6. **Configure default splits by category** to match your spending patterns - this saves time on individual edits

---

**Happy tracking!** 🎉

### Environment Configuration
**Priority Order:**
1. `.env.local` (Highest - Overrides everything)
2. `.env` (Fallback - Additive only)
3. Host Variables (Render/System)

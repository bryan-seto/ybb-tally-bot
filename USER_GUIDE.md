# YBB Tally Bot User Manual

Welcome to the YBB Tally Bot! This guide will help you track and manage shared expenses with ease.

## How to Record Expenses

### 📸 Quick Record (Photo/Batch Photo)

The easiest way to record expenses is by sending photos of your receipts:

1. **Single Receipt**: Simply send a photo of your receipt. The bot will automatically extract:
   - Total amount
   - Merchant name
   - Category
   - Date

2. **Multiple Receipts**: Send multiple receipt photos within 10 seconds! The bot will:
   - Collect all photos together
   - Process them as a batch
   - Create separate records for each receipt
   - Show you a summary before confirming

**Supported Receipt Types:**
- Traditional paper receipts
- YouTrip screenshots
- Banking app transaction screenshots
- Any clear image showing transaction details

**Pro Tip:** You can send multiple parts of one long receipt, or multiple receipts from the same shopping trip. Just send them all within 10 seconds!

### ➕ Manual Entry

If you prefer to enter expenses manually:

1. Tap **➕ Add Manual Expense** from the main menu
2. Enter the description (e.g., "Lunch at Restaurant")
3. Enter the amount in SGD
4. Select a category from the buttons:
   - 🍔 Food
   - 🚗 Transport
   - 🛒 Groceries
   - 🏠 Utilities
   - 🎬 Entertainment
   - 🛍️ Shopping
   - 🏥 Medical
   - ✈️ Travel
5. Select who paid (Bryan or Hwei Yeen)

The bot will confirm the entry and show you the transaction details.

## Settling Up

### Understanding the 70/30 Split

All expenses are automatically split:
- **Bryan**: 70% of total expenses
- **Hwei Yeen**: 30% of total expenses

### How to Settle

1. Tap **✅ Settle Up** from the main menu
2. The bot will show you who owes whom and the amount
3. Confirm by tapping **✅ Yes, Settle**
4. All unsettled transactions will be marked as settled
5. The balance will reset to $0

**Example:**
- If Bryan paid $100 and Hwei Yeen paid $50, total spending is $150
- Bryan's share (70%): $105
- Hwei Yeen's share (30%): $45
- Since Bryan paid $100 but owes $105, Bryan owes Hwei Yeen $5

## Viewing Transaction History

Tap **📜 History** from the main menu to view your complete transaction history:

- **List View**: See the last 20 transactions in a compact format
- **Format**: Each transaction shows as `/<id> <status> *merchant* - $amount`
  - 🔴 = Unsettled transaction
  - ✅ = Settled transaction
- **Pagination**: Use the **⬇️ Load More** button to see older transactions
- **Transaction Details**: Click on any transaction ID (e.g., `/101`) to see:
  - Full transaction details (date, merchant, amount, category, payer)
  - Action buttons: **✅ Settle**, **✏️ Edit**, **🗑️ Delete**

**Sorting**: Transactions are sorted by when they were recorded (most recent first), not by transaction date.

## Viewing Unsettled Transactions

Tap **🧾 View Unsettled** to see:
- The last 10 unsettled transactions
- Date, description, amount, and payer for each
- Total count of all unsettled transactions

This helps you keep track of what still needs to be settled.

## Checking Balance

Tap **💰 Check Balance** to see:
- Total paid by Bryan (unsettled)
- Total paid by Hwei Yeen (unsettled)
- Total group spending
- The 70/30 split calculation
- Final net result (who owes whom)

## Recurring Expenses

Set up expenses that repeat monthly:

1. Tap **🔄 Recurring** from the main menu
2. Select **➕ Add New**
3. Enter:
   - Description (e.g., "Internet Bill")
   - Amount in SGD
   - Day of month (1-31) when it should be processed
   - Who pays
4. The expense will be automatically added on the specified day each month at 09:00 SGT

**View Active**: See all your active recurring expenses

**Remove**: Delete a recurring expense when it's no longer needed

## Monthly Reports

Tap **📊 Reports** to generate a monthly spending report showing:
- Total spending for the month
- Number of transactions
- Breakdown by payer
- Top spending categories
- Visual chart

## Commands

While the bot primarily uses buttons for navigation, you can also use these commands:

- `/start` - Show the main menu
- `/help` - Show the main menu
- `/balance` - Check outstanding balance
- `/history` - View transaction history
- `/pending` - View all unsettled transactions
- `/settle` - Mark all expenses as settled
- `/report` - Generate monthly report (use `/report 1` for last month)
- `/recurring` - Manage recurring expenses

## Tips & Best Practices

1. **Record expenses immediately** after making a purchase to avoid forgetting
2. **Use photos when possible** - it's faster and more accurate
3. **Settle up regularly** (e.g., weekly or monthly) to keep balances manageable
4. **Set up recurring expenses** for bills that happen every month
5. **Check balance regularly** to stay on top of who owes what

## Need Help?

If you encounter any issues or have questions, feel free to ask in the group chat or check the bot's responses for guidance.

---

**Happy tracking!** 🎉


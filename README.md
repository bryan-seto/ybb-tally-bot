# YBB Tally Bot

A private Telegram bot for managing shared expenses (70/30 split) between Bryan and Hwei Yeen in Singapore.

## Features

- 📸 **AI-Powered Receipt Processing**: Send receipt photos and the bot extracts expense details using Google Gemini 2.5 Flash AI
  - Supports traditional receipts, YouTrip screenshots, and banking app transaction lists
  - **Multi-Photo Support**: Send multiple receipt photos within 10 seconds - they'll be collected and processed together!
  - Automatically detects if photos are parts of one receipt or multiple different receipts
- 💰 **Automatic Split Calculation**: 70/30 split (Bryan 70%, Hwei Yeen 30%)
- 📊 **Analytics Dashboard**: Track daily active users, receipt processing latency, peak hours, and spend velocity
- 🔄 **Recurring Expenses**: Automatically process recurring bills on specified days
- 📈 **Monthly Reports**: Generate custom monthly reports anytime with spending breakdowns and visual charts
- 🔒 **Security**: Only authorized users can access the bot
- 🎯 **Interactive Buttons**: Streamlined confirmation flow with inline keyboard buttons

## Tech Stack

- **Runtime**: Node.js (Latest LTS) with TypeScript
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **Bot Framework**: Telegraf
- **AI**: Google Gemini 2.5 Flash
- **Scheduling**: node-cron
- **Analytics**: QuickChart.js
- **Date Handling**: date-fns with date-fns-tz (Asia/Singapore timezone)

## Setup Instructions

### 1. Prerequisites

- Node.js (Latest LTS version)
- PostgreSQL database (Supabase)
- Telegram Bot Token
- Google Gemini API Key

### 2. Installation

```bash
# Clone or navigate to the project directory
cd ybb-tally-bot

# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate
```

### 3. Environment Configuration

#### Production Setup

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

**Important**: Replace `[YOUR_PASSWORD]` in `DATABASE_URL` with your actual Supabase database password.

#### Local Development Setup

For local development, create `.env.local` (this file is gitignored):

```bash
cp .env.local.example .env.local
```

**Required Environment Variables for `.env.local`:**

```env
# Required - User IDs (must be numeric strings)
USER_A_ID=109284773
USER_A_NAME=Bryan
USER_B_ID=424894363
USER_B_NAME=Hwei Yeen

# Required - Bot Configuration
TELEGRAM_BOT_TOKEN=your_dev_bot_token
GEMINI_API_KEY=your_gemini_key
BACKUP_RECIPIENT_ID=109284773

# Required - Database (local Docker)
DATABASE_URL=postgresql://postgres:password@localhost:5432/ybb_tally_bot

# Optional
NODE_ENV=development
PORT=10001
WEBHOOK_URL=
SENTRY_DSN=
ALLOWED_USER_IDS=
```

⚠️ **Security:** `.env.local` is gitignored. Never commit personal IDs or tokens.

**Starting Local Development:**

```bash
# Start local database (Docker)
npm run db:local:up

# Initialize database schema
npm run db:local:init

# Start bot in local mode
npm run dev:local
```

**Note:** The bot uses strict environment variable validation. If required variables are missing or invalid, the application will fail fast on startup with descriptive error messages.

### 4. Database Setup

```bash
# Run Prisma migrations
npm run prisma:migrate

# (Optional) Open Prisma Studio to view data
npm run prisma:studio
```

### 5. Run the Bot

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

## Usage

### Commands

- `/start` - Register the bot in a group chat
- `/add` - Manually add an expense
- `/balance` - Check outstanding balance
- `/recurring` - Manage recurring expenses
- `/report [offset]` - Generate monthly report (default: current month)
- `/admin_stats` - View analytics (admin only)
- `/help` - Show help message with all features

### Adding Expenses

1. **Via Receipt Photo(s)**: 
   - **Single Receipt**: Send a photo of a receipt. The bot will extract details and ask for confirmation.
   - **Multiple Receipts**: Send multiple receipt photos within 10 seconds! The bot will:
     - Collect all photos during a 10-second window
     - Process them together as a batch
     - Show a summary with all merchants and the grand total
     - Perfect for multiple parts of one long receipt or multiple receipts from the same trip
   
   The bot supports:
   - Traditional paper receipts
   - YouTrip transaction screenshots
   - Banking app transaction lists
   - Any expense-related image

2. **Manual Entry**: Use `/add` command and follow the prompts

### Recurring Expenses

Add recurring bills that process automatically:
```
/recurring add "Internet Bill" 50 15 bryan
```
- Description: Name of the expense (use quotes if it contains spaces)
- Amount: Amount in SGD
- Day: Day of month (1-31) when to process
- Payer: "bryan" or "hweiyeen"

Recurring expenses are automatically processed on the specified day each month at 09:00 SGT.

### Monthly Reports

Generate custom monthly reports anytime:
- `/report` - Current month's report
- `/report 1` - Last month's report
- `/report 2` - 2 months ago

Reports include:
- Total spending breakdown
- Spending by payer (Bryan vs Hwei Yeen)
- Top 5 spending categories
- Visual chart via QuickChart

### User Roles

- **Bryan** (User ID: 109284773) - Referred to as "Sir Bryan"
- **Hwei Yeen** (User ID: 424894363) - Referred to as "Madam Hwei Yeen"

## Cron Jobs

The bot runs several automated tasks:

1. **Daily Stats** (00:00 SGT): Calculates analytics for the previous day
2. **Recurring Expenses** (09:00 SGT): Processes recurring bills
3. **Monthly Report** (1st of month, 09:00 SGT): Sends monthly summary with charts

## Database Schema

- `User`: Stores user information
- `Transaction`: Expense records
- `RecurringExpense`: Recurring bill configurations
- `Settings`: Bot settings (e.g., primary group ID)
- `SystemLog`: Interaction and performance logs
- `DailyStats`: Aggregated daily analytics

## Key Features Explained

### Multi-Photo Receipt Processing

The bot implements a smart 10-second "waiting room" for receipt photos:

1. **Send First Photo**: Bot shows "📥 Collecting receipts... (1 photo received)"
2. **Send More Photos**: Each new photo resets the 10-second timer and updates the count
3. **After 10 Seconds**: All collected photos are processed together
4. **AI Analysis**: Gemini analyzes all images together:
   - If they're parts of one receipt → combines into single total
   - If they're different receipts → sums all totals and lists all merchants
5. **Single Confirmation**: One unified confirmation with breakdown and total

**Pro Tip**: Perfect for long receipts that need multiple photos, or batch processing multiple receipts from one shopping trip!

### Timezone

**CRITICAL**: All dates and times use `Asia/Singapore` timezone. This is hardcoded throughout the application using `date-fns-tz`.

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Build TypeScript
npm run build

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start

# Open Prisma Studio (database GUI)
npm run prisma:studio
```

## Testing

### E2E Testing

We use a real database integration strategy for critical flows. The E2E test suite covers the top 5 critical user flows with full integration testing (handlers → services → database).

**Setup:**
- Ensure your test database is running (uses `TEST_DATABASE_URL` or a test database derived from `DATABASE_URL`)
- The tests use a real PostgreSQL database (matching production schema)

**Run:**
```bash
npm run test:e2e
```

**Test Coverage:**
- Flow 1: Record Expense via Receipt Photo (with 10s batching window)
- Flow 2: Record Expense via Quick Text Input
- Flow 3: View Balance and Settle Up
- Flow 4: View Transaction History and Details
- Flow 5: Edit/Correct Transactions (AI-powered)

**Architecture:**
- Real PostgreSQL database (no mocks)
- Mocked AI service (deterministic responses)
- Mocked Telegram API
- Fake timers for async flows
- Complete integration testing

**Unit Tests:**
```bash
npm test
```

## Deployment

The bot is deployed on Railway.app and includes a keep-alive HTTP server:

- Listens on `PORT` environment variable (default: 10000)
- Responds to HTTP requests for health checks
- Server starts immediately when the application loads
- Webhook URL: `https://ybb-tally-bot-production.up.railway.app/webhook`

### Railway Deployment

The service is configured via `railway.json` and automatically deploys from the `main` branch:

- **Build Command**: `npm ci && npm run build && npm run db:verify`
- **Start Command**: `npm start`
- **Health Check**: `/health` endpoint
- **Public URL**: `https://ybb-tally-bot-production.up.railway.app`

Environment variables are configured in the Railway dashboard under the service's Variables tab.

## Project Structure

```
ybb-tally-bot/
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── index.ts            # Main entry point with cron jobs
│   ├── bot.ts              # Bot logic and handlers
│   ├── services/
│   │   ├── ai.ts           # Gemini AI service with multi-image support
│   │   ├── analyticsService.ts  # Analytics calculations
│   │   └── expenseService.ts    # Expense balance calculations
│   └── utils/
│       └── dateHelpers.ts  # Date utilities (Asia/Singapore timezone)
├── .env                    # Environment variables
├── .env.example            # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## License

ISC






# YBB Tally Bot

A private Telegram bot for managing shared expenses (70/30 split) between Bryan and Hwei Yeen in Singapore.

## Features

- 📸 **AI-Powered Receipt Processing**: Send a receipt photo and the bot extracts expense details using Google Gemini AI
- 💰 **Automatic Split Calculation**: 70/30 split (Bryan 70%, Hwei Yeen 30%)
- 📊 **Analytics Dashboard**: Track daily active users, receipt processing latency, peak hours, and spend velocity
- 🔄 **Recurring Expenses**: Automatically process recurring bills on specified days
- 📈 **Monthly Reports**: Automated monthly summaries with charts
- 🔒 **Security**: Only authorized users can access the bot

## Tech Stack

- **Runtime**: Node.js (Latest LTS) with TypeScript
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **Bot Framework**: Telegraf
- **AI**: Google Gemini 2.0 Flash
- **Scheduling**: node-cron
- **Analytics**: QuickChart.io

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

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

**Important**: Replace `[YOUR_PASSWORD]` in `DATABASE_URL` with your actual Supabase database password.

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
- `/admin_stats` - View analytics (admin only)
- `/help` - Show help message

### Adding Expenses

1. **Via Receipt Photo**: Simply send a photo of a receipt. The bot will:
   - Extract amount, merchant, date, and category using AI
   - Ask for confirmation
   - Ask who paid
   - Save and show updated balance

2. **Manual Entry**: Use `/add` command and follow the prompts

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

## Timezone

**CRITICAL**: All dates and times use `Asia/Singapore` timezone. This is hardcoded throughout the application.

## Development

```bash
# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Generate Prisma client after schema changes
npm run prisma:generate

# Create new migration
npm run prisma:migrate
```

## License

ISC






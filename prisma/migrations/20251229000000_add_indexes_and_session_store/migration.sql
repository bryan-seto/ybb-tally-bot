-- CreateTable
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transactions_isSettled_idx" ON "transactions"("isSettled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "system_logs_timestamp_idx" ON "system_logs"("timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "system_logs_userId_idx" ON "system_logs"("userId");


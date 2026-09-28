-- CreateEnum
CREATE TYPE "GoogleCalendarConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "GoogleCalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountId" TEXT,
    "googleEmail" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT,
    "syncToken" TEXT,
    "status" "GoogleCalendarConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "startDate" DATE,
    "endDate" DATE,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "eventType" TEXT,
    "htmlLink" TEXT,
    "hangoutLink" TEXT,
    "organizerEmail" TEXT,
    "creatorEmail" TEXT,
    "recurringEventId" TEXT,
    "recurrence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attendees" JSONB,
    "etag" TEXT,
    "googleCreatedAt" TIMESTAMP(3),
    "googleUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarConnection_userId_key" ON "GoogleCalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarConnection_userId_idx" ON "GoogleCalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_connectionId_idx" ON "GoogleCalendarEvent"("connectionId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_connectionId_startAt_idx" ON "GoogleCalendarEvent"("connectionId", "startAt");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_connectionId_startDate_idx" ON "GoogleCalendarEvent"("connectionId", "startDate");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_googleEventId_idx" ON "GoogleCalendarEvent"("googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_connectionId_googleEventId_key" ON "GoogleCalendarEvent"("connectionId", "googleEventId");

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleCalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

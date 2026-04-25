/*
  Warnings:

  - A unique constraint covering the columns `[shareToken]` on the table `Calendar` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Calendar" ADD COLUMN     "shareMode" TEXT,
ADD COLUMN     "shareToken" TEXT;

-- CreateTable
CREATE TABLE "CalendarMember" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarMember_userId_idx" ON "CalendarMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarMember_calendarId_userId_key" ON "CalendarMember"("calendarId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_shareToken_key" ON "Calendar"("shareToken");

-- AddForeignKey
ALTER TABLE "CalendarMember" ADD CONSTRAINT "CalendarMember_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMember" ADD CONSTRAINT "CalendarMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

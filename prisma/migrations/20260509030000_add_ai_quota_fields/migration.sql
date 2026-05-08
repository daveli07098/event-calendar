-- AlterTable: add AI quota tracking columns to User
ALTER TABLE "User" ADD COLUMN "aiQuotaDate" TEXT;
ALTER TABLE "User" ADD COLUMN "aiQuotaCount" INTEGER NOT NULL DEFAULT 0;

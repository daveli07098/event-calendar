-- CreateTable
CREATE TABLE "EventVenue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "address" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Hong Kong',
    "country" TEXT NOT NULL DEFAULT 'HK',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventVenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventVenue_name_idx" ON "EventVenue"("name");

-- AlterTable
-- Main performer/artist/group for the event (e.g. "Bruno Mars"), extracted
-- from ticket pages by the scraper; editable in the event modal.
ALTER TABLE "Event" ADD COLUMN "artist" TEXT;

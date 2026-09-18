-- Split the interview's one `language` into the two it always was.
--
-- `inputLanguage` is what the patient SPEAKS — the code the recogniser is told.
-- `outputLanguage` is what the patient READS AND HEARS — the wording of the
-- questions and the voice that reads them. One column made those the same
-- answer; they are two decisions, and only the first one is the patient's.
--
-- `language` is kept, holding the same value as `inputLanguage`, because
-- clients and scripts written before this split still read it. Nothing routes
-- off it any more.
--
-- ── Existing rows
--
-- Both columns take a DEFAULT, so every row already in the table is valid the
-- moment they are added and no session is left holding NULL. The UPDATE then
-- gives each existing session back the language its patient actually chose as
-- its INPUT language — without it, a Tamil interview started yesterday would
-- silently become an English one, which is precisely the wrong-language failure
-- this whole area exists to remove.
--
-- `outputLanguage` is deliberately left at 'en' for those rows: English output
-- is the product decision (see DEFAULT_OUTPUT_LANGUAGE in
-- `language.constants.ts`), and it applies to sessions already in flight for
-- the same reason it applies to new ones — every phrasebook but one is
-- unreviewed, so the English wording is the only wording a clinician here has
-- checked.

-- AlterTable
ALTER TABLE "CaseSession" ADD COLUMN     "inputLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "outputLanguage" TEXT NOT NULL DEFAULT 'en';

-- Backfill: the language on an existing session was the patient's choice, and
-- the patient's choice is the INPUT language.
UPDATE "CaseSession"
SET "inputLanguage" = "language"
WHERE "language" IS NOT NULL AND "language" <> '';

-- Sort order for the queue board.
--
-- The board ordered by the `priority` *string*, which is alphabetical and not
-- clinical: "routine" sorted above "normal", and once the p1–p5 triage codes
-- were accepted the ladder scrambled entirely. Combined with server-side
-- pagination that can put a P1 patient on page two.
ALTER TABLE "QueueManagement" ADD COLUMN "priorityRank" INTEGER NOT NULL DEFAULT 99;

-- Backfill from whatever each row already says. Both vocabularies map onto one
-- ladder; anything unrecognised keeps 99 and sorts last rather than first.
UPDATE "QueueManagement" SET "priorityRank" = CASE lower("priority")
  WHEN 'p1'        THEN 0
  WHEN 'emergency' THEN 0
  WHEN 'p2'        THEN 1
  WHEN 'urgent'    THEN 2
  WHEN 'p3'        THEN 3
  WHEN 'high'      THEN 3
  WHEN 'p4'        THEN 4
  WHEN 'normal'    THEN 4
  WHEN 'p5'        THEN 5
  WHEN 'low'       THEN 6
  WHEN 'routine'   THEN 6
  ELSE 99
END;

-- The board's only ordering: acuity, then who arrived first.
CREATE INDEX "QueueManagement_priorityRank_joinedQueueAt_idx"
  ON "QueueManagement" ("priorityRank", "joinedQueueAt");

-- Migration: 0083_sms_campaign_recipients_snapshot_columns
-- Purpose: Add personalization snapshot columns and BOOKED recipient status
--
-- SNAPSHOT RATIONALE
-- ------------------
-- All five new columns store values captured at freeze time, not derived at
-- render time.  The deliberate trade-off:
--
--   snapshotCity              Extracted from completedJobs.address at freeze.
--                             A customer can move between freeze and send;
--                             the message should reference the city of the
--                             *serviced* address, not a current profile field.
--
--   snapshotFrequency         Stored at freeze because it reflects the
--                             booking cadence that qualified the customer for
--                             this campaign.  Frequency can change (e.g. a
--                             weekly customer downgrades to monthly) and the
--                             message copy should match what was true when the
--                             audience was built.
--
--   snapshotBedrooms          Bedroom count from the last completed job.
--                             More stable than city/frequency, but snapshotted
--                             for consistency: the personalized message approved
--                             in the Review screen must be identical to what
--                             CampaignSender delivers, regardless of any
--                             completedJobs updates in between.
--
--   snapshotDaysSinceBooking  Computed at freeze as DATEDIFF(NOW(), jobDate).
--                             This value is inherently time-sensitive and
--                             meaningless if derived later.
--
--   snapshotPreferredTeam     Team name from cleanerJobs at freeze time.
--                             Team assignments change; the campaign may
--                             reference "your usual team" and that should
--                             reflect who cleaned for them last, not who is
--                             assigned today.
--
-- If schema surface area is a concern, snapshotBedrooms could be removed and
-- derived from the existing completedJobId FK — but the determinism argument
-- above applies to all five columns equally.
--
-- BOOKED STATUS
-- -------------
-- Adds BOOKED to the sms_campaign_recipient status enum to support manual
-- booking attribution in the Campaign Review screen.  A recipient is marked
-- BOOKED by an operator after confirming a re-booking resulted from this
-- campaign.  bookedCount on sms_campaigns is incremented/decremented
-- accordingly.
--
-- SAFE TO RUN
-- -----------
-- All new columns are nullable with no default, so existing rows are
-- unaffected.  The ENUM modification appends a new value; no existing rows
-- change status.  Both statements are safe on a live table with no locking
-- beyond a brief metadata change.

-- Step 1: Add snapshot columns
ALTER TABLE sms_campaign_recipients
  ADD COLUMN snapshotCity            VARCHAR(100) NULL AFTER snapshotLastPrice,
  ADD COLUMN snapshotFrequency       VARCHAR(50)  NULL AFTER snapshotCity,
  ADD COLUMN snapshotBedrooms        VARCHAR(20)  NULL AFTER snapshotFrequency,
  ADD COLUMN snapshotDaysSinceBooking INT          NULL AFTER snapshotBedrooms,
  ADD COLUMN snapshotPreferredTeam   VARCHAR(100) NULL AFTER snapshotDaysSinceBooking;

-- Step 2: Add BOOKED to the status enum
ALTER TABLE sms_campaign_recipients
  MODIFY COLUMN status ENUM('PENDING','SENT','FAILED','SKIPPED','BOOKED')
    NOT NULL DEFAULT 'PENDING';

-- Verify (run manually after applying):
-- SHOW CREATE TABLE sms_campaign_recipients;

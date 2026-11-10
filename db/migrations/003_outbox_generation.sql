-- Fence cancellation bookkeeping against a new capture rearming the same job.
ALTER TABLE outbox ADD COLUMN generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0);

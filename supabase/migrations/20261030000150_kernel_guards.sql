ALTER TABLE outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operation_receipt ADD COLUMN IF NOT EXISTS command_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE authority ADD COLUMN IF NOT EXISTS snapshot_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE authority ADD COLUMN IF NOT EXISTS owner_device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE authority ADD COLUMN IF NOT EXISTS owner_device_epoch TEXT NOT NULL DEFAULT '';
ALTER TABLE authority ADD COLUMN IF NOT EXISTS public_jwk TEXT NOT NULL DEFAULT '{}';
ALTER TABLE authority ADD COLUMN IF NOT EXISTS recovery_required INTEGER NOT NULL DEFAULT 0;

-- Scope counters as well as journal rows; application connections cannot inspect another venue's producer watermarks.
ALTER TABLE producer_counter ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT '__legacy__';
ALTER TABLE producer_counter ADD COLUMN IF NOT EXISTS venue_id TEXT NOT NULL DEFAULT '__legacy__';
ALTER TABLE producer_counter DROP CONSTRAINT producer_counter_pkey;
ALTER TABLE producer_counter ADD PRIMARY KEY(organization_id,venue_id,device_id,device_epoch);
ALTER TABLE producer_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE producer_counter FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS producer_counter_scope ON producer_counter;
CREATE POLICY producer_counter_scope ON producer_counter TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
ALTER TABLE journal DROP CONSTRAINT IF EXISTS journal_device_id_device_epoch_producer_sequence_key;
CREATE UNIQUE INDEX IF NOT EXISTS journal_scoped_sequence ON journal(organization_id,venue_id,device_id,device_epoch,producer_sequence);

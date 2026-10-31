-- Application role has no ownership or BYPASSRLS; public Data API has no grants.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mekoniq_app') THEN CREATE ROLE mekoniq_app NOLOGIN NOBYPASSRLS; END IF; END $$;

CREATE TABLE IF NOT EXISTS authority(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,coordinator_epoch INTEGER NOT NULL,policy_revision INTEGER NOT NULL,PRIMARY KEY(organization_id,venue_id));
CREATE TABLE IF NOT EXISTS aggregate_snapshot(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,kind,id));
CREATE TABLE IF NOT EXISTS operation_receipt(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,sequence TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,operation_id));
CREATE TABLE IF NOT EXISTS producer_counter(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,device_id TEXT NOT NULL,device_epoch TEXT NOT NULL,sequence TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,device_id,device_epoch));
CREATE TABLE IF NOT EXISTS journal(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,entry_id TEXT NOT NULL PRIMARY KEY,device_id TEXT NOT NULL,device_epoch TEXT NOT NULL,producer_sequence TEXT NOT NULL,entry_json TEXT NOT NULL,UNIQUE(organization_id,venue_id,device_id,device_epoch,producer_sequence));
CREATE TABLE IF NOT EXISTS audit(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT NOT NULL PRIMARY KEY,actor_ref TEXT NOT NULL,operation_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS domain_event(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT NOT NULL PRIMARY KEY,type TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT NOT NULL PRIMARY KEY,type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS inbox(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT NOT NULL PRIMARY KEY,payload_json TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_cursor(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,producer TEXT NOT NULL,received_cursor TEXT NOT NULL,applied_cursor TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,producer));
CREATE TABLE IF NOT EXISTS quarantine(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT NOT NULL PRIMARY KEY,raw_json TEXT NOT NULL,reason TEXT NOT NULL);

ALTER TABLE authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority FORCE ROW LEVEL SECURITY;
CREATE POLICY authority_scope ON authority TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON authority TO mekoniq_app;
REVOKE ALL ON authority FROM anon,authenticated;

ALTER TABLE aggregate_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY aggregate_snapshot_scope ON aggregate_snapshot TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON aggregate_snapshot TO mekoniq_app;
REVOKE ALL ON aggregate_snapshot FROM anon,authenticated;

ALTER TABLE operation_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY operation_receipt_scope ON operation_receipt TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON operation_receipt TO mekoniq_app;
REVOKE ALL ON operation_receipt FROM anon,authenticated;

ALTER TABLE journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_scope ON journal TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON journal TO mekoniq_app;
REVOKE ALL ON journal FROM anon,authenticated;

ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_scope ON audit TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON audit TO mekoniq_app;
REVOKE ALL ON audit FROM anon,authenticated;

ALTER TABLE domain_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_event FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_event_scope ON domain_event TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON domain_event TO mekoniq_app;
REVOKE ALL ON domain_event FROM anon,authenticated;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_scope ON outbox TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON outbox TO mekoniq_app;
REVOKE ALL ON outbox FROM anon,authenticated;

ALTER TABLE inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_scope ON inbox TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON inbox TO mekoniq_app;
REVOKE ALL ON inbox FROM anon,authenticated;

ALTER TABLE sync_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursor FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_cursor_scope ON sync_cursor TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON sync_cursor TO mekoniq_app;
REVOKE ALL ON sync_cursor FROM anon,authenticated;

ALTER TABLE quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine FORCE ROW LEVEL SECURITY;
CREATE POLICY quarantine_scope ON quarantine TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON quarantine TO mekoniq_app;
REVOKE ALL ON quarantine FROM anon,authenticated;

GRANT SELECT,INSERT,UPDATE ON producer_counter TO mekoniq_app; REVOKE ALL ON producer_counter FROM anon,authenticated;

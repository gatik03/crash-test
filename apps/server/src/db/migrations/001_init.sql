CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('builtin','external')),
  config_json TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, suite_id TEXT NOT NULL, suite_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('live','replay')), source TEXT NOT NULL DEFAULT 'live', trials INTEGER NOT NULL,
  status TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE scenario_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), scenario_id TEXT NOT NULL,
  variant_ids_json TEXT, profile_id TEXT NOT NULL, trial INTEGER NOT NULL, status TEXT NOT NULL,
  verdict TEXT, safety_pass INTEGER, task_pass INTEGER, termination TEXT, steps INTEGER, tokens_in INTEGER, tokens_out INTEGER,
  ledger_completeness TEXT, error TEXT, started_at TEXT, finished_at TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, scenario_run_id TEXT NOT NULL, seq INTEGER NOT NULL,
  ts TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE INDEX events_sr ON events(scenario_run_id, seq);
CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, scenario_run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('order','capture','refund')), paypal_id TEXT NOT NULL, parent_paypal_id TEXT,
  amount_minor INTEGER, currency TEXT, status TEXT, raw_json TEXT, fetched_at TEXT NOT NULL);
CREATE TABLE assertion_results (id INTEGER PRIMARY KEY AUTOINCREMENT, scenario_run_id TEXT NOT NULL, assertion_type TEXT NOT NULL,
  category TEXT NOT NULL, severity TEXT NOT NULL, passed INTEGER NOT NULL, expected_json TEXT, actual_json TEXT, evidence_json TEXT);
CREATE TABLE explanations (scenario_run_id TEXT PRIMARY KEY, json TEXT, model TEXT, created_at TEXT);
CREATE TABLE variants (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, suite_version TEXT NOT NULL, seed INTEGER NOT NULL,
  slot_id TEXT NOT NULL, text TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, event_type TEXT, resource_id TEXT, custom_id TEXT,
  verified INTEGER NOT NULL, received_at TEXT NOT NULL, raw_json TEXT);
CREATE TABLE wallet (id INTEGER PRIMARY KEY CHECK(id = 1), vault_id TEXT, payer_email_masked TEXT, status TEXT, updated_at TEXT);
CREATE TABLE live_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL);

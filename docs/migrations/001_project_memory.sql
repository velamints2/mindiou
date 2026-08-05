-- Project Memory schema reference.
-- Runtime application: project-memory-store.js executes the same idempotent DDL
-- against the existing DATA_DB_PATH SQLite database.
-- This reference file is intentionally metadata-only and contains no user data.

-- pm_projects, pm_work_items, pm_agent_sessions, pm_artifacts,
-- pm_session_work_items, pm_session_artifacts, pm_work_item_artifacts,
-- pm_decisions, pm_debt_artifact_links, pm_evidence_records,
-- pm_debt_recurrences, pm_hook_tokens, and pm_hook_events are created by the
-- idempotent DDL in project-memory-store.js. This file is a migration inventory,
-- not a standalone executable migration.

-- Rollback at the application layer is a deliberate future operation. Do not
-- drop pm_* tables in production without an export and explicit user request.

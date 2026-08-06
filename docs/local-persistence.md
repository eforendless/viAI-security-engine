# Local Persistence

viAI stores active local security state in one SQLite database at:

```text
app.getPath("userData")/viai.db
```

The desktop product name is `viAI Security`; on Windows, a normal installation resolves this under `%APPDATA%\viAI Security\viai.db`. The exact location remains the Electron-resolved `app.getPath("userData")` value, not a hardcoded path.

The Electron main process owns the database. The renderer can request typed history pages and records over preload IPC, but cannot open the database or execute SQL. The security engine receives the database location from the trusted desktop host through `VIAI_DB_PATH`; it does not derive a persistent location from its working directory.

## Storage And Safety

- SQLite uses WAL mode, foreign keys, a five-second busy timeout, normal synchronous mode, and transactional schema migrations.
- Schema migrations currently include `desktop-001-local-security-state` and `desktop-002-dashboard-assessment-queries`.
- Tables cover settings, scans, assessment history, scan cache, devices and device events, local reputation, file baselines, import bookkeeping, and diagnostics.
- History summary queries are indexed by time, category, hash, path, recommendation, source, scan, and device. Dashboard trend and recent queries also use `(kind, occurred_at DESC)` and `(kind, history_category, occurred_at DESC)` indexes. Full reports are retrieved only for a requested history record.
- This is local-only persistence. viAI does not add any cloud synchronization or network listener for the database.
- SQLite is not encrypted at rest. Filesystem permissions and full-disk encryption remain the protection for local database contents.

## Dashboard Queries

Dashboard totals and category distributions come from an aggregate query over persisted scan assessments. Trend queries group only the requested SQLite window: 24 hours by hour, and 7 or 30 days by day. Recent Activity uses a separately bounded `ORDER BY occurred_at DESC LIMIT ?` query with server-side search and category filtering. These responses contain neither `report_json` nor complete assessment history; live scan progress and protection state continue to come from runtime services.

Canonical stored categories are translated through `assessmentPresentation.ts` before they are displayed. Internal category identifiers are never shown as dashboard labels.

## Legacy Migration

On startup, before services begin using persistence, viAI imports supported legacy JSON sources into SQLite in one transaction. Successfully imported user-owned sources are moved under `legacy-json-backup/<timestamp>/`. Packaged engine seed data is read once but is not moved or repeatedly backed up. Import bookkeeping makes repeat startup idempotent. A malformed source records a local diagnostic while valid sources continue to import.

Migrated sources include background settings/history, scan cache, device records/events, the stable device ID, local reputation, and baseline/change records. JSON export remains an explicit user export artifact rather than active application storage.

When upgrading from the earlier package name, viAI also performs a one-time user-data directory migration before opening SQLite. It copies `%APPDATA%\desktop` into a sibling staging directory, validates any staged `viai.db` with SQLite `PRAGMA quick_check`, then atomically promotes it to `%APPDATA%\viAI Security`. The original directory is retained, and an interrupted staging copy is discarded and recreated from that untouched source on the next launch. Close all prior viAI processes before upgrading so a legacy WAL database is not being written during the copy.

## Clear Local Data

Clear Local Data removes scan sessions/history, cached classification data, device records and trust decisions, local reputation, and baseline/change records. Protection settings remain intact. The action does not alter files on the device.

## Runtime Compatibility

The current desktop dependency is Electron `43.2.0`, whose bundled Node runtime is `24.18.0`. viAI uses the built-in `node:sqlite` `DatabaseSync` API. It is present in both Electron main-process and `ELECTRON_RUN_AS_NODE` engine execution, and normal Windows packaging preserves that availability because it is part of Electron's bundled Node runtime.

Creating a `DatabaseSync` instance still emits Node's experimental SQLite warning in this runtime. The warning is not suppressed. This makes the implementation functional and tested for v0.3.x, but it is an upgrade risk: Electron/Node version changes can alter an experimental API. A public release should explicitly accept and monitor that risk, pin and test the Electron version, and treat a future API break as a release blocker. If experimental runtime APIs are unacceptable for a public release policy, the least disruptive stable replacement is `better-sqlite3`, rebuilt for Electron and packaged as an unpacked native module; its repository interface can remain unchanged.

## Windows Acceptance Checklist

### Fresh Installation

1. Install viAI and confirm `%LOCALAPPDATA%` user data contains `viai.db` after first launch.
2. Confirm default protection settings work, then run Quick Scan and Light, Balanced, and Deep Full Scans.
3. Confirm every completed scan is persisted in History, opens in Details, appears in Dashboard totals/trends/recent activity, and survives restart.
4. During Full Scan, verify progress reaches completion without a 99% stall, zero remaining files while running, late-result scan resurrection, pause/resume duplication, or indefinite cancel.
5. Exercise realtime download and filesystem monitoring, USB insertion, and USB manual scan. Confirm resulting assessment/device data is persisted after restart.
6. Verify Dashboard’s 24-hour, 7-day, and 30-day selector returns the corresponding complete database window, not merely visible History rows.

### Upgrade From JSON Installation

1. Prepare realistic `background-settings.json`, `background-history.json`, `scan-cache.json`, `device-security.json`, `device-id.txt`, `reputation.json`, and `baseline.json` data.
2. Start viAI and confirm it creates `viai.db`, imports once, retains identical settings, history count, details, devices, reputation, baseline state, and truthful interrupted-scan recovery.
3. Confirm user-owned legacy files are archived only after successful migration and malformed files remain with a recorded diagnostic.
4. Restart viAI. Confirm no duplicate records appear and new assessments write only to SQLite.
5. Confirm legacy JSON files receive no new production writes.

### History, Clear Data, And Lifecycle

1. Search, filter, paginate, open Details, remove one record, and bulk-remove a filtered selection from History. Confirm user files and protection settings are not altered.
2. Use Clear History and confirm only intended assessment records are removed.
3. Use Clear Local Data and confirm assessments, scan state, cache, devices/events, local labels, reputation, and baseline/change state are removed while documented settings remain.
4. Validate normal quit, tray exit, restart, and Windows shutdown/sign-out where available. Confirm `viai.db-wal` and `viai.db-shm` are handled by SQLite without manual deletion.
5. Confirm the renderer cannot access `viai.db` directly and all persistence flows use typed IPC.
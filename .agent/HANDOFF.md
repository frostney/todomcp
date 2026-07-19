# Handoff

## Current task

Issue #14 (rename to todomcp + legacy data migration) implemented on branch
`issue-14-rename-todomcp`; PR #21 open as a draft. The GitHub repository is already renamed to
`frostney/todomcp`. Earlier this session: vision re-grill landed via PR #13, and build-out
issues #14–#20 were created. Next after #21 merges: issue #15 (MCP transport), which unlocks
issues #17, #18, and #20.

## Decisions made (see docs/adr/0001-mcp-primary-push-architecture.md and VISION.md)

- Cross-project, push-not-pull system; user never picks a skill to run.
- Primary interface: globally registered MCP server over the existing SQLite store, providing
  shared always-available state access in every session; push initiation comes solely from a
  locally scheduled morning re-alignment session. Session-start injection and OS notifications
  rejected.
- CLI/REPL kept as secondary transport (inspection, scripting, export/import); no new CLI features
  by default.
- OKF (Google Open Knowledge Format) bundle records living context per todo/theme; grilling updates
  those docs; SQLite stays state of record.
- Priority = existing date+order (position is priority). An `effort` field is planned (#16, schema
  v2); once it lands, effort above 120 minutes triggers a breakdown suggestion during grilling.
- Calendar: configurable multiple read-only iCal feeds (PlanStack model), fetched at planning time,
  nothing stored.
- Rename to `todomcp` decided (pre-publication, so cheap). Not yet executed.

## Open questions

- None product-shaping. Scheduler mechanics per harness (launchd vs harness-native) resolve inside
  the installer implementation.

## Next steps

1. PR #13 opened for the vision/ADR/AGENTS.md changes.
2. Issues created for the build-out: #14 rename + data migration (lands first), #15 MCP server
   transport, #16 effort field + 120-minute breakdown flag, #17 OKF bundle, #18 iCal feeds +
   free-time computation, #19 installer (MCP registration + scheduler per selected harness),
   #20 workflow skills (intake, grilling, prioritisation, morning re-alignment, velocity
   nudging). Follow-up grill settled: full rename including GitHub repo and data-dir migration.
3. Implement in dependency order: #14 first; #15 unlocks #17/#18/#20; #19 installs #20.

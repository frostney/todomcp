# Handoff

## Current task

Issue #14 (rename to todomcp + legacy data migration) implemented on branch
`issue-14-rename-todomcp`; PR #21 open for merge. The GitHub repository is already renamed to
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
- Rename to `todomcp` executed: package/binary/docs use `todomcp`, and opening the default
  database migrates a legacy `todorepl` data directory automatically (issue #14 / PR #21).

## Open questions

- None product-shaping. Scheduler mechanics per harness (launchd vs harness-native) resolve inside
  the installer implementation.

## Next steps

1. Merge PR #21 (issue #14 rename + legacy data migration) — implemented on this branch.
2. Then issue #15 (MCP transport), which unlocks #17, #18, and #20. Remaining build-out: #16
   effort field, #17 OKF bundle, #18 iCal feeds, #19 installer, #20 workflow skills.
3. Dependency order after #14: #15 unlocks #17/#18/#20; #19 installs #20.

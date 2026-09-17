# Vision

## Executive Summary

- The project is an agent-native todo system: harnesses (Claude, Codex, any MCP client) supply the
  intelligence, and this repo supplies the substrate they work against.
- The primary interface is a globally registered MCP server over the local SQLite todo store; the
  existing Stricli CLI stays as a secondary transport for humans, scripts, and backup.
- The system pushes rather than waits: a scheduled morning session is the push channel that
  initiates re-alignment against priorities, while the MCP server provides always-available todo
  state in every project so the user never has to choose a skill to run.
- Context is recorded as an OKF (Open Knowledge Format) bundle of living concept documents, so the
  reasoning behind todos survives across sessions and harnesses.
- The project is named `todomcp` to match this identity; existing pre-rename data directories
  migrate automatically on first default-database access.
- App surface stays minimal: skills plus small scripts over the substrate. No web, desktop, or
  mobile UI.

## Product Direction

The user should not have to think about which skill to execute at what moment. The system works as a
push mechanism across all projects, not a pull mechanism inside one repo:

1. **Loose intake.** Unorganised input — dictation documents, pasted Granola notes, emails — is
   handed to any harness session and captured as raw todo candidates.
2. **Grilling.** A grilling session turns raw candidates into organised todos: one sharp question at
   a time, vague items clarified, and any todo whose effort estimate exceeds 120 minutes flagged
   for breakdown into smaller todos.
3. **Prioritisation.** The harness produces a prioritised list. Position in the list is the
   priority: the existing date + order fields are the ranking, and a todo's `effort` estimate (a
   planned schema addition, tracked in issue #16) is weighed against available time read from the
   user's calendars.
4. **Completion assistance.** The harness helps complete todos from their recorded context: first
   drafts of emails, step plans, initial documents.
5. **Velocity and nudging.** Completion velocity is derived from completion timestamps already in
   the store. As todos complete, the system gently nudges toward completing more — encouragement,
   not pressure.
6. **Morning re-alignment.** A scheduled morning session re-examines uncompleted todos from previous
   days and re-grills the list against current priorities before the day starts.

### Context recording (OKF)

The process is recorded using the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md):
a directory of markdown concept documents with YAML frontmatter, cross-linked into a graph.

- Each substantial todo and each recurring theme gets one **living concept document** holding its
  context: origin (dictation, email, Granola), breakdown, grilling decisions, and priority
  rationale.
- Grilling sessions **update** these documents rather than being stored as transcripts.
- SQLite remains the state of record for status, dates, and ordering; the OKF bundle holds the why.
- Privacy boundary: concept documents are local user data, like the todo store, and never leave the
  machine. They must not contain secrets or credentials, and source material (emails, notes,
  dictation) is captured as sanitized references and distilled rationale, not verbatim copies. The
  AGENTS.md rule against private task content applies to repository docs and examples; the OKF
  bundle is user data, not repository content.

### Calendar awareness

Prioritisation takes available time into account through **configurable read-only calendars**,
reusing the PlanStack model: a configured list of iCal feeds (label, `https://`/`webcal://` URL,
enabled flag), validated on add. Feeds are fetched at planning time to compute available time; no
calendar data is stored, and calendars are never written to.

Feed fetching must be hardened (tracked in issue #18): request timeouts and response-size limits,
redirect destinations revalidated against the same rules as the original URL, credential-bearing
URLs rejected, and non-public destinations (loopback, private, link-local) refused.

### Delivery shape

- **Global MCP server** — registered user-wide so every harness in every project reads and writes
  the same todo store through one protocol.
- **Scheduled morning session** — runs on a local scheduler (the data is local, so the session must
  be too) and initiates the re-alignment grilling without being asked.
- **CLI (secondary)** — the existing Stricli command surface and REPL remain for human inspection,
  scripting, and export/import; no new CLI features unless a workflow needs one.
- **Skills** — intake, grilling, prioritisation, and completion-assistance behaviors ship as skills
  installed at user level, not per project.
- **Installer** — a single setup command registers the MCP server and installs the morning-session
  scheduler into the harness the user selects (Claude, Codex, or another MCP client), so adoption
  is one command rather than manual configuration.

## Non-Goals

- No web, desktop, or mobile UI.
- No calendar writes; calendar access is read-only, at planning time only.
- No remote sync of todo data; the store and the OKF bundle stay on the local machine.
- No always-on daemon or OS-notification layer; push arrives through the scheduled session and the
  harness, not through new resident software.

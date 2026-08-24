import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Category, Kind, Todo } from "../domain/model";
import { SCHEMA_VERSION, type StoreSnapshot } from "../storage/repository";
import { type CliResult, makeRunCli, NOW } from "./cli-test-harness";

const TODAY = "2026-06-24";

type ExportSnapshot = {
  version: number;
  todos: Todo[];
  categories: Category[];
  kinds: Kind[];
};

type ImportResult = {
  imported: { todos: number; categories: number; kinds: number };
};

let workDir: string;
let dbFile: string;
let fileDir: string;

// Cache one runner per db path so the app is built once per file rather than per
// runCli call. Tests target either the per-test db or an explicit fresh db.
const runners = new Map<string, (args: string[]) => Promise<CliResult>>();

function runnerFor(dbPath: string): (args: string[]) => Promise<CliResult> {
  let runner = runners.get(dbPath);
  if (runner === undefined) {
    runner = makeRunCli(dbPath);
    runners.set(dbPath, runner);
  }
  return runner;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "todorepl-data-"));
  fileDir = await mkdtemp(join(workDir, "files-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// A fresh on-disk db per test isolates cases while persisting across the multiple
// runCli calls each test makes (":memory:" would reset on every connection open).
beforeEach(async () => {
  dbFile = join(await mkdtemp(join(workDir, "db-")), "todos.db");
});

afterEach(async () => {
  await rm(dbFile, { recursive: true, force: true });
});

// Drives the real Stricli application end-to-end against the per-test db (or an
// explicit db path), capturing output via the StricliProcess sinks.
function runCli(args: string[], dbPath: string = dbFile): Promise<CliResult> {
  return runnerFor(dbPath)(args);
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

async function addTodo(name: string, extraArgs: string[] = []): Promise<Todo> {
  const result = await runCli(["add", name, "--date", TODAY, "--json", ...extraArgs]);
  expect(result.exitCode).toBe(0);
  return parseJson<Todo>(result.stdout);
}

async function createCategory(name: string): Promise<Category> {
  const result = await runCli(["category", "create", name, "--json"]);
  expect(result.exitCode).toBe(0);
  return parseJson<Category>(result.stdout);
}

async function listTodos(dbPath: string = dbFile): Promise<Todo[]> {
  const result = await runCli(["list", "--json"], dbPath);
  expect(result.exitCode).toBe(0);
  return parseJson<Todo[]>(result.stdout);
}

function ids(todos: readonly { id: string }[]): string[] {
  return todos.map((entry) => entry.id).sort();
}

const TODO_BASE: Todo = {
  id: "todo-1",
  name: "Snapshot todo",
  date: TODAY,
  status: "open",
  order: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const CATEGORY_BASE: Category = {
  id: "cat-1",
  name: "Snapshot category",
  createdAt: NOW,
  updatedAt: NOW,
};

// Spread over a base so absent optionals are never set to `undefined`
// (exactOptionalPropertyTypes rejects { field: undefined }).
function todo(overrides: Partial<Todo> = {}): Todo {
  return { ...TODO_BASE, ...overrides };
}

function category(overrides: Partial<Category> = {}): Category {
  return { ...CATEGORY_BASE, ...overrides };
}

// `unknown` body lets callers hand deliberately malformed snapshots to writeSnapshot.
function snapshot(overrides: Record<string, unknown> = {}): unknown {
  return { version: SCHEMA_VERSION, todos: [], categories: [], kinds: [], ...overrides };
}

let snapshotCounter = 0;

// Writes a payload to a unique temp file and returns its path. Strings are written
// verbatim (for invalid-JSON cases); objects are JSON-encoded.
async function writeSnapshot(payload: unknown): Promise<string> {
  const path = join(fileDir, `snapshot-${snapshotCounter++}.json`);
  await writeFile(path, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return path;
}

describe("export", () => {
  test("emits a versioned snapshot containing the seeded records", async () => {
    const work = await createCategory("Work");
    const first = await addTodo("First task");
    const second = await addTodo("Second task");

    const result = await runCli(["export", "--json"]);

    expect(result.exitCode).toBe(0);
    const exported = parseJson<ExportSnapshot>(result.stdout);
    expect(exported.version).toBe(SCHEMA_VERSION);
    expect(ids(exported.todos)).toEqual(ids([first, second]));
    expect(exported.categories.map((entry) => entry.id)).toContain(work.id);
  });

  test("works without the explicit --json flag", async () => {
    const created = await addTodo("Plain export");

    const result = await runCli(["export"]);

    expect(result.exitCode).toBe(0);
    const exported = parseJson<ExportSnapshot>(result.stdout);
    expect(exported.todos.map((entry) => entry.id)).toContain(created.id);
  });

  test("includes done todos but excludes deleted ones", async () => {
    const finished = await addTodo("Finish me");
    const removed = await addTodo("Remove me");
    expect((await runCli(["done", finished.id, "--json"])).exitCode).toBe(0);
    expect((await runCli(["delete", removed.id, "--json"])).exitCode).toBe(0);

    const result = await runCli(["export", "--json"]);

    expect(result.exitCode).toBe(0);
    const exported = parseJson<ExportSnapshot>(result.stdout);
    const exportedIds = exported.todos.map((entry) => entry.id);
    expect(exportedIds).toContain(finished.id);
    expect(exportedIds).not.toContain(removed.id);
  });
});

describe("import", () => {
  test("imports a snapshot file and reflects it in list", async () => {
    const path = await writeSnapshot(
      snapshot({
        todos: [todo({ id: "imported-todo", name: "Imported task" })],
        categories: [category({ id: "imported-cat", name: "Imported category" })],
      }),
    );

    const result = await runCli(["import", "--file", path, "--json"]);

    expect(result.exitCode).toBe(0);
    const parsed = parseJson<ImportResult>(result.stdout);
    expect(parsed.imported).toEqual({ todos: 1, categories: 1, kinds: 0 });

    expect((await listTodos()).map((entry) => entry.id)).toEqual(["imported-todo"]);
  });

  test("round-trips export output through a fresh database", async () => {
    await createCategory("Roundtrip cat");
    const open = await addTodo("Stay open");
    const done = await addTodo("Get done");
    expect((await runCli(["done", done.id, "--json"])).exitCode).toBe(0);

    const exportResult = await runCli(["export", "--json"]);
    expect(exportResult.exitCode).toBe(0);
    const original = parseJson<StoreSnapshot>(exportResult.stdout);
    const snapshotPath = await writeSnapshot(original);

    const freshDb = join(await mkdtemp(join(workDir, "fresh-")), "todos.db");
    const importResult = await runCli(["import", "--file", snapshotPath, "--json"], freshDb);
    expect(importResult.exitCode).toBe(0);

    expect(ids(await listTodos(freshDb))).toEqual(ids([open, done]));
  });

  test("rejects an invalid snapshot and leaves existing data intact", async () => {
    const kept = await addTodo("Original task");
    const path = await writeSnapshot(
      snapshot({ todos: [todo({ id: "bad-todo", date: "not-a-date" })] }),
    );

    const result = await runCli(["import", "--file", path, "--json"]);

    expect(result.exitCode).toBe(2);
    // The bad record is rejected before any write, so only the seeded todo remains.
    expect((await listTodos()).map((entry) => entry.id)).toEqual([kept.id]);
  });

  test("rejects a file that is not valid JSON", async () => {
    const kept = await addTodo("Survivor");
    const path = await writeSnapshot("not json");

    const result = await runCli(["import", "--file", path, "--json"]);

    expect(result.exitCode).toBe(2);
    expect((await listTodos()).map((entry) => entry.id)).toEqual([kept.id]);
  });
});

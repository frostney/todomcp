import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Todo } from "../domain/model";
import { type CliResult, makeRunCli } from "./cli-test-harness";

const TODAY = "2026-06-24";

let workDir: string;
let dbFile: string;
let runCli: (args: string[]) => Promise<CliResult>;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "todorepl-commands-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// A fresh on-disk db per test keeps cases isolated while still persisting state
// across the multiple `runCli` calls a single test makes (":memory:" would reset
// on every open, since each command opens its own connection).
beforeEach(async () => {
  dbFile = join(await mkdtemp(join(workDir, "db-")), "todos.db");
  runCli = makeRunCli(dbFile);
});

afterEach(async () => {
  await rm(dbFile, { recursive: true, force: true });
});

function parseTodo(stdout: string): Todo {
  return JSON.parse(stdout) as Todo;
}

function parseTodos(stdout: string): Todo[] {
  return JSON.parse(stdout) as Todo[];
}

// Adds a todo via the CLI, asserts success, and returns the parsed Todo so tests
// can chain follow-up commands against a real generated id.
async function addTodo(name: string, extraArgs: string[] = []): Promise<Todo> {
  const result = await runCli(["add", name, "--date", TODAY, "--json", ...extraArgs]);
  expect(result.exitCode).toBe(0);
  return parseTodo(result.stdout);
}

describe("add", () => {
  test("creates an open todo with id, name, and date", async () => {
    const result = await runCli(["add", "Buy milk", "--date", TODAY, "--json"]);

    expect(result.exitCode).toBe(0);
    const todo = parseTodo(result.stdout);
    expect(todo.name).toBe("Buy milk");
    expect(todo.date).toBe(TODAY);
    expect(todo.status).toBe("open");
    expect(typeof todo.id).toBe("string");
    expect(todo.id.length).toBeGreaterThan(0);
  });

  test("rejects an invalid date with exit code 2", async () => {
    const result = await runCli(["add", "x", "--date", "not-a-date", "--json"]);

    expect(result.exitCode).toBe(2);
  });

  test("accepts off-slot HH:MM input and stores minute of day in JSON", async () => {
    const result = await runCli([
      "add",
      "Morning check",
      "--date",
      TODAY,
      "--time",
      "09:07",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(parseTodo(result.stdout).scheduledTime).toBe(547);
  });

  test("renders scheduled time as HH:MM in human output", async () => {
    const result = await runCli(["add", "Morning check", "--date", TODAY, "--time", "09:07"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("09:07");
  });

  test.each(["540", "24:00", "09:60"])("rejects invalid time %s with exit code 2", async (time) => {
    const result = await runCli(["add", "Bad time", "--time", time, "--json"]);

    expect(result.exitCode).toBe(2);
  });
});

describe("list", () => {
  test("returns the added todos as a JSON array", async () => {
    const first = await addTodo("First");
    const second = await addTodo("Second");

    const result = await runCli(["list", "--json"]);

    expect(result.exitCode).toBe(0);
    const todos = parseTodos(result.stdout);
    expect(todos.map((todo) => todo.id).sort()).toEqual([first.id, second.id].sort());
  });

  test("filters by date and status", async () => {
    const open = await addTodo("Stay open");
    const done = await addTodo("Finish me");
    await runCli(["done", done.id, "--json"]);

    const result = await runCli(["list", "--date", TODAY, "--status", "done", "--json"]);

    expect(result.exitCode).toBe(0);
    const todos = parseTodos(result.stdout);
    expect(todos.map((todo) => todo.id)).toEqual([done.id]);
    expect(todos.map((todo) => todo.id)).not.toContain(open.id);
  });

  test("rejects conflicting --scheduled and --unscheduled with exit code 2", async () => {
    const result = await runCli(["list", "--scheduled", "--unscheduled", "--json"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("show", () => {
  test("returns the todo for a full id", async () => {
    const created = await addTodo("Inspect me");

    const result = await runCli(["show", created.id, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseTodo(result.stdout).id).toBe(created.id);
  });

  test("resolves a unique id prefix", async () => {
    const created = await addTodo("Prefix lookup");

    const result = await runCli(["show", created.id.slice(0, 8), "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseTodo(result.stdout).id).toBe(created.id);
  });

  test("returns exit code 3 for an unknown id", async () => {
    const result = await runCli(["show", "does-not-exist", "--json"]);

    expect(result.exitCode).toBe(3);
  });
});

describe("done", () => {
  test("marks a todo as done", async () => {
    const created = await addTodo("Complete me");

    const result = await runCli(["done", created.id, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseTodo(result.stdout).status).toBe("done");
  });
});

describe("edit", () => {
  test("updates the name", async () => {
    const created = await addTodo("Old name");

    const result = await runCli(["edit", created.id, "--name", "New", "--json"]);

    expect(result.exitCode).toBe(0);
    const edited = parseTodo(result.stdout);
    expect(edited.id).toBe(created.id);
    expect(edited.name).toBe("New");
  });

  test("updates scheduled time from HH:MM input", async () => {
    const created = await addTodo("Reschedule me");

    const result = await runCli(["edit", created.id, "--time", "23:59", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseTodo(result.stdout).scheduledTime).toBe(1_439);
  });
});

describe("move", () => {
  test("changes the date", async () => {
    const created = await addTodo("Reschedule me");

    const result = await runCli(["move", created.id, "2026-07-01", "--json"]);

    expect(result.exitCode).toBe(0);
    const moved = parseTodo(result.stdout);
    expect(moved.id).toBe(created.id);
    expect(moved.date).toBe("2026-07-01");
  });
});

describe("delete", () => {
  test("removes the todo from list but keeps it with --include-deleted", async () => {
    const kept = await addTodo("Keep me");
    const doomed = await addTodo("Delete me");

    const deleted = await runCli(["delete", doomed.id, "--json"]);
    expect(deleted.exitCode).toBe(0);

    const listed = await runCli(["list", "--json"]);
    expect(listed.exitCode).toBe(0);
    const visibleIds = parseTodos(listed.stdout).map((todo) => todo.id);
    expect(visibleIds).toContain(kept.id);
    expect(visibleIds).not.toContain(doomed.id);

    const withDeleted = await runCli(["list", "--include-deleted", "--json"]);
    expect(withDeleted.exitCode).toBe(0);
    expect(parseTodos(withDeleted.stdout).map((todo) => todo.id)).toContain(doomed.id);
  });
});

describe("end-to-end lifecycle", () => {
  test("add, edit, move, done, then delete persist across commands", async () => {
    const created = await addTodo("Lifecycle");

    await runCli(["edit", created.id, "--name", "Lifecycle renamed", "--json"]);
    await runCli(["move", created.id, "2026-07-01", "--json"]);
    await runCli(["done", created.id, "--json"]);

    const shown = await runCli(["show", created.id, "--json"]);
    expect(shown.exitCode).toBe(0);
    const todo = parseTodo(shown.stdout);
    expect(todo.name).toBe("Lifecycle renamed");
    expect(todo.date).toBe("2026-07-01");
    expect(todo.status).toBe("done");

    await runCli(["delete", created.id, "--json"]);
    const finalList = await runCli(["list", "--json"]);
    expect(parseTodos(finalList.stdout).map((t) => t.id)).not.toContain(created.id);
  });
});

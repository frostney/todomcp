import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Category, Todo } from "../domain/model";
import { type CliResult, makeRunCli } from "./cli-test-harness";

const TODAY = "2026-06-24";

let workDir: string;
let dbFile: string;
let runCli: (args: string[]) => Promise<CliResult>;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "todomcp-category-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// Fresh on-disk db per test: state persists across the multiple runCli calls a
// single test makes, while each test stays isolated (":memory:" would reset on
// every open since each command opens its own connection).
beforeEach(async () => {
  dbFile = join(await mkdtemp(join(workDir, "db-")), "todos.db");
  runCli = makeRunCli(dbFile);
});

afterEach(async () => {
  await rm(dbFile, { recursive: true, force: true });
});

function parseCategory(stdout: string): Category {
  return JSON.parse(stdout) as Category;
}

function parseCategories(stdout: string): Category[] {
  return JSON.parse(stdout) as Category[];
}

function parseTodo(stdout: string): Todo {
  return JSON.parse(stdout) as Todo;
}

function parseTodos(stdout: string): Todo[] {
  return JSON.parse(stdout) as Todo[];
}

// Creates a category via the CLI, asserts success, and returns the parsed
// Category so tests can chain follow-ups against a real generated id.
async function createCategory(name: string, extraArgs: string[] = []): Promise<Category> {
  const result = await runCli(["category", "create", name, "--json", ...extraArgs]);
  expect(result.exitCode).toBe(0);
  return parseCategory(result.stdout);
}

async function addTodo(name: string, extraArgs: string[] = []): Promise<Todo> {
  const result = await runCli(["add", name, "--date", TODAY, "--json", ...extraArgs]);
  expect(result.exitCode).toBe(0);
  return parseTodo(result.stdout);
}

describe("category create", () => {
  test("returns a category with id and name", async () => {
    const result = await runCli(["category", "create", "Work", "--json"]);

    expect(result.exitCode).toBe(0);
    const category = parseCategory(result.stdout);
    expect(category.name).toBe("Work");
    expect(typeof category.id).toBe("string");
    expect(category.id.length).toBeGreaterThan(0);
  });

  test("stores provided color and emoji", async () => {
    const category = await createCategory("Personal", ["--color", "#ff0000", "--emoji", "🏠"]);

    expect(category.color).toBe("#ff0000");
    expect(category.emoji).toBe("🏠");
  });

  test("rejects a duplicate name with exit code 2", async () => {
    await createCategory("Work");

    const result = await runCli(["category", "create", "Work", "--json"]);

    expect(result.exitCode).toBe(2);
  });
});

describe("category list", () => {
  test("returns the created categories as a JSON array", async () => {
    const work = await createCategory("Work");
    const home = await createCategory("Home");

    const result = await runCli(["category", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    const categories = parseCategories(result.stdout);
    expect(categories.map((category) => category.id).sort()).toEqual([work.id, home.id].sort());
  });
});

describe("category show", () => {
  test("resolves a category by id", async () => {
    const created = await createCategory("Work");

    const result = await runCli(["category", "show", created.id, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseCategory(result.stdout).id).toBe(created.id);
  });

  test("resolves a category by name", async () => {
    const created = await createCategory("Work");

    const result = await runCli(["category", "show", "Work", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseCategory(result.stdout).id).toBe(created.id);
  });

  test("returns exit code 3 for an unknown category", async () => {
    const result = await runCli(["category", "show", "nope", "--json"]);

    expect(result.exitCode).toBe(3);
  });
});

describe("category edit", () => {
  test("updates the name", async () => {
    const created = await createCategory("Work");

    const result = await runCli(["category", "edit", created.id, "--name", "Office", "--json"]);

    expect(result.exitCode).toBe(0);
    const edited = parseCategory(result.stdout);
    expect(edited.id).toBe(created.id);
    expect(edited.name).toBe("Office");
  });
});

describe("category delete", () => {
  test("removes the category so list excludes it afterwards", async () => {
    const kept = await createCategory("Home");
    const doomed = await createCategory("Work");

    const deleted = await runCli(["category", "delete", doomed.id, "--json"]);
    expect(deleted.exitCode).toBe(0);

    const listed = await runCli(["category", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    const remainingIds = parseCategories(listed.stdout).map((category) => category.id);
    expect(remainingIds).toContain(kept.id);
    expect(remainingIds).not.toContain(doomed.id);
  });

  test("resolves the target by name", async () => {
    const created = await createCategory("Work");

    const deleted = await runCli(["category", "delete", "Work", "--json"]);
    expect(deleted.exitCode).toBe(0);

    const listed = await runCli(["category", "list", "--json"]);
    expect(parseCategories(listed.stdout).map((c) => c.id)).not.toContain(created.id);
  });
});

describe("todo category resolution", () => {
  test("add resolves a category name to its id", async () => {
    const category = await createCategory("Work");

    const todo = await addTodo("Task", ["--category", "Work"]);

    expect(todo.categoryId).toBe(category.id);
  });

  test("add returns exit code 3 for an unknown category", async () => {
    const result = await runCli([
      "add",
      "Task",
      "--date",
      TODAY,
      "--category",
      "does-not-exist",
      "--json",
    ]);

    expect(result.exitCode).toBe(3);
  });

  test("list filters todos by category name", async () => {
    await createCategory("Work");
    await createCategory("Home");
    const inWork = await addTodo("Work task", ["--category", "Work"]);
    const inHome = await addTodo("Home task", ["--category", "Home"]);

    const result = await runCli(["list", "--category", "Work", "--json"]);

    expect(result.exitCode).toBe(0);
    const ids = parseTodos(result.stdout).map((todo) => todo.id);
    expect(ids).toContain(inWork.id);
    expect(ids).not.toContain(inHome.id);
  });
});

describe("category delete with referencing todos", () => {
  test("rejects deletion of an in-use category with exit code 2", async () => {
    await createCategory("Work");
    await addTodo("Task", ["--category", "Work"]);

    const result = await runCli(["category", "delete", "Work", "--json"]);

    expect(result.exitCode).toBe(2);
  });

  test("--force deletes the category and un-assigns the referencing todo", async () => {
    const category = await createCategory("Work");
    const todo = await addTodo("Task", ["--category", "Work"]);

    const deleted = await runCli(["category", "delete", "Work", "--force", "--json"]);
    expect(deleted.exitCode).toBe(0);

    const categories = await runCli(["category", "list", "--json"]);
    expect(parseCategories(categories.stdout).map((c) => c.id)).not.toContain(category.id);

    const shown = await runCli(["show", todo.id, "--json"]);
    expect(shown.exitCode).toBe(0);
    expect(parseTodo(shown.stdout).categoryId).toBeUndefined();
  });
});

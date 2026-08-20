import { describe, expect, test } from "bun:test";
import type { Category, Todo } from "../domain/model";
import { SCHEMA_VERSION, type StoreSnapshot, type TodoRepository } from "../storage/repository";
import { ValidationError } from "./errors";
import { NOW, registerMemoryRepos } from "./service-test-harness";
import { exportData, importData } from "./transfer";

const TODAY = "2026-06-24";

const makeRepo = registerMemoryRepos();

const TODO_BASE: Todo = {
  id: "todo-1",
  name: "Write tests",
  date: TODAY,
  status: "open",
  order: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const CATEGORY_BASE: Category = {
  id: "cat-1",
  name: "Work",
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

// `unknown` so we can hand importData deliberately malformed payloads.
function snapshot(overrides: Partial<StoreSnapshot> = {}): unknown {
  return { version: SCHEMA_VERSION, todos: [], categories: [], ...overrides };
}

async function seed(repo: TodoRepository): Promise<{ todo: Todo; category: Category }> {
  const seededTodo = todo({ id: "seed-todo", name: "Original todo" });
  const seededCategory = category({ id: "seed-cat", name: "Original category" });
  await repo.putTodo(seededTodo);
  await repo.putCategory(seededCategory);
  return { todo: seededTodo, category: seededCategory };
}

// Snapshot of current store contents, used to prove importData did not mutate on failure.
async function dump(repo: TodoRepository): Promise<{ todos: Todo[]; categories: Category[] }> {
  return { todos: await repo.listTodos(), categories: await repo.listCategories() };
}

describe("exportData", () => {
  test("returns the schema version with todos and categories", async () => {
    const repo = makeRepo();
    await repo.putTodo(todo({ id: "todo-1" }));
    await repo.putCategory(category({ id: "cat-1" }));

    const result = await exportData(repo);

    expect(result.version).toBe(SCHEMA_VERSION);
    expect(result.todos.map((entry) => entry.id)).toEqual(["todo-1"]);
    expect(result.categories.map((entry) => entry.id)).toEqual(["cat-1"]);
  });

  test("excludes soft-deleted todos", async () => {
    const repo = makeRepo();
    await repo.putTodo(todo({ id: "live", order: 0 }));
    await repo.putTodo(todo({ id: "gone", order: 1, deletedAt: NOW }));

    const result = await exportData(repo);

    expect(result.todos.map((entry) => entry.id)).toEqual(["live"]);
  });

  test("orders output deterministically regardless of insertion order", async () => {
    const repo = makeRepo();
    await repo.putTodo(todo({ id: "todo-b", date: TODAY, order: 1 }));
    await repo.putTodo(todo({ id: "todo-a", date: TODAY, order: 0 }));
    await repo.putCategory(category({ id: "cat-z", name: "Zeta" }));
    await repo.putCategory(category({ id: "cat-a", name: "Alpha" }));

    const result = await exportData(repo);

    expect(result.todos.map((entry) => entry.id)).toEqual(["todo-a", "todo-b"]);
    expect(result.categories.map((entry) => entry.id)).toEqual(["cat-a", "cat-z"]);
  });
});

describe("importData", () => {
  test("replaces store contents and returns the imported counts", async () => {
    const repo = makeRepo();
    await seed(repo);

    const payload = snapshot({
      todos: [todo({ id: "imported-1" }), todo({ id: "imported-2", order: 1 })],
      categories: [category({ id: "imported-cat" })],
    });

    const counts = await importData(repo, payload);

    expect(counts).toEqual({ todos: 2, categories: 1 });
    expect((await repo.listTodos()).map((entry) => entry.id)).toEqual(["imported-1", "imported-2"]);
    expect((await repo.listCategories()).map((entry) => entry.id)).toEqual(["imported-cat"]);
  });

  test("preserves ids and timestamps on a faithful restore", async () => {
    const repo = makeRepo();
    const restoredTodo = todo({
      id: "restored",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      scheduledTime: 540,
      duration: 30,
    });
    const restoredCategory = category({
      id: "restored-cat",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
    });

    await importData(repo, snapshot({ todos: [restoredTodo], categories: [restoredCategory] }));

    expect(await repo.getTodo("restored")).toEqual(restoredTodo);
    expect((await repo.listCategories())[0]).toEqual(restoredCategory);
  });

  test("accepts an off-slot scheduled minute in a snapshot", async () => {
    const repo = makeRepo();
    const restoredTodo = todo({ scheduledTime: 547 });

    await importData(repo, snapshot({ todos: [restoredTodo] }));

    expect(await repo.getTodo(restoredTodo.id)).toEqual(restoredTodo);
  });

  test("rejects a payload that is not an object", async () => {
    const repo = makeRepo();

    await expect(importData(repo, "not-an-object")).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a payload missing the todos and categories arrays", async () => {
    const repo = makeRepo();

    await expect(importData(repo, { version: SCHEMA_VERSION })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects a version newer than this build and leaves the store unchanged", async () => {
    const repo = makeRepo();
    const before = await seed(repo);

    await expect(
      importData(repo, snapshot({ version: SCHEMA_VERSION + 1 })),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await dump(repo)).toEqual({ todos: [before.todo], categories: [before.category] });
  });

  test("rejects a todo with an invalid date and leaves the store unchanged", async () => {
    const repo = makeRepo();
    const before = await seed(repo);

    await expect(
      importData(repo, snapshot({ todos: [todo({ id: "bad", date: "2026-13-40" })] })),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await dump(repo)).toEqual({ todos: [before.todo], categories: [before.category] });
  });

  test("rejects a todo with an invalid duration", async () => {
    const repo = makeRepo();

    await expect(
      importData(
        repo,
        snapshot({ todos: [todo({ duration: 45 as unknown as NonNullable<Todo["duration"]> })] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a todo with an invalid scheduled time", async () => {
    const repo = makeRepo();

    await expect(
      importData(repo, snapshot({ todos: [todo({ scheduledTime: 1_440 })] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a todo missing a required field", async () => {
    const repo = makeRepo();
    const { id: _omitted, ...withoutId } = todo();

    await expect(importData(repo, snapshot({ todos: [withoutId as Todo] }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects a category with an empty name", async () => {
    const repo = makeRepo();

    await expect(
      importData(repo, snapshot({ categories: [category({ name: "" })] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a todo referencing a category absent from the snapshot", async () => {
    const repo = makeRepo();

    await expect(
      importData(repo, snapshot({ todos: [todo({ categoryId: "ghost" })] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a schema version below 1", async () => {
    const repo = makeRepo();

    await expect(importData(repo, snapshot({ version: 0 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

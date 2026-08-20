import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Category, Todo } from "../domain/model";
import {
  emptySnapshot,
  SCHEMA_VERSION,
  StoreCorruptError,
  type StoreSnapshot,
  StoreVersionError,
  type TodoFilter,
  type TodoRepository,
} from "./repository";
import { createSqliteRepository } from "./sqlite-store";

const tempDirs: string[] = [];
const openRepos: TodoRepository[] = [];

afterEach(async () => {
  while (openRepos.length > 0) {
    const repo = openRepos.pop();
    try {
      repo?.close();
    } catch {
      // ignore close failures during teardown
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "todorepl-sqlite-"));
  tempDirs.push(dir);
  return dir;
}

async function tempPath(name = "todos.sqlite"): Promise<string> {
  return join(await tempDir(), name);
}

function track(repo: TodoRepository): TodoRepository {
  openRepos.push(repo);
  return repo;
}

function makeRepo(): TodoRepository {
  return track(createSqliteRepository({ path: ":memory:" }));
}

const TODO_BASE: Todo = {
  id: "todo-base",
  name: "Base todo",
  date: "2026-06-24",
  status: "open",
  order: 0,
  createdAt: "2026-06-24T10:00:00.000Z",
  updatedAt: "2026-06-24T10:00:00.000Z",
};

const CATEGORY_BASE: Category = {
  id: "cat-base",
  name: "Base category",
  createdAt: "2026-06-24T10:00:00.000Z",
  updatedAt: "2026-06-24T10:00:00.000Z",
};

// Spread only over the base so absent optionals are never set to `undefined`
// (exactOptionalPropertyTypes rejects { field: undefined }).
function todo(overrides: Partial<Todo> = {}): Todo {
  return { ...TODO_BASE, ...overrides };
}

function category(overrides: Partial<Category> = {}): Category {
  return { ...CATEGORY_BASE, ...overrides };
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function ids(rows: readonly { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

async function seed(repo: TodoRepository, rows: readonly Todo[]): Promise<void> {
  for (const row of rows) {
    await repo.putTodo(row);
  }
}

describe("createSqliteRepository bootstrap", () => {
  test("fresh path bootstraps an empty store", async () => {
    const repo = track(createSqliteRepository({ path: await tempPath() }));

    expect(await repo.listTodos()).toEqual([]);
    expect(await repo.listCategories()).toEqual([]);
  });

  test("creates missing parent directories for the data file", async () => {
    const path = join(await tempDir(), "nested", "deeper", "todos.db");
    const repo = track(createSqliteRepository({ path }));

    expect(await repo.listTodos()).toEqual([]);
  });
});

describe("todo persistence", () => {
  test("putTodo then getTodo round-trips a fully populated todo", async () => {
    const repo = makeRepo();
    const full = todo({
      id: "todo-full",
      name: "Fully populated",
      date: "2026-07-01",
      status: "done",
      order: 3,
      categoryId: "cat-work",
      emoji: "🚨",
      scheduledTime: 540,
      duration: 30,
      completedAt: "2026-07-01T12:00:00.000Z",
      deletedAt: "2026-07-02T08:00:00.000Z",
      followUp: true,
      rolloverCount: 2,
      rolloverHistory: [
        {
          fromDate: "2026-06-29",
          toDate: "2026-06-30",
          rolledOverAt: "2026-06-30T08:00:00.000Z",
        },
        {
          fromDate: "2026-06-30",
          toDate: "2026-07-01",
          rolledOverAt: "2026-07-01T08:00:00.000Z",
        },
      ],
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
    });

    await repo.putTodo(full);

    expect(await repo.getTodo("todo-full")).toEqual(full);
  });

  test("getTodo returns undefined for an unknown id", async () => {
    const repo = makeRepo();

    expect(await repo.getTodo("missing")).toBeUndefined();
  });

  test("putTodo replaces an existing id", async () => {
    const repo = makeRepo();
    await repo.putTodo(todo({ id: "todo-1", name: "Original", order: 1 }));

    const replacement = todo({
      id: "todo-1",
      name: "Replaced",
      status: "done",
      order: 9,
      updatedAt: "2026-06-25T10:00:00.000Z",
    });
    await repo.putTodo(replacement);

    expect(await repo.getTodo("todo-1")).toEqual(replacement);
    expect(await repo.listTodos()).toHaveLength(1);
  });
});

describe("category persistence", () => {
  test("putCategory then getCategory round-trips color and emoji", async () => {
    const repo = makeRepo();
    const full = category({
      id: "cat-work",
      name: "Work",
      color: "#ff8800",
      emoji: "💼",
    });

    await repo.putCategory(full);

    expect(await repo.getCategory("cat-work")).toEqual(full);
  });

  test("getCategory returns undefined for an unknown id and putCategory replaces by id", async () => {
    const repo = makeRepo();
    expect(await repo.getCategory("missing")).toBeUndefined();

    await repo.putCategory(category({ id: "cat-1", name: "First" }));
    const replacement = category({ id: "cat-1", name: "Renamed", emoji: "🏷️" });
    await repo.putCategory(replacement);

    expect(await repo.getCategory("cat-1")).toEqual(replacement);
    expect(await repo.listCategories()).toHaveLength(1);
  });
});

describe("listTodos filtering", () => {
  const dataset: readonly Todo[] = [
    todo({ id: "a", date: "2026-06-24", status: "done", categoryId: "work", order: 0 }),
    todo({
      id: "b",
      date: "2026-06-24",
      status: "open",
      categoryId: "work",
      order: 1,
      scheduledTime: 540,
      duration: 60,
    }),
    todo({ id: "c", date: "2026-06-24", status: "open", categoryId: "home", order: 2 }),
    todo({ id: "d", date: "2026-06-25", status: "done", categoryId: "home", order: 0 }),
    todo({ id: "e", date: "2026-06-26", status: "open", categoryId: "work", order: 0 }),
  ];

  async function seeded(): Promise<TodoRepository> {
    const repo = makeRepo();
    await seed(repo, dataset);
    return repo;
  }

  test("date + status finds today's completed todos", async () => {
    const repo = await seeded();
    const filter: TodoFilter = { date: "2026-06-24", status: "done" };

    expect(ids(await repo.listTodos(filter))).toEqual(["a"]);
  });

  test("status open matches across dates", async () => {
    const repo = await seeded();

    expect(ids(await repo.listTodos({ status: "open" }))).toEqual(["b", "c", "e"]);
  });

  test("categoryId narrows to one category", async () => {
    const repo = await seeded();

    expect(ids(await repo.listTodos({ categoryId: "home" }))).toEqual(["c", "d"]);
  });

  test("scheduled true returns only todos with a scheduled time", async () => {
    const repo = await seeded();

    expect(ids(await repo.listTodos({ scheduled: true }))).toEqual(["b"]);
  });

  test("scheduled false returns only unscheduled todos", async () => {
    const repo = await seeded();

    expect(ids(await repo.listTodos({ scheduled: false }))).toEqual(["a", "c", "d", "e"]);
  });

  test("followUp true returns only marked follow-ups", async () => {
    const repo = makeRepo();
    await seed(repo, [
      todo({ id: "plain", date: "2026-06-24", order: 0 }),
      todo({ id: "flagged", date: "2026-06-24", order: 1, followUp: true }),
    ]);

    expect(ids(await repo.listTodos({ followUp: true }))).toEqual(["flagged"]);
    expect(ids(await repo.listTodos({ followUp: false }))).toEqual(["plain"]);
  });

  test("dateFrom and dateTo bound an inclusive range", async () => {
    const repo = await seeded();
    const filter: TodoFilter = { dateFrom: "2026-06-24", dateTo: "2026-06-25" };

    expect(ids(await repo.listTodos(filter))).toEqual(["a", "b", "c", "d"]);
  });

  test("filters AND-combine", async () => {
    const repo = await seeded();
    const filter: TodoFilter = { date: "2026-06-24", status: "open", categoryId: "work" };

    expect(ids(await repo.listTodos(filter))).toEqual(["b"]);
  });
});

describe("soft delete visibility", () => {
  test("soft-deleted todos are excluded by default and included on request", async () => {
    const repo = makeRepo();
    const live = todo({ id: "live", date: "2026-06-24", order: 0 });
    const deleted = todo({
      id: "deleted",
      date: "2026-06-24",
      order: 1,
      deletedAt: "2026-06-24T11:00:00.000Z",
    });
    await seed(repo, [live, deleted]);

    expect(ids(await repo.listTodos())).toEqual(["live"]);
    expect(ids(await repo.listTodos({ includeDeleted: true }))).toEqual(["live", "deleted"]);
    expect(await repo.getTodo("deleted")).toEqual(deleted);
  });
});

describe("atomic category deletion", () => {
  test("reports that a missing category was not deleted", async () => {
    const repo = makeRepo();

    const result = await repo.deleteCategory("missing", {
      force: false,
      updatedAt: "2026-06-24T12:00:00.000Z",
    });

    expect(result).toEqual({ deleted: false, referencedTodoCount: 0 });
  });

  test("un-assigns every referencing todo and deletes the category", async () => {
    const repo = makeRepo();
    const work = category({ id: "work", name: "Work" });
    const home = category({ id: "home", name: "Home" });
    await repo.putCategory(work);
    await repo.putCategory(home);
    await seed(repo, [
      todo({ id: "work-open", categoryId: work.id }),
      todo({ id: "work-deleted", categoryId: work.id, deletedAt: "2026-06-24T11:00:00.000Z" }),
      todo({ id: "home-open", categoryId: home.id }),
    ]);

    await repo.deleteCategory(work.id, {
      force: true,
      updatedAt: "2026-06-24T12:00:00.000Z",
    });

    expect(await repo.getCategory(work.id)).toBeUndefined();
    expect(await repo.getCategory(home.id)).toEqual(home);
    expect(await repo.getTodo("work-open")).toMatchObject({
      updatedAt: "2026-06-24T12:00:00.000Z",
    });
    expect((await repo.getTodo("work-open"))?.categoryId).toBeUndefined();
    expect((await repo.getTodo("work-deleted"))?.categoryId).toBeUndefined();
    expect(await repo.getTodo("home-open")).toMatchObject({
      categoryId: home.id,
      updatedAt: TODO_BASE.updatedAt,
    });
  });

  test("refuses a referenced category without force and changes nothing", async () => {
    const repo = makeRepo();
    const work = category({ id: "work", name: "Work" });
    const assigned = todo({ id: "assigned", categoryId: work.id });
    await repo.putCategory(work);
    await repo.putTodo(assigned);

    const result = await repo.deleteCategory(work.id, {
      force: false,
      updatedAt: "2026-06-24T12:00:00.000Z",
    });

    expect(result).toEqual({ deleted: false, referencedTodoCount: 1 });
    expect(await repo.getCategory(work.id)).toEqual(work);
    expect(await repo.getTodo(assigned.id)).toEqual(assigned);
  });

  test("rolls back todo updates when deleting the category fails", async () => {
    const path = await tempPath("atomic-delete.sqlite");
    const repo = track(createSqliteRepository({ path }));
    const work = category({ id: "work", name: "Work" });
    const assigned = todo({ id: "assigned", categoryId: work.id });
    await repo.putCategory(work);
    await repo.putTodo(assigned);

    const raw = new Database(path);
    raw.run(`CREATE TRIGGER fail_category_delete
      BEFORE DELETE ON categories
      BEGIN
        SELECT RAISE(ABORT, 'simulated category delete failure');
      END`);
    raw.close();

    await expect(
      repo.deleteCategory(work.id, {
        force: true,
        updatedAt: "2026-06-24T12:00:00.000Z",
      }),
    ).rejects.toThrow("simulated category delete failure");

    expect(await repo.getCategory(work.id)).toEqual(work);
    expect(await repo.getTodo(assigned.id)).toEqual(assigned);
  });
});

describe("deterministic ordering", () => {
  test("listTodos orders by date ASC, order ASC, id ASC", async () => {
    const repo = makeRepo();
    await seed(repo, [
      todo({ id: "z", date: "2026-06-25", order: 0 }),
      todo({ id: "m", date: "2026-06-24", order: 5 }),
      todo({ id: "b", date: "2026-06-24", order: 1 }),
      todo({ id: "a", date: "2026-06-24", order: 1 }),
      todo({ id: "y", date: "2026-06-23", order: 9 }),
    ]);

    expect(ids(await repo.listTodos())).toEqual(["y", "a", "b", "m", "z"]);
  });
});

describe("snapshot import and export", () => {
  function sampleSnapshot(): StoreSnapshot {
    return {
      version: SCHEMA_VERSION,
      todos: [
        todo({ id: "t1", date: "2026-06-24", order: 0, categoryId: "work" }),
        todo({
          id: "t2",
          date: "2026-06-25",
          order: 1,
          status: "done",
          completedAt: "2026-06-25T12:00:00.000Z",
        }),
        todo({
          id: "t3",
          date: "2026-06-26",
          order: 0,
          deletedAt: "2026-06-26T09:00:00.000Z",
        }),
      ],
      categories: [
        category({ id: "work", name: "Work", color: "#0088ff", emoji: "💼" }),
        category({ id: "home", name: "Home" }),
      ],
    };
  }

  test("importSnapshot then exportSnapshot round-trips losslessly", async () => {
    const repo = makeRepo();
    const snapshot = sampleSnapshot();

    await repo.importSnapshot(snapshot);
    const exported = await repo.exportSnapshot();

    expect(exported.version).toBe(SCHEMA_VERSION);
    expect(byId(exported.todos)).toEqual(byId(snapshot.todos));
    expect(byId(exported.categories)).toEqual(byId(snapshot.categories));
  });

  test("exportSnapshot includes soft-deleted todos in deterministic order", async () => {
    const repo = makeRepo();
    await repo.importSnapshot(sampleSnapshot());

    const exported = await repo.exportSnapshot();

    expect(ids(exported.todos)).toEqual(["t1", "t2", "t3"]);
    expect(ids(byId(exported.categories))).toEqual(["home", "work"]);
  });

  test("importSnapshot replaces all prior data", async () => {
    const repo = makeRepo();
    await repo.importSnapshot({
      version: SCHEMA_VERSION,
      todos: [todo({ id: "old-todo" })],
      categories: [category({ id: "old-cat" })],
    });

    await repo.importSnapshot({
      version: SCHEMA_VERSION,
      todos: [todo({ id: "new-todo" })],
      categories: [category({ id: "new-cat" })],
    });

    expect(ids(await repo.listTodos())).toEqual(["new-todo"]);
    expect(ids(await repo.listCategories())).toEqual(["new-cat"]);
  });

  test("importSnapshot of an empty snapshot clears the store", async () => {
    const repo = makeRepo();
    await seed(repo, [todo({ id: "doomed" })]);

    await repo.importSnapshot(emptySnapshot());

    expect(await repo.listTodos()).toEqual([]);
    expect(await repo.listCategories()).toEqual([]);
  });

  test("importSnapshot rejects a newer schema version and preserves existing data", async () => {
    const repo = makeRepo();
    const existing = todo({ id: "keep", categoryId: "work" });
    const existingCategory = category({ id: "work", name: "Work" });
    await repo.putTodo(existing);
    await repo.putCategory(existingCategory);

    const future: StoreSnapshot = {
      version: SCHEMA_VERSION + 1,
      todos: [todo({ id: "intruder" })],
      categories: [category({ id: "intruder-cat" })],
    };

    await expect(repo.importSnapshot(future)).rejects.toBeInstanceOf(StoreVersionError);

    expect(await repo.getTodo("keep")).toEqual(existing);
    expect(await repo.getTodo("intruder")).toBeUndefined();
    expect(ids(await repo.listCategories())).toEqual(["work"]);
  });
});

describe("on-disk failure modes", () => {
  // The implementation may surface these errors either at construction or on first
  // access; assert against whichever path throws/rejects.
  async function expectStoreError(
    path: string,
    error: typeof StoreCorruptError | typeof StoreVersionError,
  ): Promise<void> {
    let repo: TodoRepository | undefined;
    try {
      repo = createSqliteRepository({ path });
    } catch (caught) {
      expect(caught).toBeInstanceOf(error);
      return;
    }
    openRepos.push(repo);
    await expect(repo.listTodos()).rejects.toBeInstanceOf(error);
  }

  test("a non-SQLite file raises StoreCorruptError", async () => {
    const path = await tempPath("corrupt.sqlite");
    await writeFile(path, "not a database");

    await expectStoreError(path, StoreCorruptError);
  });

  test("an unsupported schema version raises StoreVersionError", async () => {
    const path = await tempPath("versioned.sqlite");
    // Reuse the implementation's own bootstrap to create a valid schema, then bump
    // user_version past what this build supports.
    const bootstrap = createSqliteRepository({ path });
    bootstrap.close();

    const raw = new Database(path);
    raw.run(`PRAGMA user_version = ${SCHEMA_VERSION + 998}`);
    raw.close();

    await expectStoreError(path, StoreVersionError);
  });
});

describe("schema migration", () => {
  test("migrates a v1 database and preserves existing rows", async () => {
    const path = await tempPath("legacy-v1.sqlite");
    const raw = new Database(path);
    raw.run(`
CREATE TABLE categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, emoji TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE todos (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL,
  "order" INTEGER NOT NULL, category_id TEXT, emoji TEXT, scheduled_time INTEGER,
  duration INTEGER, completed_at TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`);
    raw.run(`PRAGMA user_version = 1`);
    raw.run(
      `INSERT INTO todos (id, name, date, status, "order", created_at, updated_at)
       VALUES ('legacy', 'Legacy item', '2026-06-23', 'open', 0,
               '2026-06-23T10:00:00.000Z', '2026-06-23T10:00:00.000Z')`,
    );
    raw.close();

    const repo = track(createSqliteRepository({ path }));
    const loaded = await repo.getTodo("legacy");
    expect(loaded).toMatchObject({
      id: "legacy",
      name: "Legacy item",
      date: "2026-06-23",
      status: "open",
    });
    expect(loaded?.followUp).toBeUndefined();
    expect(loaded?.rolloverCount).toBeUndefined();
    expect(loaded?.rolloverHistory).toBeUndefined();

    const versioned = todo({
      id: "legacy",
      name: "Legacy item",
      date: "2026-06-23",
      followUp: true,
      rolloverCount: 1,
      rolloverHistory: [
        { fromDate: "2026-06-22", toDate: "2026-06-23", rolledOverAt: "2026-06-23T08:00:00.000Z" },
      ],
    });
    await repo.putTodo(versioned);
    expect(await repo.getTodo("legacy")).toEqual(versioned);

    const check = new Database(path);
    const uv = (check.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    check.close();
    expect(uv).toBe(SCHEMA_VERSION);
  });

  test("drops malformed stored rollover history", async () => {
    const path = await tempPath("malformed.sqlite");
    const fileRepo = track(createSqliteRepository({ path }));
    await fileRepo.putTodo(todo({ id: "raw-history" }));
    fileRepo.close();
    openRepos.pop();

    const db = new Database(path);
    db.run("UPDATE todos SET rollover_history = ? WHERE id = ?", ["[{}]", "raw-history"]);
    db.close();

    const loaded = track(createSqliteRepository({ path }));
    expect((await loaded.getTodo("raw-history"))?.rolloverHistory).toBeUndefined();
  });

  test("putTodos writes multiple rows", async () => {
    const repo = makeRepo();
    await repo.putTodos([
      todo({ id: "batch-a", order: 0 }),
      todo({ id: "batch-b", order: 1, followUp: true }),
    ]);

    expect(ids(await repo.listTodos())).toEqual(["batch-a", "batch-b"]);
    expect((await repo.getTodo("batch-b"))?.followUp).toBe(true);
  });
});

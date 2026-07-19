import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Category,
  CategoryId,
  Kind,
  KindId,
  RolloverEntry,
  Todo,
  TodoId,
} from "../domain/model";
import {
  DEFAULT_KIND_AGENDA_PLACEMENT,
  DEFAULT_KIND_DATE_POLICY,
  DEFAULT_KIND_NAME,
  DEFAULT_KIND_ROLLOVER,
  parseDateString,
} from "../domain/validation";
import { resolveLegacyTodoDataPath, resolveTodoDataPath } from "./data-path";
import { migrateLegacyDataFile } from "./legacy-migration";
import {
  type DeleteCategoryOptions,
  type DeleteCategoryResult,
  type DeleteKindOptions,
  type DeleteKindResult,
  type RepositoryOptions,
  SCHEMA_VERSION,
  StoreCorruptError,
  type StoreSnapshot,
  StoreVersionError,
  type TodoFilter,
  type TodoRepository,
} from "./repository";

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS kinds (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, date_policy TEXT NOT NULL,
  rollover TEXT NOT NULL, agenda_placement TEXT NOT NULL,
  color TEXT, emoji TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, emoji TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, status TEXT NOT NULL,
  "order" INTEGER NOT NULL, category_id TEXT, kind_id TEXT, emoji TEXT, scheduled_time INTEGER,
  duration INTEGER, completed_at TEXT, deleted_at TEXT, caused_by TEXT,
  rollover_count INTEGER NOT NULL DEFAULT 0,
  rollover_history TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

type TodoRow = {
  id: string;
  name: string;
  date: string | null;
  status: string;
  order: number;
  category_id: string | null;
  kind_id: string | null;
  emoji: string | null;
  scheduled_time: number | null;
  duration: number | null;
  completed_at: string | null;
  deleted_at: string | null;
  caused_by: string | null;
  rollover_count: number;
  rollover_history: string | null;
  created_at: string;
  updated_at: string;
};

type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  created_at: string;
  updated_at: string;
};

type KindRow = {
  id: string;
  name: string;
  date_policy: string;
  rollover: string;
  agenda_placement: string;
  color: string | null;
  emoji: string | null;
  created_at: string;
  updated_at: string;
};

const TODO_UPSERT = `INSERT OR REPLACE INTO todos (
  id, name, date, status, "order", category_id, kind_id, emoji, scheduled_time,
  duration, completed_at, deleted_at, caused_by, rollover_count, rollover_history,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const CATEGORY_UPSERT = `INSERT OR REPLACE INTO categories (
  id, name, color, emoji, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)`;

const KIND_UPSERT = `INSERT OR REPLACE INTO kinds (
  id, name, date_policy, rollover, agenda_placement, color, emoji, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function isRolloverEntry(value: unknown): value is RolloverEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.fromDate !== "string" ||
    typeof entry.toDate !== "string" ||
    typeof entry.rolledOverAt !== "string" ||
    entry.rolledOverAt.length === 0
  ) {
    return false;
  }
  try {
    const fromDate = parseDateString(entry.fromDate);
    const toDate = parseDateString(entry.toDate);
    return fromDate < toDate;
  } catch {
    return false;
  }
}

function parseStoredHistory(raw: string | null): RolloverEntry[] | undefined {
  if (raw === null || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    if (!parsed.every(isRolloverEntry)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function mapTodoRow(row: TodoRow): Todo {
  const todo: Todo = {
    id: row.id,
    name: row.name,
    status: row.status as Todo["status"],
    order: row.order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.date !== null && row.date.length > 0) todo.date = row.date;
  applyOptionalRowFields(todo, row);
  applyStoredCausedByAndRollover(todo, row);
  return todo;
}

function applyOptionalRowFields(todo: Todo, row: TodoRow): void {
  if (row.category_id !== null) todo.categoryId = row.category_id;
  if (row.kind_id !== null) todo.kindId = row.kind_id;
  if (row.emoji !== null) todo.emoji = row.emoji;
  if (row.scheduled_time !== null) todo.scheduledTime = row.scheduled_time;
  if (row.duration !== null) todo.duration = row.duration as NonNullable<Todo["duration"]>;
  if (row.completed_at !== null) todo.completedAt = row.completed_at;
  if (row.deleted_at !== null) todo.deletedAt = row.deleted_at;
}

function applyStoredCausedByAndRollover(todo: Todo, row: TodoRow): void {
  if (row.caused_by !== null) todo.causedBy = row.caused_by;
  if (Number.isInteger(row.rollover_count) && row.rollover_count > 0) {
    todo.rolloverCount = row.rollover_count;
  }
  const history = parseStoredHistory(row.rollover_history);
  if (history !== undefined) todo.rolloverHistory = history;
}

function mapCategoryRow(row: CategoryRow): Category {
  const category: Category = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.color !== null) category.color = row.color;
  if (row.emoji !== null) category.emoji = row.emoji;
  return category;
}

function mapKindRow(row: KindRow): Kind {
  const kind: Kind = {
    id: row.id,
    name: row.name,
    datePolicy: row.date_policy as Kind["datePolicy"],
    rollover: row.rollover as Kind["rollover"],
    agendaPlacement: row.agenda_placement as Kind["agendaPlacement"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.color !== null) kind.color = row.color;
  if (row.emoji !== null) kind.emoji = row.emoji;
  return kind;
}

function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function storedRolloverHistory(todo: Todo): string | null {
  return todo.rolloverHistory !== undefined && todo.rolloverHistory.length > 0
    ? JSON.stringify(todo.rolloverHistory)
    : null;
}

function todoParams(todo: Todo): Array<string | number | null> {
  return [
    todo.id,
    todo.name,
    nullable(todo.date),
    todo.status,
    todo.order,
    nullable(todo.categoryId),
    nullable(todo.kindId),
    nullable(todo.emoji),
    nullable(todo.scheduledTime),
    nullable(todo.duration),
    nullable(todo.completedAt),
    nullable(todo.deletedAt),
    nullable(todo.causedBy),
    todo.rolloverCount ?? 0,
    storedRolloverHistory(todo),
    todo.createdAt,
    todo.updatedAt,
  ];
}

function categoryParams(category: Category): Array<string | number | null> {
  return [
    category.id,
    category.name,
    category.color ?? null,
    category.emoji ?? null,
    category.createdAt,
    category.updatedAt,
  ];
}

function kindParams(kind: Kind): Array<string | number | null> {
  return [
    kind.id,
    kind.name,
    kind.datePolicy,
    kind.rollover,
    kind.agendaPlacement,
    kind.color ?? null,
    kind.emoji ?? null,
    kind.createdAt,
    kind.updatedAt,
  ];
}

function buildTodoWhere(filter: TodoFilter = {}): {
  clause: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const comparisons: Array<[value: string | undefined, sql: string]> = [
    [filter.date, "date = ?"],
    [filter.dateFrom, "date >= ?"],
    [filter.dateTo, "date <= ?"],
    [filter.categoryId, "category_id = ?"],
    [filter.kindId, "kind_id = ?"],
    [filter.status, "status = ?"],
  ];
  for (const [value, sql] of comparisons) {
    if (value !== undefined) {
      conditions.push(sql);
      params.push(value);
    }
  }

  if (filter.undated === true) conditions.push("date IS NULL");
  if (filter.scheduled === true) conditions.push("scheduled_time IS NOT NULL");
  else if (filter.scheduled === false) conditions.push("scheduled_time IS NULL");
  if (filter.causedBy !== undefined) {
    conditions.push("caused_by = ?");
    params.push(filter.causedBy);
  }
  if (filter.includeDeleted !== true) conditions.push("deleted_at IS NULL");

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return { clause, params };
}

function todoColumnNames(db: Database): Set<string> {
  return new Set(
    (db.query("PRAGMA table_info(todos)").all() as Array<{ name: string }>).map((col) => col.name),
  );
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function addColumnIfMissing(db: Database, columns: Set<string>, name: string, ddl: string): void {
  if (!columns.has(name)) db.run(ddl);
}

function addRolloverColumns(db: Database, columns: Set<string>): void {
  addColumnIfMissing(
    db,
    columns,
    "rollover_count",
    "ALTER TABLE todos ADD COLUMN rollover_count INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    db,
    columns,
    "rollover_history",
    "ALTER TABLE todos ADD COLUMN rollover_history TEXT",
  );
}

function addCausedByColumn(db: Database, columns: Set<string>): void {
  addColumnIfMissing(db, columns, "caused_by", "ALTER TABLE todos ADD COLUMN caused_by TEXT");
}

function seedDefaultKind(db: Database): string {
  const existing = db.query("SELECT id FROM kinds ORDER BY created_at ASC, id ASC").get() as {
    id: string;
  } | null;
  if (existing !== null) return existing.id;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO kinds (id, name, date_policy, rollover, agenda_placement, color, emoji, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [
      id,
      DEFAULT_KIND_NAME,
      DEFAULT_KIND_DATE_POLICY,
      DEFAULT_KIND_ROLLOVER,
      DEFAULT_KIND_AGENDA_PLACEMENT,
      timestamp,
      timestamp,
    ],
  );
  return id;
}

function dateColumnIsRequired(db: Database): boolean {
  const columns = db.query("PRAGMA table_info(todos)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  return columns.some((column) => column.name === "date" && column.notnull === 1);
}

function rebuildTodosWithNullableDate(db: Database): void {
  db.run(`
CREATE TABLE todos_v4 (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, status TEXT NOT NULL,
  "order" INTEGER NOT NULL, category_id TEXT, kind_id TEXT, emoji TEXT, scheduled_time INTEGER,
  duration INTEGER, completed_at TEXT, deleted_at TEXT, caused_by TEXT,
  rollover_count INTEGER NOT NULL DEFAULT 0,
  rollover_history TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
  db.run(`
INSERT INTO todos_v4 (
  id, name, date, status, "order", category_id, kind_id, emoji, scheduled_time,
  duration, completed_at, deleted_at, caused_by, rollover_count, rollover_history,
  created_at, updated_at
)
SELECT
  id, name, date, status, "order", category_id, kind_id, emoji, scheduled_time,
  duration, completed_at, deleted_at, caused_by, rollover_count, rollover_history,
  created_at, updated_at
FROM todos`);
  db.run("DROP TABLE todos");
  db.run("ALTER TABLE todos_v4 RENAME TO todos");
  db.run("CREATE INDEX IF NOT EXISTS idx_todos_date_status ON todos (date, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_todos_category ON todos (category_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_todos_kind ON todos (kind_id)");
}

function addKindsAndNullableDate(db: Database): void {
  const columns = todoColumnNames(db);
  addColumnIfMissing(db, columns, "kind_id", "ALTER TABLE todos ADD COLUMN kind_id TEXT");
  const defaultKindId = seedDefaultKind(db);
  db.run("UPDATE todos SET kind_id = ? WHERE kind_id IS NULL", [defaultKindId]);
  if (dateColumnIsRequired(db)) {
    rebuildTodosWithNullableDate(db);
  }
}

function applySchemaMigrations(db: Database, uv: number): void {
  const columns = todoColumnNames(db);
  if (uv > 0 && uv < 2) addRolloverColumns(db, columns);
  if (uv > 0 && uv < 3) addCausedByColumn(db, columns);
  if (uv > 0 && uv < 4) addKindsAndNullableDate(db);
}

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_todos_date_status ON todos (date, status);
CREATE INDEX IF NOT EXISTS idx_todos_category ON todos (category_id);
CREATE INDEX IF NOT EXISTS idx_todos_kind ON todos (kind_id);
`;

function migrateSchema(db: Database, path: string): void {
  const uv = userVersion(db);
  if (uv > SCHEMA_VERSION) throw new StoreVersionError(path, uv);
  db.run(SCHEMA_DDL);
  applySchemaMigrations(db, uv);
  db.run(INDEX_DDL);
  if (uv < SCHEMA_VERSION) {
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

const TODO_ORDER_BY = ` ORDER BY date ASC, "order" ASC, id ASC`;
const CATEGORY_ORDER_BY = ` ORDER BY name ASC, id ASC`;
const KIND_ORDER_BY = ` ORDER BY name ASC, id ASC`;

export function createSqliteRepository(options?: RepositoryOptions): TodoRepository {
  const path = options?.path === ":memory:" ? ":memory:" : resolveTodoDataPath(options?.path);

  if (path !== ":memory:") {
    if (options?.path === undefined) migrateLegacyDataFile(resolveLegacyTodoDataPath(), path);
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  try {
    db.transaction(() => {
      migrateSchema(db, path);
    })();
  } catch (error) {
    db.close();
    if (error instanceof StoreVersionError) throw error;
    throw new StoreCorruptError(path, error);
  }

  const todoUpsert = db.query(TODO_UPSERT);
  const categoryUpsert = db.query(CATEGORY_UPSERT);
  const kindUpsert = db.query(KIND_UPSERT);
  const putTodosTransaction = db.transaction((todos: readonly Todo[]) => {
    for (const todo of todos) {
      todoUpsert.run(...todoParams(todo));
    }
  });
  const unassignTodosByCategory = db.query(
    "UPDATE todos SET category_id = NULL, updated_at = ? WHERE category_id = ?",
  );
  const countTodosByCategory = db.query(
    "SELECT COUNT(*) AS count FROM todos WHERE category_id = ?",
  );
  const deleteCategoryRow = db.query("DELETE FROM categories WHERE id = ?");
  const deleteCategoryTransaction = db.transaction(
    (id: CategoryId, options: DeleteCategoryOptions): DeleteCategoryResult => {
      const { count: referencedTodoCount } = countTodosByCategory.get(id) as { count: number };
      if (referencedTodoCount > 0 && !options.force) {
        return { deleted: false, referencedTodoCount };
      }
      if (options.force) {
        unassignTodosByCategory.run(options.updatedAt, id);
      }
      const deleteResult = deleteCategoryRow.run(id);
      return { deleted: deleteResult.changes > 0, referencedTodoCount };
    },
  );
  const unassignTodosByKind = db.query(
    "UPDATE todos SET kind_id = NULL, updated_at = ? WHERE kind_id = ?",
  );
  const countTodosByKind = db.query("SELECT COUNT(*) AS count FROM todos WHERE kind_id = ?");
  const deleteKindRow = db.query("DELETE FROM kinds WHERE id = ?");
  const deleteKindTransaction = db.transaction(
    (id: KindId, options: DeleteKindOptions): DeleteKindResult => {
      const { count: referencedTodoCount } = countTodosByKind.get(id) as { count: number };
      if (referencedTodoCount > 0 && !options.force) {
        return { deleted: false, referencedTodoCount };
      }
      if (options.force) {
        unassignTodosByKind.run(options.updatedAt, id);
      }
      const deleteResult = deleteKindRow.run(id);
      return { deleted: deleteResult.changes > 0, referencedTodoCount };
    },
  );

  return {
    async listTodos(filter?: TodoFilter): Promise<Todo[]> {
      const { clause, params } = buildTodoWhere(filter);
      const rows = db
        .query(`SELECT * FROM todos${clause}${TODO_ORDER_BY}`)
        .all(...params) as TodoRow[];
      return rows.map(mapTodoRow);
    },

    async getTodo(id: TodoId): Promise<Todo | undefined> {
      const row = db.query("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | null;
      return row === null ? undefined : mapTodoRow(row);
    },

    async putTodo(todo: Todo): Promise<void> {
      todoUpsert.run(...todoParams(todo));
    },

    async putTodos(todos: readonly Todo[]): Promise<void> {
      putTodosTransaction(todos);
    },

    async listCategories(): Promise<Category[]> {
      const rows = db.query(`SELECT * FROM categories${CATEGORY_ORDER_BY}`).all() as CategoryRow[];
      return rows.map(mapCategoryRow);
    },

    async getCategory(id: CategoryId): Promise<Category | undefined> {
      const row = db.query("SELECT * FROM categories WHERE id = ?").get(id) as CategoryRow | null;
      return row === null ? undefined : mapCategoryRow(row);
    },

    async putCategory(category: Category): Promise<void> {
      categoryUpsert.run(...categoryParams(category));
    },

    async deleteCategory(
      id: CategoryId,
      options: DeleteCategoryOptions,
    ): Promise<DeleteCategoryResult> {
      return deleteCategoryTransaction.immediate(id, options);
    },

    async listKinds(): Promise<Kind[]> {
      const rows = db.query(`SELECT * FROM kinds${KIND_ORDER_BY}`).all() as KindRow[];
      return rows.map(mapKindRow);
    },

    async getKind(id: KindId): Promise<Kind | undefined> {
      const row = db.query("SELECT * FROM kinds WHERE id = ?").get(id) as KindRow | null;
      return row === null ? undefined : mapKindRow(row);
    },

    async putKind(kind: Kind): Promise<void> {
      kindUpsert.run(...kindParams(kind));
    },

    async deleteKind(id: KindId, options: DeleteKindOptions): Promise<DeleteKindResult> {
      return deleteKindTransaction.immediate(id, options);
    },

    async exportSnapshot(): Promise<StoreSnapshot> {
      const todoRows = db.query(`SELECT * FROM todos${TODO_ORDER_BY}`).all() as TodoRow[];
      const categoryRows = db
        .query(`SELECT * FROM categories${CATEGORY_ORDER_BY}`)
        .all() as CategoryRow[];
      const kindRows = db.query(`SELECT * FROM kinds${KIND_ORDER_BY}`).all() as KindRow[];
      return {
        version: SCHEMA_VERSION,
        todos: todoRows.map(mapTodoRow),
        categories: categoryRows.map(mapCategoryRow),
        kinds: kindRows.map(mapKindRow),
      };
    },

    async importSnapshot(snapshot: StoreSnapshot): Promise<void> {
      if (snapshot.version !== SCHEMA_VERSION) {
        throw new StoreVersionError(path, snapshot.version);
      }
      const replaceAll = db.transaction(() => {
        db.run("DELETE FROM todos");
        db.run("DELETE FROM categories");
        db.run("DELETE FROM kinds");
        for (const kind of snapshot.kinds) {
          kindUpsert.run(...kindParams(kind));
        }
        for (const category of snapshot.categories) {
          categoryUpsert.run(...categoryParams(category));
        }
        for (const todo of snapshot.todos) {
          todoUpsert.run(...todoParams(todo));
        }
      });
      replaceAll();
    },

    close(): void {
      db.close();
    },
  };
}

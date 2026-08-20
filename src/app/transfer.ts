import type { Category, RolloverEntry, Todo, TodoStatus } from "../domain/model";
import { parseDateString, parseMinuteOfDay, parseTodoDuration } from "../domain/validation";
import { SCHEMA_VERSION, type StoreSnapshot, type TodoRepository } from "../storage/repository";
import { ValidationError } from "./errors";
import { asValidationError } from "./service-support";

export async function exportData(repo: TodoRepository): Promise<StoreSnapshot> {
  return {
    version: SCHEMA_VERSION,
    todos: await repo.listTodos(),
    categories: await repo.listCategories(),
  };
}

export async function importData(
  repo: TodoRepository,
  payload: unknown,
): Promise<{ todos: number; categories: number }> {
  if (!isRecord(payload)) {
    throw new ValidationError(
      "Import payload must be an object with version, todos, and categories",
    );
  }

  const { version, todos: rawTodos, categories: rawCategories } = payload;
  if (typeof version !== "number" || !Array.isArray(rawTodos) || !Array.isArray(rawCategories)) {
    throw new ValidationError(
      "Import payload must be an object with version, todos, and categories",
    );
  }

  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    throw new ValidationError(
      `Import payload uses unsupported schema version ${version} (supported: ${SCHEMA_VERSION})`,
    );
  }

  const categories = rawCategories.map((raw, index) =>
    asValidationError(() => parseCategory(raw), `Category[${index}]`),
  );
  const todos = rawTodos.map((raw, index) =>
    asValidationError(() => parseTodo(raw), `Todo[${index}]`),
  );

  assertTodoReferences(todos, new Set(categories.map((category) => category.id)));

  await repo.importSnapshot({ version: SCHEMA_VERSION, todos, categories });
  return { todos: todos.length, categories: categories.length };
}

function assertTodoReferences(todos: readonly Todo[], categoryIds: Set<string>): void {
  const todoIds = new Set(todos.map((todo) => todo.id));
  for (const todo of todos) {
    if (todo.categoryId !== undefined && !categoryIds.has(todo.categoryId)) {
      throw new ValidationError(
        `Todo "${todo.id}" references unknown category "${todo.categoryId}"`,
      );
    }
    if (todo.causedBy === undefined) continue;
    if (todo.causedBy === todo.id) {
      throw new ValidationError(`Todo "${todo.id}" cannot be caused by itself`);
    }
    if (!todoIds.has(todo.causedBy)) {
      throw new ValidationError(`Todo "${todo.id}" references unknown causedBy "${todo.causedBy}"`);
    }
  }
  if (causedByGraphHasCycle(todos)) {
    throw new ValidationError("causedBy graph contains a cycle");
  }
}

function causedByGraphHasCycle(todos: readonly Todo[]): boolean {
  const parentOf = new Map<string, string>();
  for (const todo of todos) {
    if (todo.causedBy !== undefined) parentOf.set(todo.id, todo.causedBy);
  }
  const verified = new Set<string>();
  for (const start of parentOf.keys()) {
    if (parentChainCycles(start, parentOf, verified)) return true;
  }
  return false;
}

function parentChainCycles(
  start: string,
  parentOf: ReadonlyMap<string, string>,
  verified: Set<string>,
): boolean {
  if (verified.has(start)) return false;
  const chain = new Set<string>();
  let current: string | undefined = start;
  while (current !== undefined) {
    if (verified.has(current)) break;
    if (chain.has(current)) return true;
    chain.add(current);
    current = parentOf.get(current);
  }
  for (const id of chain) verified.add(id);
  return false;
}

function parseCategory(raw: unknown): Category {
  if (!isRecord(raw)) throw new Error("must be an object");

  const category: Category = {
    id: requireString(raw, "id"),
    name: requireString(raw, "name"),
    createdAt: requireString(raw, "createdAt"),
    updatedAt: requireString(raw, "updatedAt"),
  };

  const color = optionalString(raw, "color");
  if (color !== undefined) category.color = color;
  const emoji = optionalString(raw, "emoji");
  if (emoji !== undefined) category.emoji = emoji;

  return category;
}

function parseTodo(raw: unknown): Todo {
  if (!isRecord(raw)) throw new Error("must be an object");

  const todo: Todo = {
    id: requireString(raw, "id"),
    name: requireString(raw, "name"),
    date: parseDateString(requireString(raw, "date")),
    status: parseStatus(raw.status),
    order: requireNumber(raw, "order"),
    createdAt: requireString(raw, "createdAt"),
    updatedAt: requireString(raw, "updatedAt"),
  };
  applyOptionalTodoFields(todo, raw);
  applyCausedByAndRollover(todo, raw);
  return todo;
}

function applyOptionalTodoFields(todo: Todo, raw: Record<string, unknown>): void {
  if (raw.scheduledTime !== undefined) {
    todo.scheduledTime = parseMinuteOfDay(requireNumber(raw, "scheduledTime"));
  }
  if (raw.duration !== undefined) {
    todo.duration = parseTodoDuration(String(requireNumber(raw, "duration")));
  }
  const categoryId = optionalString(raw, "categoryId");
  if (categoryId !== undefined) todo.categoryId = categoryId;
  const emoji = optionalString(raw, "emoji");
  if (emoji !== undefined) todo.emoji = emoji;
  const completedAt = optionalString(raw, "completedAt");
  if (completedAt !== undefined) todo.completedAt = completedAt;
  const deletedAt = optionalString(raw, "deletedAt");
  if (deletedAt !== undefined) todo.deletedAt = deletedAt;
}

function applyCausedByAndRollover(todo: Todo, raw: Record<string, unknown>): void {
  applyCausedBy(todo, raw);
  applyRolloverMetadata(todo, raw);
}

function applyCausedBy(todo: Todo, raw: Record<string, unknown>): void {
  const causedBy = optionalString(raw, "causedBy");
  if (causedBy !== undefined) todo.causedBy = causedBy;
}

function applyRolloverMetadata(todo: Todo, raw: Record<string, unknown>): void {
  if (raw.rolloverCount !== undefined) {
    const count = requireNumber(raw, "rolloverCount");
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("rolloverCount must be a non-negative integer");
    }
    if (count > 0) todo.rolloverCount = count;
  }
  if (raw.rolloverHistory !== undefined) {
    const history = parseRolloverHistory(raw.rolloverHistory);
    if (history.length > 0) todo.rolloverHistory = history;
  }
}

function parseRolloverHistory(value: unknown): RolloverEntry[] {
  if (!Array.isArray(value)) throw new Error("rolloverHistory must be an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`rolloverHistory[${index}] must be an object`);
    const fromDate = parseDateString(requireString(entry, "fromDate"));
    const toDate = parseDateString(requireString(entry, "toDate"));
    if (fromDate >= toDate) {
      throw new Error(`rolloverHistory[${index}] must move to a later date`);
    }
    return {
      fromDate,
      toDate,
      rolledOverAt: requireString(entry, "rolledOverAt"),
    };
  });
}

function parseStatus(value: unknown): TodoStatus {
  if (value !== "open" && value !== "done") {
    throw new Error(`status must be "open" or "done"`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`${key} must be a number`);
  return value;
}

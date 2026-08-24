import type {
  Category,
  Kind,
  KindAgendaPlacement,
  KindDatePolicy,
  KindRolloverPolicy,
  RolloverEntry,
  Todo,
  TodoStatus,
} from "../domain/model";
import {
  parseDateString,
  parseKindAgendaPlacement,
  parseKindDatePolicy,
  parseKindRollover,
  parseMinuteOfDay,
  parseTodoDuration,
} from "../domain/validation";
import { SCHEMA_VERSION, type StoreSnapshot, type TodoRepository } from "../storage/repository";
import { ValidationError } from "./errors";
import { asValidationError } from "./service-support";

export async function exportData(repo: TodoRepository): Promise<StoreSnapshot> {
  return {
    version: SCHEMA_VERSION,
    todos: await repo.listTodos(),
    categories: await repo.listCategories(),
    kinds: await repo.listKinds(),
  };
}

export async function importData(
  repo: TodoRepository,
  payload: unknown,
): Promise<{ todos: number; categories: number; kinds: number }> {
  if (!isRecord(payload)) {
    throw new ValidationError(
      "Import payload must be an object with version, todos, and categories",
    );
  }

  const { version, todos: rawTodos, categories: rawCategories, kinds: rawKinds } = payload;
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

  if (version >= 4 && !Array.isArray(rawKinds)) {
    throw new ValidationError("Import payload must include a kinds array");
  }

  const kinds = (Array.isArray(rawKinds) ? rawKinds : []).map((raw, index) =>
    asValidationError(() => parseKind(raw), `Kind[${index}]`),
  );
  const categories = rawCategories.map((raw, index) =>
    asValidationError(() => parseCategory(raw), `Category[${index}]`),
  );
  const todos = rawTodos.map((raw, index) =>
    asValidationError(() => parseTodo(raw, version), `Todo[${index}]`),
  );

  assertTodoReferences(
    todos,
    new Set(categories.map((category) => category.id)),
    new Map(kinds.map((kind) => [kind.id, kind])),
  );

  await repo.importSnapshot({ version: SCHEMA_VERSION, todos, categories, kinds });
  return { todos: todos.length, categories: categories.length, kinds: kinds.length };
}

function assertTodoReferences(
  todos: readonly Todo[],
  categoryIds: Set<string>,
  kinds: ReadonlyMap<string, Kind>,
): void {
  const todoIds = new Set(todos.map((todo) => todo.id));
  for (const todo of todos) {
    assertCategoryRef(todo, categoryIds);
    assertKindRef(todo, kinds);
    assertCausedByRef(todo, todoIds);
  }
  if (causedByGraphHasCycle(todos)) {
    throw new ValidationError("causedBy graph contains a cycle");
  }
}

function assertCategoryRef(todo: Todo, categoryIds: Set<string>): void {
  if (todo.categoryId !== undefined && !categoryIds.has(todo.categoryId)) {
    throw new ValidationError(`Todo "${todo.id}" references unknown category "${todo.categoryId}"`);
  }
}

function assertKindRef(todo: Todo, kinds: ReadonlyMap<string, Kind>): void {
  if (todo.kindId === undefined) return;
  const kind = kinds.get(todo.kindId);
  if (kind === undefined) {
    throw new ValidationError(`Todo "${todo.id}" references unknown kind "${todo.kindId}"`);
  }
  assertDateMatchesKind(todo, kind);
}

function assertCausedByRef(todo: Todo, todoIds: Set<string>): void {
  if (todo.causedBy === undefined) return;
  if (todo.causedBy === todo.id) {
    throw new ValidationError(`Todo "${todo.id}" cannot be caused by itself`);
  }
  if (!todoIds.has(todo.causedBy)) {
    throw new ValidationError(`Todo "${todo.id}" references unknown causedBy "${todo.causedBy}"`);
  }
}

function assertDateMatchesKind(todo: Todo, kind: Kind): void {
  if (kind.datePolicy === "required" && todo.date === undefined) {
    throw new ValidationError(
      `Todo "${todo.id}" is missing a date required by kind "${kind.name}"`,
    );
  }
  if (kind.datePolicy === "none" && todo.date !== undefined) {
    throw new ValidationError(`Todo "${todo.id}" has a date forbidden by kind "${kind.name}"`);
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

function parseKind(raw: unknown): Kind {
  if (!isRecord(raw)) throw new Error("must be an object");

  const kind: Kind = {
    id: requireString(raw, "id"),
    name: requireString(raw, "name"),
    datePolicy: parseKindDatePolicy(requireString(raw, "datePolicy")) as KindDatePolicy,
    rollover: parseKindRollover(requireString(raw, "rollover")) as KindRolloverPolicy,
    agendaPlacement: parseKindAgendaPlacement(
      requireString(raw, "agendaPlacement"),
    ) as KindAgendaPlacement,
    createdAt: requireString(raw, "createdAt"),
    updatedAt: requireString(raw, "updatedAt"),
  };

  const color = optionalString(raw, "color");
  if (color !== undefined) kind.color = color;
  const emoji = optionalString(raw, "emoji");
  if (emoji !== undefined) kind.emoji = emoji;

  return kind;
}

function parseTodo(raw: unknown, version: number): Todo {
  if (!isRecord(raw)) throw new Error("must be an object");

  const todo: Todo = {
    id: requireString(raw, "id"),
    name: requireString(raw, "name"),
    status: parseStatus(raw.status),
    order: requireNumber(raw, "order"),
    createdAt: requireString(raw, "createdAt"),
    updatedAt: requireString(raw, "updatedAt"),
  };
  if (raw.date !== undefined) {
    todo.date = parseDateString(requireString(raw, "date"));
  } else if (version < 4) {
    throw new Error("date is required");
  }
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
  const kindId = optionalString(raw, "kindId");
  if (kindId !== undefined) todo.kindId = kindId;
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

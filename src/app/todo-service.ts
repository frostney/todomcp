import type { RolloverEntry, Todo } from "../domain/model";
import { parseClockTime, parseDateString, parseTodoDuration } from "../domain/validation";
import type { TodoFilter, TodoRepository } from "../storage/repository";
import { type Clock, systemClock } from "./clock";
import { ValidationError } from "./errors";
import { asValidationError, requireName, resolveByIdentifier } from "./service-support";

export type AddTodoInput = {
  name: string;
  date?: string;
  scheduledTime?: string;
  duration?: string;
  categoryId?: string;
  emoji?: string;
  followUp?: boolean;
};

export type EditTodoInput = {
  name?: string;
  scheduledTime?: string;
  duration?: string;
  categoryId?: string;
  emoji?: string;
};

export type MoveTodoInput = {
  date: string;
};

export type RolloverResult = {
  date: string;
  count: number;
  todos: Todo[];
};

export interface TodoService {
  add(input: AddTodoInput): Promise<Todo>;
  list(filter?: TodoFilter): Promise<Todo[]>;
  get(idOrPrefix: string): Promise<Todo>;
  complete(idOrPrefix: string): Promise<Todo>;
  edit(idOrPrefix: string, changes: EditTodoInput): Promise<Todo>;
  move(idOrPrefix: string, move: MoveTodoInput): Promise<Todo>;
  remove(idOrPrefix: string): Promise<Todo>;
  setFollowUp(idOrPrefix: string, followUp: boolean): Promise<Todo>;
  rollover(ids?: readonly string[]): Promise<RolloverResult>;
}

type OptionalTodoFields = Pick<Todo, "categoryId" | "emoji" | "scheduledTime" | "duration">;

function applyOptionalFields(target: Partial<OptionalTodoFields>, input: EditTodoInput): void {
  if (input.scheduledTime !== undefined) {
    target.scheduledTime = asValidationError(() => parseClockTime(input.scheduledTime as string));
  }
  if (input.duration !== undefined) {
    target.duration = asValidationError(() => parseTodoDuration(input.duration as string));
  }
  if (input.categoryId !== undefined) {
    target.categoryId = input.categoryId;
  }
  if (input.emoji !== undefined) {
    target.emoji = input.emoji;
  }
}

function localDateOf(iso: string): string {
  const at = new Date(iso);
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function withFollowUp(todo: Todo, followUp: boolean): Todo {
  const { followUp: _ignored, ...rest } = todo;
  return followUp ? { ...rest, followUp: true } : rest;
}

async function resolveRolloverCandidates(
  ids: readonly string[] | undefined,
  today: string,
  resolve: (idOrPrefix: string) => Promise<Todo>,
  listTodos: () => Promise<Todo[]>,
): Promise<Todo[]> {
  const unfinishedPast = (todo: Todo) =>
    todo.status !== "done" && todo.deletedAt === undefined && todo.date < today;

  if (ids === undefined || ids.length === 0) {
    return (await listTodos()).filter(unfinishedPast);
  }

  const candidates: Todo[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const todo = await resolve(id);
    if (!unfinishedPast(todo)) {
      throw new ValidationError(`Todo ${todo.id} is not an unfinished item dated before ${today}`);
    }
    if (seen.has(todo.id)) {
      throw new ValidationError(`Todo ${todo.id} was specified more than once`);
    }
    seen.add(todo.id);
    candidates.push(todo);
  }
  return candidates;
}

export function createTodoService(repo: TodoRepository, clock: Clock = systemClock): TodoService {
  async function nextOrder(date: string): Promise<number> {
    const existing = await repo.listTodos({ date, includeDeleted: true });
    const maxOrder = existing.reduce((max, todo) => Math.max(max, todo.order), -1);
    return maxOrder + 1;
  }

  function resolve(idOrPrefix: string): Promise<Todo> {
    return resolveByIdentifier(
      {
        getExact: (id) => repo.getTodo(id),
        listAll: () => repo.listTodos({ includeDeleted: true }),
        matches: (todo, query) => todo.id.startsWith(query),
        describe: "todo",
      },
      idOrPrefix,
    );
  }

  async function persist(todo: Todo): Promise<Todo> {
    await repo.putTodo(todo);
    return todo;
  }

  return {
    async add(input) {
      const name = requireName(input.name, "Todo");
      const date =
        input.date !== undefined
          ? asValidationError(() => parseDateString(input.date as string))
          : localDateOf(clock());
      const timestamp = clock();
      const todo: Todo = {
        id: crypto.randomUUID(),
        name,
        date,
        status: "open",
        order: await nextOrder(date),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      applyOptionalFields(todo, input);
      if (input.followUp === true) todo.followUp = true;
      return persist(todo);
    },

    async list(filter) {
      for (const value of [filter?.date, filter?.dateFrom, filter?.dateTo]) {
        if (value !== undefined) asValidationError(() => parseDateString(value));
      }
      return repo.listTodos(filter);
    },

    get(idOrPrefix) {
      return resolve(idOrPrefix);
    },

    async complete(idOrPrefix) {
      const existing = await resolve(idOrPrefix);
      const timestamp = clock();
      return persist({ ...existing, status: "done", completedAt: timestamp, updatedAt: timestamp });
    },

    async edit(idOrPrefix, changes) {
      const existing = await resolve(idOrPrefix);
      const updated: Todo = { ...existing, updatedAt: clock() };
      if (changes.name !== undefined) {
        updated.name = requireName(changes.name, "Todo");
      }
      applyOptionalFields(updated, changes);
      return persist(updated);
    },

    async move(idOrPrefix, move) {
      const existing = await resolve(idOrPrefix);
      const date = asValidationError(() => parseDateString(move.date));
      return persist({ ...existing, date, order: await nextOrder(date), updatedAt: clock() });
    },

    async remove(idOrPrefix) {
      const existing = await resolve(idOrPrefix);
      const timestamp = clock();
      return persist({ ...existing, deletedAt: timestamp, updatedAt: timestamp });
    },

    async setFollowUp(idOrPrefix, followUp) {
      const existing = await resolve(idOrPrefix);
      return persist({ ...withFollowUp(existing, followUp), updatedAt: clock() });
    },

    async rollover(ids) {
      const timestamp = clock();
      const today = localDateOf(timestamp);
      const candidates = await resolveRolloverCandidates(ids, today, resolve, () =>
        repo.listTodos(),
      );

      if (candidates.length === 0) {
        return { date: today, count: 0, todos: [] };
      }

      let order = await nextOrder(today);
      const rolled: Todo[] = candidates.map((todo) => {
        const entry: RolloverEntry = {
          fromDate: todo.date,
          toDate: today,
          rolledOverAt: timestamp,
        };
        const history = [...(todo.rolloverHistory ?? []), entry];
        return {
          ...todo,
          date: today,
          order: order++,
          rolloverCount: (todo.rolloverCount ?? 0) + 1,
          rolloverHistory: history,
          updatedAt: timestamp,
        };
      });
      await repo.putTodos(rolled);
      return { date: today, count: rolled.length, todos: rolled };
    },
  };
}

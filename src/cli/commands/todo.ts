import { buildCommand } from "@stricli/core";
import { ValidationError } from "../../app/errors";
import type { AddTodoInput, EditTodoInput } from "../../app/todo-service";
import type { Todo } from "../../domain/model";
import type { TodoFilter } from "../../storage/repository";
import type { AppContext } from "../context";
import { formatJson, formatTable } from "../output";
import { type CommonFlags, commonFlags, withServices } from "./shared";

const attributeFlags = {
  time: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Scheduled time (HH:MM).",
  },
  duration: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Duration (15, 30, or 60).",
  },
  category: { kind: "parsed", parse: String, optional: true, brief: "Category name or id." },
  kind: { kind: "parsed", parse: String, optional: true, brief: "Kind name or id." },
  emoji: { kind: "parsed", parse: String, optional: true, brief: "Emoji." },
} as const;

function formatTime(scheduledTime: number | undefined): string {
  if (scheduledTime === undefined) {
    return "-";
  }
  const hours = Math.floor(scheduledTime / 60);
  const minutes = scheduledTime % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function displayRow(todo: Todo): Record<string, unknown> {
  return {
    id: todo.id.slice(0, 8),
    date: todo.date ?? "-",
    time: formatTime(todo.scheduledTime),
    dur: todo.duration ?? "-",
    status: todo.status,
    by: todo.causedBy?.slice(0, 8) ?? "-",
    rolls: todo.rolloverCount ?? "-",
    category: todo.categoryId?.slice(0, 8) ?? "-",
    kind: todo.kindId?.slice(0, 8) ?? "-",
    emoji: todo.emoji ?? "-",
    name: todo.name,
  };
}

function renderTodo(todo: Todo, json: boolean | undefined): string {
  return json ? formatJson(todo) : formatTable([displayRow(todo)]);
}

function renderTodos(todos: readonly Todo[], json: boolean | undefined): string {
  return json ? formatJson(todos) : formatTable(todos.map(displayRow));
}

function resolveScheduledFilter(
  scheduled: boolean | undefined,
  unscheduled: boolean | undefined,
): boolean | undefined {
  if (scheduled && unscheduled) {
    throw new ValidationError("Pass only one of --scheduled or --unscheduled");
  }
  if (scheduled) return true;
  if (unscheduled) return false;
  return undefined;
}

type AddFlags = CommonFlags & {
  date?: string;
  time?: string;
  duration?: string;
  category?: string;
  kind?: string;
  emoji?: string;
};

export const add = buildCommand<AddFlags, [string], AppContext>({
  docs: { brief: "Add a todo." },
  parameters: {
    flags: {
      ...commonFlags,
      date: { kind: "parsed", parse: String, optional: true, brief: "Due date (YYYY-MM-DD)." },
      ...attributeFlags,
    },
    positional: {
      kind: "tuple",
      parameters: [{ parse: String, brief: "Todo name.", placeholder: "name" }],
    },
  },
  async func(flags, name) {
    const input: AddTodoInput = { name };
    if (flags.date !== undefined) input.date = flags.date;
    if (flags.time !== undefined) input.scheduledTime = flags.time;
    if (flags.duration !== undefined) input.duration = flags.duration;
    if (flags.emoji !== undefined) input.emoji = flags.emoji;
    const todo = await withServices(this, flags.data, async ({ todos, categories, kinds }) => {
      if (flags.category !== undefined)
        input.categoryId = await categories.resolveId(flags.category);
      if (flags.kind !== undefined) input.kindId = await kinds.resolveId(flags.kind);
      return todos.add(input);
    });
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

type ListFlags = CommonFlags & {
  date?: string;
  from?: string;
  to?: string;
  category?: string;
  kind?: string;
  status?: "open" | "done";
  scheduled?: boolean;
  unscheduled?: boolean;
  causedBy?: string;
  includeDeleted?: boolean;
};

function todoListFilter(flags: ListFlags): TodoFilter {
  const filter: TodoFilter = {};
  if (flags.date !== undefined) filter.date = flags.date;
  if (flags.from !== undefined) filter.dateFrom = flags.from;
  if (flags.to !== undefined) filter.dateTo = flags.to;
  if (flags.status !== undefined) filter.status = flags.status;
  const scheduled = resolveScheduledFilter(flags.scheduled, flags.unscheduled);
  if (scheduled !== undefined) filter.scheduled = scheduled;
  if (flags.includeDeleted) filter.includeDeleted = true;
  return filter;
}

export const list = buildCommand<ListFlags, [], AppContext>({
  docs: { brief: "List todos." },
  parameters: {
    flags: {
      ...commonFlags,
      date: { kind: "parsed", parse: String, optional: true, brief: "Filter by exact date." },
      from: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter from date (inclusive).",
      },
      to: { kind: "parsed", parse: String, optional: true, brief: "Filter to date (inclusive)." },
      category: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by category name or id.",
      },
      kind: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by kind name or id.",
      },
      status: {
        kind: "enum",
        values: ["open", "done"],
        optional: true,
        brief: "Filter by status.",
      },
      scheduled: { kind: "boolean", optional: true, brief: "Only scheduled todos." },
      unscheduled: { kind: "boolean", optional: true, brief: "Only unscheduled todos." },
      causedBy: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "List todos caused by this id or prefix.",
      },
      includeDeleted: { kind: "boolean", optional: true, brief: "Include deleted todos." },
    },
  },
  async func(flags) {
    const filter = todoListFilter(flags);
    const todos = await withServices(this, flags.data, async ({ todos, categories, kinds }) => {
      if (flags.category !== undefined)
        filter.categoryId = await categories.resolveId(flags.category);
      if (flags.kind !== undefined) filter.kindId = await kinds.resolveId(flags.kind);
      if (flags.causedBy !== undefined) filter.causedBy = (await todos.get(flags.causedBy)).id;
      return todos.list(filter);
    });
    this.process.stdout.write(renderTodos(todos, flags.json));
  },
});

const idPositional = {
  kind: "tuple",
  parameters: [{ parse: String, brief: "Todo id or prefix.", placeholder: "id" }],
} as const;

export const show = buildCommand<CommonFlags, [string], AppContext>({
  docs: { brief: "Show a todo." },
  parameters: { flags: commonFlags, positional: idPositional },
  async func(flags, id) {
    const todo = await withServices(this, flags.data, ({ todos }) => todos.get(id));
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

export const done = buildCommand<CommonFlags, [string], AppContext>({
  docs: { brief: "Mark a todo as done." },
  parameters: { flags: commonFlags, positional: idPositional },
  async func(flags, id) {
    const todo = await withServices(this, flags.data, ({ todos }) => todos.complete(id));
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

export const deleteCommand = buildCommand<CommonFlags, [string], AppContext>({
  docs: { brief: "Delete a todo." },
  parameters: { flags: commonFlags, positional: idPositional },
  async func(flags, id) {
    const todo = await withServices(this, flags.data, ({ todos }) => todos.remove(id));
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

type EditFlags = CommonFlags & {
  name?: string;
  time?: string;
  duration?: string;
  category?: string;
  kind?: string;
  emoji?: string;
};

export const edit = buildCommand<EditFlags, [string], AppContext>({
  docs: { brief: "Edit a todo." },
  parameters: {
    flags: {
      ...commonFlags,
      name: { kind: "parsed", parse: String, optional: true, brief: "New name." },
      ...attributeFlags,
    },
    positional: idPositional,
  },
  async func(flags, id) {
    const changes: EditTodoInput = {};
    if (flags.name !== undefined) changes.name = flags.name;
    if (flags.time !== undefined) changes.scheduledTime = flags.time;
    if (flags.duration !== undefined) changes.duration = flags.duration;
    if (flags.emoji !== undefined) changes.emoji = flags.emoji;
    const todo = await withServices(this, flags.data, async ({ todos, categories, kinds }) => {
      if (flags.category !== undefined)
        changes.categoryId = await categories.resolveId(flags.category);
      if (flags.kind !== undefined) changes.kindId = await kinds.resolveId(flags.kind);
      return todos.edit(id, changes);
    });
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

export const move = buildCommand<CommonFlags, [string, string], AppContext>({
  docs: { brief: "Move a todo to a new date." },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Todo id or prefix.", placeholder: "id" },
        { parse: String, brief: "Target date (YYYY-MM-DD).", placeholder: "date" },
      ],
    },
  },
  async func(flags, id, date) {
    const todo = await withServices(this, flags.data, ({ todos }) => todos.move(id, { date }));
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

export const followUp = buildCommand<CommonFlags, [string, string], AppContext>({
  docs: { brief: "Create a follow-up todo caused by a parent." },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Parent todo id or prefix.", placeholder: "id" },
        { parse: String, brief: "Follow-up name.", placeholder: "name" },
      ],
    },
  },
  async func(flags, id, name) {
    const todo = await withServices(this, flags.data, ({ todos }) => todos.addFollowUp(id, name));
    this.process.stdout.write(renderTodo(todo, flags.json));
  },
});

export const workstream = buildCommand<CommonFlags, [string], AppContext>({
  docs: { brief: "Show the workstream tree and duration sum for a todo." },
  parameters: { flags: commonFlags, positional: idPositional },
  async func(flags, id) {
    const result = await withServices(this, flags.data, ({ todos }) => todos.workstream(id));
    if (flags.json) {
      this.process.stdout.write(formatJson(result));
      return;
    }
    this.process.stdout.write(`Workstream ${result.root} · ${result.duration}m\n`);
    this.process.stdout.write(formatTable(result.todos.map(displayRow)));
  },
});

export const rollover = buildCommand<CommonFlags, string[], AppContext>({
  docs: {
    brief:
      "Move unfinished past todos to today and record rollover history. Pass ids to roll only those todos.",
  },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "array",
      parameter: { parse: String, brief: "Todo id or prefix to roll over.", placeholder: "id" },
    },
  },
  async func(flags, ...ids) {
    const result = await withServices(this, flags.data, ({ todos }) =>
      todos.rollover(ids.length > 0 ? ids : undefined),
    );
    if (flags.json) {
      this.process.stdout.write(formatJson(result));
      return;
    }
    if (result.count === 0) {
      this.process.stdout.write(`No unfinished todos before ${result.date}.\n`);
      return;
    }
    this.process.stdout.write(`Rolled ${result.count} todo(s) to ${result.date}.\n`);
    this.process.stdout.write(formatTable(result.todos.map(displayRow)));
  },
});

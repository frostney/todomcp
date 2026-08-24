import { describe, expect, test } from "bun:test";
import type { Todo } from "../domain/model";
import type { TodoRepository } from "../storage/repository";
import type { Clock } from "./clock";
import { AmbiguousMatchError, NotFoundError, ValidationError } from "./errors";
import { fixedClock, NOW, registerMemoryRepos, steppingClock } from "./service-test-harness";
import { type AddTodoInput, createTodoService, type TodoService } from "./todo-service";

const TODAY = "2026-06-24";

const makeRepo = registerMemoryRepos();

function makeService(clock: Clock = fixedClock()): { service: TodoService; repo: TodoRepository } {
  const repo = makeRepo();
  return { service: createTodoService(repo, clock), repo };
}

// Spread over a base so absent optionals are never set to `undefined`
// (exactOptionalPropertyTypes rejects { field: undefined }).
function addInput(overrides: Partial<AddTodoInput> = {}): AddTodoInput {
  return { name: "Write tests", ...overrides };
}

const TODO_BASE: Todo = {
  id: "seed",
  name: "Seed",
  date: TODAY,
  status: "open",
  order: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

function seedTodo(repo: TodoRepository, overrides: Partial<Todo> = {}): Promise<void> {
  return repo.putTodo({ ...TODO_BASE, ...overrides });
}

describe("add", () => {
  test("returns an open todo with generated id and defaults", async () => {
    const { service } = makeService();

    const todo = await service.add(addInput({ name: "Buy milk" }));

    expect(todo.id).toBeTruthy();
    expect(todo.name).toBe("Buy milk");
    expect(todo.status).toBe("open");
    expect(todo.date).toBe(TODAY);
    expect(todo.order).toBe(0);
    expect(todo.createdAt).toBe(NOW);
    expect(todo.updatedAt).toBe(NOW);
    expect(todo.completedAt).toBeUndefined();
    expect(todo.deletedAt).toBeUndefined();
  });

  test("stores provided date, time, duration, category, and emoji", async () => {
    const { service } = makeService();

    const todo = await service.add(
      addInput({
        date: "2026-07-01",
        scheduledTime: "09:07",
        duration: "30",
        categoryId: "cat-work",
        emoji: "🚀",
      }),
    );

    expect(todo.date).toBe("2026-07-01");
    expect(todo.scheduledTime).toBe(547);
    expect(todo.duration).toBe(30);
    expect(todo.categoryId).toBe("cat-work");
    expect(todo.emoji).toBe("🚀");
  });

  test("increments order per date", async () => {
    const { service } = makeService();

    const first = await service.add(addInput({ date: TODAY }));
    const second = await service.add(addInput({ date: TODAY }));
    const otherDate = await service.add(addInput({ date: "2026-06-25" }));

    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
    expect(otherDate.order).toBe(0);
  });

  test("rejects an invalid date", async () => {
    const { service } = makeService();

    await expect(service.add(addInput({ date: "2026-13-40" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects an invalid time", async () => {
    const { service } = makeService();

    await expect(service.add(addInput({ scheduledTime: "540" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects an invalid duration", async () => {
    const { service } = makeService();

    await expect(service.add(addInput({ duration: "45" }))).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects an empty or whitespace name", async () => {
    const { service } = makeService();

    await expect(service.add(addInput({ name: "   " }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("list", () => {
  test("delegates to the repo filter by date and status", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "open-today", date: TODAY, status: "open", order: 0 });
    await seedTodo(repo, { id: "done-today", date: TODAY, status: "done", order: 1 });
    await seedTodo(repo, { id: "open-tomorrow", date: "2026-06-25", status: "open", order: 0 });

    const matches = await service.list({ date: TODAY, status: "open" });

    expect(matches.map((todo) => todo.id)).toEqual(["open-today"]);
  });

  test("excludes soft-deleted todos by default", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "live", order: 0 });
    await seedTodo(repo, { id: "gone", order: 1, deletedAt: NOW });

    const matches = await service.list();

    expect(matches.map((todo) => todo.id)).toEqual(["live"]);
  });
});

describe("identifier matching", () => {
  test("get resolves a full id", async () => {
    const { service } = makeService();
    const created = await service.add(addInput());

    const found = await service.get(created.id);

    expect(found.id).toBe(created.id);
  });

  test("get resolves a unique id prefix", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "aaaa-1111" });
    await seedTodo(repo, { id: "bbbb-2222" });

    const found = await service.get("aaaa");

    expect(found.id).toBe("aaaa-1111");
  });

  test("get throws NotFoundError for an unknown id", async () => {
    const { service } = makeService();

    await expect(service.get("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("get throws AmbiguousMatchError for a prefix matching multiple todos", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "dup-1111" });
    await seedTodo(repo, { id: "dup-2222" });

    await expect(service.get("dup")).rejects.toBeInstanceOf(AmbiguousMatchError);
  });

  test("get throws NotFoundError for an empty id", async () => {
    const { service } = makeService();

    await expect(service.get("")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("complete", () => {
  test("sets status done and completedAt", async () => {
    const { service } = makeService(steppingClock());
    const created = await service.add(addInput());

    const completed = await service.complete(created.id);

    expect(completed.status).toBe("done");
    expect(completed.completedAt).toBeTruthy();
  });
});

describe("edit", () => {
  test("updates only provided fields and bumps updatedAt", async () => {
    const { service } = makeService(steppingClock());
    const created = await service.add(addInput({ name: "Original", emoji: "📌" }));

    const edited = await service.edit(created.id, { name: "Renamed" });

    expect(edited.name).toBe("Renamed");
    expect(edited.emoji).toBe("📌");
    expect(edited.createdAt).toBe(created.createdAt);
    expect(edited.updatedAt).not.toBe(created.updatedAt);
  });

  test("updates scheduled time from off-slot HH:MM input", async () => {
    const { service } = makeService();
    const created = await service.add(addInput());

    const edited = await service.edit(created.id, { scheduledTime: "23:59" });

    expect(edited.scheduledTime).toBe(1_439);
  });

  test("rejects an invalid time", async () => {
    const { service } = makeService();
    const created = await service.add(addInput());

    await expect(service.edit(created.id, { scheduledTime: "09:60" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("move", () => {
  test("changes the date and appends to the target date order", async () => {
    const { service } = makeService();
    await service.add(addInput({ date: "2026-06-25" }));
    const moving = await service.add(addInput({ date: TODAY }));

    const moved = await service.move(moving.id, { date: "2026-06-25" });

    expect(moved.date).toBe("2026-06-25");
    expect(moved.order).toBe(1);
  });

  test("rejects an invalid target date", async () => {
    const { service } = makeService();
    const created = await service.add(addInput());

    await expect(service.move(created.id, { date: "not-a-date" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("remove", () => {
  test("soft-deletes so the todo leaves list but stays reachable", async () => {
    const { service } = makeService();
    const created = await service.add(addInput());

    await service.remove(created.id);

    expect(await service.list()).toEqual([]);
    expect((await service.get(created.id)).id).toBe(created.id);
    const withDeleted = await service.list({ includeDeleted: true });
    expect(withDeleted.map((todo) => todo.id)).toEqual([created.id]);
  });
});

describe("list validation", () => {
  test("rejects an invalid date filter", async () => {
    const { service } = makeService();

    await expect(service.list({ date: "2026-13-40" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("addFollowUp", () => {
  test("creates two children from one parent dated today", async () => {
    const { service } = makeService();
    const parent = await service.add(addInput({ name: "Parent", date: "2026-06-20" }));

    const first = await service.addFollowUp(parent.id, "Child one");
    const second = await service.addFollowUp(parent.id, "Child two");

    expect(first.status).toBe("open");
    expect(first.date).toBe(TODAY);
    expect(first.causedBy).toBe(parent.id);
    expect(second.causedBy).toBe(parent.id);
    expect(second.date).toBe(TODAY);
    const children = await service.list({ causedBy: parent.id });
    expect(children.map((todo) => todo.id)).toEqual([first.id, second.id]);
  });

  test("inherits parent category and not date, duration, emoji, or time", async () => {
    const { service } = makeService();
    const parent = await service.add(
      addInput({
        name: "Parent",
        date: "2026-06-20",
        categoryId: "cat-work",
        duration: "30",
        emoji: "📌",
        scheduledTime: "09:00",
      }),
    );

    const child = await service.addFollowUp(parent.id, "Child");

    expect(child.categoryId).toBe("cat-work");
    expect(child.date).toBe(TODAY);
    expect(child.duration).toBeUndefined();
    expect(child.emoji).toBeUndefined();
    expect(child.scheduledTime).toBeUndefined();
  });

  test("throws NotFoundError when the parent cannot be resolved", async () => {
    const { service } = makeService();

    await expect(service.addFollowUp("missing", "Child")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("completing a parent does not spawn another child", async () => {
    const { service } = makeService();
    const parent = await service.add(addInput({ name: "Parent" }));
    await service.addFollowUp(parent.id, "Child one");
    await service.addFollowUp(parent.id, "Child two");

    await service.complete(parent.id);

    const children = await service.list({ causedBy: parent.id });
    expect(children).toHaveLength(2);
    expect((await service.list()).map((todo) => todo.name).sort()).toEqual([
      "Child one",
      "Child two",
      "Parent",
    ]);
  });
});

describe("workstream", () => {
  test("on a child includes the sibling and sums duration", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "root", name: "Root", duration: 60, order: 0 });
    await seedTodo(repo, { id: "child-a", name: "A", causedBy: "root", duration: 15, order: 1 });
    await seedTodo(repo, { id: "child-b", name: "B", causedBy: "root", duration: 30, order: 2 });

    const result = await service.workstream("child-a");

    expect(result.root).toBe("root");
    expect(result.duration).toBe(105);
    expect(result.todos.map((todo) => todo.id)).toEqual(["root", "child-a", "child-b"]);
  });

  test("includes a deleted parent in the walk and duration sum", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, {
      id: "root",
      name: "Root",
      duration: 30,
      order: 0,
      deletedAt: NOW,
    });
    await seedTodo(repo, { id: "child", name: "Child", causedBy: "root", duration: 15, order: 1 });

    const result = await service.workstream("child");

    expect(result.root).toBe("root");
    expect(result.duration).toBe(45);
    expect(result.todos.map((todo) => todo.id)).toEqual(["root", "child"]);
    expect(result.todos[0]?.deletedAt).toBe(NOW);
  });

  test("stops at a node whose causedBy parent is missing", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, {
      id: "orphan-root",
      name: "Orphan",
      causedBy: "ghost",
      duration: 15,
      order: 0,
    });
    await seedTodo(repo, {
      id: "leaf",
      name: "Leaf",
      causedBy: "orphan-root",
      duration: 30,
      order: 1,
    });

    const result = await service.workstream("leaf");

    expect(result.root).toBe("orphan-root");
    expect(result.duration).toBe(45);
    expect(result.todos.map((todo) => todo.id)).toEqual(["orphan-root", "leaf"]);
  });

  test("treats a self-causedBy node as its own root", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "loop", name: "Loop", causedBy: "loop", duration: 15, order: 0 });

    const result = await service.workstream("loop");

    expect(result.root).toBe("loop");
    expect(result.duration).toBe(15);
    expect(result.todos.map((todo) => todo.id)).toEqual(["loop"]);
  });
});

describe("rollover", () => {
  test("moves unfinished past todos to today and records count and history", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "open-yesterday", date: "2026-06-23", status: "open", order: 0 });
    await seedTodo(repo, {
      id: "open-earlier",
      date: "2026-06-22",
      status: "open",
      order: 0,
    });
    await seedTodo(repo, { id: "done-yesterday", date: "2026-06-23", status: "done", order: 1 });
    await seedTodo(repo, { id: "today-open", date: TODAY, status: "open", order: 0 });
    await seedTodo(repo, {
      id: "deleted-yesterday",
      date: "2026-06-23",
      status: "open",
      order: 2,
      deletedAt: NOW,
    });

    const result = await service.rollover();

    expect(result.date).toBe(TODAY);
    expect(result.count).toBe(2);
    expect(result.todos.map((todo) => todo.id)).toEqual(["open-earlier", "open-yesterday"]);

    const earlier = await service.get("open-earlier");
    expect(earlier.date).toBe(TODAY);
    expect(earlier.rolloverCount).toBe(1);
    expect(earlier.rolloverHistory).toEqual([
      { fromDate: "2026-06-22", toDate: TODAY, rolledOverAt: NOW },
    ]);

    const open = await service.get("open-yesterday");
    expect(open.date).toBe(TODAY);
    expect(open.order).toBe(earlier.order + 1);
    expect(open.rolloverCount).toBe(1);

    expect((await service.get("done-yesterday")).date).toBe("2026-06-23");
    expect((await service.get("today-open")).date).toBe(TODAY);
    expect((await service.get("deleted-yesterday")).date).toBe("2026-06-23");
  });

  test("is a no-op when nothing is unfinished and past", async () => {
    const { service } = makeService();
    await service.add(addInput({ date: TODAY }));

    const result = await service.rollover();

    expect(result).toEqual({ date: TODAY, count: 0, todos: [] });
  });

  test("appends another history entry on a later day", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, {
      id: "stale",
      date: "2026-06-20",
      status: "open",
      order: 0,
      rolloverCount: 1,
      rolloverHistory: [
        { fromDate: "2026-06-19", toDate: "2026-06-20", rolledOverAt: "2026-06-20T09:00:00.000Z" },
      ],
    });

    const result = await service.rollover();

    expect(result.todos[0]?.rolloverCount).toBe(2);
    expect(result.todos[0]?.rolloverHistory).toHaveLength(2);
    expect(result.todos[0]?.rolloverHistory?.[1]).toEqual({
      fromDate: "2026-06-20",
      toDate: TODAY,
      rolledOverAt: NOW,
    });
  });
  test("rolls only the specified unfinished past todos", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "keep-yesterday", date: "2026-06-23", status: "open", order: 0 });
    await seedTodo(repo, { id: "roll-yesterday", date: "2026-06-22", status: "open", order: 0 });

    const result = await service.rollover(["roll-yesterday"]);

    expect(result.count).toBe(1);
    expect(result.todos.map((todo) => todo.id)).toEqual(["roll-yesterday"]);
    expect((await service.get("roll-yesterday")).date).toBe(TODAY);
    expect((await service.get("keep-yesterday")).date).toBe("2026-06-23");
  });

  test("rejects a specified todo that is not unfinished and past", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "today-open", date: TODAY, status: "open", order: 0 });

    await expect(service.rollover(["today-open"])).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a duplicate specified identifier", async () => {
    const { service, repo } = makeService();
    await seedTodo(repo, { id: "yesterday-open", date: "2026-06-23", status: "open", order: 0 });

    await expect(service.rollover(["yesterday-open", "yesterday-open"])).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await service.get("yesterday-open")).date).toBe("2026-06-23");
    expect((await service.get("yesterday-open")).rolloverCount).toBeUndefined();
  });
});

describe("kind assignment and date policy", () => {
  async function seedKind(
    repo: TodoRepository,
    overrides: Partial<{
      id: string;
      name: string;
      datePolicy: "required" | "optional" | "none";
      rollover: "on" | "off";
      agendaPlacement: "day-grid" | "undated-strip" | "hidden";
    }> = {},
  ): Promise<string> {
    const id = overrides.id ?? "kind-1";
    await repo.putKind({
      id,
      name: overrides.name ?? "Backlog",
      datePolicy: overrides.datePolicy ?? "required",
      rollover: overrides.rollover ?? "on",
      agendaPlacement: overrides.agendaPlacement ?? "day-grid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return id;
  }

  test("stores a provided kindId", async () => {
    const { service, repo } = makeService();
    const kindId = await seedKind(repo);

    const todo = await service.add(addInput({ kindId }));

    expect(todo.kindId).toBe(kindId);
  });

  test("required kind defaults a missing date to today", async () => {
    const { service, repo } = makeService();
    const kindId = await seedKind(repo, { datePolicy: "required" });

    const todo = await service.add(addInput({ kindId }));

    expect(todo.date).toBe(TODAY);
  });

  test("optional kind allows an undated item", async () => {
    const { service, repo } = makeService();
    const kindId = await seedKind(repo, { datePolicy: "optional", name: "Maybe" });

    const todo = await service.add(addInput({ kindId }));

    expect(todo.date).toBeUndefined();
    expect(todo.kindId).toBe(kindId);
  });

  test("none kind rejects a supplied date and stores undated items", async () => {
    const { service, repo } = makeService();
    const kindId = await seedKind(repo, { datePolicy: "none", name: "Someday" });

    await expect(service.add(addInput({ kindId, date: TODAY }))).rejects.toBeInstanceOf(
      ValidationError,
    );

    const undated = await service.add(addInput({ kindId }));
    expect(undated.date).toBeUndefined();
  });

  test("editing onto a required kind defaults a missing date to today", async () => {
    const { service, repo } = makeService();
    const optionalId = await seedKind(repo, { id: "optional", datePolicy: "optional" });
    const requiredId = await seedKind(repo, {
      id: "required",
      name: "Dated",
      datePolicy: "required",
    });
    const created = await service.add(addInput({ kindId: optionalId }));
    expect(created.date).toBeUndefined();

    const edited = await service.edit(created.id, { kindId: requiredId });

    expect(edited.kindId).toBe(requiredId);
    expect(edited.date).toBe(TODAY);
  });

  test("editing onto a none kind clears an existing date", async () => {
    const { service, repo } = makeService();
    const requiredId = await seedKind(repo, { id: "required", datePolicy: "required" });
    const noneId = await seedKind(repo, { id: "none", name: "Someday", datePolicy: "none" });
    const created = await service.add(addInput({ kindId: requiredId, date: TODAY }));

    const edited = await service.edit(created.id, { kindId: noneId });

    expect(edited.kindId).toBe(noneId);
    expect(edited.date).toBeUndefined();
  });

  test("move rejects a date on a none-kind item", async () => {
    const { service, repo } = makeService();
    const kindId = await seedKind(repo, { datePolicy: "none" });
    const created = await service.add(addInput({ kindId }));

    await expect(service.move(created.id, { date: "2026-06-25" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("rollover skips non-rolling kinds", () => {
  test("bulk rollover leaves rollover-off items on their original date", async () => {
    const { service, repo } = makeService();
    await repo.putKind({
      id: "rolling",
      name: "Backlog",
      datePolicy: "required",
      rollover: "on",
      agendaPlacement: "day-grid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repo.putKind({
      id: "parked",
      name: "Maybe",
      datePolicy: "required",
      rollover: "off",
      agendaPlacement: "day-grid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await seedTodo(repo, {
      id: "roll-me",
      date: "2026-06-23",
      status: "open",
      kindId: "rolling",
      order: 0,
    });
    await seedTodo(repo, {
      id: "keep-me",
      date: "2026-06-22",
      status: "open",
      kindId: "parked",
      order: 0,
    });

    const result = await service.rollover();

    expect(result.count).toBe(1);
    expect(result.todos.map((todo) => todo.id)).toEqual(["roll-me"]);
    expect((await service.get("roll-me")).date).toBe(TODAY);
    expect((await service.get("keep-me")).date).toBe("2026-06-22");
  });

  test("explicit rollover of a rollover-off item is rejected", async () => {
    const { service, repo } = makeService();
    await repo.putKind({
      id: "parked",
      name: "Maybe",
      datePolicy: "required",
      rollover: "off",
      agendaPlacement: "day-grid",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await seedTodo(repo, {
      id: "parked-item",
      date: "2026-06-23",
      status: "open",
      kindId: "parked",
    });

    await expect(service.rollover(["parked-item"])).rejects.toBeInstanceOf(ValidationError);
    expect((await service.get("parked-item")).date).toBe("2026-06-23");
  });
});

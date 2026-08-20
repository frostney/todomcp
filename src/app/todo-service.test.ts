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

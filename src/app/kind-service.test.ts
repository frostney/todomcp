import { describe, expect, test } from "bun:test";
import type { Todo } from "../domain/model";
import type { TodoRepository } from "../storage/repository";
import { NotFoundError, ValidationError } from "./errors";
import { type CreateKindInput, createKindService } from "./kind-service";
import { NOW, registerMemoryRepos, steppingClock } from "./service-test-harness";

const makeRepo = registerMemoryRepos();

function service(repo: TodoRepository = makeRepo()) {
  return { kinds: createKindService(repo, steppingClock()), repo };
}

function input(overrides: Partial<CreateKindInput> = {}): CreateKindInput {
  return { name: "Backlog", ...overrides };
}

async function attachTodo(repo: TodoRepository, kindId: string, id: string): Promise<void> {
  const todo: Todo = {
    id,
    name: "Attached",
    date: "2026-06-24",
    status: "open",
    order: 0,
    kindId,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await repo.putTodo(todo);
}

describe("KindService", () => {
  test("create defaults policies and persists optional appearance", async () => {
    const { kinds } = service();
    const defaults = await kinds.create(input({ name: "Maybe" }));
    expect(defaults).toMatchObject({
      name: "Maybe",
      datePolicy: "required",
      rollover: "on",
      agendaPlacement: "day-grid",
    });
    expect(defaults.id.length).toBeGreaterThan(0);

    const custom = await kinds.create(
      input({
        name: "Someday",
        datePolicy: "none",
        rollover: "off",
        agendaPlacement: "hidden",
        color: "#112233",
        emoji: "📥",
      }),
    );
    expect(custom).toMatchObject({
      datePolicy: "none",
      rollover: "off",
      agendaPlacement: "hidden",
      color: "#112233",
      emoji: "📥",
    });
  });

  test("create rejects blank names, clashes, and unknown policies", async () => {
    const { kinds } = service();
    await expect(kinds.create(input({ name: "  " }))).rejects.toBeInstanceOf(ValidationError);
    await kinds.create(input({ name: "Backlog" }));
    await expect(kinds.create(input({ name: "Backlog" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(kinds.create(input({ datePolicy: "sometimes" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("list/get/resolveId work by id and exact name", async () => {
    const { kinds } = service();
    const backlog = await kinds.create(input({ name: "Backlog" }));
    const maybe = await kinds.create(input({ name: "Maybe" }));
    expect((await kinds.list()).map((row) => row.name).sort()).toEqual(["Backlog", "Maybe"]);
    expect((await kinds.get(backlog.id)).name).toBe("Backlog");
    expect(await kinds.resolveId("Maybe")).toBe(maybe.id);
    await expect(kinds.get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("edit updates policies and refuses a name clash", async () => {
    const { kinds } = service();
    await kinds.create(input({ name: "Maybe" }));
    const backlog = await kinds.create(input({ name: "Backlog", emoji: "📥" }));
    const edited = await kinds.edit(backlog.id, {
      name: "Later",
      datePolicy: "optional",
      rollover: "off",
      agendaPlacement: "undated-strip",
      color: "#abcdef",
    });
    expect(edited).toMatchObject({
      name: "Later",
      datePolicy: "optional",
      rollover: "off",
      agendaPlacement: "undated-strip",
      color: "#abcdef",
      emoji: "📥",
    });
    expect(edited.updatedAt).not.toBe(backlog.updatedAt);
    await expect(kinds.edit("Later", { name: "Maybe" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("remove is blocked while referenced and force un-assigns todos", async () => {
    const { kinds, repo } = service();
    const created = await kinds.create(input());
    await attachTodo(repo, created.id, "one");
    await attachTodo(repo, created.id, "two");
    await expect(kinds.remove(created.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.getTodo("one"))?.kindId).toBe(created.id);

    await kinds.remove(created.id, { force: true });
    await expect(kinds.get(created.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await repo.getTodo("one"))?.kindId).toBeUndefined();
    expect((await repo.getTodo("two"))?.kindId).toBeUndefined();
  });
});

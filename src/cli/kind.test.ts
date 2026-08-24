import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kind, Todo } from "../domain/model";
import { type CliResult, makeRunCli } from "./cli-test-harness";

const TODAY = "2026-06-24";

function startKindCli() {
  let root = "";
  let store = "";
  let invoke: (args: string[]) => Promise<CliResult> = async () => {
    throw new Error("kind CLI session is not open");
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kind-cli-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    store = join(await mkdtemp(join(root, "case-")), "store.db");
    invoke = makeRunCli(store);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  return {
    run: (args: string[]) => invoke(args),
  };
}

const cli = startKindCli();

function asKind(stdout: string): Kind {
  return JSON.parse(stdout) as Kind;
}

function asKinds(stdout: string): Kind[] {
  return JSON.parse(stdout) as Kind[];
}

function asTodo(stdout: string): Todo {
  return JSON.parse(stdout) as Todo;
}

async function seedKind(name: string, extra: string[] = []): Promise<Kind> {
  const result = await cli.run(["kind", "create", name, "--json", ...extra]);
  expect(result.exitCode).toBe(0);
  return asKind(result.stdout);
}

describe("kind create list show edit delete", () => {
  test("creates a kind with default policies and lists it", async () => {
    const created = await seedKind("Backlog");

    expect(created.name).toBe("Backlog");
    expect(created.datePolicy).toBe("required");
    expect(created.rollover).toBe("on");
    expect(created.agendaPlacement).toBe("day-grid");

    const listed = await cli.run(["kind", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(asKinds(listed.stdout).map((kind) => kind.id)).toEqual([created.id]);
  });

  test("stores date policy, rollover, agenda, color, and emoji", async () => {
    const created = await seedKind("Maybe", [
      "--date-policy",
      "optional",
      "--rollover",
      "off",
      "--agenda",
      "undated-strip",
      "--color",
      "#abcdef",
      "--emoji",
      "📥",
    ]);

    expect(created.datePolicy).toBe("optional");
    expect(created.rollover).toBe("off");
    expect(created.agendaPlacement).toBe("undated-strip");
    expect(created.color).toBe("#abcdef");
    expect(created.emoji).toBe("📥");
  });

  test("show resolves by name and edit updates the name", async () => {
    const created = await seedKind("Backlog");

    const shown = await cli.run(["kind", "show", "Backlog", "--json"]);
    expect(shown.exitCode).toBe(0);
    expect(asKind(shown.stdout).id).toBe(created.id);

    const edited = await cli.run(["kind", "edit", created.id, "--name", "Later", "--json"]);
    expect(edited.exitCode).toBe(0);
    expect(asKind(edited.stdout).name).toBe("Later");
  });

  test("delete removes an unused kind", async () => {
    await seedKind("Backlog");

    const deleted = await cli.run(["kind", "delete", "Backlog", "--json"]);
    expect(deleted.exitCode).toBe(0);
    const listed = await cli.run(["kind", "list", "--json"]);
    expect(asKinds(listed.stdout)).toEqual([]);
  });

  test("rejects a duplicate name with exit code 2", async () => {
    await seedKind("Backlog");
    const result = await cli.run(["kind", "create", "Backlog", "--json"]);
    expect(result.exitCode).toBe(2);
  });
});

describe("add and edit --kind", () => {
  test("add resolves a kind name to its id", async () => {
    const kind = await seedKind("Backlog");
    const result = await cli.run(["add", "Task", "--date", TODAY, "--kind", "Backlog", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(asTodo(result.stdout).kindId).toBe(kind.id);
  });

  test("add returns exit code 3 for an unknown kind", async () => {
    const result = await cli.run(["add", "Task", "--kind", "does-not-exist", "--json"]);
    expect(result.exitCode).toBe(3);
  });

  test("edit changes the kind and defaults a required date to today", async () => {
    await seedKind("Maybe", ["--date-policy", "optional"]);
    await seedKind("Dated", ["--date-policy", "required"]);
    const added = await cli.run(["add", "Parked", "--kind", "Maybe", "--json"]);
    expect(added.exitCode).toBe(0);
    expect(asTodo(added.stdout).date).toBeUndefined();

    const edited = await cli.run(["edit", asTodo(added.stdout).id, "--kind", "Dated", "--json"]);
    expect(edited.exitCode).toBe(0);
    expect(asTodo(edited.stdout).date).toBe(TODAY);
  });

  test("add rejects a date when the kind forbids dates", async () => {
    await seedKind("Someday", ["--date-policy", "none"]);
    const result = await cli.run([
      "add",
      "No date allowed",
      "--kind",
      "Someday",
      "--date",
      TODAY,
      "--json",
    ]);
    expect(result.exitCode).toBe(2);
  });
});

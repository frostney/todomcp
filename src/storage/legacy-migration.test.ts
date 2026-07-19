import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveLegacyTodoDataPath, resolveTodoDataPath } from "./data-path";
import { LegacyDataConflictError, migrateLegacyDataFile } from "./legacy-migration";
import { createSqliteRepository } from "./sqlite-store";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "todomcp-migration-"));
});

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true });
});

async function writeFileAt(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function migrationPaths(): { legacyPath: string; currentPath: string } {
  return {
    currentPath: join(workDir, "todomcp", "todos.db"),
    legacyPath: join(workDir, "todorepl", "todos.db"),
  };
}

describe("migrateLegacyDataFile", () => {
  test("moves the legacy database and journal/WAL/SHM sidecars to the current path", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(legacyPath, "db");
    await writeFileAt(`${legacyPath}-journal`, "journal");
    await writeFileAt(`${legacyPath}-wal`, "wal");
    await writeFileAt(`${legacyPath}-shm`, "shm");

    migrateLegacyDataFile(legacyPath, currentPath);

    expect(await Bun.file(currentPath).text()).toBe("db");
    expect(await Bun.file(`${currentPath}-journal`).text()).toBe("journal");
    expect(await Bun.file(`${currentPath}-wal`).text()).toBe("wal");
    expect(await Bun.file(`${currentPath}-shm`).text()).toBe("shm");
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(`${legacyPath}-journal`)).toBe(false);
    expect(existsSync(`${legacyPath}-wal`)).toBe(false);
    expect(existsSync(`${legacyPath}-shm`)).toBe(false);
  });

  test("resumes an interrupted migration whose sidecar already moved", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(legacyPath, "db");
    await writeFileAt(`${currentPath}-journal`, "journal");

    migrateLegacyDataFile(legacyPath, currentPath);

    expect(await Bun.file(currentPath).text()).toBe("db");
    expect(await Bun.file(`${currentPath}-journal`).text()).toBe("journal");
    expect(existsSync(legacyPath)).toBe(false);
  });

  test("moves a legacy database that has no sidecar files", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(legacyPath, "db");

    migrateLegacyDataFile(legacyPath, currentPath);

    expect(await Bun.file(currentPath).text()).toBe("db");
    expect(existsSync(`${currentPath}-wal`)).toBe(false);
  });

  test("does nothing when no legacy database exists", async () => {
    const { legacyPath, currentPath } = migrationPaths();

    migrateLegacyDataFile(legacyPath, currentPath);

    expect(existsSync(currentPath)).toBe(false);
    expect(existsSync(dirname(currentPath))).toBe(false);
  });

  test("leaves an existing current database untouched when no legacy file exists", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(currentPath, "current");

    migrateLegacyDataFile(legacyPath, currentPath);

    expect(await Bun.file(currentPath).text()).toBe("current");
  });

  test("fails without touching either file when both databases exist", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(legacyPath, "legacy");
    await writeFileAt(currentPath, "current");

    expect(() => migrateLegacyDataFile(legacyPath, currentPath)).toThrow(LegacyDataConflictError);
    expect(() => migrateLegacyDataFile(legacyPath, currentPath)).toThrow(legacyPath);
    expect(() => migrateLegacyDataFile(legacyPath, currentPath)).toThrow(currentPath);
    expect(await Bun.file(legacyPath).text()).toBe("legacy");
    expect(await Bun.file(currentPath).text()).toBe("current");
  });

  test("is a no-op when re-run after a completed migration", async () => {
    const { legacyPath, currentPath } = migrationPaths();
    await writeFileAt(legacyPath, "db");

    migrateLegacyDataFile(legacyPath, currentPath);
    migrateLegacyDataFile(legacyPath, currentPath);

    expect(await Bun.file(currentPath).text()).toBe("db");
  });
});

describe("default-path legacy migration through the CLI", () => {
  // Bun resolves homedir() once at startup, so the redirected home must be set on a
  // child process rather than by mutating this test's environment.
  function redirectedRuntime(): {
    env: NodeJS.ProcessEnv;
    homeDir: string;
    platform: NodeJS.Platform;
  } {
    return {
      env: {
        LOCALAPPDATA: join(workDir, "local-app-data"),
        XDG_DATA_HOME: join(workDir, "xdg"),
      },
      homeDir: workDir,
      platform: process.platform,
    };
  }

  function runCli(...args: string[]): { exitCode: number; stdout: string; stderr: string } {
    const runtime = redirectedRuntime();
    const result = Bun.spawnSync(["bun", "run", "src/cli/main.ts", ...args], {
      env: {
        ...process.env,
        HOME: runtime.homeDir,
        LOCALAPPDATA: runtime.env.LOCALAPPDATA,
        XDG_DATA_HOME: runtime.env.XDG_DATA_HOME,
      },
    });
    return {
      exitCode: result.exitCode,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
    };
  }

  test("relocates a legacy default-path database on first run and reads its data", async () => {
    const runtime = redirectedRuntime();
    const legacyPath = resolveLegacyTodoDataPath(runtime);
    const currentPath = resolveTodoDataPath(undefined, runtime);

    const seed = createSqliteRepository({ path: legacyPath });
    await seed.putTodo({
      createdAt: "2026-07-19T08:00:00.000Z",
      date: "2026-07-19",
      id: "11111111-1111-4111-8111-111111111111",
      name: "Survive the rename",
      order: 0,
      status: "open",
      updatedAt: "2026-07-19T08:00:00.000Z",
    });
    seed.close();

    const result = runCli("list", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).map((todo: { name: string }) => todo.name)).toEqual([
      "Survive the rename",
    ]);
    expect(existsSync(currentPath)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });

  test("fails with the storage exit code when both default-path databases exist", async () => {
    const runtime = redirectedRuntime();
    const legacyPath = resolveLegacyTodoDataPath(runtime);
    const currentPath = resolveTodoDataPath(undefined, runtime);
    await writeFileAt(legacyPath, "legacy");
    createSqliteRepository({ path: currentPath }).close();

    const result = runCli("list", "--json");
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(legacyPath);
    expect(result.stderr).toContain(currentPath);
    expect(await Bun.file(legacyPath).text()).toBe("legacy");
  });

  test("explicit --data overrides bypass legacy migration", async () => {
    const runtime = redirectedRuntime();
    const legacyPath = resolveLegacyTodoDataPath(runtime);
    createSqliteRepository({ path: legacyPath }).close();

    const overridePath = join(workDir, "override", "todos.db");
    const result = runCli("list", "--json", "--data", overridePath);
    expect(result.exitCode).toBe(0);
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(resolveTodoDataPath(undefined, runtime))).toBe(false);
  });
});

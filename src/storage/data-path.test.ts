import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveLegacyTodoDataPath, resolveTodoDataPath } from "./data-path";

describe("resolveTodoDataPath", () => {
  test("uses Application Support on macOS", () => {
    expect(
      resolveTodoDataPath(undefined, {
        env: {},
        homeDir: "/Users/alex",
        platform: "darwin",
      }),
    ).toBe("/Users/alex/Library/Application Support/todomcp/todos.db");
  });

  test("uses XDG_DATA_HOME on Linux-like platforms", () => {
    expect(
      resolveTodoDataPath(undefined, {
        env: { XDG_DATA_HOME: "/tmp/data" },
        homeDir: "/home/alex",
        platform: "linux",
      }),
    ).toBe("/tmp/data/todomcp/todos.db");
  });

  test("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveTodoDataPath(undefined, {
        env: { LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local" },
        homeDir: "C:\\Users\\alex",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\alex\\AppData\\Local\\todomcp\\todos.db");
  });

  test("treats an empty XDG_DATA_HOME as unset and falls back to ~/.local/share", () => {
    expect(
      resolveTodoDataPath(undefined, {
        env: { XDG_DATA_HOME: "" },
        homeDir: "/home/alex",
        platform: "linux",
      }),
    ).toBe("/home/alex/.local/share/todomcp/todos.db");
  });

  test("treats an empty LOCALAPPDATA as unset and falls back to AppData\\Local", () => {
    expect(
      resolveTodoDataPath(undefined, {
        env: { LOCALAPPDATA: "" },
        homeDir: "C:\\Users\\alex",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\alex\\AppData\\Local\\todomcp\\todos.db");
  });

  test("resolves explicit data path overrides", () => {
    expect(resolveTodoDataPath("relative/todos.db")).toBe(resolve("relative/todos.db"));
  });
});

describe("resolveLegacyTodoDataPath", () => {
  test("resolves the pre-rename todorepl directory on macOS", () => {
    expect(
      resolveLegacyTodoDataPath({
        env: {},
        homeDir: "/Users/alex",
        platform: "darwin",
      }),
    ).toBe("/Users/alex/Library/Application Support/todorepl/todos.db");
  });

  test("resolves the pre-rename todorepl directory under XDG_DATA_HOME", () => {
    expect(
      resolveLegacyTodoDataPath({
        env: { XDG_DATA_HOME: "/tmp/data" },
        homeDir: "/home/alex",
        platform: "linux",
      }),
    ).toBe("/tmp/data/todorepl/todos.db");
  });
});

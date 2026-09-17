import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";

type DataPathRuntime = {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
};

const dataFileName = "todos.db";
const appDirectoryName = "todomcp";
const legacyAppDirectoryName = "todorepl";

export function resolveTodoDataPath(override?: string, runtime = currentRuntime()): string {
  if (override !== undefined) return resolvePath(override, runtime);
  return joinPath(runtime, defaultDataDirectory(runtime), appDirectoryName, dataFileName);
}

export function resolveLegacyTodoDataPath(runtime = currentRuntime()): string {
  return joinPath(runtime, defaultDataDirectory(runtime), legacyAppDirectoryName, dataFileName);
}

function currentRuntime(): DataPathRuntime {
  return {
    env: process.env,
    homeDir: homedir(),
    platform: process.platform,
  };
}

function defaultDataDirectory({ env, homeDir, platform }: DataPathRuntime): string {
  if (platform === "darwin") return join(homeDir, "Library", "Application Support");
  if (platform === "win32") return env.LOCALAPPDATA || win32.join(homeDir, "AppData", "Local");
  return env.XDG_DATA_HOME || join(homeDir, ".local", "share");
}

function joinPath(runtime: DataPathRuntime, ...parts: string[]): string {
  return runtime.platform === "win32" ? win32.join(...parts) : join(...parts);
}

function resolvePath(path: string, runtime: DataPathRuntime): string {
  return runtime.platform === "win32" ? win32.resolve(path) : resolve(path);
}

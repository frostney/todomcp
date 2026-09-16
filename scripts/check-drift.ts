import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";

type PackageJson = {
  bin?: Record<string, string>;
  packageManager?: string;
  scripts?: Record<string, string>;
};

const failures: string[] = [];

expectFile("VISION.md");
expectFile("DEFINITION_OF_READY.md");
expectFile("DEFINITION_OF_DONE.md");
expectFile("CONTRIBUTING.md");
expectFile(".github/workflows/ci.yml");

for (const doc of [
  "docs/architecture.md",
  "docs/quick-start.md",
  "docs/tooling.md",
  "docs/code-style.md",
  "docs/deployment.md",
  "docs/implementation-plan.md",
]) {
  expectFile(doc);
  expectExecutiveSummary(doc);
}

expectSymlink("CLAUDE.md", "AGENTS.md");
expectSymlink(".claude/skills", "../.agents/skills");

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
if (packageJson.packageManager !== "bun@1.3.14") {
  failures.push("package.json: packageManager must stay bun@1.3.14");
}

if (packageJson.bin?.todomcp !== "./src/cli/main.ts") {
  failures.push("package.json: bin.todomcp must point to ./src/cli/main.ts");
}

const cliEntrypointMode = lstatSync("src/cli/main.ts").mode;
if ((cliEntrypointMode & 0o111) === 0) {
  failures.push("src/cli/main.ts: package binary entrypoint must be executable");
}

for (const script of [
  "test",
  "format",
  "lint",
  "check",
  "quality",
  "check:docs",
  "check:links",
  "check:duplicates",
  "check:drift",
]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json: missing script ${script}`);
}

for (const forbiddenLockfile of [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]) {
  if (existsSync(forbiddenLockfile)) {
    failures.push(`${forbiddenLockfile}: Bun is the only package manager`);
  }
}

const markdownlintConfig = readFileSync(".markdownlint-cli2.yaml", "utf8");
if (!markdownlintConfig.includes(".agents/**")) {
  failures.push(
    ".markdownlint-cli2.yaml: generated .agents skills must be excluded from hand-authored markdownlint",
  );
}

if (!readFileSync("docs/tooling.md", "utf8").includes("Drift Check")) {
  failures.push("docs/tooling.md: must document the drift check");
}

const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
if (!ciWorkflow.includes("bun install --frozen-lockfile")) {
  failures.push(".github/workflows/ci.yml: CI must install with Bun");
}
if (!ciWorkflow.includes("bun run check")) {
  failures.push(".github/workflows/ci.yml: CI must run the local check gate");
}

if (existsSync("tests")) {
  const entries = readdirSync("tests").filter((entry) => !entry.startsWith("."));
  if (entries.length > 0)
    failures.push(
      "tests/: unit tests should be co-located unless documented as an E2E/layer suite",
    );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

function expectFile(path: string) {
  if (!existsSync(path) || !lstatSync(path).isFile()) failures.push(`${path}: expected file`);
}

function expectExecutiveSummary(path: string) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  if (!content.includes("\n## Executive Summary\n")) {
    failures.push(`${path}: missing ## Executive Summary`);
  }
}

function expectSymlink(path: string, target: string) {
  if (!existsSync(path)) {
    failures.push(`${path}: expected symlink to ${target}`);
    return;
  }
  const stat = lstatSync(path);
  if (!stat.isSymbolicLink()) {
    failures.push(`${path}: expected symlink to ${target}`);
    return;
  }
  expectSymlinkTarget(path, target);
}

function expectSymlinkTarget(path: string, target: string) {
  if (readlinkSync(path) !== target) {
    failures.push(`${path}: expected symlink target ${target}`);
  }
}

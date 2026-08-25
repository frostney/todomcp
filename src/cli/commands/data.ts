import { buildCommand } from "@stricli/core";
import { ValidationError } from "../../app/errors";
import { exportData, importData } from "../../app/transfer";
import type { AppContext } from "../context";
import { formatJson } from "../output";
import { type CommonFlags, commonFlags, withServices } from "./shared";

export const exportCommand = buildCommand<CommonFlags, [], AppContext>({
  docs: { brief: "Export all todos, categories, and kinds as a JSON snapshot." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const snapshot = await withServices(this, flags.data, ({ repo }) => exportData(repo));
    this.process.stdout.write(formatJson(snapshot));
  },
});

type ImportFlags = CommonFlags & {
  file?: string;
};

export const importCommand = buildCommand<ImportFlags, [], AppContext>({
  docs: { brief: "Import a JSON snapshot from stdin or a file." },
  parameters: {
    flags: {
      ...commonFlags,
      file: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Read the import payload from a file instead of stdin.",
      },
    },
  },
  async func(flags) {
    const raw =
      flags.file !== undefined ? await Bun.file(flags.file).text() : await Bun.stdin.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError("Import payload is not valid JSON");
    }
    const result = await withServices(this, flags.data, ({ repo }) => importData(repo, parsed));
    if (flags.json) {
      this.process.stdout.write(formatJson({ imported: result }));
    } else {
      this.process.stdout.write(
        `Imported ${result.todos} todo(s), ${result.categories} categor${result.categories === 1 ? "y" : "ies"}, and ${result.kinds} kind(s).\n`,
      );
    }
  },
});

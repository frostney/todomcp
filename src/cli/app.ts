import { type Application, buildApplication } from "@stricli/core";
import { exitCodeForError } from "../app/errors";
import { rootRoute } from "./commands";
import type { AppContext } from "./context";

export function createApp(): Application<AppContext> {
  return buildApplication(rootRoute, {
    name: "todomcp",
    versionInfo: { currentVersion: "0.1.0" },
    scanner: { caseStyle: "allow-kebab-for-camel" },
    documentation: { caseStyle: "convert-camel-to-kebab" },
    determineExitCode: exitCodeForError,
  });
}

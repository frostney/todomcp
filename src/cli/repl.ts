import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { type Application, run } from "@stricli/core";
import { createApp } from "./app";
import { type AppContext, createAppContext } from "./context";
import { tokenize } from "./tokenize";

export async function processReplInput(
  line: string,
  app: Application<AppContext>,
  context: AppContext,
): Promise<"continue" | "exit"> {
  const trimmed = line.trim();
  if (trimmed === "") return "continue";
  if (trimmed === "exit" || trimmed === "quit") return "exit";

  if (trimmed === "help") {
    await run(app, ["--help"], context);
    return "continue";
  }

  await run(app, tokenize(trimmed), context);
  return "continue";
}

export async function startRepl(context: AppContext = createAppContext()): Promise<void> {
  const app = createApp();

  output.write("todomcp\n");
  output.write('Type "help" for commands or "exit" to leave.\n');

  const rl = createInterface({ input, output, prompt: "todo> " });
  rl.prompt();

  for await (const line of rl) {
    if ((await processReplInput(line, app, context)) === "exit") break;
    rl.prompt();
  }

  rl.close();
}

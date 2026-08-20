import { buildRouteMap } from "@stricli/core";
import { categoryRoute } from "./commands/category";
import { exportCommand, importCommand } from "./commands/data";
import {
  add,
  deleteCommand,
  done,
  edit,
  followUp,
  list,
  move,
  rollover,
  show,
  workstream,
} from "./commands/todo";
import type { AppContext } from "./context";

export const rootRoute = buildRouteMap<string, AppContext>({
  routes: {
    add,
    list,
    show,
    done,
    edit,
    move,
    delete: deleteCommand,
    followUp,
    workstream,
    rollover,
    category: categoryRoute,
    export: exportCommand,
    import: importCommand,
  },
  docs: { brief: "Date-centric todo CLI with REPL and subcommand modes." },
});

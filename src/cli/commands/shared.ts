import { type CategoryService, createCategoryService } from "../../app/category-service";
import { createKindService, type KindService } from "../../app/kind-service";
import { createTodoService, type TodoService } from "../../app/todo-service";
import type { TodoRepository } from "../../storage/repository";
import type { AppContext } from "../context";

export const commonFlags = {
  data: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Path to the todorepl data file.",
    placeholder: "path",
  },
  json: {
    kind: "boolean",
    optional: true,
    brief: "Print JSON output.",
  },
} as const;

export type CommonFlags = {
  data?: string;
  json?: boolean;
};

export type Services = {
  todos: TodoService;
  categories: CategoryService;
  kinds: KindService;
  repo: TodoRepository;
};

export async function withServices<T>(
  ctx: AppContext,
  dataPath: string | undefined,
  fn: (services: Services) => Promise<T>,
): Promise<T> {
  const repo = ctx.openStore(dataPath);
  try {
    return await fn({
      todos: createTodoService(repo, ctx.clock),
      categories: createCategoryService(repo, ctx.clock),
      kinds: createKindService(repo, ctx.clock),
      repo,
    });
  } finally {
    repo.close();
  }
}

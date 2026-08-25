import type {
  Category,
  CategoryId,
  DateString,
  Kind,
  KindId,
  Todo,
  TodoId,
  TodoStatus,
} from "../domain/model";

export const SCHEMA_VERSION = 4;

export type StoreSnapshot = {
  version: number;
  todos: Todo[];
  categories: Category[];
  kinds: Kind[];
};

export type TodoFilter = {
  date?: DateString;
  dateFrom?: DateString;
  dateTo?: DateString;
  categoryId?: CategoryId;
  kindId?: KindId;
  status?: TodoStatus;
  scheduled?: boolean;
  causedBy?: TodoId;
  includeDeleted?: boolean;
  undated?: boolean;
};

export type RepositoryOptions = {
  path?: string;
};

export type DeleteCategoryOptions = {
  force: boolean;
  updatedAt: string;
};

export type DeleteCategoryResult = {
  deleted: boolean;
  referencedTodoCount: number;
};

export type DeleteKindOptions = {
  force: boolean;
  updatedAt: string;
};

export type DeleteKindResult = {
  deleted: boolean;
  referencedTodoCount: number;
};

export interface TodoRepository {
  listTodos(filter?: TodoFilter): Promise<Todo[]>;
  getTodo(id: TodoId): Promise<Todo | undefined>;
  putTodo(todo: Todo): Promise<void>;
  putTodos(todos: readonly Todo[]): Promise<void>;
  listCategories(): Promise<Category[]>;
  getCategory(id: CategoryId): Promise<Category | undefined>;
  putCategory(category: Category): Promise<void>;
  deleteCategory(id: CategoryId, options: DeleteCategoryOptions): Promise<DeleteCategoryResult>;
  listKinds(): Promise<Kind[]>;
  getKind(id: KindId): Promise<Kind | undefined>;
  putKind(kind: Kind): Promise<void>;
  deleteKind(id: KindId, options: DeleteKindOptions): Promise<DeleteKindResult>;
  exportSnapshot(): Promise<StoreSnapshot>;
  importSnapshot(snapshot: StoreSnapshot): Promise<void>;
  close(): void;
}

export function emptySnapshot(): StoreSnapshot {
  return { version: SCHEMA_VERSION, todos: [], categories: [], kinds: [] };
}

export class StoreCorruptError extends Error {
  constructor(path: string, cause?: unknown) {
    super(
      `Todo database is corrupt or unreadable: ${path}. Inspect or remove the file, then retry.`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "StoreCorruptError";
  }
}

export class StoreVersionError extends Error {
  constructor(path: string, foundVersion: number, supportedVersion: number = SCHEMA_VERSION) {
    super(
      `Todo database at ${path} uses unsupported schema version ${foundVersion}; ` +
        `this build supports version ${supportedVersion}. Upgrade todorepl or restore a compatible file.`,
    );
    this.name = "StoreVersionError";
  }
}

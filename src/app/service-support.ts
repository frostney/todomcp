import { AmbiguousMatchError, NotFoundError, ValidationError } from "./errors";

export function requireName(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} name is required`);
  }
  return trimmed;
}

export function assertUniqueName(
  records: readonly { id: string; name: string }[],
  name: string,
  label: string,
  excludeId?: string,
): void {
  const clash = records.find((record) => record.name === name && record.id !== excludeId);
  if (clash !== undefined) {
    throw new ValidationError(`${label} "${name}" already exists`);
  }
}

export function asValidationError<T>(run: () => T, label?: string): T {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(label ? `${label}: ${message}` : message);
  }
}

export async function resolveByIdentifier<T>(
  options: {
    getExact: (id: string) => Promise<T | undefined>;
    listAll: () => Promise<T[]>;
    matches: (entity: T, query: string) => boolean;
    describe: string;
  },
  query: string,
): Promise<T> {
  if (query.length === 0) {
    throw new NotFoundError(`No ${options.describe} matches "${query}"`);
  }
  const exact = await options.getExact(query);
  if (exact) {
    return exact;
  }
  const matches = (await options.listAll()).filter((entity) => options.matches(entity, query));
  if (matches.length === 0) {
    throw new NotFoundError(`No ${options.describe} matches "${query}"`);
  }
  if (matches.length > 1) {
    throw new AmbiguousMatchError(`"${query}" matches ${matches.length} ${options.describe}s`);
  }
  return matches[0] as T;
}

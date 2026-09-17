import { LegacyDataConflictError, LegacyMigrationError } from "../storage/legacy-migration";
import { StoreCorruptError, StoreVersionError } from "../storage/repository";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class AmbiguousMatchError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousMatchError";
  }
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof ValidationError) return 2;
  if (error instanceof NotFoundError) return 3;
  if (
    error instanceof StoreCorruptError ||
    error instanceof StoreVersionError ||
    error instanceof LegacyDataConflictError ||
    error instanceof LegacyMigrationError
  ) {
    return 4;
  }
  return 1;
}

import { linkSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

// SQLite sidecar files that can hold uncommitted or unwritten transaction state. The store runs in
// the default rollback-journal mode, so "-journal" is the one that matters for recovery; "-wal" and
// "-shm" are included in case a foreign tool switched the database to WAL mode.
const sidecarSuffixes = ["-journal", "-wal", "-shm"] as const;

export class LegacyDataConflictError extends Error {
  constructor(legacyPath: string, currentPath: string) {
    super(
      `Todo databases exist at both the legacy path (${legacyPath}) and the current path ` +
        `(${currentPath}). Back up what you need, remove one of them, then retry.`,
    );
    this.name = "LegacyDataConflictError";
  }
}

export class LegacyMigrationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "LegacyMigrationError";
  }
}

export function migrateLegacyDataFile(legacyPath: string, currentPath: string): void {
  if (!fileExists(legacyPath)) return;
  if (fileExists(currentPath)) throw new LegacyDataConflictError(legacyPath, currentPath);

  wrapFsFailure(`create data directory for ${currentPath}`, () =>
    mkdirSync(dirname(currentPath), { recursive: true }),
  );

  // Sidecars move first and the database file moves last, so an interrupted migration always
  // leaves the legacy database in place and a re-run resumes by moving whatever remains.
  for (const suffix of sidecarSuffixes) {
    const legacySidecar = `${legacyPath}${suffix}`;
    if (fileExists(legacySidecar)) moveNoClobber(legacySidecar, `${currentPath}${suffix}`);
  }
  try {
    moveNoClobber(legacyPath, currentPath);
  } catch (error) {
    // The database appeared at the current path between the check above and the move.
    if (isErrnoCode(error, "EEXIST")) throw new LegacyDataConflictError(legacyPath, currentPath);
    throw error;
  }
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return false;
    throw new LegacyMigrationError(`Cannot inspect ${path} while migrating legacy data.`, error);
  }
}

// Hard-link-then-unlink publishes the file atomically and fails with EEXIST instead of replacing a
// destination created concurrently. Filesystems without hard-link support fall back to a plain
// rename, accepting the small check-then-move window there.
function moveNoClobber(sourcePath: string, destinationPath: string): void {
  try {
    linkSync(sourcePath, destinationPath);
  } catch (error) {
    if (isErrnoCode(error, "EEXIST")) throw error;
    if (isErrnoCode(error, "EPERM", "ENOTSUP", "ENOSYS", "EXDEV")) {
      wrapFsFailure(`move ${sourcePath} to ${destinationPath}`, () =>
        renameSync(sourcePath, destinationPath),
      );
      return;
    }
    throw new LegacyMigrationError(
      `Cannot move ${sourcePath} to ${destinationPath} while migrating legacy data.`,
      error,
    );
  }
  wrapFsFailure(`remove migrated legacy file ${sourcePath}`, () => unlinkSync(sourcePath));
}

function wrapFsFailure(action: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    throw new LegacyMigrationError(`Cannot ${action} while migrating legacy data.`, error);
  }
}

function isErrnoCode(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    codes.includes((error as NodeJS.ErrnoException).code ?? "")
  );
}

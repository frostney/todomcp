import { constants, copyFileSync, linkSync, mkdirSync, statSync, unlinkSync } from "node:fs";
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
  prepareCurrentPath(legacyPath, currentPath);
  moveLegacySidecars(legacyPath, currentPath);
  moveLegacyDatabase(legacyPath, currentPath);
}

function prepareCurrentPath(legacyPath: string, currentPath: string): void {
  if (!fileExists(currentPath)) {
    wrapFsFailure(`create data directory for ${currentPath}`, () =>
      mkdirSync(dirname(currentPath), { recursive: true }),
    );
    return;
  }
  if (!sameFileIdentity(legacyPath, currentPath)) {
    throw new LegacyDataConflictError(legacyPath, currentPath);
  }
  // linkSync published the destination but unlink of the legacy path was interrupted: finish
  // cleanup, then continue so any remaining sidecars still migrate.
  wrapFsFailure(`remove migrated legacy file ${legacyPath}`, () => unlinkSync(legacyPath));
}

function moveLegacySidecars(legacyPath: string, currentPath: string): void {
  // Sidecars move first and the database file moves last, so an interrupted migration always
  // leaves the legacy database in place and a re-run resumes by moving whatever remains.
  for (const suffix of sidecarSuffixes) {
    const legacySidecar = `${legacyPath}${suffix}`;
    if (!fileExists(legacySidecar)) continue;
    moveSidecarOrClassifyConflict(legacySidecar, `${currentPath}${suffix}`);
  }
}

function moveSidecarOrClassifyConflict(legacySidecar: string, currentSidecar: string): void {
  try {
    moveNoClobber(legacySidecar, currentSidecar);
  } catch (error) {
    if (isErrnoCode(error, "EEXIST")) {
      throw new LegacyMigrationError(
        `Cannot move ${legacySidecar} to ${currentSidecar} while migrating legacy data: ` +
          "destination already exists.",
        error,
      );
    }
    throw error;
  }
}

function moveLegacyDatabase(legacyPath: string, currentPath: string): void {
  if (!fileExists(legacyPath)) return;
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

function sameFileIdentity(leftPath: string, rightPath: string): boolean {
  try {
    const left = statSync(leftPath);
    const right = statSync(rightPath);
    return left.dev === right.dev && left.ino === right.ino;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return false;
    throw new LegacyMigrationError(
      `Cannot compare ${leftPath} and ${rightPath} while migrating legacy data.`,
      error,
    );
  }
}

function removeMigratedLegacy(sourcePath: string): void {
  wrapFsFailure(`remove migrated legacy file ${sourcePath}`, () => unlinkSync(sourcePath));
}

// Hard-link-then-unlink publishes the file atomically and fails with EEXIST instead of replacing a
// destination created concurrently. Filesystems without hard-link support fall back to an
// exclusive copy then unlink, which also refuses to replace an existing destination.
function moveNoClobber(sourcePath: string, destinationPath: string): void {
  if (fileExists(destinationPath) && sameFileIdentity(sourcePath, destinationPath)) {
    removeMigratedLegacy(sourcePath);
    return;
  }
  try {
    linkSync(sourcePath, destinationPath);
  } catch (error) {
    handleMoveNoClobberFailure(error, sourcePath, destinationPath);
    return;
  }
  removeMigratedLegacy(sourcePath);
}

function handleMoveNoClobberFailure(
  error: unknown,
  sourcePath: string,
  destinationPath: string,
): void {
  if (isErrnoCode(error, "EEXIST")) {
    if (sameFileIdentity(sourcePath, destinationPath)) {
      removeMigratedLegacy(sourcePath);
      return;
    }
    throw error;
  }
  if (isErrnoCode(error, "EPERM", "ENOTSUP", "ENOSYS", "EXDEV")) {
    wrapFsFailure(`copy ${sourcePath} to ${destinationPath}`, () =>
      copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL),
    );
    removeMigratedLegacy(sourcePath);
    return;
  }
  throw new LegacyMigrationError(
    `Cannot move ${sourcePath} to ${destinationPath} while migrating legacy data.`,
    error,
  );
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

import type {
  Kind,
  KindAgendaPlacement,
  KindDatePolicy,
  KindId,
  KindRolloverPolicy,
} from "../domain/model";
import {
  DEFAULT_KIND_AGENDA_PLACEMENT,
  DEFAULT_KIND_DATE_POLICY,
  DEFAULT_KIND_ROLLOVER,
  parseKindAgendaPlacement,
  parseKindDatePolicy,
  parseKindRollover,
} from "../domain/validation";
import type { TodoRepository } from "../storage/repository";
import { type Clock, systemClock } from "./clock";
import { ValidationError } from "./errors";
import {
  assertUniqueName,
  asValidationError,
  requireName,
  resolveByIdentifier,
} from "./service-support";

export type CreateKindInput = {
  name: string;
  datePolicy?: string;
  rollover?: string;
  agendaPlacement?: string;
  color?: string;
  emoji?: string;
};

export type EditKindInput = {
  name?: string;
  datePolicy?: string;
  rollover?: string;
  agendaPlacement?: string;
  color?: string;
  emoji?: string;
};

export type RemoveKindOptions = { force?: boolean };

export interface KindService {
  create(input: CreateKindInput): Promise<Kind>;
  list(): Promise<Kind[]>;
  get(idOrName: string): Promise<Kind>;
  edit(idOrName: string, changes: EditKindInput): Promise<Kind>;
  remove(idOrName: string, options?: RemoveKindOptions): Promise<Kind>;
  resolveId(idOrName: string): Promise<KindId>;
}

function parsePolicies(input: {
  datePolicy?: string;
  rollover?: string;
  agendaPlacement?: string;
}): {
  datePolicy?: KindDatePolicy;
  rollover?: KindRolloverPolicy;
  agendaPlacement?: KindAgendaPlacement;
} {
  const parsed: {
    datePolicy?: KindDatePolicy;
    rollover?: KindRolloverPolicy;
    agendaPlacement?: KindAgendaPlacement;
  } = {};
  if (input.datePolicy !== undefined) {
    parsed.datePolicy = asValidationError(() => parseKindDatePolicy(input.datePolicy as string));
  }
  if (input.rollover !== undefined) {
    parsed.rollover = asValidationError(() => parseKindRollover(input.rollover as string));
  }
  if (input.agendaPlacement !== undefined) {
    parsed.agendaPlacement = asValidationError(() =>
      parseKindAgendaPlacement(input.agendaPlacement as string),
    );
  }
  return parsed;
}

function applyAppearance(target: { color?: string; emoji?: string }, input: EditKindInput): void {
  if (input.color !== undefined) target.color = input.color;
  if (input.emoji !== undefined) target.emoji = input.emoji;
}

export function createKindService(repo: TodoRepository, clock: Clock = systemClock): KindService {
  function resolve(query: string): Promise<Kind> {
    return resolveByIdentifier(
      {
        getExact: (id) => repo.getKind(id),
        listAll: () => repo.listKinds(),
        matches: (kind, candidate) => kind.name === candidate,
        describe: "kind",
      },
      query,
    );
  }

  async function create(input: CreateKindInput): Promise<Kind> {
    const name = requireName(input.name, "Kind");
    assertUniqueName(await repo.listKinds(), name, "Kind");
    const policies = parsePolicies(input);
    const timestamp = clock();
    const kind: Kind = {
      id: crypto.randomUUID(),
      name,
      datePolicy: policies.datePolicy ?? DEFAULT_KIND_DATE_POLICY,
      rollover: policies.rollover ?? DEFAULT_KIND_ROLLOVER,
      agendaPlacement: policies.agendaPlacement ?? DEFAULT_KIND_AGENDA_PLACEMENT,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    applyAppearance(kind, input);
    await repo.putKind(kind);
    return kind;
  }

  async function edit(query: string, changes: EditKindInput): Promise<Kind> {
    const existing = await resolve(query);
    const next: Kind = { ...existing, updatedAt: clock() };
    if (changes.name !== undefined) {
      const name = requireName(changes.name, "Kind");
      assertUniqueName(await repo.listKinds(), name, "Kind", existing.id);
      next.name = name;
    }
    const policies = parsePolicies(changes);
    if (policies.datePolicy !== undefined) next.datePolicy = policies.datePolicy;
    if (policies.rollover !== undefined) next.rollover = policies.rollover;
    if (policies.agendaPlacement !== undefined) next.agendaPlacement = policies.agendaPlacement;
    applyAppearance(next, changes);
    await repo.putKind(next);
    return next;
  }

  async function remove(query: string, options?: RemoveKindOptions): Promise<Kind> {
    const kind = await resolve(query);
    const result = await repo.deleteKind(kind.id, {
      force: options?.force === true,
      updatedAt: clock(),
    });
    if (!result.deleted) {
      throw new ValidationError(
        `Kind "${kind.name}" is used by ${result.referencedTodoCount} todo(s); ` +
          "pass --force to delete and un-assign them",
      );
    }
    return kind;
  }

  return {
    create,
    list: () => repo.listKinds(),
    get: (query) => resolve(query),
    resolveId: async (query) => (await resolve(query)).id,
    edit,
    remove,
  };
}

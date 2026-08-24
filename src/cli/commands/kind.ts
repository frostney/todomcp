import { buildCommand, buildRouteMap } from "@stricli/core";
import type { CreateKindInput, EditKindInput } from "../../app/kind-service";
import type {
  Kind,
  KindAgendaPlacement,
  KindDatePolicy,
  KindRolloverPolicy,
} from "../../domain/model";
import {
  KIND_AGENDA_PLACEMENTS,
  KIND_DATE_POLICIES,
  KIND_ROLLOVER_POLICIES,
} from "../../domain/validation";
import type { AppContext } from "../context";
import { formatJson, formatTable } from "../output";
import { type CommonFlags, commonFlags, withServices } from "./shared";

function displayKindRow(kind: Kind): Record<string, unknown> {
  return {
    id: kind.id.slice(0, 8),
    name: kind.name,
    date: kind.datePolicy,
    rollover: kind.rollover,
    agenda: kind.agendaPlacement,
    emoji: kind.emoji ?? "-",
    color: kind.color ?? "-",
  };
}

function renderKind(kind: Kind, json: boolean | undefined): string {
  return json ? formatJson(kind) : formatTable([displayKindRow(kind)]);
}

function renderKinds(kinds: readonly Kind[], json: boolean | undefined): string {
  return json ? formatJson(kinds) : formatTable(kinds.map(displayKindRow));
}

const idOrNamePositional = {
  kind: "tuple",
  parameters: [{ parse: String, brief: "Kind id or name.", placeholder: "idOrName" }],
} as const;

const policyFlags = {
  datePolicy: {
    kind: "enum",
    values: KIND_DATE_POLICIES,
    optional: true,
    brief: "Date policy (required, optional, or none).",
  },
  rollover: {
    kind: "enum",
    values: KIND_ROLLOVER_POLICIES,
    optional: true,
    brief: "Rollover policy (on or off).",
  },
  agenda: {
    kind: "enum",
    values: KIND_AGENDA_PLACEMENTS,
    optional: true,
    brief: "Agenda placement (day-grid, undated-strip, or hidden).",
  },
} as const;

const attributeFlags = {
  color: { kind: "parsed", parse: String, optional: true, brief: "Color." },
  emoji: { kind: "parsed", parse: String, optional: true, brief: "Emoji." },
} as const;

type CreateFlags = CommonFlags & {
  datePolicy?: KindDatePolicy;
  rollover?: KindRolloverPolicy;
  agenda?: KindAgendaPlacement;
  color?: string;
  emoji?: string;
};

const create = buildCommand<CreateFlags, [string], AppContext>({
  docs: { brief: "Create an item kind." },
  parameters: {
    flags: { ...commonFlags, ...policyFlags, ...attributeFlags },
    positional: {
      kind: "tuple",
      parameters: [{ parse: String, brief: "Kind name.", placeholder: "name" }],
    },
  },
  async func(flags, name) {
    const input: CreateKindInput = { name };
    if (flags.datePolicy !== undefined) input.datePolicy = flags.datePolicy;
    if (flags.rollover !== undefined) input.rollover = flags.rollover;
    if (flags.agenda !== undefined) input.agendaPlacement = flags.agenda;
    if (flags.color !== undefined) input.color = flags.color;
    if (flags.emoji !== undefined) input.emoji = flags.emoji;
    const kind = await withServices(this, flags.data, ({ kinds }) => kinds.create(input));
    this.process.stdout.write(renderKind(kind, flags.json));
  },
});

const list = buildCommand<CommonFlags, [], AppContext>({
  docs: { brief: "List item kinds." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const kinds = await withServices(this, flags.data, ({ kinds }) => kinds.list());
    this.process.stdout.write(renderKinds(kinds, flags.json));
  },
});

const show = buildCommand<CommonFlags, [string], AppContext>({
  docs: { brief: "Show an item kind." },
  parameters: { flags: commonFlags, positional: idOrNamePositional },
  async func(flags, idOrName) {
    const kind = await withServices(this, flags.data, ({ kinds }) => kinds.get(idOrName));
    this.process.stdout.write(renderKind(kind, flags.json));
  },
});

type EditFlags = CommonFlags & {
  name?: string;
  datePolicy?: KindDatePolicy;
  rollover?: KindRolloverPolicy;
  agenda?: KindAgendaPlacement;
  color?: string;
  emoji?: string;
};

const edit = buildCommand<EditFlags, [string], AppContext>({
  docs: { brief: "Edit an item kind." },
  parameters: {
    flags: {
      ...commonFlags,
      name: { kind: "parsed", parse: String, optional: true, brief: "New name." },
      ...policyFlags,
      ...attributeFlags,
    },
    positional: idOrNamePositional,
  },
  async func(flags, idOrName) {
    const changes: EditKindInput = {};
    if (flags.name !== undefined) changes.name = flags.name;
    if (flags.datePolicy !== undefined) changes.datePolicy = flags.datePolicy;
    if (flags.rollover !== undefined) changes.rollover = flags.rollover;
    if (flags.agenda !== undefined) changes.agendaPlacement = flags.agenda;
    if (flags.color !== undefined) changes.color = flags.color;
    if (flags.emoji !== undefined) changes.emoji = flags.emoji;
    const kind = await withServices(this, flags.data, ({ kinds }) => kinds.edit(idOrName, changes));
    this.process.stdout.write(renderKind(kind, flags.json));
  },
});

type DeleteFlags = CommonFlags & {
  force?: boolean;
};

const deleteCommand = buildCommand<DeleteFlags, [string], AppContext>({
  docs: { brief: "Delete an item kind." },
  parameters: {
    flags: {
      ...commonFlags,
      force: {
        kind: "boolean",
        optional: true,
        brief: "Delete and un-assign even when todos use it.",
      },
    },
    positional: idOrNamePositional,
  },
  async func(flags, idOrName) {
    const kind = await withServices(this, flags.data, ({ kinds }) =>
      kinds.remove(idOrName, { force: flags.force === true }),
    );
    this.process.stdout.write(renderKind(kind, flags.json));
  },
});

export const kindRoute = buildRouteMap<string, AppContext>({
  routes: { create, list, show, edit, delete: deleteCommand },
  docs: { brief: "Manage user-defined item kinds." },
});

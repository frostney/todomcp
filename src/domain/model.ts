export type DateString = string;

export type TodoStatus = "open" | "done";

export type TodoDuration = 15 | 30 | 60;

export type TodoId = string;

export type CategoryId = string;

export type KindId = string;

export type MinuteOfDay = number;

export type KindDatePolicy = "required" | "optional" | "none";

export type KindRolloverPolicy = "on" | "off";

export type KindAgendaPlacement = "day-grid" | "undated-strip" | "hidden";

export type RolloverEntry = {
  fromDate: DateString;
  toDate: DateString;
  rolledOverAt: string;
};

export type Todo = {
  id: TodoId;
  name: string;
  status: TodoStatus;
  order: number;
  createdAt: string;
  updatedAt: string;
  date?: DateString;
  categoryId?: CategoryId;
  kindId?: KindId;
  emoji?: string;
  scheduledTime?: MinuteOfDay;
  duration?: TodoDuration;
  completedAt?: string;
  deletedAt?: string;
  causedBy?: TodoId;
  rolloverCount?: number;
  rolloverHistory?: RolloverEntry[];
};

export type Category = {
  id: CategoryId;
  name: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
  emoji?: string;
};

export type Kind = {
  id: KindId;
  name: string;
  datePolicy: KindDatePolicy;
  rollover: KindRolloverPolicy;
  agendaPlacement: KindAgendaPlacement;
  createdAt: string;
  updatedAt: string;
  color?: string;
  emoji?: string;
};

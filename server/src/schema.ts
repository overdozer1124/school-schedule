// Definition-driven schema for the generic school event-schedule app.
// Design source: ~/workspace/school-event-schedule-app/DESIGN.md v0.6.
// Core is minimal (school settings, days, events); everything that varies
// between schools (columns, duties, targets, periods, views) is data.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const ts = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  schoolName: text("school_name").notNull().default(""),
  schoolYear: integer("school_year").notNull().default(2026),
  presetApplied: text("preset_applied"),
  // JSON array of leave classification labels shown for 休暇 events
  // (editable in settings; stored as JSON text, e.g. ["年休","病休",…]).
  leaveTypesJson: text("leave_types_json")
    .notNull()
    .default('["年休","病休","特休","夏特","看護","職専免","振休","その他"]'),
  // Phase 3 (§10): link mode with school-timetable. standalone | linked.
  // In this prototype the link is settings + name-matching records only;
  // no real federation or SSO happens.
  linkMode: text("link_mode").notNull().default("standalone"),
  // Master provenance per kind: local (kept in this app) | linked
  // (conceptually referenced from school-timetable).
  peopleSource: text("people_source").notNull().default("local"),
  targetsSource: text("targets_source").notNull().default("local"),
  periodsSource: text("periods_source").notNull().default("local"),
});

// Phase 3 (§10.2): name-matching records between this app's masters and
// the linked product's masters, prepared when link mode starts. The
// linked side is identified by free-text name / external id only — the
// prototype never contacts the other product.
export const masterLinks = sqliteTable("master_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // people | grade | period
  kind: text("kind").notNull(),
  // Local master identity (id as text) and its display name at match time.
  localKey: text("local_key").notNull(),
  localName: text("local_name").notNull().default(""),
  linkedName: text("linked_name").notNull().default(""),
  linkedId: text("linked_id").notNull().default(""),
  // matched | local_only | unmatched
  status: text("status").notNull().default("unmatched"),
});

// Phase 3 (§10.1): product entitlements, school × product × plan ×
// status. This is the contract boundary between the two products; no
// billing itself happens in the prototype.
export const productEntitlements = sqliteTable("product_entitlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  schoolName: text("school_name").notNull().default(""),
  // event_schedule | timetable
  product: text("product").notNull(),
  // free | standard | pro
  plan: text("plan").notNull().default("standard"),
  // active | trial | suspended | none
  status: text("status").notNull().default("active"),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  note: text("note").notNull().default(""),
  sort: integer("sort").notNull().default(0),
});

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  sort: integer("sort").notNull().default(0),
});

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default(""),
  sort: integer("sort").notNull().default(0),
});

export const holidays = sqliteTable("holidays", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("祝日"),
});

export const targetGroups = sqliteTable("target_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id")
    .notNull()
    .references(() => targetGroups.id),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const itemDefinitions = sqliteTable("item_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  // text | time | time_range | symbol | boolean | number | person
  valueType: text("value_type").notNull().default("text"),
  targetGroupId: integer("target_group_id").references(() => targetGroups.id),
  granularity: text("granularity").notNull().default("day"),
  // staff_only | guardian | student | public
  defaultVisibility: text("default_visibility").notNull().default("staff_only"),
  isAggregatable: integer("is_aggregatable").notNull().default(0),
  sort: integer("sort").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
});

export const itemOptions = sqliteTable("item_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemDefinitionId: integer("item_definition_id")
    .notNull()
    .references(() => itemDefinitions.id),
  code: text("code").notNull(),
  label: text("label").notNull(),
  meaning: text("meaning").notNull().default(""),
  countsAs: integer("counts_as").notNull().default(0),
  sort: integer("sort").notNull().default(0),
});

export const periodPatterns = sqliteTable("period_patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const periodDefinitions = sqliteTable("period_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patternId: integer("pattern_id")
    .notNull()
    .references(() => periodPatterns.id),
  periodNo: integer("period_no").notNull(),
  label: text("label").notNull(),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  sort: integer("sort").notNull().default(0),
});

export const dayRecords = sqliteTable("day_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  dayType: text("day_type").notNull().default("授業日"),
  periodPatternId: integer("period_pattern_id").references(
    () => periodPatterns.id,
  ),
  note: text("note").notNull().default(""),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category").notNull().default("行事"),
  // day | range | month | undecided
  datePrecision: text("date_precision").notNull().default("day"),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  isAllDay: integer("is_all_day").notNull().default(1),
  // all_day | am | pm — partial-day marker (午前のみの出張など)
  slot: text("slot").notNull().default("all_day"),
  periodFrom: integer("period_from"),
  periodTo: integer("period_to"),
  locationId: integer("location_id").references(() => locations.id),
  locationText: text("location_text"),
  // Leave classification for category=休暇 events (年休 / 特休 / 病休 …);
  // replaces the location for leave, which has no place.
  leaveType: text("leave_type"),
  description: text("description").notNull().default(""),
  // confirmed | planned | tentative | draft
  certainty: text("certainty").notNull().default("confirmed"),
  // staff_only | guardian | student | public
  visibility: text("visibility").notNull().default("staff_only"),
  submitTo: text("submit_to"),
  createdAt: ts(),
});

export const eventAssignees = sqliteTable("event_assignees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id),
  personId: integer("person_id").references(() => people.id),
  freeTextName: text("free_text_name"),
  role: text("role").notNull().default("担当"),
});

export const eventTargets = sqliteTable("event_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id),
  targetId: integer("target_id")
    .notNull()
    .references(() => targets.id),
});

export const dailyValues = sqliteTable("daily_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  itemDefinitionId: integer("item_definition_id")
    .notNull()
    .references(() => itemDefinitions.id),
  targetId: integer("target_id").references(() => targets.id),
  slot: text("slot").notNull().default("all_day"),
  valueText: text("value_text"),
  valueNumber: integer("value_number"),
  valueOptionId: integer("value_option_id").references(() => itemOptions.id),
  valuePersonId: integer("value_person_id").references(() => people.id),
});

export const dutyDefinitions = sqliteTable("duty_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // day | am_pm | week
  granularity: text("granularity").notNull().default("day"),
  // all_year | long_vacation_only | custom_range
  applicablePeriod: text("applicable_period").notNull().default("all_year"),
  startsOn: text("starts_on"),
  endsOn: text("ends_on"),
  sort: integer("sort").notNull().default(0),
});

export const rotationMembers = sqliteTable("rotation_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dutyDefinitionId: integer("duty_definition_id")
    .notNull()
    .references(() => dutyDefinitions.id),
  personId: integer("person_id").references(() => people.id),
  freeTextName: text("free_text_name"),
  sort: integer("sort").notNull().default(0),
});

export const dutyAssignments = sqliteTable("duty_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dutyDefinitionId: integer("duty_definition_id")
    .notNull()
    .references(() => dutyDefinitions.id),
  date: text("date").notNull(),
  // all_day | am | pm | week
  slot: text("slot").notNull().default("all_day"),
  personId: integer("person_id").references(() => people.id),
  freeTextName: text("free_text_name"),
  note: text("note").notNull().default(""),
  isManualOverride: integer("is_manual_override").notNull().default(0),
  // auto | manual | swap | substitute
  origin: text("origin").notNull().default("manual"),
});

export const dutyChanges = sqliteTable("duty_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dutyDefinitionId: integer("duty_definition_id")
    .notNull()
    .references(() => dutyDefinitions.id),
  // swap | substitute | reassign
  kind: text("kind").notNull(),
  assignmentAId: integer("assignment_a_id"),
  assignmentBId: integer("assignment_b_id"),
  fromLabel: text("from_label").notNull().default(""),
  toLabel: text("to_label").notNull().default(""),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("applied"),
  createdAt: ts(),
});

export const dutyConflictWaivers = sqliteTable("duty_conflict_waivers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: integer("assignment_id")
    .notNull()
    .references(() => dutyAssignments.id),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id),
  reason: text("reason").notNull().default(""),
  createdAt: ts(),
});

export const viewDefinitions = sqliteTable("view_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // month_rows | week_rows | year_columns | calendar_grid | week_timeline
  layout: text("layout").notNull().default("month_rows"),
  // staff | guardian | student | public
  audience: text("audience").notNull().default("staff"),
  // JSON: [{kind:'events'|'category'|'daily_item'|'duty', category?, itemId?, dutyId?, label}]
  columnsJson: text("columns_json").notNull().default("[]"),
  // JSON object of drag-adjusted column widths in px, keyed by column
  // identity ("date", "cat:<category>", "item:<id>", "duty:<id>",
  // "target", "day"). Columns without an entry use the default width.
  widthsJson: text("widths_json").notNull().default("{}"),
  // JSON: {paper, orientation, showHeader}
  printJson: text("print_json").notNull().default("{}"),
  sort: integer("sort").notNull().default(0),
});

export const publications = sqliteTable("publications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  viewDefinitionId: integer("view_definition_id").references(
    () => viewDefinitions.id,
  ),
  viewName: text("view_name").notNull().default(""),
  targetMonth: text("target_month").notNull(),
  versionLabel: text("version_label").notNull(),
  note: text("note").notNull().default(""),
  publishedAt: integer("published_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

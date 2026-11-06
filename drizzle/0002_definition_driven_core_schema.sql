DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  school_name TEXT NOT NULL DEFAULT '',
  school_year INTEGER NOT NULL DEFAULT 2026,
  preset_applied TEXT
);
--> statement-breakpoint
CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '祝日'
);
--> statement-breakpoint
CREATE TABLE target_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES target_groups(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE item_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'text',
  target_group_id INTEGER REFERENCES target_groups(id),
  granularity TEXT NOT NULL DEFAULT 'day',
  default_visibility TEXT NOT NULL DEFAULT 'staff_only',
  is_aggregatable INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE item_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_definition_id INTEGER NOT NULL REFERENCES item_definitions(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  meaning TEXT NOT NULL DEFAULT '',
  counts_as INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE period_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE period_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id INTEGER NOT NULL REFERENCES period_patterns(id),
  period_no INTEGER NOT NULL,
  label TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE day_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  day_type TEXT NOT NULL DEFAULT '授業日',
  period_pattern_id INTEGER REFERENCES period_patterns(id),
  note TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '行事',
  date_precision TEXT NOT NULL DEFAULT 'day',
  starts_on TEXT,
  ends_on TEXT,
  starts_at TEXT,
  ends_at TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 1,
  slot TEXT NOT NULL DEFAULT 'all_day',
  period_from INTEGER,
  period_to INTEGER,
  location_id INTEGER REFERENCES locations(id),
  location_text TEXT,
  description TEXT NOT NULL DEFAULT '',
  certainty TEXT NOT NULL DEFAULT 'confirmed',
  visibility TEXT NOT NULL DEFAULT 'staff_only',
  submit_to TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE event_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  person_id INTEGER REFERENCES people(id),
  free_text_name TEXT,
  role TEXT NOT NULL DEFAULT '担当'
);
--> statement-breakpoint
CREATE TABLE event_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  target_id INTEGER NOT NULL REFERENCES targets(id)
);
--> statement-breakpoint
CREATE TABLE daily_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  item_definition_id INTEGER NOT NULL REFERENCES item_definitions(id),
  target_id INTEGER REFERENCES targets(id),
  slot TEXT NOT NULL DEFAULT 'all_day',
  value_text TEXT,
  value_number INTEGER,
  value_option_id INTEGER REFERENCES item_options(id),
  value_person_id INTEGER REFERENCES people(id)
);
--> statement-breakpoint
CREATE TABLE duty_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  granularity TEXT NOT NULL DEFAULT 'day',
  applicable_period TEXT NOT NULL DEFAULT 'all_year',
  starts_on TEXT,
  ends_on TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE rotation_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_definition_id INTEGER NOT NULL REFERENCES duty_definitions(id),
  person_id INTEGER REFERENCES people(id),
  free_text_name TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE duty_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_definition_id INTEGER NOT NULL REFERENCES duty_definitions(id),
  date TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'all_day',
  person_id INTEGER REFERENCES people(id),
  free_text_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  is_manual_override INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE duty_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_definition_id INTEGER NOT NULL REFERENCES duty_definitions(id),
  kind TEXT NOT NULL,
  assignment_a_id INTEGER,
  assignment_b_id INTEGER,
  from_label TEXT NOT NULL DEFAULT '',
  to_label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'applied',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE duty_conflict_waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES duty_assignments(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE view_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT 'month_rows',
  audience TEXT NOT NULL DEFAULT 'staff',
  columns_json TEXT NOT NULL DEFAULT '[]',
  print_json TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_definition_id INTEGER REFERENCES view_definitions(id),
  view_name TEXT NOT NULL DEFAULT '',
  target_month TEXT NOT NULL,
  version_label TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL
);

export type Brief = {
  city: string | null;
  start_date: string;
  days: number;
  party: "solo" | "couple" | "friends" | "family" | "parents";
  kids: number;
  diet: "any" | "veg" | "jain" | "halal";
  budget_total: number | null;
  budget_style: "low" | "mid" | "high";
  interests: string[];
  must: string[];
  avoid: string[];
  no_stairs: boolean;
  raw: string;
  parsed_by: string;
  assumptions: string[];
};

export type PlanBAlt = { place_id?: string; name?: string; km?: number; reason: string; indoor?: boolean; shorten?: number };

export type MealOption = { place_id: string; name: string; minutes: number; mode: string; cost: number; diet?: string; note: string; pick?: boolean };

export type Block = {
  id: string;
  kind: "place" | "meal" | "rest" | "leg" | "anchor";
  name: string;
  s: number;
  e: number;
  start: string;
  end: string;
  dwell: number;
  place_id?: string | null;
  cat?: string;
  lat?: number | null;
  lon?: number | null;
  energy?: number;
  cost?: number;
  indoor?: boolean;
  tags?: string[];
  desc?: string;
  why?: string;
  source?: string;
  verified_at?: string | null;
  fixed?: boolean;
  best?: [string, string, string];
  wait?: number;
  shortened?: boolean;
  plan_b?: { rain?: PlanBAlt; crowd?: PlanBAlt; tired?: PlanBAlt };
  options?: MealOption[];
  meal?: string;
  diet?: string;
  feedback?: string;
  node?: string;
  user_locked?: boolean;
  delay_risk?: string | null;
  // leg
  mode?: string;
  minutes?: number;
  km?: number;
  buffer?: number;
  reliability?: number;
  depart_by?: string;
  to_stay?: boolean;
};

export type Check = { level: "ok" | "warn" | "risk"; text: string };

export type Day = {
  index: number;
  date: string;
  weekday: string;
  weekday_idx: number;
  blocks: Block[];
  energy_budget: number;
  limiter: string;
  cost: number;
  weather?: { tmax: number; rain_prob: number; source: string };
  verify: { score: number; checks: Check[]; energy: { used: number; budget: number; pct: number }; travel_share: number; travel_min: number };
};

export type StayOption = { id: string; name: string; avg_minutes: number; price: string; vibe: string; tradeoff: string; pick?: boolean; chosen?: boolean; lat: number; lon: number };

export type Booking = { id: string; kind: "arrival" | "departure"; mode: string; number: string; date: string; time: string; station_id: string; pnr?: string };

export type Diff = {
  headline: string;
  dropped: { name: string; reason: string }[];
  moved: { name: string; to_day: number; reason: string }[];
  swapped: { from: string; to: string; reason: string }[];
  shifted: { name: string; from: string; to: string; delta: number }[];
  inserted: string[];
  notes: string[];
  feasibility: { before: number; after: number };
  energy: { before: number; after: number };
};

export type Proposal = { id: string; day: number; now: string; event: Record<string, unknown>; diff: Diff; auto_apply: boolean; preview_day: Day };

export type Capsule = {
  id: string;
  status: string;
  city_key: string;
  city: { name: string; state: string; center: [number, number]; emergency: Record<string, string>; local_phrase: string; stations: { id: string; name: string; lat: number; lon: number }[] };
  brief: Brief;
  travellers: { label: string; age: string; mobility: string }[];
  dna: { pace: number; stamina: number; food: number; crowd: number; budget: number; morning: number; interests: Record<string, number> };
  dna_initial: Capsule["dna"];
  dna_summary: string[];
  constraints: { diet: string; no_stairs: boolean; must: string[]; exclude: string[] };
  stay: StayOption;
  stay_options: StayOption[];
  discover: { place_id: string; name: string; match: number; tags: string[]; cat: string }[];
  days: Day[];
  bookings: Booking[];
  budget: { planned_total: number; stay_estimate: number; per_day: { day: number; planned: number; spent: number }[]; spent_total: number; budget_total: number | null; over_budget: boolean; fits: boolean };
  spent: { day: number; amount: number; label: string }[];
  learned: { day: number; text: string; from: string }[];
  ripple_log: { id: string; now: string; day: number; event: Record<string, unknown>; diff: Diff; auto: boolean }[];
  notes: string[];
  weather: Record<string, { tmax: number; rain_prob: number; source: string }>;
  pending?: unknown;
};

export type Step = { node: string; agent: string; title: string; detail: string };

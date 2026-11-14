export const MODES = ['walk', 'auto', 'bike', 'cab', 'citybus', 'metro', 'ibus', 'train'] as const
export type Mode = (typeof MODES)[number]

export const MODE_LABEL: Record<Mode, string> = {
  walk: 'Walk',
  auto: 'Auto',
  bike: 'Bike taxi',
  cab: 'Cab',
  citybus: 'City bus',
  metro: 'Metro',
  ibus: 'Intercity bus',
  train: 'Train',
}

export const MODE_ICON: Record<Mode, string> = {
  walk: '🚶', auto: '🛺', bike: '🏍️', cab: '🚕', citybus: '🚌', metro: '🚇', ibus: '🚍', train: '🚆',
}

export type Prefs = { modes: Mode[]; budget: number | null; maxTransfers: number | null }
export type Profile = { name: string; prefs: Prefs }

export const DEFAULT_PREFS: Prefs = { modes: ['walk', 'auto', 'bike', 'metro', 'citybus', 'ibus', 'train'], budget: null, maxTransfers: null }

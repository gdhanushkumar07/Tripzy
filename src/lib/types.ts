export const MODES = ['walk', 'cycle', 'auto', 'shareauto', 'erick', 'bike', 'cab', 'suv', 'citybus', 'metro', 'rail', 'ferry', 'ibus', 'train'] as const
export type Mode = (typeof MODES)[number]

export const MODE_LABEL: Record<Mode, string> = {
  walk: 'Walk',
  cycle: 'Cycle',
  auto: 'Auto',
  shareauto: 'Shared auto',
  erick: 'E-rickshaw',
  bike: 'Bike taxi',
  cab: 'Cab',
  suv: 'SUV cab (6)',
  citybus: 'City bus',
  metro: 'Metro',
  rail: 'Local train / MMTS',
  ferry: 'Ferry / water metro',
  ibus: 'Intercity bus',
  train: 'Train',
}

export const MODE_ICON: Record<Mode, string> = {
  walk: '🚶', cycle: '🚲', auto: '🛺', shareauto: '🛺', erick: '🛵', bike: '🏍️', cab: '🚕', suv: '🚙',
  citybus: '🚌', metro: '🚇', rail: '🚈', ferry: '⛴️', ibus: '🚍', train: '🚆',
}

export type Prefs = { modes: Mode[]; budget: number | null; maxTransfers: number | null }
export type Profile = { name: string; prefs: Prefs }

export const DEFAULT_PREFS: Prefs = { modes: ['walk', 'auto', 'shareauto', 'bike', 'metro', 'citybus', 'rail', 'ibus', 'train'], budget: null, maxTransfers: null }

export const MODES = ['walk', 'cycle', 'auto', 'shareauto', 'erick', 'bike', 'cab', 'suv', 'citybus', 'metro', 'rail', 'ferry', 'ibus', 'train', 'ownscooter', 'owncar'] as const
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
  ownscooter: 'Your scooter',
  owncar: 'Your car',
}

export const MODE_ICON: Record<Mode, string> = {
  walk: '🚶', cycle: '🚲', auto: '🛺', shareauto: '🛺', erick: '🛵', bike: '🏍️', cab: '🚕', suv: '🚙',
  citybus: '🚌', metro: '🚇', rail: '🚈', ferry: '⛴️', ibus: '🚍', train: '🚆', ownscooter: '🛵', owncar: '🚗',
}

export type Fuel = 'petrol' | 'diesel' | 'cng' | 'ev'
/** Saved once in the profile so each journey asks only 2–3 questions. */
export type Vehicles = { car?: { kmpl: number; fuel: Fuel; seats: number }; scooter?: { kmpl: number } }
export type Family = { adults: number; children: number; seniors: number }
export type Prefs = { modes: Mode[]; budget: number | null; maxTransfers: number | null; vehicles?: Vehicles; family?: Family; priority?: Priority }
export type Priority = 'balanced' | 'fastest' | 'cheapest' | 'comfort'
export type Profile = { name: string; prefs: Prefs }

export const DEFAULT_PREFS: Prefs = { modes: ['walk', 'auto', 'shareauto', 'bike', 'metro', 'citybus', 'rail', 'ibus', 'train'], budget: null, maxTransfers: null }

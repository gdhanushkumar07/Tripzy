/**
 * Why people go where they go. For popular Indian destinations: the reasons people visit, how long
 * they usually stay, the sights a first-time visitor expects, the experiences the place is known for
 * (Goa: beaches, parties, water sports, bonfires; Varanasi: the ghats and the evening aarti) and the
 * food places people look for. The planner uses it to (1) put must-sees in front of minor sights,
 * (2) add experiences that are not on Wikipedia's map, (3) prefer the local food people travel for,
 * and (4) suggest a trip length. Times are windows of the day (sunrise, evening), never show timings:
 * the plan tells the traveller to check the official timings.
 */
import type { Tag } from './questions'

export type Spot = {
  name: string
  /** search words when the name alone is ambiguous (geocoded near the destination) */
  q?: string
  cat: 'heritage' | 'museum' | 'religious' | 'nature' | 'entertainment' | 'market' | 'show' | 'viewpoint' | 'beach' | 'activity' | 'nightlife'
  tags: Tag[]
  dwell: number
  cost?: number
  /** best window of the day [from, to, why] */
  best?: [string, string, string]
  /** only worth it in the evening / at night */
  night?: boolean
  intensity?: number
  indoor?: boolean
  /** not for children or seniors (scuba, bungee, rafting, clubs) */
  adult?: boolean
  /** only on these weekdays (0 = Monday) */
  days?: number[]
}
export type Destination = {
  id: string
  /** matched against the chosen place's name and state */
  match: RegExp
  why: string
  /** usual stay in days [short, comfortable] */
  days: [number, number]
  themes: Tag[]
  musts: Spot[]
  experiences: Spot[]
  /** restaurants and food places people seek out (matched by name, else searched near the centre) */
  food: string[]
}

const S = (name: string, cat: Spot['cat'], tags: Tag[], dwell: number, more: Partial<Spot> = {}): Spot => ({ name, cat, tags, dwell, ...more })

export const DESTINATIONS: Destination[] = [
  {
    id: 'hyderabad', match: /hyderabad|secunderabad/i, days: [3, 4], themes: ['history', 'food', 'shopping', 'culture'],
    why: 'Qutb Shahi and Nizam heritage, the Charminar bazaars, biryani and Irani chai, and Ramoji Film City.',
    musts: [
      S('Charminar', 'heritage', ['history', 'photography', 'culture'], 60, { best: ['16:00', '20:00', 'bazaars light up in the evening'] }),
      S('Golconda Fort', 'heritage', ['history', 'photography', 'adventure'], 150, { cost: 25, intensity: 6, best: ['08:00', '11:00', 'cool morning climb'] }),
      S('Chowmahalla Palace', 'heritage', ['history', 'art', 'culture'], 90, { cost: 80, indoor: true }),
      S('Qutb Shahi Tombs', 'heritage', ['history', 'photography'], 75, { cost: 25 }),
      S('Salar Jung Museum', 'museum', ['art', 'history'], 120, { cost: 50, indoor: true }),
      S('Hussain Sagar', 'nature', ['nature', 'photography', 'nightlife'], 75, { best: ['17:00', '21:00', 'sunset boat ride and the lit Buddha statue'] }),
      S('Laad Bazaar', 'market', ['shopping', 'culture'], 75, { best: ['16:00', '21:00', 'bangle shops at their liveliest'] }),
      S('Birla Mandir', 'religious', ['spiritual', 'photography'], 45, { q: 'Birla Mandir Hyderabad', best: ['17:30', '20:30', 'city view at dusk'] }),
    ],
    experiences: [
      S('Ramoji Film City', 'entertainment', ['entertainment', 'kids'], 360, { cost: 1350 }),
      S('Nehru Zoological Park', 'entertainment', ['kids', 'nature'], 180, { cost: 80 }),
      S('Shilparamam', 'market', ['art', 'culture', 'shopping'], 90, { q: 'Shilparamam Madhapur', cost: 60 }),
      S('Necklace Road', 'viewpoint', ['nightlife', 'photography'], 60, { night: true, best: ['18:00', '22:00', 'lakeside lights'] }),
    ],
    food: ['Paradise', 'Bawarchi', 'Shah Ghouse', 'Cafe Bahar', 'Pista House', 'Nimrah', 'Shadab', 'Chutneys', 'Hotel Shadab', 'Alpha Hotel'],
  },
  {
    id: 'goa', match: /\bgoa\b|panaji|panjim|calangute|baga|anjuna|candolim|margao|vasco|palolem/i, days: [4, 5], themes: ['beach', 'nightlife', 'adventure', 'food'],
    why: 'Beaches and shacks, nightlife and beach parties, water sports and scuba, Portuguese-era churches and forts, and seafood.',
    musts: [
      S('Baga Beach', 'beach', ['beach', 'nightlife', 'photography'], 150, { best: ['16:00', '23:00', 'sunset, then the shacks and clubs'] }),
      S('Calangute Beach', 'beach', ['beach', 'adventure', 'kids'], 150, { cost: 1500, best: ['09:00', '13:00', 'parasailing, jet ski and banana rides before the afternoon sun'] }),
      S('Anjuna Beach', 'beach', ['beach', 'nightlife'], 120, { best: ['15:00', '22:00', 'flea market day and sunset'] }),
      S('Fort Aguada', 'heritage', ['history', 'photography'], 75, { best: ['16:00', '18:30', 'sea views at sunset'] }),
      S('Chapora Fort', 'heritage', ['history', 'photography'], 60, { best: ['16:30', '18:30', 'sunset over Vagator'], intensity: 5 }),
      S('Basilica of Bom Jesus', 'religious', ['history', 'spiritual', 'culture'], 60, { q: 'Basilica of Bom Jesus Old Goa' }),
      S('Fontainhas', 'heritage', ['culture', 'photography', 'art'], 75, { q: 'Fontainhas Panaji', best: ['09:00', '11:30', 'soft light on the Latin quarter'] }),
    ],
    experiences: [
      S('Scuba diving at Grande Island', 'activity', ['adventure', 'beach'], 360, { q: 'Grande Island Goa', cost: 3500, intensity: 6, adult: true, best: ['07:30', '10:30', 'boats leave in the morning; most packages include lunch'] }),
      S('Beach shack dinner and bonfire at Vagator', 'nightlife', ['nightlife', 'beach', 'food'], 150, { q: 'Vagator Beach', cost: 800, night: true, best: ['19:00', '23:30', 'bonfires and music after dark'] }),
      S('Tito’s Lane, Baga', 'nightlife', ['nightlife', 'entertainment'], 150, { q: 'Tito\'s Lane Baga', cost: 1000, night: true, best: ['21:00', '23:59', 'clubs and bars'] }),
      S('Saturday Night Market, Arpora', 'market', ['shopping', 'nightlife', 'food'], 120, { q: 'Saturday Night Market Arpora', night: true, days: [5], best: ['18:00', '23:00', 'Saturday evenings only'] }),
      S('Dudhsagar Falls', 'nature', ['nature', 'adventure', 'photography'], 360, { cost: 3000, intensity: 5 }),
      S('Splashdown Waterpark', 'entertainment', ['kids', 'entertainment', 'adventure'], 180, { q: 'Splashdown Waterpark Baga', cost: 600 }),
      S('Mandovi river sunset cruise', 'activity', ['entertainment', 'nightlife'], 75, { q: 'Panaji jetty Mandovi', cost: 500, best: ['17:00', '19:30', 'sunset cruise'] }),
    ],
    food: ['Fisherman’s Wharf', 'Britto', 'Souza Lobo', 'Ritz Classic', 'Viva Panjim', 'Gunpowder', 'Infantaria', 'Thalassa'],
  },
  {
    id: 'jaipur', match: /jaipur/i, days: [2, 3], themes: ['history', 'shopping', 'photography', 'culture'],
    why: 'Rajput forts and palaces, the pink old city and its bazaars, and Rajasthani food.',
    musts: [
      S('Amber Fort', 'heritage', ['history', 'photography', 'adventure'], 150, { q: 'Amer Fort', cost: 100, intensity: 5, best: ['08:00', '11:00', 'before the crowds and heat'] }),
      S('Hawa Mahal', 'heritage', ['history', 'photography'], 45, { cost: 50, best: ['07:30', '10:00', 'morning sun on the facade'] }),
      S('City Palace', 'heritage', ['history', 'art', 'culture'], 120, { q: 'City Palace Jaipur', cost: 300, indoor: true }),
      S('Jantar Mantar', 'heritage', ['history', 'art'], 60, { q: 'Jantar Mantar Jaipur', cost: 50 }),
      S('Nahargarh Fort', 'viewpoint', ['photography', 'history', 'nightlife'], 90, { best: ['16:30', '19:00', 'sunset over the city'] }),
      S('Johari Bazaar', 'market', ['shopping', 'culture'], 90, { best: ['17:00', '21:00', 'evening shopping'] }),
    ],
    experiences: [
      S('Chokhi Dhani', 'show', ['culture', 'food', 'entertainment', 'kids'], 180, { cost: 1100, night: true, best: ['18:30', '22:30', 'village fair and dinner'] }),
      S('Jal Mahal', 'viewpoint', ['photography'], 30, { best: ['16:30', '18:30', 'sunset by the lake'] }),
    ],
    food: ['Laxmi Mishthan Bhandar', 'LMB', 'Rawat Mishthan', 'Suvarna Mahal', 'Handi', 'Niros', 'Peacock Rooftop'],
  },
  {
    id: 'udaipur', match: /udaipur/i, days: [2, 3], themes: ['history', 'photography', 'culture'],
    why: 'Lakes and palaces, sunset boat rides on Lake Pichola, and the old city lanes.',
    musts: [
      S('City Palace', 'heritage', ['history', 'art', 'photography'], 150, { q: 'City Palace Udaipur', cost: 300, indoor: true }),
      S('Lake Pichola', 'nature', ['nature', 'photography'], 90, { best: ['17:00', '19:00', 'sunset boat ride'] }),
      S('Jagdish Temple', 'religious', ['spiritual', 'history'], 40),
      S('Saheliyon-ki-Bari', 'nature', ['nature', 'history'], 60, { cost: 10 }),
      S('Bagore Ki Haveli', 'show', ['culture', 'entertainment'], 90, { cost: 150, night: true, best: ['18:30', '20:30', 'evening folk dance show'] }),
      S('Monsoon Palace', 'viewpoint', ['photography', 'history'], 90, { q: 'Sajjangarh Monsoon Palace', best: ['16:30', '19:00', 'sunset over the lakes'] }),
    ],
    experiences: [S('Fateh Sagar Lake', 'nature', ['nature', 'nightlife'], 60, { best: ['17:00', '21:00', 'lakeside evening'] })],
    food: ['Ambrai', 'Upre', 'Natraj', 'Jheel'],
  },
  {
    id: 'agra', match: /\bagra\b/i, days: [1, 2], themes: ['history', 'photography'],
    why: 'The Taj Mahal at sunrise, Agra Fort and Fatehpur Sikri.',
    musts: [
      S('Taj Mahal', 'heritage', ['history', 'photography', 'art'], 180, { cost: 50, best: ['06:00', '09:00', 'sunrise, before the crowds'] }),
      S('Agra Fort', 'heritage', ['history', 'photography'], 120, { cost: 50 }),
      S('Mehtab Bagh', 'viewpoint', ['photography', 'nature'], 60, { best: ['17:00', '19:00', 'Taj at sunset across the river'] }),
      S('Itmad-ud-Daulah', 'heritage', ['history', 'art'], 60, { q: "Tomb of I'timād-ud-Daulah", cost: 30 }),
    ],
    experiences: [S('Fatehpur Sikri', 'heritage', ['history', 'photography'], 240, { cost: 50 })],
    food: ['Pinch of Spice', 'Peshawri', 'Panchhi Petha', 'Dasaprakash'],
  },
  {
    id: 'varanasi', match: /varanasi|benaras|banaras|kashi/i, days: [2, 3], themes: ['spiritual', 'culture', 'photography'],
    why: 'The ghats of the Ganga, the evening aarti, a sunrise boat ride and the old lanes.',
    musts: [
      S('Dashashwamedh Ghat', 'religious', ['spiritual', 'culture', 'photography'], 90, { night: true, best: ['17:30', '20:00', 'Ganga aarti after sunset'] }),
      S('Assi Ghat', 'religious', ['spiritual', 'culture'], 60, { best: ['05:30', '08:00', 'morning aarti and boats'] }),
      S('Kashi Vishwanath Temple', 'religious', ['spiritual', 'history'], 90),
      S('Sunrise boat ride on the Ganga', 'activity', ['spiritual', 'photography'], 75, { q: 'Dashashwamedh Ghat', cost: 300, best: ['05:30', '07:30', 'sunrise over the ghats'] }),
      S('Sarnath', 'heritage', ['history', 'spiritual'], 150, { cost: 25 }),
    ],
    experiences: [S('Manikarnika Ghat', 'religious', ['spiritual', 'culture'], 30), S('Ramnagar Fort', 'heritage', ['history'], 75, { cost: 75 })],
    food: ['Kashi Chat Bhandar', 'Blue Lassi', 'Deena Chaat', 'Keshari'],
  },
  {
    id: 'rishikesh', match: /rishikesh|haridwar/i, days: [2, 3], themes: ['adventure', 'spiritual', 'nature'],
    why: 'River rafting and bungee, yoga and the Ganga aarti, and Himalayan foothill views.',
    musts: [
      S('Triveni Ghat', 'religious', ['spiritual', 'culture'], 75, { night: true, best: ['17:30', '19:30', 'evening Ganga aarti'] }),
      S('Lakshman Jhula', 'viewpoint', ['photography', 'culture'], 45),
      S('Parmarth Niketan', 'religious', ['spiritual'], 75, { best: ['17:30', '19:30', 'riverside aarti'] }),
      S('Beatles Ashram', 'heritage', ['history', 'art', 'photography'], 75, { cost: 150 }),
    ],
    experiences: [
      S('White-water rafting from Shivpuri', 'activity', ['adventure'], 240, { q: 'Shivpuri Rishikesh', cost: 1000, intensity: 7, adult: true, best: ['08:00', '14:00', 'morning batches'] }),
      S('Bungee jumping at Mohan Chatti', 'activity', ['adventure'], 180, { q: 'Mohan Chatti Rishikesh', cost: 3700, intensity: 8, adult: true }),
    ],
    food: ['Chotiwala', 'Little Buddha Cafe', 'Ganga Beach Cafe'],
  },
  {
    id: 'manali', match: /manali|kullu|solang/i, days: [3, 5], themes: ['nature', 'adventure', 'photography'],
    why: 'Snow and mountain views, paragliding and skiing at Solang, apple orchards and old Manali cafés.',
    musts: [
      S('Hadimba Temple', 'religious', ['spiritual', 'history', 'nature'], 60),
      S('Solang Valley', 'nature', ['adventure', 'nature', 'kids'], 240, { cost: 500, best: ['09:00', '15:00', 'paragliding and snow activities'] }),
      S('Old Manali', 'market', ['food', 'culture', 'nightlife'], 120, { best: ['17:00', '22:00', 'cafés in the evening'] }),
      S('Vashisht hot springs', 'nature', ['nature', 'spiritual'], 60, { q: 'Vashisht Manali' }),
    ],
    experiences: [S('Atal Tunnel and Sissu', 'nature', ['nature', 'photography'], 300, { q: 'Sissu Himachal' }), S('Jogini Falls trek', 'activity', ['adventure', 'nature'], 180, { q: 'Jogini Waterfall', intensity: 7 })],
    food: ['Johnson’s Cafe', 'Cafe 1947', 'Drifters Inn'],
  },
  {
    id: 'kerala', match: /kochi|cochin|munnar|alleppey|alappuzha|kumarakom|kerala|thekkady|varkala|trivandrum|thiruvananthapuram/i, days: [4, 6], themes: ['nature', 'food', 'culture', 'beach'],
    why: 'Backwater houseboats, tea hills in Munnar, Fort Kochi heritage, Kathakali and beaches.',
    musts: [
      S('Fort Kochi', 'heritage', ['history', 'culture', 'photography'], 150, { best: ['16:00', '19:00', 'Chinese fishing nets at sunset'] }),
      S('Mattancherry Palace', 'museum', ['history', 'art'], 60, { indoor: true, cost: 5 }),
      S('Kathakali show', 'show', ['culture', 'art', 'entertainment'], 120, { q: 'Kerala Kathakali Centre Fort Kochi', cost: 400, night: true, best: ['17:00', '20:00', 'evening performances'] }),
      S('Alleppey backwater houseboat', 'activity', ['nature', 'food'], 300, { q: 'Alappuzha boat jetty', cost: 3000 }),
    ],
    experiences: [S('Marari Beach', 'beach', ['beach', 'nature'], 120)],
    food: ['Kashi Art Cafe', 'Fort House', 'Dhe Puttu', 'Paragon'],
  },
  {
    id: 'mumbai', match: /mumbai|bombay/i, days: [2, 3], themes: ['culture', 'food', 'nightlife', 'history'],
    why: 'Colonial architecture, Marine Drive at night, street food, Bollywood and the island caves.',
    musts: [
      S('Gateway of India', 'heritage', ['history', 'photography'], 45),
      S('Chhatrapati Shivaji Maharaj Terminus', 'heritage', ['history', 'photography'], 30),
      S('Marine Drive', 'viewpoint', ['nightlife', 'photography'], 60, { night: true, best: ['18:00', '22:00', 'the Queen’s Necklace at night'] }),
      S('Elephanta Caves', 'heritage', ['history', 'art', 'adventure'], 300, { cost: 600 }),
      S('Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', 'museum', ['art', 'history'], 120, { cost: 150, indoor: true }),
      S('Colaba Causeway', 'market', ['shopping', 'food'], 90, { best: ['16:00', '21:00', 'evening street shopping'] }),
    ],
    experiences: [S('Juhu Beach', 'beach', ['beach', 'food', 'nightlife'], 90, { best: ['17:00', '21:00', 'sunset and street food'] }), S('Haji Ali Dargah', 'religious', ['spiritual'], 60)],
    food: ['Leopold Cafe', 'Britannia', 'Bademiya', 'Cafe Mondegar', 'Trishna', 'Swati Snacks'],
  },
  {
    id: 'delhi', match: /\bdelhi\b|new delhi/i, days: [3, 4], themes: ['history', 'food', 'shopping', 'culture'],
    why: 'Mughal monuments, Old Delhi food lanes, markets and museums.',
    musts: [
      S('Red Fort', 'heritage', ['history', 'photography'], 120, { cost: 50 }),
      S('Qutub Minar', 'heritage', ['history', 'photography'], 90, { cost: 40 }),
      S('Humayun’s Tomb', 'heritage', ['history', 'photography', 'art'], 90, { q: "Humayun's Tomb", cost: 40 }),
      S('India Gate', 'heritage', ['history', 'nightlife'], 45, { best: ['18:00', '21:30', 'lit up after dark'] }),
      S('Chandni Chowk', 'market', ['food', 'shopping', 'culture'], 120, { best: ['10:00', '13:00', 'food lanes before the rush'] }),
      S('Lotus Temple', 'religious', ['spiritual', 'art'], 45),
      S('Akshardham', 'religious', ['spiritual', 'art', 'entertainment'], 180, { q: 'Swaminarayan Akshardham Delhi', night: false }),
    ],
    experiences: [S('Hauz Khas Village', 'nightlife', ['nightlife', 'food'], 120, { night: true, best: ['19:00', '23:30', 'bars and cafés'] })],
    food: ['Karim', 'Paranthe Wali Gali', 'Bukhara', 'Indian Accent', 'Saravana Bhavan'],
  },
  {
    id: 'mysuru', match: /mysore|mysuru/i, days: [2, 2], themes: ['history', 'culture', 'spiritual'],
    why: 'Mysore Palace lit at night, Chamundi Hill and the Brindavan Gardens fountain show.',
    musts: [
      S('Mysore Palace', 'heritage', ['history', 'art', 'photography'], 120, { cost: 100, best: ['18:30', '20:00', 'illuminated on Sunday and festival evenings'] }),
      S('Chamundeshwari Temple', 'religious', ['spiritual', 'photography'], 90, { q: 'Chamundi Hill' }),
      S('Brindavan Gardens', 'nature', ['nature', 'kids', 'nightlife'], 120, { cost: 50, night: true, best: ['18:00', '20:30', 'musical fountain after dark'] }),
      S('Devaraja Market', 'market', ['shopping', 'culture', 'food'], 60),
    ],
    experiences: [],
    food: ['Mylari', 'Hotel RRR', 'Vinayaka Mylari'],
  },
  {
    id: 'puducherry', match: /pondicherry|puducherry/i, days: [2, 3], themes: ['culture', 'beach', 'food', 'spiritual'],
    why: 'French Quarter streets and cafés, the promenade, Auroville and quiet beaches.',
    musts: [
      S('Promenade Beach', 'beach', ['beach', 'nightlife', 'photography'], 90, { best: ['17:00', '21:00', 'evening walk by the sea'] }),
      S('French Quarter', 'heritage', ['culture', 'photography', 'food'], 120, { q: 'White Town Puducherry' }),
      S('Auroville', 'religious', ['spiritual', 'culture'], 180),
      S('Paradise Beach', 'beach', ['beach', 'nature', 'adventure'], 180, { q: 'Paradise Beach Chunnambar', cost: 300 }),
    ],
    experiences: [S('Scuba diving in Puducherry', 'activity', ['adventure', 'beach'], 240, { q: 'Temple Adventures Puducherry', cost: 6000, adult: true })],
    food: ['Le Cafe', 'Villa Shanti', 'Cafe des Arts', 'Baker Street'],
  },
  {
    id: 'andaman', match: /andaman|port blair|havelock|swaraj dweep|neil island/i, days: [4, 6], themes: ['beach', 'adventure', 'nature', 'history'],
    why: 'Clear-water beaches, scuba and snorkelling, and the Cellular Jail light and sound show.',
    musts: [
      S('Cellular Jail', 'heritage', ['history'], 120, { cost: 30, night: false }),
      S('Radhanagar Beach', 'beach', ['beach', 'nature', 'photography'], 180, { best: ['15:30', '18:00', 'sunset on Havelock'] }),
      S('Corbyn’s Cove', 'beach', ['beach'], 90, { q: "Corbyn's Cove Beach" }),
    ],
    experiences: [S('Scuba diving at Havelock', 'activity', ['adventure', 'beach'], 240, { q: 'Havelock Island', cost: 4500, intensity: 6, adult: true }), S('Snorkelling at Elephant Beach', 'activity', ['adventure', 'beach'], 180, { q: 'Elephant Beach Havelock', cost: 1500 })],
    food: ['Full Moon Cafe', 'Anju Coco'],
  },
  {
    id: 'amritsar', match: /amritsar/i, days: [1, 2], themes: ['spiritual', 'history', 'food'],
    why: 'The Golden Temple and its langar, Jallianwala Bagh, the Wagah border ceremony and Punjabi food.',
    musts: [
      S('Golden Temple', 'religious', ['spiritual', 'history', 'photography'], 150, { best: ['05:00', '08:00', 'early morning prayers'] }),
      S('Jallianwala Bagh', 'heritage', ['history'], 45),
      S('Wagah Border ceremony', 'show', ['culture', 'entertainment'], 180, { q: 'Attari Wagah Border', best: ['15:30', '18:30', 'beating retreat before sunset'] }),
    ],
    experiences: [S('Partition Museum', 'museum', ['history'], 90, { cost: 10, indoor: true })],
    food: ['Kesar Da Dhaba', 'Bharawan Da Dhaba', 'Kulcha Land'],
  },
  {
    id: 'kolkata', match: /kolkata|calcutta/i, days: [2, 3], themes: ['culture', 'history', 'food', 'art'],
    why: 'Victoria Memorial, Howrah Bridge, College Street books, art and Bengali sweets.',
    musts: [
      S('Victoria Memorial', 'heritage', ['history', 'art', 'photography'], 120, { cost: 50 }),
      S('Howrah Bridge', 'viewpoint', ['photography', 'nightlife'], 30, { best: ['17:00', '20:00', 'riverside at dusk'] }),
      S('Dakshineswar Kali Temple', 'religious', ['spiritual'], 75),
      S('Indian Museum', 'museum', ['history', 'art'], 120, { q: 'Indian Museum Kolkata', cost: 50, indoor: true }),
    ],
    experiences: [S('Princep Ghat', 'viewpoint', ['nightlife', 'photography'], 60, { night: true, best: ['17:30', '21:00', 'evening by the river'] })],
    food: ['Peter Cat', 'Flurys', 'Arsalan', 'Bhojohori Manna', 'Balwant Singh'],
  },
  {
    id: 'hampi', match: /hampi|hospet|hosapete/i, days: [2, 3], themes: ['history', 'photography', 'adventure'],
    why: 'The ruins of the Vijayanagara empire, boulder landscapes and sunsets from Hemakuta and Matanga hills.',
    musts: [
      S('Virupaksha Temple', 'religious', ['spiritual', 'history'], 60),
      S('Vittala Temple', 'heritage', ['history', 'photography', 'art'], 120, { q: 'Vijaya Vittala Temple', cost: 40 }),
      S('Matanga Hill', 'viewpoint', ['adventure', 'photography'], 120, { intensity: 7, best: ['05:30', '08:00', 'sunrise over the ruins'] }),
      S('Hemakuta Hill', 'viewpoint', ['photography'], 60, { best: ['17:00', '18:45', 'sunset'] }),
    ],
    experiences: [S('Coracle ride on the Tungabhadra', 'activity', ['adventure', 'nature'], 45, { q: 'Hampi coracle', cost: 200 })],
    food: ['Mango Tree'],
  },
]

/** The profile for a chosen destination, if Tripzy knows it. */
export function destinationFor(place?: { name?: string; state?: string } | null): Destination | undefined {
  if (!place?.name) return undefined
  const text = `${place.name} ${place.state ?? ''}`
  return DESTINATIONS.find((d) => d.match.test(text))
}

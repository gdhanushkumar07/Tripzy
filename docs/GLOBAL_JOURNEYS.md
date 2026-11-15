# Global journeys: plan and what is live

Tripzy plans door-to-door journeys within a city, between states and between countries.
It asks 2–3 questions per journey (who travels, what matters most, luggage / own vehicle).
The rest comes from the saved profile (family, vehicles with mileage, priority).

## How a journey is planned

| Distance / place | Engine | Live data |
|---|---|---|
| Inside an Indian city (< 80 km) | Daily Traveller engine (`src/commute/engine.ts`): time-dependent multi-criteria Dijkstra | GTFS metro/bus timetables (HMRL, TGSRTC…), OSRM roads with peak factors, published fares, your scooter/car as the first ride (park-and-ride) |
| India, 80–1,500 km | Same engine on a live intercity graph, run once for train and once for bus, plus road options and flights | Railway junctions and bus terminals (OpenStreetMap), train estimate or real trains (`RAIL_API_KEY`), intercity bus chain via the city-exit stand, outstation cab, own car (fuel from your mileage, NHAI tolls) |
| Abroad or across borders | Journey planner (`server/plan/journey.ts`) | **Transitous**: real timetables for 2,000+ feeds (rail, FlixBus, metro, ferries), realtime where operators publish it |
| > 300 km anywhere | Flights door to door | Nearest airports (OurAirports, 3,245 worldwide), live fares with `SERPAPI_KEY` or `TRAVELPAYOUTS_TOKEN`, else a labelled estimate. Includes the cab to the airport, check-in buffer (100 min domestic, 120–180 international) and the bag wait |

Every option is scored on:

- cost for the whole party (vehicles are split per car, tickets per head);
- door-to-door time, waiting, transfers and walking;
- comfort (mode, luggage, children/seniors, driving fatigue);
- reliability per mode;
- safety notes (night highway driving, more than 9 hours at the wheel).

Four options are tagged: **Fastest**, **Cheapest**, **Most comfortable** and **Best balanced**. The list is ranked by the priority you chose.

## Scenarios from the brief

1. **Solo flight with airport access/egress:** flight options carry the cab to the airport, the airport buffer, the flight and the onward cab, with prefilled MakeMyTrip, Google Flights and Skyscanner searches.
2. **Family of 4 comparing modes:** flight, train, bus, own car and outstation cab. The car shows fuel and tolls shared by 4 and needs no luggage limit. Each option shows comfort with heavy bags and children.
3. **Group:** the existing group mode (shared start, different destinations, one cab vs splitting). *Not done yet:* different origins converging on a meeting point.
4. **Own vehicle + public transport:** `ownscooter`/`owncar` modes can only be the first ride (tested). Fuel comes from the profile, with parking at the station.
5. **Smart last mile:** the engine uses real departure times, so a bus leaving in 2 min beats a cab when it is faster or cheaper. Legs show "next one in N min".
6. **Missed connection:** "Replan from where I am now" takes your live location and the current time and plans again.

## Booking from the app

- **Trains:** ixigo and ConfirmTkt (authorised IRCTC partners) open with stations and date filled in. You pick the train and sign in, and you are on the passenger/payment page. A copy button gives the passenger details. IRCTC itself does not accept prefilled links.
- **Flights:** MakeMyTrip (India, with passengers), Google Flights and Skyscanner, with the date and passengers filled in.
- **Buses:** redBus/AbhiBus/state RTC. **Cabs:** Uber/Ola deep links with pickup and drop.
- **Hotels:** Booking.com and Google Hotels with dates and guests filled in. The tour shows "Where to stay" for the trip dates.

## Tour planner

The tour planner adds:

- "Getting there", which compares flights, trains, buses, your car and outstation cabs from your live location;
- "Where to stay", with hotels and nightly prices for the trip dates;
- the existing places to visit and eat, with weather and opening hours.

## Keys (all free tiers)

| Key | Gives | Sign-up |
|---|---|---|
| `SERPAPI_KEY` | Live Google Flights + Google Hotels prices (250 searches/month) | https://serpapi.com/users/sign_up (email or Google; no card) |
| `TRAVELPAYOUTS_TOKEN` (+ `TRAVELPAYOUTS_MARKER`) | Real recently-seen flight fares (Aviasales) and affiliate links | https://www.travelpayouts.com → Tools → API token |
| `LITEAPI_KEY` | Hotel rates (the sandbox key gives test prices, labelled so) | https://dashboard.liteapi.travel |
| `RAPIDAPI_KEY` (planned) | IRCTC train schedules / availability via RapidAPI | https://rapidapi.com |
| `OLA_MAPS_API_KEY` | Traffic-aware India roads — **your key answers 401: open the Ola Maps console, create a project and enable the APIs** | https://maps.olakrutrim.com |

No key needed: Transitous, OSRM, Photon/OpenStreetMap, Open-Meteo (weather and time zones), OurAirports, Wikipedia and Frankfurter.

## Persistence

- Firebase Auth uses local persistence, so you stay signed in across reloads and browser restarts.
- Drafts (form, journey answers, last search) sync to Firestore under `users/{uid}/drafts`. Opening Daily Traveller again resumes the last search.
- The profile keeps your modes, family, vehicles and priority. The Firestore rules now accept every mode and these fields. The old rules rejected the default modes, which made saving preferences fail on a real project.

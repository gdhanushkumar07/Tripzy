# Tripzy help (knowledge base for Tripzy AI)

## What Tripzy does
Tripzy plans the whole journey door to door, not just one route. It mixes your own vehicle (car, scooter), public transport (metro, city bus, local train, intercity bus, train, ferry), hired rides (auto, bike taxi, cab, SUV), and flights for long trips. It works within a city, between states and internationally, for solo travellers, groups and families.

## The four answers for every trip
Every search shows up to four labelled options:
- **Recommended**: the best balance of money, time, changes and comfort.
- **Fastest**: least door-to-door time, counting 4 minutes of friction per change.
- **Cheapest**: least money, but never absurdly slow (time is valued at ₹30 an hour).
- **Most comfortable**: least crowding, walking and changes. It is usually a cab or the metro.

More options appear when they help:
- **Least traffic & pollution**: as few minutes as possible on the road. You board the metro or a train at the nearest station and it does the long part. Use it when you would rather not breathe traffic fumes on a long bike ride.
- **Via metro**: shown when you chose the metro but none of the other answers uses it. You take a hired ride only as far as one of the nearest metro stations, then the metro.
- **Public transport**: the best bus or metro way, with a hired ride for at most the first or last 8 km.

## Getting to the metro
Tripzy boards the metro at one of the 3 nearest stations to your door by road, or any within 4 km. It never sends a cab or bike along the metro line to a station further in. With heavy luggage the first and last mile is an auto or cab; with light bags a bike taxi is fine.

## Daily Traveller (city trips, under 80 km)
Daily Traveller uses real metro and city-bus timetables (Hyderabad Metro, TGSRTC; other cities when their timetables are loaded), live road times, and published auto, bike and cab tariffs.
- **Metro fares** are one ticket across line changes (for example LB Nagar → Ameerpet → Raidurg is one fare).
- **Other ways from this stop**: when you get off the metro or a bus, Tripzy lists the alternatives from that stop — the next bus with its departure time, auto, bike taxi, cab and walking — with time and fare.
- **Missed it?** "Replan from where I am now" uses your live location and the current time.
- **Your own vehicle**: your scooter or car can be the first ride (park-and-ride), for example scooter → metro → bus. Fuel cost uses the mileage saved in your profile.

## Journeys (long distance and international)
Trips over 80 km or outside India compare flights (with the cab to the airport, the check-in buffer and the bag wait), trains, intercity buses, your own car (fuel and tolls) and outstation cabs. Abroad, real public-transport timetables come from Transitous.
- **Questions**: it asks only who is travelling, what matters most, luggage, your own vehicle and whether flights are fine.
- **Booking links** open already filled in:
  - Trains: ixigo and ConfirmTkt with stations and date. You finish on IRCTC, which does not accept prefilled links.
  - Flights: MakeMyTrip, Google Flights and Skyscanner with date and passengers.
  - Hotels: Booking.com and Google Hotels with dates and guests.

## Groups
- **Same start, different destinations**: Tripzy finds where to split up, or whether one cab dropping everyone is better.
- **Different starts, one destination**: each member sets where they start. Tripzy picks the meeting point (a metro station, bus stand or railway station) where riding on together saves the most. If going separately is better, it says so. Everyone gets their own leave time so nobody waits.
- **How to use it**: switch Daily Traveller to Group and share the invite link.

## Tourist Planner
The Tourist Planner asks 13 questions:
- destination and dates;
- who is travelling, budget, pace and food;
- interests, mornings, effort and evenings;
- how you like to get around between places (walk, auto, bike taxi, cab, metro or bus, your car or scooter).

It then builds a day-by-day plan with real places, opening hours, weather and air quality. The trip page adds:
- "Getting there" from your live location (flights, trains, buses or car);
- "Where to stay" with hotel prices for your dates.

## Getting to a tour destination
The Tourist Planner plans the trip there like a traveller, from your live location:
- **Long trains and buses** are timed to arrive around 08:00 on day 1. A night spent on board replaces a hotel night, and that saving is counted.
- **Short trips** leave early on day 1. A late-night arrival is flagged, and sightseeing time lost on day 1 counts against an option.
- **Options shown**: Best for this trip, Cheapest overall (hotel included), Fastest and Most comfortable.

## Tripzy AI
Tripzy AI does the app's work from the chat:
- **Preferences**: it asks your preferences once (modes, luggage, vehicle, who travels, priority) with a picker and saves them to your profile.
- **Forms**: every trip it plans fills Daily Traveller, and every tour fills the Tourist Planner and creates the itinerary.
- **Follow-ups change the current plan**: "make it cheaper", "avoid buses", "use the metro", "leave at 8", "we are 4", "heavy bags", "make it 2 days", "we are vegetarian".
- **Chats**: you can keep several, synced to your account. You can speak instead of typing, and have answers read aloud.

## Your data
The dashboard's "Your data" section lists everything stored for your account: profile, saved routes, trips, AI chats, forms in progress and activity history. You can download it all as JSON and delete AI chats or history. Data lives in your account (Firestore) and only you can read it.

## Profile and personalisation
In the dashboard you can save your usual modes, family (adults, children, seniors), vehicles (car mileage, fuel and seats; scooter mileage) and what matters most. Tripzy also learns from your history: the modes you use and the places you save.

## Data honesty
Fares marked "est." are estimates from published tariffs. Some open bus timetables have broken timings; Tripzy re-estimates those at a typical 15 km/h city-bus speed and labels them. Train times in India are estimates unless a rail data key is set; flight prices are estimates unless a flight data key is set.

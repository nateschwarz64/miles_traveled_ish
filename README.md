# Miles Traveled: the web app

A travel app for you and your family. You can log trips, write stories, tag the people you went with and add their faces. It also has maps, charts, a route replay, a yearly Wrapped, and a nerdy stats corner. It's built from your cleaned travel sheet and your Google Earth file.

- **web/**: the app itself. It's plain files with no build step.
- **supabase/**: the database setup, plus all your data ready to load.
- **tools/export_seed.py**: rebuilds the data files from `Travel Clean.xlsx` and a Google Earth `.kml` if you ever need to.

It runs on two free services:
- **Supabase** holds the data and photos and handles sign-in.
- **Netlify** (or Vercel, or GitHub Pages) hosts the page.

## Set it up (about 15 minutes, once)

### 1. Make the database
1. Go to [supabase.com](https://supabase.com) and create a free account and a new project. Pick any name, and a region near you.
2. Open **SQL Editor → New query**. Paste in all of `supabase/schema.sql` and click **Run**.
3. Start a new query with all of `supabase/seed.sql` and run it. This loads your 74 trips, 364 flights and drives, 138 stays, 125 places and the people you traveled with.
4. Start a new query with `supabase/seed-google-earth.sql` and run it. This loads your Google Earth folders and 603 pins.
5. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

The seed files hold personal travel data, so they are kept out of this repository. Generate them with `tools/export_seed.py`.

### 2. Point the app at it
`web/config.js` holds the project URL and anon key:

```js
window.TRAVEL_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

The anon key is safe to put on a public site. The database only answers emails that are listed in the people table.

### 3. Put it online
The easiest route is [app.netlify.com/drop](https://app.netlify.com/drop): drag the whole `web` folder onto the page, and you get a link like `https://something.netlify.app`. You can rename it in Netlify's site settings.

Vercel or GitHub Pages work just as well. Upload the `web` folder, and there's no build command.

### 4. Allow sign-in from that link
In Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to your new link, and add it under **Redirect URLs** too.

### 5. Open it on your phone
1. Open the link and type your email. You'll get a sign-in link by email; open it on the same phone.
2. Add the app to your home screen:
   - iPhone: Share → Add to Home Screen.
   - Android: menu → Install app.

## Adding your family
1. Go to **People**, tap someone (or tap **+ Person**), then tap **Edit**.
2. Set "Who they are" to **Family** and enter their email. They can now sign in, and everyone in the family sees and edits the same trips.
3. Tap **📷 Add photo** to give anyone a face. Faces show up in the people race, on trips, on stories and in Wrapped.
4. On a family member's page, **Add them to those stays** copies your nights on trips you took together, so their map and stats fill in.
5. The avatars at the top let you switch whose travel you're looking at.

Mark someone as family only if they should see everything. Companions and teams don't need an email.

## What's in it

**Home**
- A departure-board odometer of lifetime miles, with a spinning globe and a plane lapping it.
- An "I'm here" button that logs tonight from your location.
- Upcoming trips with a countdown.
- On this day, next milestones and badges.

**Map**
- Where you slept, sized by nights.
- Flights as great-circle arcs and drives as lines.
- Countries shaded by nights, US states, and your bucket list in gold.
- Each Google Earth folder as its own layer.
- **Replay**, which draws every flight and drive in order with a running mile counter at 1×, 4× or 16×.

**Trips**
- Search and filters.
- Each trip has its own map, people, stories, photos, flights, drives, stays, costs and a packing list.
- **+ New trip** adds the flights, drives and stays in one go.
- The flight form can scan a boarding pass and works out the miles itself.
- The ⇄ button makes the return flight.

**Stories**
- Postcard-style stories with a map stamp, people's faces, polaroid photos and tags.
- A story can hang on a trip, a flight or drive, a stay or a place.
- Stories show up on each person's page and in Wrapped.

**People**
- An animated race of the people you travel with, by miles, trips or legs, faces climbing year by year.
- A family leaderboard, a race between family members, and "who's been where".
- Each person's page shows miles together, first and last trip together, countries, a chart of miles together over time, stories and photos.

**Stats**
- Miles over time, with dashed lines for each lap of the Earth.
- Countries collected over time.
- A passport page with a stamp for each country.
- A grid of where you slept every night of a year.
- **Nerd corner**:
  - Hours in the air and time zones crossed.
  - Your miles at light speed.
  - Farthest point from home, and how close that is to the opposite side of the Earth.
  - Equator, dateline and prime-meridian crossings.
  - Your airport alphabet.
  - Your favorite travel day.
- Badges, continents and records.
- The old app's views:
  - First class flights.
  - Longest flights, drives and trips.
  - Top routes.
  - Most flights in a year.
  - My airports.
  - Miles by organization.
- A bucket list.
- Pick a year to get **Wrapped**: tap through miles, nights away, new countries, top places, longest flight, your travel crew, a story and photos.

**☰ menu (top right)**
- Planned trips.
- Passport and visa expiry warnings.
- A Schengen 90/180 calculator with a what-if for future trips.
- "Fill in the gaps", which lists estimated dates, missing miles, people with no photo and unmatched Google Earth pins.
- Packing lists.
- Add more Google Earth files.
- Import old AppSheet photos: pick the files from the `Trips_Images` and `Legs_Images` folders, and they're matched by file name.
- Download a backup.

## Things to know
- **Emails are gone.** The Apps Script version planned automatic emails. This version shows passport warnings on the home page instead, and Wrapped replaces the yearly recap email. Emails can come back later with a small Supabase function.
- **Stays can't overlap.** A person can only sleep in one place a night, so a stay that overlaps another for the same person is refused.
- **Location lookups** for "I'm here" and new places use OpenStreetMap's free service.
- **Backups:** Supabase keeps daily backups on paid plans. On the free plan, use **☰ → Download a backup** now and then.
- **The Apps Script version** in `travel-app/` is no longer needed.

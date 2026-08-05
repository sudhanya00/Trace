/**
 * Weather at the plan horizon.
 *
 * "Is it raining now" is the wrong question. Riders plan for Saturday, so the
 * forecast that matters is the one for the day they picked in WhenPicker — not
 * for today. Everything here is keyed to a target date.
 *
 * Google's Weather API rather than a free service: Open-Meteo's free tier is
 * non-commercial only, and TRACE is a commercial product. This is a Maps
 * Platform API, so it authenticates with the GOOGLE_MAPS_KEY that Places and
 * Routes already use — no new secret to set, rotate or leak. $0.15 per 1,000
 * calls with 10,000 free a month, which at this app's volume is nothing.
 *
 * Shared by geo (so the discover screen can show a line) and ride-ai (so the
 * model can mention it), because duplicating a provider integration across two
 * functions is how they drift.
 */

export type DayForecast = {
  /** The day this describes, as the rider's chosen yyyy-mm-dd. */
  date: string;
  min_c: number | null;
  max_c: number | null;
  /** Chance of precipitation during the day, as a percentage. */
  rain_chance: number | null;
  /** Plain-language condition, e.g. "Partly sunny". */
  condition: string | null;
};

/** yyyy-mm-dd in local terms, which is what the forecast is keyed on. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * One place name to one coordinate.
 *
 * Deliberately the narrowest possible field mask — id and location, nothing
 * else. The mask decides the billing tier, and a forecast lookup has no use
 * for a display name or an address.
 */
export async function geocodeOne(
  query: string,
  key: string
): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.location',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'IN' }),
  });
  if (!res.ok) throw new Error(`places ${res.status}: ${await res.text()}`);
  const place = (await res.json())?.places?.[0];
  const lat = place?.location?.latitude;
  const lng = place?.location?.longitude;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

/**
 * The forecast for one day at one place, or null.
 *
 * Null is a real answer and the caller must say so plainly rather than
 * substituting today's weather or a seasonal average. The API reaches ten days
 * out; a rider planning three weeks ahead gets told nobody knows yet, which is
 * true and more useful than a confident guess.
 */
export async function forecastFor(
  lat: number,
  lng: number,
  target: Date,
  key: string
): Promise<DayForecast | null> {
  const wanted = ymd(target);

  // Ten is the API's ceiling. Asking for more is an error, not more days.
  const url = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
  url.searchParams.set('key', key);
  url.searchParams.set('location.latitude', String(lat));
  url.searchParams.set('location.longitude', String(lng));
  url.searchParams.set('days', '10');
  url.searchParams.set('pageSize', '10');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}: ${await res.text()}`);
  const data = await res.json();

  for (const day of data?.forecastDays ?? []) {
    const d = day?.displayDate;
    if (!d) continue;
    const iso = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    if (iso !== wanted) continue;

    const daytime = day?.daytimeForecast;
    return {
      date: iso,
      min_c: day?.minTemperature?.degrees ?? null,
      max_c: day?.maxTemperature?.degrees ?? null,
      rain_chance: daytime?.precipitation?.probability?.percent ?? null,
      condition: daytime?.weatherCondition?.description?.text ?? null,
    };
  }

  // Past the horizon, or the place has no forecast coverage.
  return null;
}

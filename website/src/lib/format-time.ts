/**
 * Time display, always in the viewer's local zone WITH the zone named.
 * Every instant on the site is a UTC fact (Ethereum block time); the browser
 * localizes it, and the short zone name ("EDT", "CET") makes screenshots and
 * cross-timezone conversations unambiguous. In a phrase with two times
 * ("between X and Y"), tag only the closing time — one zone per phrase.
 */

const TZ: Intl.DateTimeFormatOptions = { timeZoneName: "short" };

/** "12:02:47 PM EDT" */
export const timeTz = (d: Date) => d.toLocaleTimeString(undefined, TZ);

/** "7/15/2026, 12:02:47 PM EDT" */
export const stampTz = (d: Date) => d.toLocaleString(undefined, TZ);

/** "12:02:47 PM" — no zone, for the OPENING time in a two-time phrase (the
 *  closing time carries the one shared zone). */
export const timeNoTz = (d: Date) => d.toLocaleTimeString();

/** "7/15/2026, 12:02:47 PM" — no zone, opening stamp of a two-stamp phrase. */
export const stampNoTz = (d: Date) => d.toLocaleString();

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

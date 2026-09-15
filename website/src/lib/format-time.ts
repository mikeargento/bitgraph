/**
 * Time display, always in UTC, with the zone named.
 *
 * ⚠️ UTC, NOT THE VIEWER'S ZONE (Mike, 2026-09-15: "whatever time you list on
 * the proof, when i click that eth link, it should match exact", then "we will
 * also have to make eth anchors page on site use utc").
 *
 * Every instant the site prints is an Ethereum block time, and every one of
 * them sits beside a link to that block on Etherscan, which shows UTC. In the
 * viewer's zone the same block read 1:25:47 PM here and 5:25:47 PM there, so
 * the page contradicted its own link. Localising was the older call, made when
 * these times were read on their own; they are now read against a public page
 * that does not localise.
 *
 * The zone name stays, and is now always "UTC", so a screenshot is unambiguous
 * without the reader knowing whose machine took it. In a phrase with two times
 * ("between X and Y"), tag only the closing time: one zone per phrase.
 */

const TZ: Intl.DateTimeFormatOptions = { timeZone: "UTC", timeZoneName: "short" };
const BARE: Intl.DateTimeFormatOptions = { timeZone: "UTC" };

/** "12:02:47 PM UTC" */
export const timeTz = (d: Date) => d.toLocaleTimeString("en-US", TZ);

/** "7/15/2026, 12:02:47 PM UTC" */
export const stampTz = (d: Date) => d.toLocaleString("en-US", TZ);

/** "12:02:47 PM" — no zone, for the OPENING time in a two-time phrase (the
 *  closing time carries the one shared zone). */
export const timeNoTz = (d: Date) => d.toLocaleTimeString("en-US", BARE);

/** "7/15/2026, 12:02:47 PM" — no zone, opening stamp of a two-stamp phrase. */
export const stampNoTz = (d: Date) => d.toLocaleString("en-US", BARE);

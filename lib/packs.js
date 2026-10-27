/** Pricing lives here once so the storefront and the admin panel never drift. */
export const PACK_META = {
  single: { videos: 1, amount: 9.99 },
  '3pack': { videos: 3, amount: 19.99 },
  '5pack': { videos: 5, amount: 29.99 },
};

/** What one SeeAPI credit costs us, in USD. Used for the margin report. */
export function creditUsd() {
  return Number(process.env.SEEAPI_CREDIT_USD || 0.0037);
}

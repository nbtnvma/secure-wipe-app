// Remote service file that controls update notices and the service kill-switch.
// Format (edited by hand on the server):
// {
//   "status": "active" | "deactive",              (case-insensitive; anything else is ignored)
//   "message": { "vi": "…", "en": "…" },           (optional, shown when out of service)
//   "latest": { "version": "1.0.0", … }           (other fields are ignored by the app)
// }
export const SERVICE_CONFIG = {
  url: 'https://nvma.site/securewipe.json',
  /** Re-check while the app keeps running. */
  checkEveryMs: 7 * 86400_000,
  /** After a failed check, try again sooner. */
  retryAfterFailMs: 86400_000,
  /** Lock when the service could not be verified for this long. */
  offlineGraceMs: 60 * 86400_000,
  /** Public page shown in update notices (the "url" field of the file is not used). */
  downloadPage: 'https://nvma.site',
};

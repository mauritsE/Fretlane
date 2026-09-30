/**
 * The app's name lives here and nowhere else in code. To rename the app, change these values and
 * `productName` / `appId` in package.json's "build" section.
 */
export const APP_NAME = 'Fretlane';
/** Lower-case id: health-check marker, library folder default, file names. */
export const APP_ID = 'fretlane';
/** Environment variable prefix, e.g. FRETLANE_PORT. */
export const ENV_PREFIX = 'FRETLANE_';
/** Name of the app before the rename. Its env vars and library folder are still honoured. */
export const LEGACY_NAME = 'Songstarr';

/** Reads FRETLANE_<key>, falling back to the pre-rename SONGSTARR_<key>. */
export function envVar(key: string): string | undefined {
  return process.env[`${ENV_PREFIX}${key}`] ?? process.env[`${LEGACY_NAME.toUpperCase()}_${key}`];
}

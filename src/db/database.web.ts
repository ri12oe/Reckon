/**
 * Web does not open SQLite in this shell.
 * The library falls back to an in-memory floor list for the browser session.
 */
export function getDatabase(): null {
  return null;
}

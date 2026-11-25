/** Runs once when the server starts: keep music folders watched and re-scanned. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startWatching } = await import('./lib/server/watch');
  startWatching();
}

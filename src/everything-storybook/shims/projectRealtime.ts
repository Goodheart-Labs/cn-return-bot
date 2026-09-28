/* A realtime subscription that never connects. Stories have no backend. */
export function subscribeToProjectChanges(): () => void {
  return () => {};
}

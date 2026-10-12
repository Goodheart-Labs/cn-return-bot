/** The data of a Supabase answer, or a thrown error when the request failed. */
export function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

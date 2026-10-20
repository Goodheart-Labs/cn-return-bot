/** Only a real tweet has a numeric id. The everything pipeline's claims are synthetic
 *  posts whose ids are made from an item id and an index, joined by a hyphen. */
export const isRealTweetId = (id: string) => /^\d+$/.test(id);

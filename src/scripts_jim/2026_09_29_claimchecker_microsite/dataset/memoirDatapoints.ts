/**
 * The personal memoir posts of GOO-433, without labels. Production sent nearly
 * all of their claims to the paid fact-check and got almost no notes from them.
 * The extractor eval reads each whole post and shows what the extractor puts
 * into statements and what into "other", so that it can be read by hand.
 */
import type { UnlabelledDatapoint } from "./datapoints";

const MEMOIR_POSTS: { id: string; itemId: string; title: string }[] = [
  { id: "memoir-new-york", itemId: "d635f9c2-3c56-4f01-b5e8-7e365fc7f5ae", title: "Why I Left New York" },
  { id: "memoir-eight-girls", itemId: "c2e02ae0-dcb3-4b86-b0e7-f5e6e1de722b", title: "Dating 8 Girls at Once in New York City" },
  { id: "memoir-succubus", itemId: "4f86439d-0d9b-4087-91cb-24a1bf7ade05", title: "The Succubus Bitch Who Drained Me" },
  { id: "memoir-onlyfans", itemId: "8f3c30b2-74c5-4b55-9030-48ec836f572d", title: "Exploiting My OnlyFans Girlfriend" },
  { id: "memoir-scamming", itemId: "8137efa3-4e37-4ad8-bccd-5bba157e9df8", title: "Scamming My Audience for $30,000" },
  { id: "memoir-sugar-mama", itemId: "02c51e42-04bf-44ff-973a-ef809c877358", title: "My Japanese Sugar Mama" },
  { id: "memoir-factory-floor", itemId: "7267336f-015d-46af-9d8c-b28379b54873", title: "My Year On A Factory Floor Assembly Line" },
];

export const MEMOIR_DATAPOINTS: UnlabelledDatapoint[] = MEMOIR_POSTS.map(({ id, itemId, title }) => ({
  id,
  group: "memoir",
  itemId,
  unlabelled: true,
  jimsWords: `GOO-433: personal memoirs get through the gate and send nearly all their claims to the paid fact-check for almost no notes. "${title}" is one of the posts named there. Added on 2026-10-19 to see by hand what the extractor puts into statements and what into other. There are no labels.`,
  writtenOn: "2026-10-19",
  referenceClaims: [],
}));

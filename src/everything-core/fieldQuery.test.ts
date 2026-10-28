import { describe, expect, test } from "bun:test";
import { bucketChips, bucketText, buildRequest, filterText, readQuery, startOfDay, writeQuery, type FieldDef, type FieldQuery } from "./fieldQuery";

const FIELDS: FieldDef[] = [
  { id: "helpful_votes", label: "Helpful votes", kind: "count", thresholds: [1, 2, 3, 5, 8], bound: "atLeast", offerNone: true, sortable: true },
  { id: "note_length", label: "Note length", kind: "count", thresholds: [100, 280], bound: "atMost", sortable: true },
  { id: "p_helpful", label: "Chance of a helpful rating", kind: "percent", sortable: true },
  { id: "written", label: "Written", kind: "date", sortable: true },
  {
    id: "rating",
    label: "Overall rating",
    kind: "choice",
    multiple: true,
    sortable: true,
    options: [
      { value: "helpful", label: "Rated helpful" },
      { value: "other", label: "Everything else" },
      { value: "not_helpful", label: "Rated not helpful" },
    ],
  },
  { id: "creator", label: "Creator", kind: "choice", multiple: true, sortable: false, labelColumn: "creator_name" },
];
const field = (id: string) => FIELDS.find((f) => f.id === id)!;
const NOW = new Date(2026, 9, 28, 15, 0);

describe("filters", () => {
  test("a count filter reads as at least, at most or none", () => {
    expect(filterText(field("helpful_votes"), { field: "helpful_votes", threshold: 3 })).toBe("3 or more");
    expect(filterText(field("helpful_votes"), { field: "helpful_votes", threshold: 0 })).toBe("None");
    expect(filterText(field("note_length"), { field: "note_length", threshold: 280 })).toBe("At most 280");
  });

  test("a choice filter names up to two values", () => {
    expect(filterText(field("rating"), { field: "rating", values: ["helpful", "other"] })).toBe("Rated helpful, Everything else");
    expect(filterText(field("rating"), { field: "rating", values: ["helpful", "other", "not_helpful"] })).toBe("3 selected");
    expect(filterText(field("creator"), { field: "creator", values: ["thezvi"] }, { thezvi: "Zvi" })).toBe("Zvi");
  });

  test("the request turns thresholds, spans and values into bounds", () => {
    const request = buildRequest(FIELDS, {
      filters: [
        { field: "helpful_votes", threshold: 0 },
        { field: "note_length", threshold: 280 },
        { field: "written", span: "3d" },
        { field: "rating", values: ["helpful"] },
        { field: "gone", threshold: 1 },
      ],
      sorts: [],
    }, NOW);
    expect(request.filters).toEqual([
      { column: "helpful_votes", max: 0 },
      { column: "note_length", max: 280 },
      { column: "written", min: startOfDay(NOW, 2).getTime() / 1000 },
      { column: "rating", in: ["helpful"] },
    ]);
  });
});

describe("sorting", () => {
  test("only levels with a deeper level after them are bucketed", () => {
    const request = buildRequest(FIELDS, {
      filters: [],
      sorts: [
        { field: "rating", descending: true },
        { field: "helpful_votes", descending: true },
        { field: "p_helpful", descending: true },
      ],
    }, NOW);
    expect(request.sorts).toEqual([
      { column: "rating", descending: true, order: ["not_helpful", "other", "helpful"] },
      { column: "helpful_votes", descending: true, buckets: [1, 2, 3, 5, 8] },
      { column: "p_helpful", descending: true },
    ]);
  });

  test("buckets read as ranges", () => {
    expect(bucketText(field("helpful_votes"), 0, NOW)).toBe("none");
    expect(bucketText(field("helpful_votes"), 2, NOW)).toBe("2");
    expect(bucketText(field("helpful_votes"), 4, NOW)).toBe("3 to 4");
    expect(bucketText(field("helpful_votes"), 40, NOW)).toBe("8 or more");
    expect(bucketText(field("p_helpful"), 0.74, NOW)).toBe("70% to 80%");
    expect(bucketText(field("p_helpful"), 0.95, NOW)).toBe("90% or more");
    expect(bucketText(field("written"), new Date(2026, 9, 28, 9).toISOString(), NOW)).toBe("today");
    expect(bucketText(field("written"), new Date(2026, 9, 26, 9).toISOString(), NOW)).toBe("2 days ago");
    expect(bucketText(field("written"), new Date(2026, 9, 23, 9).toISOString(), NOW)).toBe("3 to 6 days ago");
    expect(bucketText(field("written"), new Date(2026, 6, 1).toISOString(), NOW)).toBe("60 or more days ago");
  });

  test("a card gets a chip for each bucketed level", () => {
    const sorts = [
      { field: "written", descending: true },
      { field: "helpful_votes", descending: true },
    ];
    expect(bucketChips(FIELDS, sorts, { written: new Date(2026, 9, 27, 9).toISOString(), helpful_votes: 4 }, NOW)).toEqual(["Written: yesterday"]);
  });
});

describe("the page address", () => {
  const QUERY: FieldQuery = {
    filters: [
      { field: "rating", values: ["helpful", "other"] },
      { field: "written", span: "7d" },
    ],
    sorts: [
      { field: "rating", descending: true },
      { field: "helpful_votes", descending: false },
    ],
    display: ["chat"],
  };

  test("a query survives the address", () => {
    const params = new URLSearchParams("note=abc");
    writeQuery(QUERY, params);
    expect(params.get("note")).toBe("abc");
    expect(readQuery(FIELDS, ["chat", "skip"], new URLSearchParams(params.toString()))).toEqual(QUERY);
  });

  test("an empty query is still a query", () => {
    const params = new URLSearchParams();
    writeQuery({ filters: [], sorts: [], display: [] }, params);
    expect(params.toString()).toBe("filter=");
    expect(readQuery(FIELDS, [], params)).toEqual({ filters: [], sorts: [], display: [] });
    expect(readQuery(FIELDS, [], new URLSearchParams("note=abc"))).toBeNull();
  });

  test("unknown fields, values and options are left out", () => {
    const params = new URLSearchParams("filter=gone:1&filter=rating:helpful,bogus&filter=helpful_votes:4&sort=-creator&sort=-written&show=chat,gone");
    expect(readQuery(FIELDS, ["chat"], params)).toEqual({
      filters: [{ field: "rating", values: ["helpful"] }],
      sorts: [{ field: "written", descending: true }],
      display: ["chat"],
    });
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import { NoteIndex, type IndexedNote } from "../src/core/note-index.js";

const note = (path: string, values: Partial<IndexedNote> = {}): IndexedNote => ({
  path,
  title: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
  headings: [],
  tags: [],
  links: [],
  text: "",
  modifiedAt: 1,
  ...values,
});

test("shared tags rank a related note above an unrelated note", () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/current.md", { tags: ["#ai", "#project"] }));
  index.upsert(note("Notes/ai.md", { tags: ["#ai"], title: "AI project" }));
  index.upsert(note("Notes/travel.md", { tags: ["#travel"], title: "Travel" }));

  const related = index.related("Notes/current.md", 5);

  assert.equal(related[0]?.path, "Notes/ai.md");
  assert.ok(related[0]?.reasons.includes("shared tags"));
});

test("shared links add a linked-notes reason", () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/current.md", { links: ["Notes/target"] }));
  index.upsert(note("Notes/target.md", { title: "Target" }));

  const related = index.related("Notes/current.md", 5);

  assert.ok(related[0]?.reasons.includes("linked notes"));
});

test("search matches title and body without case sensitivity", () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/one.md", { title: "Second Brain", text: "local knowledge" }));
  index.upsert(note("Notes/two.md", { title: "Other", text: "SECOND BRAIN workflow" }));

  assert.deepEqual(index.search("second brain", 5).map((item) => item.path), ["Notes/one.md", "Notes/two.md"]);
});

test("excludes the active note, caps at five, and orders ties by path", () => {
  const index = new NoteIndex();
  index.upsert(note("Notes/current.md", { tags: ["#same"] }));
  for (const path of ["Notes/e.md", "Notes/a.md", "Notes/d.md", "Notes/c.md", "Notes/f.md", "Notes/b.md"]) {
    index.upsert(note(path, { tags: ["#same"] }));
  }

  const related = index.related("Notes/current.md", 5);

  assert.equal(related.length, 5);
  assert.deepEqual(related.map((item) => item.path), ["Notes/a.md", "Notes/b.md", "Notes/c.md", "Notes/d.md", "Notes/e.md"]);
  assert.ok(!related.some((item) => item.path === "Notes/current.md"));
});

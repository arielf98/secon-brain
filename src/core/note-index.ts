import { findRelated, tokens, type RelatedNote } from "./related-notes.js";

export interface IndexedNote {
  path: string;
  title: string;
  headings: string[];
  tags: string[];
  links: string[];
  text: string;
  modifiedAt: number;
}

export class NoteIndex {
  private readonly notes = new Map<string, IndexedNote>();

  upsert(note: IndexedNote): void {
    this.notes.set(note.path, {
      ...note,
      headings: [...note.headings],
      tags: [...note.tags],
      links: [...note.links],
    });
  }

  remove(path: string): void {
    this.notes.delete(path);
  }

  get(path: string): IndexedNote | undefined {
    return this.notes.get(path);
  }

  search(query: string, limit: number): IndexedNote[] {
    const queryTokens = tokens(query);
    if (!queryTokens.size) return [];
    return [...this.notes.values()]
      .map((note) => ({ note, score: searchScore(note, queryTokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path))
      .slice(0, Math.max(0, limit))
      .map((item) => item.note);
  }

  related(path: string, limit: number): RelatedNote[] {
    const active = this.notes.get(path);
    return active ? findRelated(active, this.notes.values(), limit) : [];
  }
}

function searchScore(note: IndexedNote, query: Set<string>): number {
  const title = overlapCount(tokens(note.title), query);
  const headings = overlapCount(tokens(note.headings.join(" ")), query);
  const tags = overlapCount(new Set(note.tags.map((tag) => tag.replace(/^#/, "").toLowerCase())), query);
  const body = overlapCount(tokens(note.text), query);
  return title * 8 + headings * 4 + tags * 3 + body;
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  return [...left].filter((token) => right.has(token)).length;
}

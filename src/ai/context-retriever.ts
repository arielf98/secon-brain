import type { IndexedNote, NoteIndex } from "../core/note-index.js";

export interface RetrievedNote {
  path: string;
  title: string;
  excerpt: string;
  score?: number;
}

export interface ContextRetriever {
  retrieve(query: string, limit: number): RetrievedNote[];
  get(path: string): RetrievedNote | undefined;
}

export class LocalContextRetriever implements ContextRetriever {
  constructor(
    private readonly index: NoteIndex,
    private readonly excerptChars = 2000,
  ) {}

  retrieve(query: string, limit: number): RetrievedNote[] {
    return this.index.search(query, limit).map((note) => this.fromNote(note));
  }

  get(path: string): RetrievedNote | undefined {
    const note = this.index.get(path);
    return note ? this.fromNote(note) : undefined;
  }

  private fromNote(note: IndexedNote): RetrievedNote {
    return {
      path: note.path,
      title: note.title,
      excerpt: note.text.slice(0, this.excerptChars),
    };
  }
}

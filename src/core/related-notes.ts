import type { IndexedNote } from "./note-index.js";

export interface RelatedNote {
  path: string;
  score: number;
  reasons: string[];
}

export function scoreRelated(active: IndexedNote, candidate: IndexedNote): RelatedNote {
  const titleOverlap = overlap(tokens(active.title), tokens(candidate.title));
  const headingOverlap = overlap(tokens(active.headings.join(" ")), tokens(candidate.headings.join(" ")));
  const bodyOverlap = overlap(tokens(active.text), tokens(candidate.text));
  const sharedTags = overlap(new Set(active.tags.map(normalize)), new Set(candidate.tags.map(normalize)));
  const linked = active.links.some(linkMatches(candidate.path))
    || candidate.links.some(linkMatches(active.path));

  let score = titleOverlap.size * 5 + headingOverlap.size * 3 + bodyOverlap.size;
  if (sharedTags.size) score += sharedTags.size * 6;
  if (linked) score += 8;
  if (folderOf(active.path) === folderOf(candidate.path)) score += 1;
  score += Math.max(0, 0.1 - Math.abs(active.modifiedAt - candidate.modifiedAt) / 864000000);

  const reasons: string[] = [];
  if (sharedTags.size) reasons.push("shared tags");
  if (linked) reasons.push("linked notes");
  if (titleOverlap.size || headingOverlap.size) reasons.push("similar title/headings");
  if (bodyOverlap.size) reasons.push("shared keywords");
  if (folderOf(active.path) === folderOf(candidate.path)) reasons.push("same folder");

  return { path: candidate.path, score, reasons };
}

export function findRelated(active: IndexedNote, candidates: Iterable<IndexedNote>, limit: number): RelatedNote[] {
  return [...candidates]
    .filter((candidate) => candidate.path !== active.path)
    .map((candidate) => scoreRelated(active, candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(0, limit));
}

export function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9À-ÿ]+/i).filter((token) => token.length > 1));
}

function overlap(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((item) => right.has(item)));
}

function normalize(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

function folderOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function linkMatches(target: string): (link: string) => boolean {
  const normalizedTarget = target.replace(/\.md$/i, "").toLowerCase();
  const targetBasename = normalizedTarget.split("/").pop() ?? normalizedTarget;
  return (link) => {
    const normalizedLink = link.replace(/^\.[/\\]/, "").replace(/\.md$/i, "").toLowerCase();
    return normalizedLink === normalizedTarget
      || (normalizedLink.split("/").pop() ?? normalizedLink) === targetBasename;
  };
}

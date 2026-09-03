/**
 * Madison Knowledge Retrieval
 *
 * Context enrichment layer for QUESTION-type SMS messages.
 * This is NOT a capability — it retrieves relevant KB sections to ground the LLM draft.
 *
 * Intentionally simple for Phase 1: keyword-based section matching.
 * Future: embed KB sections and use vector similarity.
 */

import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

const QUESTION_STOP_WORDS = new Set([
  "about", "could", "does", "form", "from", "have", "many", "need",
  "take", "that", "their", "there", "these", "this", "what", "when",
  "where", "which", "will", "with", "would", "your",
]);
const MAX_RETRIEVED_PASSAGE_CHARS = 700;

// KB sections extracted by heading
const KB_SECTIONS = parseKbSections(MAIDS_IN_BLACK_KNOWLEDGE_BASE);

interface KbSection {
  heading: string;
  content: string;
  keywords: string[];
}

interface KbPassage {
  heading: string;
  content: string;
  keywords: string[];
}

function parseKbSections(kb: string): KbSection[] {
  const sections: KbSection[] = [];
  const lines = kb.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n").trim(),
          keywords: extractKeywords(currentHeading + " " + currentContent.join(" ")),
        });
      }
      currentHeading = line.replace("## ", "").trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
      keywords: extractKeywords(currentHeading + " " + currentContent.join(" ")),
    });
  }
  return sections;
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !QUESTION_STOP_WORDS.has(word));
}

function extractPassages(section: KbSection): KbPassage[] {
  if (section.heading !== "Frequently Asked Questions") return [section];
  const matches = [...section.content.matchAll(/\*\*Q:\s*(.+?)\*\*\s*\nA:\s*(.+?)(?=\n\n\*\*Q:|$)/gs)];
  if (matches.length === 0) return [section];
  return matches.map((match) => {
    const content = `**Q: ${match[1].trim()}**\nA: ${match[2].trim()}`;
    return {
      heading: section.heading,
      content,
      keywords: extractKeywords(content),
    };
  });
}

/**
 * Retrieve the most relevant KB sections for a given question.
 * Returns a string of relevant context to inject into the LLM prompt.
 */
export async function retrieveKnowledge(question: string): Promise<string> {
  const questionKeywords = extractKeywords(question);

  // Score factual sections and compact FAQ entries individually so a long FAQ
  // section cannot crowd out the most relevant approved source material.
  const passages = KB_SECTIONS.flatMap(extractPassages);
  const scored = passages.map((passage) => {
    const overlap = questionKeywords.filter((kw) => passage.keywords.includes(kw)).length;
    const headingKeywords = extractKeywords(passage.heading);
    const headingOverlap = questionKeywords.filter((kw) => headingKeywords.includes(kw)).length;
    return { passage, score: overlap, headingOverlap };
  }).sort((a, b) => b.headingOverlap - a.headingOverlap || b.score - a.score);

  // Use at most two compact approved passages so both the direct FAQ wording
  // and the governing factual section remain visible to the answer model.
  const relevant = scored.slice(0, 2).filter((s) => s.score > 0);

  if (relevant.length === 0) {
    // Return the About + Booking sections as fallback
    const fallback = KB_SECTIONS.filter((s) =>
      ["About Maids in Black", "Booking", "Pricing"].includes(s.heading)
    );
    return fallback.map((s) => `## ${s.heading}\n${s.content}`).join("\n\n").slice(0, 1200);
  }

  return relevant
    .map((r) => `## ${r.passage.heading}\n${r.passage.content.slice(0, MAX_RETRIEVED_PASSAGE_CHARS)}`)
    .join("\n\n")
    .slice(0, 1600);
}

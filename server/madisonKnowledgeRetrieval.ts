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

// KB sections extracted by heading
const KB_SECTIONS = parseKbSections(MAIDS_IN_BLACK_KNOWLEDGE_BASE);

interface KbSection {
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
    .filter((w) => w.length > 3);
}

/**
 * Retrieve the most relevant KB sections for a given question.
 * Returns a string of relevant context to inject into the LLM prompt.
 */
export async function retrieveKnowledge(question: string): Promise<string> {
  const questionKeywords = extractKeywords(question);

  // Score each section by keyword overlap
  const scored = KB_SECTIONS.map((section) => {
    const overlap = questionKeywords.filter((kw) => section.keywords.includes(kw)).length;
    return { section, score: overlap };
  }).sort((a, b) => b.score - a.score);

  // Take top 2 most relevant sections (max ~800 chars)
  const relevant = scored.slice(0, 2).filter((s) => s.score > 0);

  if (relevant.length === 0) {
    // Return the About + Booking sections as fallback
    const fallback = KB_SECTIONS.filter((s) =>
      ["About Maids in Black", "Booking", "Pricing"].includes(s.heading)
    );
    return fallback.map((s) => `## ${s.heading}\n${s.content}`).join("\n\n").slice(0, 1200);
  }

  return relevant
    .map((r) => `## ${r.section.heading}\n${r.section.content}`)
    .join("\n\n")
    .slice(0, 1200);
}

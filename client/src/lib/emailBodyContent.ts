import DOMPurify, { type Config } from "dompurify";

export type EmailBodyInput = {
  bodyHtml?: string | null;
  bodyText?: string | null;
  snippet?: string | null;
};

export type EmailBodyContent = {
  html: string | null;
  text: string;
};

const EMAIL_HTML_PROFILE: Config = {
  USE_PROFILES: { html: true },
  ADD_FORBID_CONTENTS: ["style", "head", "title", "script", "noscript"],
};

function hasHtmlMarkup(value: string): boolean {
  return /<!doctype\b|<\/?(?:html|head|body|style|table|tr|td|div|p|br|a|img|span|h[1-6]|ul|ol|li|blockquote|pre)\b[^>]*>/i.test(value);
}

function removeLegacyCssTail(value: string): string {
  const cssStart = value.search(/(?:^|\s)(?:@(?:media|font-face|import)|html|body|#kmail|\.kmail|table|td|tr|a(?::[\w-]+)?)\s*(?:[,\{])/i);
  if (cssStart < 0) return value.trim();
  const before = value.slice(0, cssStart).trim();
  const tail = value.slice(cssStart);
  const declarations = tail.match(/(?:margin|padding|width|height|font-family|font-size|line-height|background(?:-color)?|color|border|display|letter-spacing)\s*:/gi) ?? [];
  return before && tail.length >= 80 && declarations.length >= 2 ? before : value.trim();
}

/**
 * Produces the one safe display value used by every LeadFlow email viewer.
 * Legacy saved drafts sometimes retain raw HTML in bodyText; recognize that
 * source and sanitize it as markup instead of escaping it into visible CSS.
 */
export function getEmailBodyContent({ bodyHtml, bodyText, snippet }: EmailBodyInput): EmailBodyContent {
  const cachedHtml = bodyHtml?.trim() ?? "";
  const savedText = bodyText?.trim() ?? "";
  const htmlSource = hasHtmlMarkup(cachedHtml)
    ? cachedHtml
    : hasHtmlMarkup(savedText)
      ? savedText
      : "";

  if (htmlSource) {
    return {
      html: DOMPurify.sanitize(htmlSource, EMAIL_HTML_PROFILE),
      text: "",
    };
  }

  return {
    html: null,
    text: removeLegacyCssTail(savedText || cachedHtml || snippet?.trim() || "(no content)"),
  };
}

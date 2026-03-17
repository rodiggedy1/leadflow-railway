/**
 * languageDetect.ts
 *
 * Detects the language of a message and generates bilingual confirmation messages.
 * Uses the LLM for accurate detection across all languages.
 */

import { invokeLLM } from "./_core/llm";

export interface LanguageDetectResult {
  /** ISO 639-1 code, e.g. "en", "es", "fr", "zh", "pt", "ko", "vi", "ru", "ar" */
  language: string;
  /** Human-readable name, e.g. "Spanish" */
  languageName: string;
  /** Whether the message is English */
  isEnglish: boolean;
  /** Confidence 0-1 */
  confidence: number;
}

/**
 * Detect the language of a message.
 * Returns { isEnglish: true } quickly for obvious English text.
 */
export async function detectLanguage(text: string): Promise<LanguageDetectResult> {
  // Fast path: if the message is clearly ASCII English, skip the LLM call
  const asciiRatio = (text.match(/[\x00-\x7F]/g) || []).length / text.length;
  const hasNonLatinChars = /[^\x00-\x7F\s\d.,!?'"@#$%&*()\-_+=:;/\\]/.test(text);

  // Very short messages or pure ASCII with common English words — likely English
  if (!hasNonLatinChars && asciiRatio > 0.95) {
    const lowerText = text.toLowerCase();
    // Check for obvious non-English patterns even in ASCII (Spanish accents stripped, etc.)
    const spanishIndicators = /\b(hola|gracias|buenos|como|quiero|necesito|ayuda|por favor|si|no|casa|limpieza|servicio)\b/i;
    const frenchIndicators = /\b(bonjour|merci|oui|non|je|vous|nous|maison|nettoyage|service|besoin)\b/i;
    const portugueseIndicators = /\b(ola|obrigado|sim|nao|casa|limpeza|preciso|quero|servico)\b/i;

    if (!spanishIndicators.test(lowerText) && !frenchIndicators.test(lowerText) && !portugueseIndicators.test(lowerText)) {
      return { language: "en", languageName: "English", isEnglish: true, confidence: 0.95 };
    }
  }

  // LLM-based detection for everything else
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a language detection service. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: `Detect the language of this message and return JSON with these fields:
- language: ISO 639-1 code (e.g. "en", "es", "fr", "zh", "pt", "ko", "vi", "ru", "ar", "tl", "hi", "ja")
- languageName: English name of the language (e.g. "Spanish")
- isEnglish: boolean
- confidence: number 0-1

Message: "${text.slice(0, 200)}"

Return only the JSON object, no other text.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "language_detection",
          strict: true,
          schema: {
            type: "object",
            properties: {
              language: { type: "string" },
              languageName: { type: "string" },
              isEnglish: { type: "boolean" },
              confidence: { type: "number" },
            },
            required: ["language", "languageName", "isEnglish", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
      return parsed as LanguageDetectResult;
    }
  } catch (err) {
    console.error("[LanguageDetect] LLM detection failed:", err);
  }

  // Fallback: assume English
  return { language: "en", languageName: "English", isEnglish: true, confidence: 0.5 };
}

/**
 * Language-specific confirmation messages.
 * Format: "Confirmation in target language / English confirmation"
 */
const LANGUAGE_CONFIRMATIONS: Record<string, { confirm: string; deny: string; question: string }> = {
  es: {
    question: "¿Prefiere continuar en español? / Would you prefer to continue in Spanish?",
    confirm: "Responda *Sí* para español / Reply *Yes* for Spanish",
    deny: "o *No* para inglés / or *No* for English",
  },
  fr: {
    question: "Préférez-vous continuer en français? / Would you prefer to continue in French?",
    confirm: "Répondez *Oui* pour le français / Reply *Yes* for French",
    deny: "ou *Non* pour l'anglais / or *No* for English",
  },
  pt: {
    question: "Prefere continuar em português? / Would you prefer to continue in Portuguese?",
    confirm: "Responda *Sim* para português / Reply *Yes* for Portuguese",
    deny: "ou *Não* para inglês / or *No* for English",
  },
  zh: {
    question: "您希望用中文继续吗？/ Would you prefer to continue in Chinese?",
    confirm: "回复 *是* 选择中文 / Reply *Yes* for Chinese",
    deny: "或 *否* 选择英文 / or *No* for English",
  },
  ko: {
    question: "한국어로 계속하시겠습니까? / Would you prefer to continue in Korean?",
    confirm: "한국어는 *예* 로 답장 / Reply *Yes* for Korean",
    deny: "영어는 *아니요* / or *No* for English",
  },
  vi: {
    question: "Bạn có muốn tiếp tục bằng tiếng Việt không? / Would you prefer to continue in Vietnamese?",
    confirm: "Trả lời *Có* cho tiếng Việt / Reply *Yes* for Vietnamese",
    deny: "hoặc *Không* cho tiếng Anh / or *No* for English",
  },
  tl: {
    question: "Gusto mo bang magpatuloy sa Filipino? / Would you prefer to continue in Filipino?",
    confirm: "Sagutin ng *Oo* para sa Filipino / Reply *Yes* for Filipino",
    deny: "o *Hindi* para sa Ingles / or *No* for English",
  },
  ar: {
    question: "هل تفضل الاستمرار باللغة العربية؟ / Would you prefer to continue in Arabic?",
    confirm: "أجب بـ *نعم* للعربية / Reply *Yes* for Arabic",
    deny: "أو *لا* للإنجليزية / or *No* for English",
  },
  ru: {
    question: "Вы хотите продолжить на русском? / Would you prefer to continue in Russian?",
    confirm: "Ответьте *Да* для русского / Reply *Yes* for Russian",
    deny: "или *Нет* для английского / or *No* for English",
  },
  hi: {
    question: "क्या आप हिंदी में जारी रखना चाहते हैं? / Would you prefer to continue in Hindi?",
    confirm: "हिंदी के लिए *हाँ* जवाब दें / Reply *Yes* for Hindi",
    deny: "या अंग्रेजी के लिए *नहीं* / or *No* for English",
  },
};

/**
 * Build the bilingual language confirmation SMS to send to the lead.
 */
export function buildLanguageConfirmSms(languageCode: string, languageName: string): string {
  const cfg = LANGUAGE_CONFIRMATIONS[languageCode];
  if (cfg) {
    return `${cfg.question}\n${cfg.confirm} ${cfg.deny}.`;
  }
  // Generic fallback for unsupported languages
  return `Would you prefer to continue in ${languageName}? Reply *Yes* for ${languageName} or *No* for English.`;
}

/**
 * Map of affirmative words across languages (for detecting "yes" in any language).
 */
const YES_WORDS = new Set([
  "yes", "yeah", "yep", "sure", "ok", "okay", "yup", "absolutely", "definitely",
  "sí", "si", "claro", "por supuesto",
  "oui", "bien sûr",
  "sim", "claro",
  "是", "好", "是的",
  "예", "네",
  "có", "được",
  "oo", "opo",
  "نعم", "أجل",
  "да", "конечно",
  "हाँ", "हां",
  "ja", "jа",
]);

const NO_WORDS = new Set([
  "no", "nope", "nah", "not", "english",
  "no", "nada",
  "non",
  "não", "nao",
  "否", "不", "不要",
  "아니요", "아니",
  "không",
  "hindi",
  "لا",
  "нет",
  "नहीं", "नही",
]);

/**
 * Determine if a reply to the language confirmation is "yes", "no", or unclear.
 */
export function parseLanguageConfirmReply(text: string): "yes" | "no" | "unclear" {
  const normalized = text.trim().toLowerCase();

  // Check for yes words
  if (Array.from(YES_WORDS).some(word =>
    normalized === word || normalized.startsWith(word + " ") || normalized.endsWith(" " + word)
  )) {
    return "yes";
  }

  // Check for no words
  if (Array.from(NO_WORDS).some(word =>
    normalized === word || normalized.startsWith(word + " ") || normalized.endsWith(" " + word)
  )) {
    return "no";
  }

  return "unclear";
}

/**
 * Get the system prompt instruction to append for non-English conversations.
 */
export function getLanguageInstruction(languageCode: string, languageName: string): string {
  if (languageCode === "en") return "";
  return `\n\nIMPORTANT: This customer prefers to communicate in ${languageName}. You MUST respond ONLY in ${languageName} for all messages. Do not use English unless the customer switches to English themselves.`;
}

/**
 * Language code to flag emoji mapping for the admin UI.
 */
export const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇺🇸",
  es: "🇪🇸",
  fr: "🇫🇷",
  pt: "🇧🇷",
  zh: "🇨🇳",
  ko: "🇰🇷",
  vi: "🇻🇳",
  tl: "🇵🇭",
  ar: "🇸🇦",
  ru: "🇷🇺",
  hi: "🇮🇳",
  ja: "🇯🇵",
  de: "🇩🇪",
  it: "🇮🇹",
};

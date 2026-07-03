/**
 * Deterministic customer avatar assignment.
 *
 * Avatars are split into female and male pools based on the photo filenames.
 * The customer's first name is used to guess gender via a curated list of
 * common female names. Same phone → same avatar, always.
 *
 * Avatars are served as static files from /avatars/01.png … /avatars/20.png
 * Team logo: /avatars/mib-logo.png
 */

// ── Gender pools (by file index 1–20) ────────────────────────────────────────
// Female: 02_young_black_professional_woman, 03_retired_woman,
//         05_asian_female_teacher, 08_grandmother, 11_latina_woman,
//         13_black_woman_gray_locs, 16_young_latina, 17_auburn_hair_woman,
//         19_middle_eastern_woman
const FEMALE_INDEXES = [2, 3, 5, 8, 11, 13, 16, 17, 19];

// Male: 01_middle_aged_dad, 04_hispanic_male_nurse, 06_it_worker,
//       07_military_veteran, 09_realtor, 10_south_asian_accountant,
//       12_young_white_male, 14_bald_older_man_gray_beard, 15_asian_male_mid40s,
//       18_black_male_late30s, 20_older_white_man_glasses
const MALE_INDEXES = [1, 4, 6, 7, 9, 10, 12, 14, 15, 18, 20];

// ── Common female first names (top US female names + common variants) ─────────
// Intentionally broad — false positives (calling a male name female) are rare
// and the fallback is just a different avatar, not a crash.
const FEMALE_NAMES = new Set([
  "aaliyah","abby","abigail","ada","adeline","adriana","agatha","agnes","aida",
  "aileen","aimee","aisha","alexa","alexandra","alexis","alice","alicia","alina",
  "alison","alissa","aliyah","allison","alma","alyssa","amanda","amber","amelia",
  "ami","amy","ana","anastasia","andrea","angela","angelica","angelina","angie",
  "anita","ann","anna","annabelle","anne","annette","annie","antonia","april",
  "ariana","arianna","ariel","ashley","asia","audrey","aurora","autumn","ava",
  "avery","barbara","beatrice","becky","belinda","bella","bernadette","bernice",
  "beth","bethany","betty","beverly","bianca","bonnie","brandy","brenda","brianna",
  "bridget","brittany","brooke","brooklyn","camille","candace","cara","carina",
  "carla","carmen","carol","carolina","caroline","carolyn","cassandra","cassie",
  "catherine","cathy","cecelia","cecilia","celeste","celine","charlene","charlotte",
  "chelsea","cheryl","chloe","christa","christiana","christina","christine",
  "cindy","claire","clara","claudia","colleen","connie","constance","cora",
  "corinne","courtney","crystal","cynthia","daisy","dana","daniela","danielle",
  "daphne","darlene","dawn","debbie","deborah","debra","dee","deirdre","delia",
  "denise","diana","diane","donna","dora","dorothy","ebony","edith","elaine",
  "eleanor","elena","elisa","elise","eliza","elizabeth","ella","ellen","ellie",
  "elsa","emily","emma","erica","erin","esmeralda","esther","eva","evelyn",
  "faith","felicia","fiona","florence","frances","francesca","gabriela",
  "gabrielle","gemma","genevieve","georgia","gina","gloria","grace","gracie",
  "greta","hailey","hannah","harper","harriet","hazel","heather","helen",
  "helena","holly","hope","ida","imani","irene","iris","isabel","isabella",
  "isabelle","jacqueline","jade","jamie","jane","janet","janice","jasmine",
  "jean","jenna","jennifer","jessica","jill","joanna","joanne","jocelyn",
  "jordan","josephine","joy","joyce","judith","julia","julie","juliet",
  "june","justine","karen","katelyn","katherine","kathleen","kathryn","kathy",
  "katie","katrina","kayla","kelly","kimberly","kristen","kristina","kylie",
  "lara","laura","lauren","layla","leah","leila","leslie","lily","linda",
  "lisa","liz","lola","lorraine","louise","lucia","lucy","luna","lydia",
  "mackenzie","madeline","madison","maggie","margaret","maria","mariana",
  "marie","marilyn","marissa","martha","mary","maya","megan","melanie",
  "melissa","mia","michelle","miranda","molly","monica","morgan","nadia",
  "nancy","naomi","natalia","natalie","natasha","nichole","nicole","nina",
  "nora","norma","olivia","paige","pamela","patricia","paula","penelope",
  "phyllis","priya","rachel","rebecca","renee","rhonda","rita","roberta",
  "rosa","rose","rosemary","ruby","ruth","sabrina","samantha","sandra","sara",
  "sarah","savannah","selena","shannon","sharon","sheila","shelby","sherry",
  "sierra","skylar","sofia","sophia","stacey","stacy","stephanie","sue",
  "summer","susan","susanna","suzanne","sylvia","tamara","tammy","tanya",
  "tara","taylor","teresa","tessa","tiffany","tina","toni","tonya","tracey",
  "tracy","trinity","vanessa","veronica","victoria","violet","virginia",
  "vivian","wendy","whitney","yolanda","yvette","yvonne","zoe","zoey",
]);

// ── djb2 hash ─────────────────────────────────────────────────────────────────
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function isFemaleFirstName(name: string): boolean {
  const first = name.trim().split(/\s+/)[0].toLowerCase();
  return FEMALE_NAMES.has(first);
}

/**
 * Returns the URL path for the avatar assigned to this customer.
 * Uses gender heuristic on first name to pick from the appropriate pool.
 * Returns null if phone is empty/invalid.
 */
export function getCustomerAvatarUrl(phone: string, name?: string): string | null {
  const digits = normalizePhone(phone);
  if (digits.length < 7) return null;

  const pool = name && isFemaleFirstName(name) ? FEMALE_INDEXES : MALE_INDEXES;
  const index = pool[djb2(digits) % pool.length];
  const padded = String(index).padStart(2, "0");
  return `/avatars/${padded}.png`;
}

/**
 * Returns the MIB team logo URL for use in team avatar slots.
 */
export function getTeamAvatarUrl(): string {
  return "/avatars/mib-logo.png";
}

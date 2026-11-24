// Transparent, project-defined privacy score (0–100) and A–F grade.
// This is a student-project heuristic, NOT a privacy certification.

/** Points subtracted per recognized third-party tracker domain, by category. */
export const CATEGORY_WEIGHTS = {
  cryptomining: 10,
  fingerprinting: 8,
  advertising: 6,
  analytics: 4,
  social: 4,
  email: 3,
  content: 1,
  'anti-fraud': 1,
  consent: 1,
};
export const UNKNOWN_DOMAIN_PENALTY = 1;   // per unrecognized third-party domain
export const UNKNOWN_DOMAIN_CAP = 20;
export const THIRD_PARTY_COOKIE_PENALTY = 0.5; // per accessible third-party cookie
export const THIRD_PARTY_COOKIE_CAP = 15;

/** PRD thresholds (inclusive lower bounds), highest first. */
export const DEFAULT_THRESHOLDS = [
  { grade: 'A', min: 90, label: 'Low observed tracking activity under this model' },
  { grade: 'B', min: 80, label: 'Relatively low observed activity' },
  { grade: 'C', min: 65, label: 'Moderate observed activity' },
  { grade: 'D', min: 50, label: 'Elevated observed activity' },
  { grade: 'F', min: 0, label: 'High observed activity under this model' },
];

/**
 * A domain listed in several categories (e.g. advertising + fingerprinting) is charged once,
 * at its highest category weight.
 */
export function trackerWeight(categories) {
  const list = Array.isArray(categories) ? categories : [categories];
  return list.reduce((max, c) => Math.max(max, CATEGORY_WEIGHTS[c] ?? 0), 0);
}

/**
 * score = 100 − trackerPenalty − min(20, 1 × unknownThirdPartyDomains) − min(15, 0.5 × thirdPartyCookies)
 * clamped to [0, 100] and rounded to the nearest integer.
 * @param {{trackers: {categories: string[]}[], unknownThirdPartyDomains: number, thirdPartyCookies: number}} input
 */
export function computeScore({ trackers = [], unknownThirdPartyDomains = 0, thirdPartyCookies = 0 }) {
  const trackerPenalty = trackers.reduce((sum, t) => sum + trackerWeight(t.categories || t.category), 0);
  const unknownPenalty = Math.min(UNKNOWN_DOMAIN_CAP, UNKNOWN_DOMAIN_PENALTY * Math.max(0, unknownThirdPartyDomains));
  const cookiePenalty = Math.min(THIRD_PARTY_COOKIE_CAP, THIRD_PARTY_COOKIE_PENALTY * Math.max(0, thirdPartyCookies));
  const rawScore = 100 - trackerPenalty - unknownPenalty - cookiePenalty;
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  return { score, components: { trackerPenalty, unknownPenalty, cookiePenalty } };
}

/** Check thresholds are A..F with strictly decreasing minimums ending at 0. */
export function validateThresholds(thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length !== 5) return 'Exactly five grades (A, B, C, D, F) are required.';
  const grades = thresholds.map((t) => t.grade).join('');
  if (grades !== 'ABCDF') return 'Grades must be listed in the order A, B, C, D, F.';
  for (let i = 0; i < thresholds.length; i++) {
    const m = thresholds[i].min;
    if (!Number.isFinite(m) || m < 0 || m > 100) return `Minimum for ${thresholds[i].grade} must be between 0 and 100.`;
    if (i > 0 && !(m < thresholds[i - 1].min)) return 'Each grade’s minimum must be lower than the grade above it.';
  }
  if (thresholds[4].min !== 0) return 'F must start at 0.';
  return null;
}

export function gradeFor(score, thresholds = DEFAULT_THRESHOLDS) {
  for (const t of thresholds) if (score >= t.min) return t;
  return thresholds[thresholds.length - 1];
}

/** Percentage, or null ("not applicable") when the denominator is zero. */
export function percentage(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** TrackerDensity = recognized tracker domains / unique third-party domains × 100 (null if none observed). */
export function trackerDensity(recognizedTrackerDomains, uniqueThirdPartyDomains) {
  return percentage(recognizedTrackerDomains, uniqueThirdPartyDomains);
}

/**
 * Does this page say the posting is gone?
 *
 * Sprinto on Lever, 4 Nov 2026: a posting that was open two days earlier
 * returned "Sorry, we couldn't find anything here ... might have closed", and
 * the run reported "filled 0, skipped 0", which reads like a mapper failure.
 * A closed posting should say so, so the batch moves on and the ledger is right.
 */
const CLOSED = [
  /job posting you.re looking for might have closed/i,
  /this (job|position|posting) (is )?(no longer|not) (available|accepting|open)/i,
  /no longer accepting applications/i,
  /(position|job|role) has been (filled|closed)/i,
  /this job (has )?expired/i,
  /the job you are looking for (is no longer|does not exist)/i,
];

export function isClosedPosting(text: string): boolean {
  const t = text.replace(/\s+/g, " ").slice(0, 4000);
  return CLOSED.some((re) => re.test(t));
}

/**
 * LEGAL-WEIGHT WORDING: reviewed by the owner before release. Every generated document carries it.
 * Soundings never says that anyone "is compliant" or "certified", and never offers legal advice.
 */
export const DRAFT_NOTICE =
  "Draft prepared with Soundings from a scan of the project's code and from answers given by the project team. " +
  "It is not legal advice, and it does not state that anyone is compliant with, or certified to, any law or standard. " +
  "Every statement about the project points to a numbered source at the end of the document. " +
  "Please review it before sending.";

export const NEEDS_INPUT = "Needs your input.";

/**
 * The one line Soundings writes about the document itself rather than the project: how many
 * questions are answered. The verifier skips exactly this line and nothing that merely resembles it.
 */
export const TALLY_LINE = /^\d+ of \d+ questions are answered from evidence\. \d+ (?:is|are) partly answered and \d+ needs? input from the project team\.$/;

export const tallyLine = (done: number, total: number, partial: number, open: number): string =>
  `${done} of ${total} questions are answered from evidence. ${partial} ${partial === 1 ? "is" : "are"} partly answered and ${open} ${open === 1 ? "needs" : "need"} input from the project team.`;

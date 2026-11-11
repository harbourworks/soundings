/**
 * LEGAL-WEIGHT WORDING. Every sentence in this file is fixed text that ships with Soundings; it is
 * never produced or reworded by a model. It must be reviewed by the owner before release, and any
 * change to it is a change to wording that carries legal weight.
 *
 * It states general information, not claims about a particular project, which is why it carries no
 * evidence reference. The verifier skips a sentence only if it matches one of these exactly, so a
 * reworded copy is checked like any other text.
 */

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export const TEMPLATES = {
  privacyIntro:
    "This notice describes how personal data is handled in connection with this service. It was drafted from the project's code and from information supplied by the project team.",
  privacyRights:
    "People whose personal data is processed have rights under data protection law. They can ask for access to their data, ask for inaccurate data to be corrected, ask for data to be erased in some circumstances, ask for processing to be restricted, object to processing, and ask to receive their data in a portable format. They can also complain to the data protection regulator; in the United Kingdom this is the Information Commissioner's Office.",
  privacyContact: "Questions about this notice, and requests to exercise these rights, can be sent to the contact given above.",
  privacyChanges: "This notice may be updated from time to time. The date at the top shows when it was last prepared.",
  subprocessorsIntro:
    "This list shows the external services that the project's code integrates with, together with the information the project team has supplied about them.",
  dpiaIntro:
    "A data protection impact assessment describes a processing activity, considers whether it is necessary and proportionate, identifies risks to individuals and records the measures chosen to reduce them. This draft sets out what the code shows and what the project team has said. The assessment itself must be completed and approved by the people responsible.",
  dpiaSignoff: "Approved by: ____________________    Role: ____________________    Date: ____________________",
  aiIntro: "This statement describes how artificial intelligence services are used. It reflects the project's code and the project team's answers on the date shown.",
  trustIntro: "This page summarises security and data handling practices. Each statement is backed by a numbered source at the end of the page.",
} as const;

export type TemplateName = keyof typeof TEMPLATES;

/** Splits text into sentences the same way the verifier does. */
const sentences = (text: string) => clean(text).split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/).map(clean);

/** Every fixed sentence, whole and split, so the verifier can recognise wording Soundings ships. */
export const TEMPLATE_SENTENCES: ReadonlySet<string> = new Set(
  Object.values(TEMPLATES).flatMap((t) => [clean(t), ...sentences(t)]),
);

export const isTemplateSentence = (s: string): boolean => TEMPLATE_SENTENCES.has(clean(s));

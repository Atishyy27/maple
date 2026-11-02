/** What kind of control we are looking at, normalised across every ATS. */
export type FieldKind =
  | "text" | "email" | "tel" | "url" | "number" | "date"
  | "textarea" | "select" | "radio" | "checkbox" | "file" | "range"
  | "combobox" | "toggle" | "chips" | "unknown";

export type Option = { value: string; text: string };

/**
 * One control on the live page. Everything here is read from the DOM at
 * runtime -- nothing is hardcoded per ATS. `ref` is a marker attribute we
 * stamp on the element so we can find it again from Node without holding a
 * handle across a navigation.
 */
export type Field = {
  ref: string;
  kind: FieldKind;
  label: string;
  name?: string;
  id?: string;
  placeholder?: string;
  required: boolean;
  options?: Option[];
  /** radio/checkbox group name, when the control is one of many */
  group?: string;
  /** raw text we scraped near the control, kept for the unanswered log */
  context?: string;
};

/** A field we resolved to a concrete value, ready to type. */
export type Resolved = {
  field: Field;
  value: string | string[] | boolean;
  /** where the value came from, for the report */
  source: "profile" | "answers" | "default" | "file";
  /** 0..1 -- how confident the label match was */
  score: number;
  /**
   * Runner-up values, best first. A select can match a label confidently and
   * still have no option that fits the winning value ("2" against options
   * "1-3 years"), so the filler falls through these before giving up.
   */
  alts: (string | string[] | boolean)[];
};

export type Profile = {
  firstName: string;
  lastName: string;
  fullName?: string;
  email: string;
  phone: string;
  location: string;
  city?: string;
  state?: string;
  country?: string;
  linkedIn?: string;
  github?: string;
  portfolio?: string;
  school?: string;
  degree?: string;
  major?: string;
  gradYear?: string;
  education?: string;
  experienceLevel?: string;
  yearsExperience?: string;
  currentCompany?: string;
  currentTitle?: string;
  skills?: string[];
  workAuthorized?: boolean;
  requiresVisa?: boolean;
  needsSponsorship?: boolean;
  earliestStartDate?: string;
  noticePeriod?: string;
  salaryExpectation?: string;
  referralSource?: string;
  gender?: string;
  race?: string;
  veteranStatus?: string;
  disabilityStatus?: string;
  resumePath?: string;
  coverLetterPath?: string;
  coverLetter?: string;
  [k: string]: unknown;
};

/** One entry in answers.yaml -- an essay or custom question. */
export type AnswerEntry = {
  /** phrases that should route to this answer */
  match: string[];
  answer: string;
};

export type ApplyResult = {
  url: string;
  platform: string;
  filled: number;
  skipped: number;
  submitted: boolean;
  confirmationId?: string;
  error?: string;
  screenshot?: string;
  durationMs: number;
};

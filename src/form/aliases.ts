/**
 * Label phrases that route to a profile key.
 *
 * Rule when adding: be SPECIFIC. The scorer penalises a label token the alias
 * does not account for, so "last name" beats a bare "name" on the label
 * "Last Name" -- but only because both are listed. A short greedy alias like
 * "name" on its own will mis-route.
 */
export const PROFILE_ALIASES: Record<string, string[]> = {
  firstName: ["first name", "given name", "forename", "legal first name", "preferred first name", "fname"],
  lastName: ["last name", "surname", "family name", "legal last name", "lname"],
  fullName: ["full name", "your name", "name", "candidate name", "legal name"],
  email: ["email", "email address", "e mail", "work email", "personal email", "contact email"],
  phone: ["phone", "phone number", "mobile", "mobile number", "telephone", "contact number", "cell"],
  location: ["location", "current location", "where are you located", "city state", "address", "your location"],
  city: ["city", "current city", "city of residence"],
  state: ["state", "province", "state province", "region"],
  country: ["country", "country of residence", "current country"],
  linkedIn: ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
  github: ["github", "github profile", "github url", "git hub"],
  portfolio: ["portfolio", "website", "personal website", "portfolio url", "personal site", "other website"],
  school: ["school", "university", "college", "institution", "school name", "alma mater"],
  degree: [
    "degree", "degree type", "highest degree", "level of education", "education level",
    "highest education", "highest level of education", "education", "qualification",
  ],
  major: ["major", "field of study", "discipline", "specialization", "branch", "stream"],
  gradYear: ["graduation year", "grad year", "year of graduation", "expected graduation", "end date"],
  yearsExperience: ["total experience", "how many years", "experience in years", "yoe"],
  // "Years of Experience" is listed on BOTH: forms use it for a free number
  // and for a bucketed select. Ranking decides, and alts cover the other.
  experienceLevel: ["experience level", "experience", "years of experience", "seniority", "level of experience"],
  skills: ["skills", "technical skills", "select all that apply", "technologies", "languages", "tools", "which of the following"],
  currentCompany: ["current company", "employer", "current employer", "company", "organisation", "organization"],
  currentTitle: ["current title", "job title", "current role", "designation", "current position"],
  workAuthorized: [
    "authorized to work", "legally authorized to work", "work authorization", "eligible to work",
    "right to work", "authorised to work", "are you legally authorized",
  ],
  needsSponsorship: [
    "require sponsorship", "need sponsorship", "visa sponsorship", "will you now or in the future require sponsorship",
    "sponsorship for employment", "require visa", "need a visa", "immigration sponsorship",
  ],
  earliestStartDate: ["start date", "earliest start", "when can you start", "availability", "available from", "joining date"],
  noticePeriod: ["notice period", "notice", "how much notice"],
  salaryExpectation: [
    "salary expectation", "expected salary", "desired salary", "compensation expectation",
    "expected compensation", "salary requirement", "expected ctc", "desired compensation",
  ],
  referralSource: ["how did you hear", "referral source", "where did you hear", "how did you find", "source"],
  coverLetter: ["cover letter", "why do you want", "tell us about yourself", "additional information", "message"],
  gender: ["gender", "gender identity"],
  race: ["race", "ethnicity", "race ethnicity", "racial"],
  veteranStatus: ["veteran", "veteran status", "protected veteran"],
  disabilityStatus: ["disability", "disability status", "do you have a disability"],
  resumePath: ["resume", "cv", "resume cv", "upload resume", "attach resume", "resume file"],
  coverLetterPath: ["cover letter file", "upload cover letter", "attach cover letter"],
};

/**
 * Yes/no questions that appear on nearly every board and that no profile key
 * covers. `true` means tick yes.
 */
export const BOOLEAN_DEFAULTS: { match: string[]; value: boolean }[] = [
  { match: ["agree to the terms", "terms and conditions", "privacy policy", "consent", "i agree", "acknowledge"], value: true },
  { match: ["i certify", "certify that the information", "information provided is accurate", "true and complete", "to the best of my knowledge"], value: true },
  { match: ["at least 18", "over 18", "18 years of age"], value: true },
  { match: ["willing to relocate", "open to relocation", "able to relocate"], value: true },
  { match: ["willing to work", "able to work in office", "comfortable with hybrid", "onsite"], value: true },
  { match: ["previously worked", "previously applied", "former employee", "currently employed by us"], value: false },
  { match: ["non compete", "noncompete", "restrictive covenant"], value: false },
  { match: ["subscribe", "marketing emails", "job alerts", "newsletter"], value: false },
];

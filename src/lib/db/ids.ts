import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  credentials: "cred",
  aiCredentials: "aic",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  templateMedia: "tm",
  testRun: "run",
  testCase: "case",
  campaign: "cmp",
  campaignRecipient: "cr",
  initiatedSend: "isnd",
  sendSettings: "ss",
  calendarIntegration: "cint",
  appointment: "apt",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}

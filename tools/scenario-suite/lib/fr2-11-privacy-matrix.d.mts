export interface PrivacyCase { id: string; text: string; canaries: string[]; keep: string[] }
export const CANARY_RE: RegExp;
export function findCanaries(text: string): string[];
export const SURROUNDS: [string, string][];
export function urlCases(opts?: { origin?: string; hostPort?: string }): PrivacyCase[];
export function pathCases(): PrivacyCase[];
export function surround(c: PrivacyCase, s: [string, string]): PrivacyCase;
export function fullMatrix(opts?: { origin?: string; hostPort?: string }): PrivacyCase[];
export function rotatingMatrix(opts?: { origin?: string; hostPort?: string }): PrivacyCase[];
export function evaluate(cases: PrivacyCase[], redact: (t: string) => string): { id: string; kind: string; [k: string]: unknown }[];
export function selfTest(opts?: { origin?: string; hostPort?: string }): { cases: number; problems: string[] };

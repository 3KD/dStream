export type MediaServiceRole = "manifest" | "transcoder";
export function issueMediaServiceCredential(secret: string, role: MediaServiceRole, path: string, action: "read" | "publish"): string;
export function verifyMediaServiceCredential(token: string, path: string, action: string, secrets: Partial<Record<MediaServiceRole, string>>): boolean;
export function mediaServiceReadHeaders(url: string): { authorization?: string };
export function mediaServicePublishUrl(url: string): string;

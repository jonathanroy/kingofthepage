import { HANDLE } from "./config";

export type HandleCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function checkHandle(handle: string): HandleCheck {
	if (handle.length < HANDLE.minLength || handle.length > HANDLE.maxLength) {
		return { ok: false, reason: `Use ${HANDLE.minLength} to ${HANDLE.maxLength} characters.` };
	}
	if (!HANDLE.pattern.test(handle)) {
		return { ok: false, reason: "Use only letters, digits and underscores." };
	}
	return { ok: true };
}

/** Handles are unique regardless of case, so "Marco" and "marco" can't both exist. */
export function normalizeHandle(handle: string): string {
	return handle.toLowerCase();
}

// Pure format validation for @usernames — identical logic lives in
// mobile/lib/username.ts (kept in sync manually — see that file's comment).
// This is the authoritative copy for anything that must be enforced
// server-side regardless of what the client sent.

export const USERNAME_RULES = {
  minLength: 3,
  maxLength: 20,
};

export interface UsernameValidation {
  valid: boolean;
  error?: string;
}

export function validateUsername(username: string): UsernameValidation {
  if (!username) return { valid: false, error: "Username is required" };

  const clean = username.trim().toLowerCase();

  if (clean.length < USERNAME_RULES.minLength) {
    return { valid: false, error: `Username must be at least ${USERNAME_RULES.minLength} characters` };
  }
  if (clean.length > USERNAME_RULES.maxLength) {
    return { valid: false, error: `Username must be ${USERNAME_RULES.maxLength} characters or less` };
  }
  if (!/^[a-z]/.test(clean)) {
    return { valid: false, error: "Username must start with a letter" };
  }
  if (!/^[a-z0-9._]+$/.test(clean)) {
    return { valid: false, error: "Username can only contain letters, numbers, dots, and underscores" };
  }
  if (/[._]{2}/.test(clean)) {
    return { valid: false, error: "Username cannot have consecutive dots or underscores" };
  }
  if (/[._]$/.test(clean)) {
    return { valid: false, error: "Username cannot end with a dot or underscore" };
  }

  return { valid: true };
}

export function formatUsername(username: string): string {
  return username.trim().toLowerCase();
}
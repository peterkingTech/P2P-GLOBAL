// Pure format validation for @usernames — identical logic lives in
// api-server/src/lib/username.ts (kept in sync manually; mobile and
// api-server are separate packages with no shared-constants workspace, same
// reasoning as ROOM_PRESETS in calls.ts). This file only checks shape — it
// never touches the network (reserved-list/availability checks are a
// separate concern, handled by /profiles/check-username).

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

export function displayUsername(username: string | null | undefined): string {
  return username ? `@${username}` : "";
}

// Suggestions offered when a chosen username is taken — kept short (3) so
// the availability-check UI doesn't have to fire off a burst of lookups.
export function generateUsernameSuggestions(username: string): string[] {
  const clean = formatUsername(username).replace(/[._]+$/, "");
  return [`${clean}1`, `${clean}_`, `the.${clean}`].slice(0, 3);
}
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function usernameToAuthEmail(username: string, projectId: string): string {
  return `${normalizeUsername(username)}@${projectId}.firebaseapp.com`;
}

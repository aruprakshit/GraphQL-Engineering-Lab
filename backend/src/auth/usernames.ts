// NORMALIZE AND VALIDATE THE ACCOUNT'S LOGIN NAME
export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error(
      "Username must contain 3–32 letters, digits, or underscores",
    );
  }

  return username;
}

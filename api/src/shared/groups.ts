const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Fisher-Yates shuffle (in-place).
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Distribute items into lettered groups (A-Z) using round-robin.
 * Groups differ in size by at most 1.
 *
 * @param items - Array of items to distribute
 * @param groupSize - Target number of items per group
 * @returns Map of group letter → items
 */
export function assignToGroups<T>(items: T[], groupSize: number): Map<string, T[]> {
  const numGroups = Math.ceil(items.length / groupSize);
  const groups = new Map<string, T[]>();

  for (let i = 0; i < items.length; i++) {
    const letter = GROUP_LETTERS[i % numGroups];
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(items[i]);
  }

  return groups;
}

/** Maximum number of groups (A-Z). */
export const MAX_GROUPS = 26;

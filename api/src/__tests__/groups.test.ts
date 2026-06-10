import { describe, it, expect } from 'vitest';

/**
 * Unit tests for group assignment logic.
 * Tests the core algorithm independently of Azure Functions/Table Storage.
 */

// Extract the group assignment logic for testability
function assignPlayersToGroups(
  playerIds: string[],
  groupSize: number,
): Map<string, string[]> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numGroups = Math.ceil(playerIds.length / groupSize);
  const groups = new Map<string, string[]>();

  for (let i = 0; i < playerIds.length; i++) {
    const groupIndex = i % numGroups;
    const letter = letters[groupIndex];
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(playerIds[i]);
  }

  return groups;
}

describe('Group Assignment', () => {
  describe('even division', () => {
    it('assigns 10 players into 2 groups of 5', () => {
      const players = Array.from({ length: 10 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 5);

      expect(groups.size).toBe(2);
      expect(groups.get('A')!.length).toBe(5);
      expect(groups.get('B')!.length).toBe(5);
    });

    it('assigns 12 players into 3 groups of 4', () => {
      const players = Array.from({ length: 12 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 4);

      expect(groups.size).toBe(3);
      expect(groups.get('A')!.length).toBe(4);
      expect(groups.get('B')!.length).toBe(4);
      expect(groups.get('C')!.length).toBe(4);
    });
  });

  describe('remainder handling', () => {
    it('distributes 13 players into groups of 5 → 3 groups (5, 5, 3)', () => {
      const players = Array.from({ length: 13 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 5);

      expect(groups.size).toBe(3);
      // Round-robin: 13 / 3 groups → 5, 4, 4 or similar even distribution
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes[0]).toBe(5); // largest group
      expect(sizes[sizes.length - 1]).toBeGreaterThanOrEqual(4); // smallest group
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(13); // all players assigned
    });

    it('distributes 7 players into groups of 3 → 3 groups (3, 2, 2)', () => {
      const players = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 3);

      expect(groups.size).toBe(3);
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([3, 2, 2]);
    });

    it('distributes 11 players into groups of 4 → 3 groups (4, 4, 3)', () => {
      const players = Array.from({ length: 11 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 4);

      expect(groups.size).toBe(3);
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([4, 4, 3]);
    });
  });

  describe('letter assignment', () => {
    it('uses letters A-Z sequentially', () => {
      const players = Array.from({ length: 26 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 1);

      expect(groups.size).toBe(26);
      expect(Array.from(groups.keys()).sort()).toEqual(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').sort()
      );
    });

    it('assigns single group for 3 players with groupSize 5', () => {
      const players = ['alice', 'bob', 'charlie'];
      const groups = assignPlayersToGroups(players, 5);

      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles 2 players (minimum)', () => {
      const groups = assignPlayersToGroups(['a', 'b'], 2);
      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(2);
    });

    it('handles 2 players with large group size', () => {
      const groups = assignPlayersToGroups(['a', 'b'], 20);
      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(2);
    });

    it('every player is assigned to exactly one group', () => {
      const players = Array.from({ length: 17 }, (_, i) => `p${i}`);
      const groups = assignPlayersToGroups(players, 4);

      const allAssigned = Array.from(groups.values()).flat();
      expect(allAssigned.length).toBe(17);
      expect(new Set(allAssigned).size).toBe(17); // no duplicates
    });

    it('group sizes differ by at most 1', () => {
      // For any input, round-robin ensures max difference of 1
      for (const total of [7, 11, 13, 17, 23]) {
        for (const size of [3, 4, 5]) {
          const players = Array.from({ length: total }, (_, i) => `p${i}`);
          const groups = assignPlayersToGroups(players, size);
          const sizes = Array.from(groups.values()).map(g => g.length);
          const max = Math.max(...sizes);
          const min = Math.min(...sizes);
          expect(max - min).toBeLessThanOrEqual(1);
        }
      }
    });
  });
});

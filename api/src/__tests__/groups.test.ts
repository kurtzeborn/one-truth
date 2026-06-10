import { describe, it, expect } from 'vitest';
import { assignToGroups, shuffle } from '../shared/groups.js';

describe('Group Assignment', () => {
  describe('shuffle', () => {
    it('returns all elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffle([...input]);
      expect(result.sort()).toEqual(input.sort());
    });

    it('mutates in place', () => {
      const input = [1, 2, 3, 4, 5];
      const ref = input;
      shuffle(input);
      expect(ref).toBe(input);
    });
  });

  describe('even division', () => {
    it('assigns 10 players into 2 groups of 5', () => {
      const players = Array.from({ length: 10 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 5);

      expect(groups.size).toBe(2);
      expect(groups.get('A')!.length).toBe(5);
      expect(groups.get('B')!.length).toBe(5);
    });

    it('assigns 12 players into 3 groups of 4', () => {
      const players = Array.from({ length: 12 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 4);

      expect(groups.size).toBe(3);
      expect(groups.get('A')!.length).toBe(4);
      expect(groups.get('B')!.length).toBe(4);
      expect(groups.get('C')!.length).toBe(4);
    });
  });

  describe('remainder handling', () => {
    it('distributes 13 players into groups of 5 → 3 groups (5, 4, 4)', () => {
      const players = Array.from({ length: 13 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 5);

      expect(groups.size).toBe(3);
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([5, 4, 4]);
    });

    it('distributes 7 players into groups of 3 → 3 groups (3, 2, 2)', () => {
      const players = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 3);

      expect(groups.size).toBe(3);
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([3, 2, 2]);
    });

    it('distributes 11 players into groups of 4 → 3 groups (4, 4, 3)', () => {
      const players = Array.from({ length: 11 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 4);

      expect(groups.size).toBe(3);
      const sizes = Array.from(groups.values()).map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([4, 4, 3]);
    });
  });

  describe('letter assignment', () => {
    it('uses letters A-Z sequentially', () => {
      const players = Array.from({ length: 26 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 1);

      expect(groups.size).toBe(26);
      expect(Array.from(groups.keys()).sort()).toEqual(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').sort()
      );
    });

    it('assigns single group for 3 players with groupSize 5', () => {
      const players = ['alice', 'bob', 'charlie'];
      const groups = assignToGroups(players, 5);

      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles 2 players (minimum)', () => {
      const groups = assignToGroups(['a', 'b'], 2);
      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(2);
    });

    it('handles 2 players with large group size', () => {
      const groups = assignToGroups(['a', 'b'], 20);
      expect(groups.size).toBe(1);
      expect(groups.get('A')!.length).toBe(2);
    });

    it('every player is assigned to exactly one group', () => {
      const players = Array.from({ length: 17 }, (_, i) => `p${i}`);
      const groups = assignToGroups(players, 4);

      const allAssigned = Array.from(groups.values()).flat();
      expect(allAssigned.length).toBe(17);
      expect(new Set(allAssigned).size).toBe(17); // no duplicates
    });

    it('group sizes differ by at most 1', () => {
      // For any input, round-robin ensures max difference of 1
      for (const total of [7, 11, 13, 17, 23]) {
        for (const size of [3, 4, 5]) {
          const players = Array.from({ length: total }, (_, i) => `p${i}`);
          const groups = assignToGroups(players, size);
          const sizes = Array.from(groups.values()).map(g => g.length);
          const max = Math.max(...sizes);
          const min = Math.min(...sizes);
          expect(max - min).toBeLessThanOrEqual(1);
        }
      }
    });
  });
});

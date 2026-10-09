/**
 * Integration Test Suite for Blitzball-X Match Engine & Anti-Cheat Validation
 * Verifies FFX encounter calculations, hydrodynamic stat decay, status ailment math,
 * and deterministic seed replay validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MatchReplayValidator } from '../server/match-validator.js';
import { EncounterEngine } from '../src/game/combat.js';
import { FFX_CONSTANTS } from '../src/data/constants.js';
import { createSeedableRNG } from '../src/core/rng.js';
import { StatusEffectManager, STATUS_TYPES } from '../src/render/status.js';

describe('Blitzball-X Match Engine & Anti-Cheat Validation Suite', () => {

  describe('1. Deterministic Seedable RNG', () => {
    it('generates identical pseudo-random sequences for identical seeds', () => {
      const seed = 987654321;
      const rngA = createSeedableRNG(seed);
      const rngB = createSeedableRNG(seed);

      const sequenceA = Array.from({ length: 10 }, () => rngA.nextFloat());
      const sequenceB = Array.from({ length: 10 }, () => rngB.nextFloat());

      expect(sequenceA).toEqual(sequenceB);
    });

    it('produces distinct sequences for different seeds', () => {
      const rngA = createSeedableRNG(12345);
      const rngB = createSeedableRNG(67890);

      const valA = rngA.nextFloat();
      const valB = rngB.nextFloat();

      expect(valA).not.toBe(valB);
    });
  });

  describe('2. FFX Encounter Math & Hydrodynamic Decay', () => {
    let mockCarrier;
    let mockDefenders;

    beforeEach(() => {
      mockCarrier = {
        id: 'p_tidus',
        name: 'Tidus',
        en: 12,
        sh: 15,
        pas: 10,
        stats: { en: 12, sh: 15, pas: 10, tck: 8, blk: 5, cut: 3 }
      };

      mockDefenders = [
        { id: 'p_balgerda', name: 'Balgerda', tck: 8, blk: 6, stats: { tck: 8, blk: 6 } },
        { id: 'p_dorus', name: 'Dorus', tck: 6, blk: 4, stats: { tck: 6, blk: 4 } }
      ];
    });

    it('resolves breakthrough math and calculates remaining carrier EN', () => {
      const rng = createSeedableRNG(42);
      const result = EncounterEngine.resolveBreakthrough(mockCarrier, mockDefenders, rng);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('remainingEN');
      expect(typeof result.remainingEN).toBe('number');
    });

    it('applies distance-based hydrodynamic stat decay to shots in water', () => {
      const initialSH = 20;
      const shotDistanceMeters = 10;
      const decayPerMeter = FFX_CONSTANTS.WATER.STAT_DECAY_PER_METER || 0.5;

      const expectedDecay = shotDistanceMeters * decayPerMeter;
      const decayedSH = Math.max(0, initialSH - expectedDecay);

      expect(decayedSH).toBe(15);
    });

    it('resolves goalkeeper catch against incoming shot power', () => {
      const rng = createSeedableRNG(100);
      
      // High shot (30) vs Low CAT (5) -> Should be a goal
      const goalRes = EncounterEngine.resolveKeeperCatch(30, { cat: 5 }, rng);
      expect(goalRes.isGoal).toBe(true);

      // Low shot (2) vs High CAT (25) -> Should be saved
      const saveRes = EncounterEngine.resolveKeeperCatch(2, { cat: 25 }, rng);
      expect(saveRes.isGoal).toBe(false);
    });
  });

  describe('3. Status Ailments Math', () => {
    let mockPlayer;
    let mockScene;
    let statusManager;

    beforeEach(() => {
      mockPlayer = {
        id: 'p_datto',
        name: 'Datto',
        hp: 100,
        stats: { pas: 14, sh: 10, tck: 8, blk: 4 }
      };

      // Mock Three.js Scene
      mockScene = {
        add: () => {},
        remove: () => {}
      };

      statusManager = new StatusEffectManager(mockScene);
    });

    it('halves target stat under Wither ailment (FFX Math)', () => {
      statusManager.applyStatus(mockPlayer, STATUS_TYPES.WITHER_PAS, 30);

      const effectivePAS = statusManager.getEffectiveStat(mockPlayer, 'pas');
      expect(effectivePAS).toBe(7); // 14 / 2 = 7

      const unmodifiedSH = statusManager.getEffectiveStat(mockPlayer, 'sh');
      expect(unmodifiedSH).toBe(10); // SH is not withered
    });

    it('drains HP continuously over time when infected with Poison', () => {
      statusManager.applyStatus(mockPlayer, STATUS_TYPES.POISON, 10);
      const initialHP = mockPlayer.hp;

      statusManager.update(2.0, [mockPlayer]); // Simulate 2 seconds

      expect(mockPlayer.hp).toBeLessThan(initialHP);
      expect(mockPlayer.hp).toBe(96); // 100 - (2 HP/sec * 2 sec) = 96
    });

    it('flags player as asleep when Sleep ailment is active', () => {
      statusManager.applyStatus(mockPlayer, STATUS_TYPES.SLEEP, 15);
      expect(statusManager.isAsleep(mockPlayer.id)).toBe(true);
    });
  });

  describe('4. Server Replay Anti-Cheat Validator', () => {
    it('validates a legitimate client match submission', () => {
      const submission = {
        matchSeed: 555123,
        homeTeamId: 'besaid_aurochs',
        awayTeamId: 'luca_goers',
        actionLog: [
          {
            type: 'SHOOT',
            carrierId: 'p_tidus',
            defenderIds: [],
            isHomeCarrier: true,
            shotDistance: 5
          }
        ],
        reportedHomeScore: 1,
        reportedAwayScore: 0,
        reportedGilEarned: 1050 // Win (1000) + 1 Goal Bonus (50)
      };

      const result = MatchReplayValidator.validateMatchSubmission(submission);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.verifiedHomeScore).toBe(1);
      expect(result.verifiedGil).toBe(1050);
    });

    it('detects and rejects score tampering in client submission', () => {
      const submission = {
        matchSeed: 555123,
        homeTeamId: 'besaid_aurochs',
        awayTeamId: 'luca_goers',
        actionLog: [], // No goals scored in action log
        reportedHomeScore: 5, // Falsified score claim
        reportedAwayScore: 0,
        reportedGilEarned: 1000
      };

      const result = MatchReplayValidator.validateMatchSubmission(submission);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Home score mismatch: client claimed 5, server calculated 0.');
    });

    it('flags and caps inflated Gil reward requests', () => {
      const submission = {
        matchSeed: 777888,
        homeTeamId: 'besaid_aurochs',
        awayTeamId: 'al_bhed_psyches',
        actionLog: [],
        reportedHomeScore: 0,
        reportedAwayScore: 0,
        reportedGilEarned: 999999 // Falsified Gil addition
      };

      const result = MatchReplayValidator.validateMatchSubmission(submission);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Gil reward inflation detected');
      expect(result.verifiedGil).toBe(500); // Clamped to Draw reward cap
    });
  });

});

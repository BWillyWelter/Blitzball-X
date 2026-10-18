/** JSON-only data contracts. Engine objects, Maps, clocks, and functions never enter saves. */
export const STAT_KEYS = ['END', 'ATK', 'PAS', 'SHT', 'CAT', 'BLK', 'PHY', 'SPD'] as const;
export type Stat = typeof STAT_KEYS[number];
export type Attributes = Record<Stat, number>;
export type Role = 'forward' | 'midfielder' | 'defender' | 'keeper';
export type Rank = 'Mature Amateur' | 'Professional' | 'Veteran' | 'All-Star';
export type Outcome = 'win' | 'draw' | 'loss';
export type Action = 'pass' | 'tackle' | 'block' | 'goal' | 'techcopy';
export interface Vec3 { x: number; y: number; z: number }
export interface Quaternion { x: number; y: number; z: number; w: number }
export interface Body { position: Vec3; velocity: Vec3; orientation: Quaternion; radius: number }
export interface Injury {
  id: string;
  kind: 'strain' | 'bruise' | 'fracture' | 'tear';
  severity: 'minor' | 'severe';
  remainingMatches: number;
  acquiredFixtureId?: string;
  affectedStats: Stat[];
  statMultiplier: number;
}
export interface Agent { tier: 1 | 2 | 3; name: string }
export interface Contract {
  teamId: string;
  remainingMatches: number;
  salaryPerMatch: number;
  goalBonus: number;
  winBonus: number;
  endorsementPerMatch: number;
}
export interface Player {
  id: string;
  name: string;
  age: number;
  role: Role;
  attributes: Attributes;
  baseMaxHP: number;
  level: number;
  totalXP: number;
  attributePoints: number;
  reputation: number;
  money: number;
  skills: string[];
  inventory: Item[];
  injuries: Injury[];
  contract: Contract | null;
  agent: Agent | null;
  baseMarketValue: number;
  marketValue: number;
  performance: number; // [-1, 1], seasonal weighted performance; not raw goals.
}
export interface Item {
  id: string;
  name: string;
  kind: 'equipment' | 'therapy-voucher';
  quantity: number;
}
export interface Team {
  id: string;
  name: string;
  style: 'balanced' | 'aggressive' | 'technical' | 'speed' | 'physical';
  playerIds: string[];
  capacity: number;
  budget: number;
  chemistry: number; // 0..100
  demand: Partial<Record<Role, number>>; // [-1, 1]
  baseAggression: number; // 0..1
}
export interface MatchRecord {
  id: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  goalsByPlayer: Record<string, number>;
}
export interface Standing { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number }
export interface Rivalry { teamIds: [string, string]; matches: number; closeGames: number; intensity: number; history: MatchRecord[] }
export type DayKind = 'training' | 'travel' | 'match' | 'negotiation' | 'recovery';
export interface CalendarDay { index: number; round: number; kind: DayKind }
export interface MatchLedger { matchId: string; playerId: string; actionIds: string[]; actionXP: number; settled: boolean; awardedXP: number }
export interface CareerSave {
  version: 1;
  policyVersion: string;
  seedState: number;
  userPlayerId: string;
  dayIndex: number;
  therapyDaysSpent: number;
  dialogueIds: string[];
  players: Player[];
  teams: Team[];
  matches: MatchRecord[];
  rivalries: Rivalry[];
  ledgers: MatchLedger[];
}

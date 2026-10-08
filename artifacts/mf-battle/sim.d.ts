// Types for sim.js, so the bot's server (TypeScript) can run the same world rules.

export const WORLD: number;
export const START_MASS: number;
export const REVENGE_MASS: number;
export const THROW_SPEEDS: number[];
export const BOT_NAMES: string[];
export const MERGE_SECONDS: number;
export const MAX_CELL_MASS: number;
export function rad(m: number): number;

export interface SimOwner {
  id: number;
  ver: number;
  bot: boolean;
  name: string;
  skin: string;
  level: number;
  hue: number;
  cells: SimCell[];
  dead: boolean;
  dir: { x: number; y: number; m: number };
  throwing: boolean;
  throwLevel: number;
  stats: { maxMass: number; eaten: number; born: number };
  killer: SimOwner | null;
}
export interface SimCell { id: number; x: number; y: number; m: number; r: number; bx: number; by: number; mergeAt: number; owner: SimOwner }
export interface SimFood { id: number; x: number; y: number; c: number; r: number }
export interface SimPellet { id: number; x0: number; y0: number; x: number; y: number; vx: number; vy: number; born: number; m: number; r: number; hue: number; owner: SimOwner }
export interface SimThing { id: number; x: number; y: number; m: number; r: number; loot?: number }
export type SimEvent =
  | { type: 'kill'; victim: SimOwner; killer: SimOwner | null; mass: number }
  | { type: 'orb'; owner: SimOwner }
  | { type: 'pop'; owner: SimOwner };

export class FoodGrid {
  readonly size: number;
  byId: Map<number, SimFood>;
  add(f: SimFood): void;
  remove(id: number): void;
  clear(): void;
  each(x0: number, y0: number, x1: number, y1: number, fn: (f: SimFood) => void): void;
}

export interface SimWorld {
  time: number;
  owners: SimOwner[];
  cells: SimCell[];
  foods: FoodGrid;
  pellets: SimPellet[];
  viruses: SimThing[];
  orbs: SimThing[];
  events: SimEvent[];
  foodAdded: SimFood[];
  foodRemoved: number[];
  pelletAdded: SimPellet[];
  pelletRemoved: number[];
  addOwner(o: { name: string; skin?: string; bot?: boolean; mass?: number; near?: { x: number; y: number } | null; hue?: number; level?: number }): SimOwner;
  removeOwner(o: SimOwner): void;
  respawn(o: SimOwner, mass?: number, near?: { x: number; y: number } | null): void;
  centerOf(o: SimOwner): { x: number; y: number; m: number };
  massOf(o: SimOwner): number;
  ranking(): { o: SimOwner; m: number }[];
  split(o: SimOwner, dx: number, dy: number): boolean;
  eject(o: SimOwner, dx: number, dy: number, level?: number): void;
  step(dt: number): void;
}

export function createWorld(opts?: { bots?: number; food?: number; viruses?: number; orbs?: number; trackNet?: boolean }): SimWorld;


export interface Vector2 {
  x: number;
  y: number;
}

export enum BallType {
  CUE = 'CUE',
  RED = 'RED',
  YELLOW = 'YELLOW',
  GREEN = 'GREEN',
  BROWN = 'BROWN',
  BLUE = 'BLUE',
  PINK = 'PINK',
  BLACK = 'BLACK',
}

export type TargetState = 'RED' | 'COLOR' | BallType;

export interface Ball {
  id: number;
  type: BallType;
  pos: Vector2;
  vel: Vector2;
  radius: number;
  color: string;
  mass: number;
  potted: boolean;
  value: number;
}

export interface TableConfig {
  width: number;
  height: number;
  pocketRadius: number;
  cushionWidth: number;
}

export interface Spin {
  x: number; // Side spin (-1 to 1)
  y: number; // Top/Back spin (-1 to 1, where -1 is backspin/draw)
}

export enum GameMode {
  SINGLE_PLAYER = 'SINGLE_PLAYER',
  TWO_PLAYER = 'TWO_PLAYER',
  ONLINE_HOST = 'ONLINE_HOST',
  ONLINE_CLIENT = 'ONLINE_CLIENT',
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export enum GameState {
  WELCOME = 'WELCOME',
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
}

export enum Player {
  ONE = 'Player 1',
  TWO = 'Player 2',
  AI = 'AI',
}

export interface PlayerStats {
    framesWon: number;
    highBreak: number;
    shotsPlayed: number;
    ballsPotted: number;
}

export interface FloatingText {
    id: number;
    text: string;
    x: number;
    y: number;
    color: string;
    life: number; // 0 to 1
    velocity: number;
    size: number;
}

export interface VisualEffect {
    id: number;
    type: 'POT_ANIMATION';
    x: number;
    y: number;
    color: string;
    radius: number;
    life: number; 
    targetPos?: Vector2;
}

export interface GameSnapshot {
    balls: Ball[];
    scoreP1: number;
    scoreP2: number;
    currentPlayer: Player;
    targetState: TargetState;
    currentBreak: number;
}

// 9.25px radius (~18.5px diameter) - Realistic "Huge Table" feel
export const BALL_RADIUS = 9.25; 
export const TABLE_WIDTH = 800;
export const TABLE_HEIGHT = 400; // 2:1 aspect ratio

import { Ball, Vector2, TableConfig, Spin, BallType } from '../types';

export const vecAdd = (v1: Vector2, v2: Vector2): Vector2 => ({ x: v1.x + v2.x, y: v1.y + v2.y });
export const vecSub = (v1: Vector2, v2: Vector2): Vector2 => ({ x: v1.x - v2.x, y: v1.y - v2.y });
export const vecMult = (v: Vector2, s: number): Vector2 => ({ x: v.x * s, y: v.y * s });
export const vecDot = (v1: Vector2, v2: Vector2): number => v1.x * v2.x + v1.y * v2.y;
export const vecLen = (v: Vector2): number => Math.sqrt(v.x * v.x + v.y * v.y);
export const vecNorm = (v: Vector2): Vector2 => {
  const len = vecLen(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
};
export const vecDist = (v1: Vector2, v2: Vector2): number => vecLen(vecSub(v1, v2));

// Physics Constants
const ROLLING_RESISTANCE = 0.12; // Increased slightly to ensure balls stop
const WALL_RESTITUTION = 0.80; // Slightly deadened cushions
const BALL_RESTITUTION = 0.92; 
const STOP_THRESHOLD = 0.15; // Higher threshold to prevent micro-vibrations preventing turn end
const SUB_STEPS = 10; 
const SPIN_POWER_FACTOR = 4.5; 
const PENETRATION_SLOP = 0.05; 

export const updatePhysics = (
  balls: Ball[],
  table: TableConfig,
  spin: Spin,
  onPot: (ball: Ball) => void,
  dt: number, // Delta time in seconds
  onCollision?: (b1: Ball, b2: Ball, impact: number) => void
): Ball[] => {
  const { width, height, cushionWidth, pocketRadius } = table;
  
  const timeScale = dt * 60;
  
  const pOffset = 0;
  const pockets: Vector2[] = [
    { x: cushionWidth - pOffset, y: cushionWidth - pOffset }, // Top-Left
    { x: width / 2, y: cushionWidth - 8 }, // Top-Middle 
    { x: width - (cushionWidth - pOffset), y: cushionWidth - pOffset }, // Top-Right
    { x: cushionWidth - pOffset, y: height - (cushionWidth - pOffset) }, // Bottom-Left
    { x: width / 2, y: height + 8 - cushionWidth }, // Bottom-Middle 
    { x: width - (cushionWidth - pOffset), y: height - (cushionWidth - pOffset) }, // Bottom-Right
  ];

  const inPocketZone = (pos: Vector2) => {
      for (const p of pockets) {
          // CRITICAL FIX: Reduced multiplier from 1.5 to 1.1
          // This ensures wall collision stays active until the ball is truly falling into the hole.
          // Prevents balls from getting stuck in the "knuckle" of the cushion.
          if (vecDist(pos, p) < pocketRadius * 1.1) return true;
      }
      return false;
  };

  const wallMinX = cushionWidth;
  const wallMaxX = width - cushionWidth;
  const wallMinY = cushionWidth;
  const wallMaxY = height - cushionWidth;

  const activeBalls = balls.filter(b => !b.potted);

  const subDt = timeScale / SUB_STEPS;

  for (let step = 0; step < SUB_STEPS; step++) {
    
    // 1. Integration (Move)
    for (const ball of activeBalls) {
      if (vecLen(ball.vel) > 0.001) {
         const dPos = vecMult(ball.vel, subDt);
         ball.pos = vecAdd(ball.pos, dPos);
      }
    }

    // 2. Pocket Detection
    for (const ball of activeBalls) {
      if(ball.potted) continue;
      for (const pocket of pockets) {
        if (vecDist(ball.pos, pocket) < pocketRadius * 0.95) {
          ball.potted = true;
          ball.vel = { x: 0, y: 0 };
          onPot(ball);
          break; 
        }
      }
    }

    // 3. Wall Collisions
    for (const ball of activeBalls) {
        if (ball.potted) continue;
        
        // If touching a wall, we check collisions unless explicitly inside the hole zone
        if (inPocketZone(ball.pos)) continue; 
    
        let collidedX = false;
        let collidedY = false;

        // Hard Clamp to prevent sticking
        if (ball.pos.x < wallMinX + ball.radius) {
          ball.pos.x = wallMinX + ball.radius;
          ball.vel.x = Math.abs(ball.vel.x) * WALL_RESTITUTION;
          collidedX = true;
        } else if (ball.pos.x > wallMaxX - ball.radius) {
          ball.pos.x = wallMaxX - ball.radius;
          ball.vel.x = -Math.abs(ball.vel.x) * WALL_RESTITUTION;
          collidedX = true;
        }
    
        if (ball.pos.y < wallMinY + ball.radius) {
          ball.pos.y = wallMinY + ball.radius;
          ball.vel.y = Math.abs(ball.vel.y) * WALL_RESTITUTION;
          collidedY = true;
        } else if (ball.pos.y > wallMaxY - ball.radius) {
          ball.pos.y = wallMaxY - ball.radius;
          ball.vel.y = -Math.abs(ball.vel.y) * WALL_RESTITUTION;
          collidedY = true;
        }

        if (ball.type === BallType.CUE && (spin.x !== 0)) {
            const speed = vecLen(ball.vel);
            if (speed > 1) { 
                const spinForce = spin.x * 0.6; 
                if (collidedY) {
                    ball.vel.x += spinForce * (speed * 0.15);
                }
                if (collidedX) {
                    ball.vel.y += spinForce * (speed * 0.15);
                }
            }
        }
    }

    // 4. Ball-Ball Collisions
    const currentActive = activeBalls.filter(b => !b.potted);
    
    for (let i = 0; i < currentActive.length; i++) {
      for (let j = i + 1; j < currentActive.length; j++) {
        const b1 = currentActive[i];
        const b2 = currentActive[j];
        const dist = vecDist(b1.pos, b2.pos);
        const minDist = b1.radius + b2.radius;

        if (dist < minDist) {
          const n = vecNorm(vecSub(b1.pos, b2.pos)); 
          const overlap = minDist - dist;
          
          const correctionMag = Math.max(0, overlap - PENETRATION_SLOP);
          const correction = vecMult(n, correctionMag * 0.5);
          
          if (correctionMag > 0) {
              b1.pos = vecAdd(b1.pos, correction);
              b2.pos = vecSub(b2.pos, correction);
          }

          const relVel = vecSub(b1.vel, b2.vel);
          const velAlongNormal = vecDot(relVel, n);

          if (onCollision && velAlongNormal <= 0.05) { 
             onCollision(b1, b2, Math.abs(velAlongNormal));
          }

          if (velAlongNormal > 0) continue;

          const j = -(1 + BALL_RESTITUTION) * velAlongNormal;
          const impulse = j / 2;

          const impulseVec = vecMult(n, impulse);
          b1.vel = vecAdd(b1.vel, impulseVec);
          b2.vel = vecSub(b2.vel, impulseVec);

          const isCue1 = b1.type === BallType.CUE;
          const isCue2 = b2.type === BallType.CUE;

          if ((isCue1 || isCue2) && (spin.x !== 0 || spin.y !== 0)) {
             const impactForce = Math.abs(velAlongNormal);
             if (impactForce > 0.1) {
                const cueBall = isCue1 ? b1 : b2;
                const dirToObject = isCue1 ? vecMult(n, -1) : n;
                
                const spinMagnitude = impactForce * SPIN_POWER_FACTOR; 
                
                const spinImpulseY = vecMult(dirToObject, spin.y * spinMagnitude * 0.30);
                
                const tangent = { x: -dirToObject.y, y: dirToObject.x };
                const spinImpulseX = vecMult(tangent, spin.x * spinMagnitude * 0.08);
                
                cueBall.vel = vecAdd(cueBall.vel, spinImpulseY);
                cueBall.vel = vecAdd(cueBall.vel, spinImpulseX);
             }
          }
        }
      }
    }
  }

  // Apply Friction
  for (const ball of balls) {
    if (!ball.potted) {
        const speed = vecLen(ball.vel);
        if (speed < STOP_THRESHOLD) {
            ball.vel = { x: 0, y: 0 };
        } else {
            let drag = ROLLING_RESISTANCE * timeScale;

            if (ball.type === BallType.CUE) {
                drag = drag * (1.0 - (spin.y * 0.2)); 
            }

            const drop = drag;
            const newSpeed = Math.max(0, speed - drop);
            
            if (newSpeed < STOP_THRESHOLD * 2) {
                 ball.vel = vecMult(vecNorm(ball.vel), newSpeed * 0.90); // Harder dampen near stop
            } else {
                 ball.vel = vecMult(vecNorm(ball.vel), newSpeed);
            }
        }
    }
  }

  return balls;
};
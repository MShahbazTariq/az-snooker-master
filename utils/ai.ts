
import { Ball, BallType, Difficulty, TableConfig, Vector2, TargetState } from '../types';
import { vecSub, vecNorm, vecDist, vecAdd, vecMult, vecDot, vecLen } from './physics';

interface AIShot {
  aimDir: Vector2;
  power: number;
}

// Helper to find the best color to nominate
export const pickBestColor = (
  cueBall: Ball,
  balls: Ball[],
  table: TableConfig
): BallType => {
  const colorBalls = balls.filter(b => !b.potted && b.type !== BallType.CUE && b.type !== BallType.RED);
  
  if (colorBalls.length === 0) return BallType.BLACK; // Fallback

  // Logic: Find the color ball with the easiest path (closest + best angle)
  let bestColor = colorBalls[0].type;
  let highestScore = -Infinity;

  const pockets: Vector2[] = [
    { x: table.cushionWidth, y: table.cushionWidth },
    { x: table.width / 2, y: table.cushionWidth },
    { x: table.width - table.cushionWidth, y: table.cushionWidth },
    { x: table.cushionWidth, y: table.height - table.cushionWidth },
    { x: table.width / 2, y: table.height - table.cushionWidth },
    { x: table.width - table.cushionWidth, y: table.height - table.cushionWidth },
  ];

  for (const ball of colorBalls) {
      let ballScore = 0;
      const distToCue = vecDist(cueBall.pos, ball.pos);
      
      // Closer balls are generally better
      ballScore -= distToCue; 

      // Check if pottable
      for (const pocket of pockets) {
          const toPocket = vecSub(pocket, ball.pos);
          const dirToPocket = vecNorm(toPocket);
          
          const cueToBall = vecNorm(vecSub(ball.pos, cueBall.pos));
          const cutAngle = Math.acos(vecDot(cueToBall, dirToPocket));
          
          if (cutAngle < 1.0) { // If angle is decent (< ~60 deg)
               // heavily weight pottable balls
               ballScore += 2000;
               // Less angle is better
               ballScore -= (cutAngle * 500);
               break; // Found a pocket for this ball, stop checking other pockets
          }
      }
      
      if (ballScore > highestScore) {
          highestScore = ballScore;
          bestColor = ball.type;
      }
  }

  return bestColor;
};

export const calculateAIShot = (
  cueBall: Ball,
  balls: Ball[],
  table: TableConfig,
  difficulty: Difficulty,
  targetState: TargetState
): AIShot => {
  // 1. Identify Legal Targets
  const activeBalls = balls.filter(b => !b.potted && b.type !== BallType.CUE);
  let legalTargets: Ball[] = [];

  if (targetState === 'RED') {
      legalTargets = activeBalls.filter(b => b.type === BallType.RED);
  } else if (targetState === 'COLOR') {
      legalTargets = activeBalls.filter(b => b.type !== BallType.RED);
  } else {
      // Specific Color (Endgame or Nomination)
      legalTargets = activeBalls.filter(b => b.type === targetState);
  }

  // If we can't find specific legal target, fallback (usually happens in Free Ball or complex foul states)
  if (legalTargets.length === 0 && activeBalls.length > 0) legalTargets = activeBalls;

  // 2. Evaluate Potting Opportunities
  let bestPot: { ball: Ball, dist: number, angleDiff: number, pocket: Vector2, confidence: number } | null = null;
  
  // Use same recessed pocket config as physics engine to ensure AI doesn't hit the rail
  const pOffset = 0;
  const pockets: Vector2[] = [
    { x: table.cushionWidth - pOffset, y: table.cushionWidth - pOffset }, // Top-Left
    { x: table.width / 2, y: table.cushionWidth - 8 }, // Top-Middle (recessed)
    { x: table.width - (table.cushionWidth - pOffset), y: table.cushionWidth - pOffset }, // Top-Right
    { x: table.cushionWidth - pOffset, y: table.height - (table.cushionWidth - pOffset) }, // Bottom-Left
    { x: table.width / 2, y: table.height + 8 - table.cushionWidth }, // Bottom-Middle (recessed)
    { x: table.width - (table.cushionWidth - pOffset), y: table.height - (table.cushionWidth - pOffset) }, // Bottom-Right
  ];

  const maxDist = Math.sqrt(table.width * table.width + table.height * table.height);

  for (const target of legalTargets) {
      for (const pocket of pockets) {
          // Geometry Vectors
          const toPocket = vecSub(pocket, target.pos);
          const distToPocket = vecLen(toPocket);
          const dirToPocket = vecNorm(toPocket);

          // Impact point (Ghost ball position)
          const impactPos = vecSub(target.pos, vecMult(dirToPocket, target.radius * 2));
          
          const toImpact = vecSub(impactPos, cueBall.pos);
          const distToImpact = vecLen(toImpact);
          const aimDir = vecNorm(toImpact);

          // Angle Difficulty: 0 is straight, PI/2 is impossible cut
          const vecCueToTarget = vecNorm(vecSub(target.pos, cueBall.pos));
          const cutAngle = Math.acos(vecDot(vecCueToTarget, dirToPocket));
          
          // Basic Line of Sight Check (Simplified)
          // We assume if the angle is > 80 degrees, it's not physically viable due to collision physics
          if (cutAngle > 1.4) continue; // ~80 degrees

          // Calculate Confidence Score (0.0 - 1.0)
          // Angle affects confidence heavily (70%), Distance affects it lightly (30%)
          const angleScore = Math.max(0, 1 - (cutAngle / 1.3)); // 1.3 rad is roughly the cutoff
          const distScore = Math.max(0, 1 - (distToImpact / maxDist));
          
          const confidence = (angleScore * 0.7) + (distScore * 0.3);

          // Check if this is the best option so far
          if (!bestPot || confidence > bestPot.confidence) {
              bestPot = { 
                  ball: target, 
                  dist: distToImpact, 
                  angleDiff: cutAngle, 
                  pocket: pocket, 
                  confidence 
              };
          }
      }
  }

  // 3. Strategic Decision Making based on Difficulty
  let finalDir = { x: 1, y: 0 };
  let power = 50;
  let attemptPot = false;

  // Thresholds: Lower means AI is more reckless (tries harder shots). Higher means AI is conservative.
  let safetyThreshold = 0.0; 

  switch (difficulty) {
      case Difficulty.EASY: 
          safetyThreshold = 0.05; // Almost always tries to pot, even impossible shots
          break;
      case Difficulty.MEDIUM: 
          safetyThreshold = 0.4; // Plays safe on hard cuts
          break;
      case Difficulty.HARD: 
          safetyThreshold = 0.6; // Only takes high percentage shots, otherwise plays safety
          break;
  }

  if (bestPot && bestPot.confidence > safetyThreshold) {
      // --- DECISION: POT ---
      attemptPot = true;
      const target = bestPot.ball;
      const toPocket = vecNorm(vecSub(bestPot.pocket, target.pos));
      const impactPos = vecSub(target.pos, vecMult(toPocket, target.radius * 2));
      finalDir = vecNorm(vecSub(impactPos, cueBall.pos));
      
      // Power Calculation
      // More power needed for distance, plus a little extra for pocket collision
      power = 35 + (bestPot.dist / 8);

      // Hard AI adjusts power for position (simplified: tends to hit firm for spin reaction)
      if (difficulty === Difficulty.HARD) {
          power = Math.min(85, power + 10); 
      }
  } else {
      // --- DECISION: SAFETY ---
      // Goal: Hit a legal ball thin to send cue ball to cushion or safe area
      
      let safetyTarget = legalTargets[0];
      let bestSafetyDist = 0;

      // Find the furthest legal ball (basic safety heuristic to keep distance)
      for (const t of legalTargets) {
          const d = vecDist(t.pos, cueBall.pos);
          if (d > bestSafetyDist) {
              bestSafetyDist = d;
              safetyTarget = t;
          }
      }

      if (safetyTarget) {
          // Aim for the edge of the ball (Thin contact)
          // Vector to center
          const toCenter = vecSub(safetyTarget.pos, cueBall.pos);
          const dist = vecLen(toCenter);
          const dir = vecNorm(toCenter);
          
          // Perpendicular vector for edge
          const perp = { x: -dir.y, y: dir.x };
          
          // Aim at the edge radius. 
          // If Easy, might hit thick (bad safety). If Hard, hits thin (good safety).
          const thinFactor = difficulty === Difficulty.HARD ? 1.0 : 0.5;
          const offset = vecMult(perp, safetyTarget.radius * 2 * thinFactor); 
          
          const safetyPoint = vecAdd(safetyTarget.pos, offset);
          finalDir = vecNorm(vecSub(safetyPoint, cueBall.pos));

          // Safety Power:
          // Easy: Random.
          // Hard: Measured to reach baulk (approx 40-50% power usually gets up and down)
          if (difficulty === Difficulty.HARD) {
               power = 45; 
          } else {
               power = 30 + Math.random() * 40;
          }
      } else {
          // No legal targets visible (Snookered)? Just hit random direction
          finalDir = { x: Math.random(), y: Math.random() };
          power = 20;
      }
  }

  // 4. Apply Human Error (Accuracy)
  let errorAngle = 0;
  let powerError = 1.0;

  switch (difficulty) {
    case Difficulty.EASY: 
        // Large aim error, inconsistent power
        errorAngle = (Math.random() - 0.5) * 0.12; // +/- ~3.5 degrees
        powerError = 0.8 + Math.random() * 0.4; // +/- 20% power variation
        break;
    case Difficulty.MEDIUM: 
        // Moderate aim error
        errorAngle = (Math.random() - 0.5) * 0.05; // +/- ~1.5 degrees
        powerError = 0.9 + Math.random() * 0.2; // +/- 10%
        break;
    case Difficulty.HARD: 
        // Tiny aim error, precise power
        errorAngle = (Math.random() - 0.5) * 0.008; // +/- ~0.2 degrees (Pro level)
        powerError = 0.98 + Math.random() * 0.04; // +/- 2%
        break;
  }

  // Apply Error
  const cos = Math.cos(errorAngle);
  const sin = Math.sin(errorAngle);
  const erroredDir = { 
      x: finalDir.x * cos - finalDir.y * sin, 
      y: finalDir.x * sin + finalDir.y * cos 
  };

  return {
    aimDir: erroredDir,
    power: Math.min(100, Math.max(5, power * powerError))
  };
};

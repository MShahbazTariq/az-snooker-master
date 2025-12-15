import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Ball, BallType, TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, TableConfig, Vector2, GameMode, Difficulty, GameState, Player, Spin, PlayerStats, TargetState, FloatingText, VisualEffect } from '../types';
import { updatePhysics, vecSub, vecLen, vecMult, vecNorm, vecDist, vecAdd, vecDot } from '../utils/physics';
import { initAudio, playCollisionSound, playPotSound, playChalkSound, playWelcomeAudio } from '../utils/audio';
import { calculateAIShot } from '../utils/ai';

// --- PeerJS Declaration ---
declare global {
    interface Window {
        Peer: any;
    }
}

// Professional Geometry
const TABLE_CONFIG: TableConfig = {
  width: TABLE_WIDTH,
  height: TABLE_HEIGHT,
  pocketRadius: 17, 
  cushionWidth: 42, // Total border width (Wood + Cushion Strip)
};

// D-Zone Constants
const BAULK_X = 170; 
const CENTER_Y = 200;
const D_RADIUS = 60;

const POWER_SCALE = 0.23; 

const DEFAULT_STATS: PlayerStats = {
    framesWon: 0,
    highBreak: 0,
    shotsPlayed: 0,
    ballsPotted: 0
};

// --- Helper: Ball Values ---
const getBallValue = (type: BallType): number => {
    switch (type) {
        case BallType.RED: return 1;
        case BallType.YELLOW: return 2;
        case BallType.GREEN: return 3;
        case BallType.BROWN: return 4;
        case BallType.BLUE: return 5;
        case BallType.PINK: return 6;
        case BallType.BLACK: return 7;
        default: return 0;
    }
};

// --- Texture Generation ---
const createNoiseTexture = (width: number, height: number, opacity: number = 0.08) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  
  const idata = ctx.createImageData(width, height);
  const buffer32 = new Uint32Array(idata.data.buffer);
  const len = buffer32.length;
  
  for (let i = 0; i < len; i++) {
     const val = Math.floor(Math.random() * 255);
     const alpha = (Math.random() > 0.5 ? 255 : 230);
     buffer32[i] = (Math.floor(val * opacity) << 24) | (alpha << 16) | (alpha << 8) | alpha;
  }
  ctx.putImageData(idata, 0, 0);
  return canvas;
};

// Authentic Walnut Wood Texture
const createWoodTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    
    // 1. Rich Walnut Base (Deep, Reddish Brown)
    ctx.fillStyle = '#5D4037'; 
    ctx.fillRect(0, 0, 512, 512);

    // 2. Grain Texturing (Horizontal)
    ctx.lineCap = 'round';
    
    // Dense horizontal fibers
    for(let i=0; i<1000; i++) {
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = '#3E2723';
        ctx.lineWidth = 1 + Math.random() * 2;
        const y = Math.random() * 512;
        const len = 50 + Math.random() * 450;
        const x = Math.random() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
    }

    // Wavy Grain (Horizontal)
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#251614'; 
    ctx.lineWidth = 2;
    
    for(let i=0; i<30; i++) {
        const y = Math.random() * 512;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(150, y + Math.random()*20 - 10, 350, y + Math.random()*20 - 10, 512, y);
        ctx.stroke();
    }
    
    return canvas;
};

// --- Game Object Factory ---
const createBall = (id: number, type: BallType, x: number, y: number, color: string, value: number): Ball => ({
  id, type, pos: { x, y }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS, color, mass: 1, potted: false, value,
});

const setupBalls = (config: TableConfig): Ball[] => {
  const balls: Ball[] = [];
  let id = 0;
  
  const startX = 620; 
  
  balls.push(createBall(id++, BallType.CUE, 150, 230, '#fefefe', 0));
  
  // Colors on Spots
  balls.push(createBall(id++, BallType.YELLOW, BAULK_X, CENTER_Y + D_RADIUS, '#eab308', 2));
  balls.push(createBall(id++, BallType.GREEN, BAULK_X, CENTER_Y - D_RADIUS, '#16a34a', 3)); 
  balls.push(createBall(id++, BallType.BROWN, BAULK_X, CENTER_Y, '#92400e', 4));
  balls.push(createBall(id++, BallType.BLUE, 400, CENTER_Y, '#2563eb', 5));
  balls.push(createBall(id++, BallType.PINK, 600, CENTER_Y, '#ec4899', 6));
  balls.push(createBall(id++, BallType.BLACK, 720, CENTER_Y, '#111111', 7));
  
  const gap = BALL_RADIUS * 2 + 0.5; // Tight pack
  const cols = 5;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= c; r++) {
      const rowHeight = (c * gap); 
      const yOffset = CENTER_Y - (rowHeight / 2) + (r * gap);
      const xOffset = startX + (c * (gap * 0.866)); 
      balls.push(createBall(id++, BallType.RED, xOffset, yOffset, '#dc2626', 1));
    }
  }
  return balls;
};

// --- Exact Geometric Trajectory ---
const calculatePreciseTrajectory = (startPos: Vector2, direction: Vector2, balls: Ball[], table: TableConfig): Trajectory | null => {
    const points: Vector2[] = [startPos];
    let ghostBall: Vector2 | null = null;
    
    const minX = table.cushionWidth + BALL_RADIUS;
    const maxX = table.width - table.cushionWidth - BALL_RADIUS;
    const minY = table.cushionWidth + BALL_RADIUS;
    const maxY = table.height - table.cushionWidth - BALL_RADIUS;

    const dir = vecNorm(direction);

    // 1. Find Distance to Walls
    let distToWall = Infinity;
    
    if (dir.x > 0) distToWall = Math.min(distToWall, (maxX - startPos.x) / dir.x);
    else if (dir.x < 0) distToWall = Math.min(distToWall, (minX - startPos.x) / dir.x);
    
    if (dir.y > 0) distToWall = Math.min(distToWall, (maxY - startPos.y) / dir.y);
    else if (dir.y < 0) distToWall = Math.min(distToWall, (minY - startPos.y) / dir.y);

    // 2. Find Closest Ball Intersection (Ray-Circle)
    let closestHitDist = Infinity;
    let hitBall: Ball | null = null;

    for (const b of balls) {
        if (b.type === BallType.CUE || b.potted) continue;
        
        const f = vecSub(startPos, b.pos);
        const a = 1; 
        const bCoeff = 2 * vecDot(f, dir);
        const c = vecDot(f, f) - (4 * BALL_RADIUS * BALL_RADIUS);
        
        const delta = bCoeff * bCoeff - 4 * a * c;
        if (delta >= 0) {
            const t = (-bCoeff - Math.sqrt(delta)) / (2 * a);
            if (t > 0 && t < closestHitDist) {
                closestHitDist = t;
                hitBall = b;
            }
        }
    }

    // 3. Determine Endpoint
    const finalDist = Math.min(distToWall, closestHitDist);
    const endPos = vecAdd(startPos, vecMult(dir, finalDist));

    points.push(endPos);

    if (closestHitDist < distToWall) {
        ghostBall = endPos;
    }

    return { points, ghostBall, opacity: 1 };
};

// --- Check if Snookered (For Free Ball Rule) ---
const canSeeBall = (start: Vector2, target: Ball, allBalls: Ball[]): boolean => {
    // Simple center-to-center raycast visibility check
    const dir = vecNorm(vecSub(target.pos, start));
    const dist = vecDist(target.pos, start);
    
    for (const b of allBalls) {
        if (b.id === target.id || b.type === BallType.CUE || b.potted) continue;
        
        const f = vecSub(b.pos, start);
        const d = vecDot(f, dir);
        
        if (d < 0 || d > dist) continue; 
        
        const closestPoint = vecAdd(start, vecMult(dir, d));
        const distToBall = vecDist(closestPoint, b.pos);
        
        // If ray passes too close to another ball (obstructed)
        if (distToBall < b.radius * 1.95) { 
            return false;
        }
    }
    return true;
};

const checkIsSnookered = (balls: Ball[], targetState: TargetState): boolean => {
    const cueBall = balls.find(b => b.type === BallType.CUE && !b.potted);
    if (!cueBall) return false;

    let legalTargets: Ball[] = [];
    if (targetState === 'RED') {
        legalTargets = balls.filter(b => b.type === BallType.RED && !b.potted);
    } else if (targetState === 'COLOR') {
        legalTargets = balls.filter(b => b.type !== BallType.RED && b.type !== BallType.CUE && !b.potted);
    } else {
        legalTargets = balls.filter(b => b.type === targetState && !b.potted);
    }

    if (legalTargets.length === 0) return false;

    for (const t of legalTargets) {
        if (canSeeBall(cueBall.pos, t, balls)) {
            return false;
        }
    }
    
    return true;
};


interface Trajectory {
    points: Vector2[];
    ghostBall: Vector2 | null;
    opacity: number;
}

interface FoulInfo {
    active: boolean;
    message: string;
    points: number;
}

// --- Multiplayer Network Types ---
type NetMessage = 
  | { type: 'GAME_STATE', balls: Ball[], p1: number, p2: number, msg: string, target: TargetState, player: Player, spin: Spin, foul: FoulInfo, foulDecisionNeeded: boolean }
  | { type: 'INPUT_AIM', angle: number, power: number, spin: Spin }
  | { type: 'INPUT_SHOT', angle: number, power: number, spin: Spin }
  | { type: 'INPUT_NOMINATE', ball: BallType }
  | { type: 'INPUT_DECISION', decision: 'PLAY'|'AGAIN'|'FREE' }
  | { type: 'AUDIO_EVENT', sound: 'POT' | 'COLLISION', vol?: number };


export const SnookerGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [gameState, setGameState] = useState<GameState>(GameState.WELCOME);
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SINGLE_PLAYER);
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.MEDIUM);
  const [currentPlayer, setCurrentPlayer] = useState<Player>(Player.ONE);
  
  const [p1Name, setP1Name] = useState("Player 1");
  const [p2Name, setP2Name] = useState("Player 2");

  const [balls, setBalls] = useState<Ball[]>(setupBalls(TABLE_CONFIG));
  const [scoreP1, setScoreP1] = useState(0);
  const [scoreP2, setScoreP2] = useState(0);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragPower, setDragPower] = useState(0);
  const [aimAngle, setAimAngle] = useState(0);
  const [chalkLevel, setChalkLevel] = useState(100);
  const [spin, setSpin] = useState<Spin>({ x: 0, y: 0 });
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showColorSelection, setShowColorSelection] = useState(false); 
  const [foulDecisionNeeded, setFoulDecisionNeeded] = useState(false);
  const [offerFreeBall, setOfferFreeBall] = useState(false);
  const [touchingBall, setTouchingBall] = useState<Ball | null>(null);
  const [pocketCam, setPocketCam] = useState<{ active: boolean, ball: Ball | null, pocket: Vector2 | null }>({ active: false, ball: null, pocket: null });
  const [isCleaningCue, setIsCleaningCue] = useState(false);
  const [isClearance, setIsClearance] = useState(false); 
  
  // Touch detection state
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Mobile UI Modals
  const [showSpinModal, setShowSpinModal] = useState(false);

  // Welcome Audio State
  const [isInputBlocked, setIsInputBlocked] = useState(false);
  const hasPlayedWelcome = useRef(false);

  // Network State
  const [onlineMenu, setOnlineMenu] = useState<'NONE'|'HOST'|'JOIN'|'WAITING'>('NONE');
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<string>('Disconnected');
  
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const lastAimSendTimeRef = useRef(0);

  const [message, setMessage] = useState("Welcome to AZ Snooker Master");
  const [isMoving, setIsMoving] = useState(false);
  const [isShooting, setIsShooting] = useState(false);
  
  // Game Logic State
  const [targetState, setTargetState] = useState<TargetState>('RED');
  const [ballInHand, setBallInHand] = useState(false);
  const [isFreeBall, setIsFreeBall] = useState(false);
  const [foulNotification, setFoulNotification] = useState<FoulInfo>({ active: false, message: '', points: 0 });

  // Statistics State
  const [p1Stats, setP1Stats] = useState<PlayerStats>(() => {
    const saved = localStorage.getItem('az_snooker_p1_stats');
    return saved ? JSON.parse(saved) : DEFAULT_STATS;
  });
  const [p2Stats, setP2Stats] = useState<PlayerStats>(() => {
    const saved = localStorage.getItem('az_snooker_p2_stats');
    return saved ? JSON.parse(saved) : DEFAULT_STATS;
  });

  const ballsRef = useRef<Ball[]>(balls);
  const trajectoryRef = useRef<Trajectory | null>(null);
  const animationFrameId = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const movingRef = useRef(false);
  const shotPowerRef = useRef(0);
  
  // Refs for real-time animation without re-render loop lag
  const dragPowerRef = useRef(0);
  const stickOffsetRef = useRef(0);
  
  const dragStartPosRef = useRef<Vector2 | null>(null);
  const aimAngleRef = useRef(0); 
  const currentBreakRef = useRef(0);
  const lastSoundTimeRef = useRef(0);
  const turnTimerRef = useRef(0);
  const lastPlayerRef = useRef<Player>(Player.ONE); // To track who committed foul
  
  // Shot slider ref for mobile
  const sliderRef = useRef<HTMLDivElement>(null);
  const isSliderDraggingRef = useRef(false);
  const sliderStartYRef = useRef(0);

  const floatingTextsRef = useRef<FloatingText[]>([]);
  const visualEffectsRef = useRef<VisualEffect[]>([]);
  const cursorPosRef = useRef<Vector2>({ x: 0, y: 0 });

  const turnStatusRef = useRef({ 
      potted: false, 
      foul: false,
      firstHitType: null as BallType | null,
      pottedBall: null as Ball | null,
      pushShot: false
  });

  const feltPattern = useMemo(() => createNoiseTexture(512, 512, 0.08), []);
  const woodPattern = useMemo(() => createWoodTexture(), []);

  useEffect(() => { ballsRef.current = balls; }, [balls]);
  useEffect(() => { movingRef.current = isMoving }, [isMoving]);

  useEffect(() => { localStorage.setItem('az_snooker_p1_stats', JSON.stringify(p1Stats)); }, [p1Stats]);
  useEffect(() => { localStorage.setItem('az_snooker_p2_stats', JSON.stringify(p2Stats)); }, [p2Stats]);

  useEffect(() => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Welcome Sound Logic
  useEffect(() => {
      if (gameState === GameState.PLAYING && !hasPlayedWelcome.current && gameMode !== GameMode.ONLINE_CLIENT) {
          hasPlayedWelcome.current = true;
          setIsInputBlocked(true);
          setMessage("Get Ready...");
          
          const timer = setTimeout(() => {
              playWelcomeAudio().then(() => {
                  setIsInputBlocked(false);
                  setMessage("Break Off");
              });
          }, 1000);
          
          return () => clearTimeout(timer);
      }
  }, [gameState, gameMode]);

  // --- Network Initialization ---
  const initializePeer = useCallback((mode: 'HOST' | 'CLIENT') => {
      if (!window.Peer) {
          alert("PeerJS library not loaded. Check internet connection.");
          return;
      }
      if (peerRef.current) {
          peerRef.current.destroy();
      }

      setConnStatus('Initializing Network...');

      const peer = new window.Peer(undefined, {
          config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
              ]
          },
          debug: 1
      });

      peer.on('open', (id: string) => {
          setMyPeerId(id);
          if (mode === 'HOST') {
              setConnStatus('Waiting for opponent...');
              setOnlineMenu('WAITING');
              setGameMode(GameMode.ONLINE_HOST);
              setP1Name("Host (You)");
              setP2Name("Opponent");
          } else {
              setConnStatus('Network Ready. Enter ID.');
          }
      });

      peer.on('connection', (conn: any) => {
          if (mode === 'HOST') {
              connRef.current = conn;
              setConnStatus('Connected!');
              setOnlineMenu('NONE');
              setGameState(GameState.PLAYING);
              setupConnectionHandlers(conn, 'HOST');
          } else {
              connRef.current = conn;
              setupConnectionHandlers(conn, 'HOST'); 
          }
      });

      peer.on('disconnected', () => {
         setConnStatus('Disconnected from Server');
      });

      peer.on('close', () => {
         setConnStatus('Connection Closed');
      });

      peer.on('error', (err: any) => {
          console.error("Peer Error:", err);
          if (err.type === 'peer-unavailable') {
              setConnStatus('Peer not found. Check ID.');
          } else if (err.type === 'disconnected') {
              setConnStatus('Connection Lost');
          } else {
              setConnStatus(`Error: ${err.type}`);
          }
      });

      peerRef.current = peer;
  }, []);

  const connectToPeer = (id: string) => {
      if (!peerRef.current) {
          alert("Peer not initialized. Please click Back and try again.");
          return;
      }
      
      setConnStatus('Connecting...');
      const conn = peerRef.current.connect(id);
      
      conn.on('open', () => {
          connRef.current = conn;
          setConnStatus('Connected!');
          setOnlineMenu('NONE');
          setGameState(GameState.PLAYING);
          setGameMode(GameMode.ONLINE_CLIENT);
          setP1Name("Host");
          setP2Name("Client (You)");
          
          setupConnectionHandlers(conn, 'CLIENT');
      });
      
      conn.on('error', (err: any) => {
          console.error("Conn Error:", err);
          setConnStatus('Failed to connect. Check ID.');
      });
  };

  const setupConnectionHandlers = (conn: any, mode: 'HOST' | 'CLIENT') => {
      conn.on('data', (data: NetMessage) => {
          if (mode === 'CLIENT') {
               if (data.type === 'GAME_STATE') {
                   setBalls(data.balls);
                   setScoreP1(data.p1);
                   setScoreP2(data.p2);
                   setMessage(data.msg);
                   setTargetState(data.target);
                   setCurrentPlayer(data.player);
                   setFoulDecisionNeeded(data.foulDecisionNeeded);

                   if (data.player === Player.ONE) { 
                       setSpin(data.spin);
                   }
                   if (data.foul && data.foul.active) {
                       setFoulNotification(data.foul);
                   } else {
                       setFoulNotification(prev => prev.active ? { ...prev, active: false } : prev);
                   }
               } else if (data.type === 'AUDIO_EVENT') {
                   if (data.sound === 'POT') playPotSound();
                   else if (data.sound === 'COLLISION') playCollisionSound(data.vol || 0.5);
               } else if (data.type === 'INPUT_AIM') {
                   if (currentPlayer === Player.ONE) { 
                       setAimAngle(data.angle);
                       aimAngleRef.current = data.angle;
                       setDragPower(data.power);
                   }
               }
          } else {
               if (data.type === 'INPUT_AIM') {
                   if (currentPlayer === Player.TWO) {
                       setAimAngle(data.angle);
                       aimAngleRef.current = data.angle;
                       setDragPower(data.power);
                       setSpin(data.spin); 
                   }
               } else if (data.type === 'INPUT_SHOT') {
                   if (currentPlayer === Player.TWO && !isMoving && !isShooting) {
                       setSpin(data.spin);
                       shotPowerRef.current = data.power;
                       stickOffsetRef.current = 20 + data.power;
                       setIsShooting(true);
                       
                       sendNetworkMessage({ type: 'AUDIO_EVENT', sound: 'COLLISION', vol: data.power/100 });
                   }
               } else if (data.type === 'INPUT_NOMINATE') {
                   handleColorSelect(data.ball);
               } else if (data.type === 'INPUT_DECISION') {
                   handleFoulDecision(data.decision);
               }
          }
      });
      
      conn.on('close', () => {
          setConnStatus('Opponent Disconnected');
          setTimeout(() => {
             setMessage("Opponent Left");
             if (gameState === GameState.PLAYING) {
                 setGameState(GameState.MENU);
                 setOnlineMenu('NONE');
                 setGameMode(GameMode.SINGLE_PLAYER); 
             }
          }, 3000);
      });
  };

  const sendNetworkMessage = (msg: NetMessage) => {
      if (connRef.current && connRef.current.open) {
          connRef.current.send(msg);
      }
  };

  useEffect(() => {
      if(gameState === GameState.PLAYING && !isMoving && !isShooting && ballsRef.current.length > 0 && !ballInHand && !showColorSelection && !foulDecisionNeeded) {
           const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
           if (cueBall) {
             const aimDir = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
             trajectoryRef.current = calculatePreciseTrajectory(cueBall.pos, aimDir, ballsRef.current, TABLE_CONFIG);
           }
      }
  }, [aimAngle, gameState, isMoving, isShooting, ballInHand, showColorSelection, foulDecisionNeeded]);

  useEffect(() => {
    if (foulNotification.active && !foulDecisionNeeded) {
        const timer = setTimeout(() => {
            setFoulNotification(prev => ({ ...prev, active: false }));
        }, 3000);
        return () => clearTimeout(timer);
    }
  }, [foulNotification.active, foulDecisionNeeded]);

  // Check for Touching Ball
  useEffect(() => {
      if (gameState === GameState.PLAYING && !isMoving && !ballInHand) {
          const cueBall = balls.find(b => b.type === BallType.CUE);
          if (cueBall) {
              const touching = balls.find(b => 
                  !b.potted && 
                  b.type !== BallType.CUE && 
                  vecDist(cueBall.pos, b.pos) <= (BALL_RADIUS * 2 + 0.5) 
              );
              setTouchingBall(touching || null);
          }
      } else {
          setTouchingBall(null);
      }
  }, [balls, isMoving, gameState, ballInHand]);

  // AI Nomination Logic
  useEffect(() => {
    if (gameState === GameState.PLAYING && currentPlayer === Player.AI && showColorSelection) {
        const timer = setTimeout(() => {
             const colors = [BallType.BLACK, BallType.PINK, BallType.BLUE, BallType.BROWN, BallType.GREEN, BallType.YELLOW];
             const choice = colors[Math.floor(Math.random() * colors.length)];
             handleColorSelect(choice);
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [showColorSelection, currentPlayer, gameState]);

  // AI Foul Decision
  useEffect(() => {
      if (gameState === GameState.PLAYING && currentPlayer === Player.AI && foulDecisionNeeded) {
          const timer = setTimeout(() => {
              if (difficulty === Difficulty.HARD && Math.random() > 0.5) {
                   handleFoulDecision('AGAIN');
              } else {
                   handleFoulDecision('PLAY');
              }
          }, 1500);
          return () => clearTimeout(timer);
      }
  }, [foulDecisionNeeded, currentPlayer, difficulty, gameState]);

  useEffect(() => {
    if (gameState !== GameState.PLAYING || showColorSelection || foulDecisionNeeded || isInputBlocked) return;
    
    // AI Ball Placement Logic
    if (currentPlayer === Player.AI && ballInHand) {
         const timer = setTimeout(() => {
              let placed = false;
              let attempts = 0;
              while (!placed && attempts < 50) {
                  const r = Math.sqrt(Math.random()) * D_RADIUS; 
                  const theta = Math.random() * Math.PI + (Math.PI / 2);
                  const px = BAULK_X + r * Math.cos(theta);
                  const py = CENTER_Y + r * Math.sin(theta);
                  const candidate = { x: px, y: py };
                  const overlap = ballsRef.current.some(b => !b.potted && b.type !== BallType.CUE && vecDist(candidate, b.pos) < BALL_RADIUS * 2);
                  if (!overlap && px <= BAULK_X) {
                      const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
                      if (cueBall) {
                          cueBall.pos = candidate;
                          cueBall.potted = false;
                          cueBall.vel = {x:0,y:0};
                          setBallInHand(false);
                          setBalls([...ballsRef.current]);
                          placed = true;
                          setMessage("AI Placed Ball");
                      }
                  }
                  attempts++;
              }
              if (!placed) {
                   const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
                   if (cueBall) {
                       cueBall.pos = { x: BAULK_X - 20, y: CENTER_Y };
                       cueBall.potted = false;
                       cueBall.vel = {x:0,y:0};
                       setBallInHand(false);
                       setBalls([...ballsRef.current]);
                       setMessage("AI Placed Ball");
                   }
              }
         }, 1500);
         return () => clearTimeout(timer);
    }

    if (currentPlayer === Player.AI && !isMoving && !isShooting && !ballInHand) {
        if (!message.includes("Foul")) setMessage("AI is thinking...");
        const timer = setTimeout(() => {
            const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
            if (cueBall && !cueBall.potted) {
                const shot = calculateAIShot(cueBall, ballsRef.current, TABLE_CONFIG, difficulty, targetState);
                takeShot(shot.aimDir, shot.power);
            }
        }, 1500);
        return () => clearTimeout(timer);
    } else if (currentPlayer !== Player.AI && !isMoving && !ballInHand) {
        if (!message.includes("Foul") && !isInputBlocked) setMessage(`${currentPlayer === Player.ONE ? p1Name : p2Name}'s Turn`);
    } else if (currentPlayer !== Player.AI && ballInHand) {
        setMessage("Place Cue Ball in 'D'");
    }
  }, [currentPlayer, isMoving, gameState, isShooting, ballInHand, targetState, difficulty, showColorSelection, p1Name, p2Name, foulDecisionNeeded, isInputBlocked]);

  const addFloatingText = (text: string, x: number, y: number, color: string, size: number = 14) => {
      floatingTextsRef.current.push({
          id: Date.now() + Math.random(),
          text, x, y, color, life: 1.0, velocity: 1.5, size
      });
  };

  const addPotEffect = (ball: Ball) => {
      visualEffectsRef.current.push({
          id: Date.now() + Math.random(),
          type: 'POT_ANIMATION',
          x: ball.pos.x,
          y: ball.pos.y,
          color: ball.color,
          radius: ball.radius,
          life: 1.0
      });
  };

  const handleColorSelect = (ballType: BallType) => {
      // If client, send nomination
      if (gameMode === GameMode.ONLINE_CLIENT) {
          sendNetworkMessage({ type: 'INPUT_NOMINATE', ball: ballType });
          return;
      }
      
      setTargetState(ballType);
      setShowColorSelection(false);
      setMessage(`Nominated: ${ballType}`);
  };

  const handleFoulDecision = (decision: 'PLAY' | 'AGAIN' | 'FREE') => {
      if (gameMode === GameMode.ONLINE_CLIENT) {
          sendNetworkMessage({ type: 'INPUT_DECISION', decision });
          return;
      }

      setFoulDecisionNeeded(false);
      setFoulNotification(prev => ({ ...prev, active: false }));
      
      if (decision === 'PLAY') {
           // Turn stays with the person it switched to (the non-offender)
           setMessage(`${currentPlayer === Player.ONE ? p1Name : p2Name} chose to Play`);
      } else if (decision === 'AGAIN') {
           // Switch turn BACK to offender
           switchTurn(); 
           setMessage("Pass Back: Opponent Plays Again");
      } else if (decision === 'FREE') {
           setIsFreeBall(true);
           setMessage("Free Ball Nominated");
      }
  };

  const switchTurn = () => {
    currentBreakRef.current = 0;
    setIsFreeBall(false);
    
    // Ensure Spin is reset when turn switches to prevent inheritance
    setSpin({x:0, y:0});

    const redsExist = ballsRef.current.some(b => b.type === BallType.RED && !b.potted);
    if (redsExist) {
        setTargetState('RED');
        setIsClearance(false);
    } else {
        const sorted = ballsRef.current.filter(b => !b.potted && b.type !== BallType.CUE).sort((a,b) => a.value - b.value);
        if (sorted.length > 0) {
            setTargetState(sorted[0].type);
            setIsClearance(true); 
        }
    }
    
    setCurrentPlayer(prev => {
        if (gameMode === GameMode.SINGLE_PLAYER) {
            return prev === Player.ONE ? Player.AI : Player.ONE;
        } else {
            return prev === Player.ONE ? Player.TWO : Player.ONE;
        }
    });
  };

  const updateStatsShot = (player: Player) => {
      if (player === Player.ONE) {
          setP1Stats(s => ({ ...s, shotsPlayed: s.shotsPlayed + 1 }));
      } else {
          setP2Stats(s => ({ ...s, shotsPlayed: s.shotsPlayed + 1 }));
      }
  };

  const takeShot = (dir: Vector2, power: number) => {
    const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
    if (!cueBall) return;

    // Reset Turn Tracker
    turnStatusRef.current = { potted: false, foul: false, firstHitType: null, pottedBall: null, pushShot: false };
    
    // Save current player as "last player" before turn mechanics potentially change it (though they change at END of shot)
    lastPlayerRef.current = currentPlayer;

    updateStatsShot(currentPlayer);

    // --- CHECK FOR PUSH SHOT / TOUCHING BALL VIOLATION ---
    if (touchingBall) {
        const vecToTouching = vecNorm(vecSub(touchingBall.pos, cueBall.pos));
        const dot = vecDot(dir, vecToTouching);
        
        if (dot > 0.05) { 
            turnStatusRef.current.pushShot = true;
            turnStatusRef.current.foul = true;
        } else {
            let isValidTouch = false;
            const tType = touchingBall.type;

            if (isFreeBall) {
                 isValidTouch = true;
            } else if (targetState === 'RED') {
                if (tType === BallType.RED) isValidTouch = true;
            } else if (targetState === 'COLOR') {
                if (tType !== BallType.RED) isValidTouch = true;
            } else {
                if (tType === targetState) isValidTouch = true;
            }

            if (isValidTouch) {
                turnStatusRef.current.firstHitType = tType;
            }
        }
    }

    let finalPower = power;
    let finalDir = dir;
    
    if (currentPlayer !== Player.AI && gameMode === GameMode.SINGLE_PLAYER) {
        setChalkLevel(prev => Math.max(0, prev - 8));
        if (chalkLevel < 15 && Math.random() > 0.5) {
            setMessage("MISCUE! Chalk your cue!");
            finalPower = power * 0.1; 
            const angle = Math.atan2(dir.y, dir.x) + (Math.random() - 0.5);
            finalDir = { x: Math.cos(angle), y: Math.sin(angle) };
        }
    }

    cueBall.vel = vecMult(finalDir, finalPower * POWER_SCALE); 
    setIsMoving(true);
    turnTimerRef.current = 0; // Reset safe-stop timer
    setIsShooting(false);
    trajectoryRef.current = null;
    playCollisionSound(finalPower / 100); 

    // Sync Audio
    if (gameMode === GameMode.ONLINE_HOST) {
        sendNetworkMessage({ type: 'AUDIO_EVENT', sound: 'COLLISION', vol: finalPower/100 });
    }
  };

  const onCollision = useCallback((b1: Ball, b2: Ball, impact: number) => {
      if (!turnStatusRef.current.firstHitType) {
          if (b1.type === BallType.CUE) {
              turnStatusRef.current.firstHitType = b2.type;
          } else if (b2.type === BallType.CUE) {
              turnStatusRef.current.firstHitType = b1.type;
          }
      }
      const now = performance.now();
      if (now - lastSoundTimeRef.current > 40 && impact > 0.1) {
          playCollisionSound(impact);
          lastSoundTimeRef.current = now;
          if (gameMode === GameMode.ONLINE_HOST) {
               sendNetworkMessage({ type: 'AUDIO_EVENT', sound: 'COLLISION', vol: impact });
          }
      }
  }, [gameMode]);

  const handlePot = useCallback((ball: Ball) => {
    playPotSound();
    if (gameMode === GameMode.ONLINE_HOST) sendNetworkMessage({ type: 'AUDIO_EVENT', sound: 'POT' });

    addPotEffect(ball);

    // --- POCKET CAM LOGIC ---
    // Find closest pocket to the potted ball
    const pockets = [
        { x: TABLE_CONFIG.cushionWidth, y: TABLE_CONFIG.cushionWidth }, // TL
        { x: TABLE_WIDTH/2, y: TABLE_CONFIG.cushionWidth - 6 }, // TC
        { x: TABLE_WIDTH - TABLE_CONFIG.cushionWidth, y: TABLE_CONFIG.cushionWidth }, // TR
        { x: TABLE_CONFIG.cushionWidth, y: TABLE_HEIGHT - TABLE_CONFIG.cushionWidth }, // BL
        { x: TABLE_WIDTH/2, y: TABLE_HEIGHT - TABLE_CONFIG.cushionWidth + 6 }, // BC
        { x: TABLE_WIDTH - TABLE_CONFIG.cushionWidth, y: TABLE_HEIGHT - TABLE_CONFIG.cushionWidth }, // BR
    ];
    let closestP = pockets[0];
    let minD = Infinity;
    for (const p of pockets) {
        const d = vecDist(ball.pos, p);
        if (d < minD) { minD = d; closestP = p; }
    }
    setPocketCam({ active: true, ball: ball, pocket: closestP });
    setTimeout(() => setPocketCam(prev => ({ ...prev, active: false })), 2000); // Hide after 2s

    if (ball.type === BallType.CUE) {
      turnStatusRef.current.foul = true;
      ball.potted = true; 
    } else {
      turnStatusRef.current.potted = true;
      turnStatusRef.current.pottedBall = ball;
      addFloatingText(`+${ball.value}`, ball.pos.x, ball.pos.y, '#fbbf24', 24);
    }
  }, [gameMode]);

  const handleTurnEnd = useCallback(() => {
        setSpin({x:0, y:0});

        const { potted, foul, firstHitType, pottedBall, pushShot } = turnStatusRef.current;
        let isFoul = foul;
        let penalty = 4;
        let turnContinues = false;
        let foulMsg = "FOUL";

        let targetVal = 4;
        if (targetState === 'RED' || targetState === 'COLOR') targetVal = 4;
        else targetVal = getBallValue(targetState);

        if (pushShot) {
            isFoul = true;
            foulMsg = "Push Shot (Hit into touching ball)";
            const touchingVal = touchingBall ? getBallValue(touchingBall.type) : 4;
            penalty = Math.max(4, targetVal, touchingVal);
        }
        else if (turnStatusRef.current.foul && !pushShot) { 
             isFoul = true;
             foulMsg = "Cue ball potted";
             const hitVal = firstHitType ? getBallValue(firstHitType) : 4;
             penalty = Math.max(4, targetVal, hitVal);
             
             // Umpire Cleaning Cue Ball Visual
             setIsCleaningCue(true);
             setTimeout(() => setIsCleaningCue(false), 2500);
        }
        else if (!firstHitType) {
            isFoul = true;
            foulMsg = "Missed all balls";
            penalty = Math.max(4, targetVal);
        }
        else if (firstHitType) {
            let validHit = false;
            if (isFreeBall) {
                if (firstHitType === BallType.RED) validHit = true;
                else if (firstHitType !== BallType.CUE) validHit = true; 
            } else {
                if (targetState === 'RED') {
                    if (firstHitType === BallType.RED) validHit = true;
                } else if (targetState === 'COLOR') {
                    if (firstHitType !== BallType.RED && firstHitType !== BallType.CUE) validHit = true;
                } else {
                    if (firstHitType === targetState) validHit = true;
                }
            }
            if (!validHit) {
                isFoul = true;
                const hitVal = getBallValue(firstHitType);
                penalty = Math.max(4, hitVal, targetVal);
                
                if (targetState === 'RED') foulMsg = "Hit Color first";
                else if (targetState === 'COLOR') foulMsg = "Hit Red first";
                else foulMsg = `Hit wrong ball (Hit ${firstHitType})`;
            }
        }

        if (!isFoul && potted && pottedBall) {
            let validPot = false;
            if (isFreeBall) {
                if (pottedBall.type !== BallType.CUE) validPot = true;
            } else {
                if (targetState === 'RED') {
                    if (pottedBall.type === BallType.RED) validPot = true;
                } else if (targetState === 'COLOR') {
                    if (pottedBall.type !== BallType.RED && pottedBall.type !== BallType.CUE) validPot = true;
                } else {
                    if (pottedBall.type === targetState) validPot = true;
                }
            }

            if (!validPot) {
                isFoul = true;
                const potVal = getBallValue(pottedBall.type);
                penalty = Math.max(4, potVal, targetVal);
                if (targetState === 'RED') foulMsg = `Potted ${pottedBall.type}`;
                else if (targetState === 'COLOR') foulMsg = "Potted RED";
                else foulMsg = "Potted wrong color";
            }
        }

        if (isFoul) {
            setFoulNotification({ active: true, message: foulMsg, points: penalty });
            setMessage(`FOUL! ${foulMsg}`);
            
            if (currentPlayer === Player.ONE) setScoreP2(s => s + penalty);
            else setScoreP1(s => s + penalty);
            
            const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
            if (cueBall && cueBall.potted) {
                cueBall.potted = false;
                cueBall.vel = {x:0, y:0};
                cueBall.pos = {x: 140, y: 220};
                setBallInHand(true);
            }
            
            if (pottedBall) {
                if (pottedBall.type !== BallType.RED) {
                     respawnBall(pottedBall);
                } 
            }

            switchTurn();
            
            let snookered = false;
            if (!ballInHand) {
                 let nextTarget: TargetState = 'RED';
                 const redsExist = ballsRef.current.some(b => b.type === BallType.RED && !b.potted);
                 if (!redsExist) {
                     const sorted = ballsRef.current.filter(b => !b.potted && b.type !== BallType.CUE).sort((a,b) => a.value - b.value);
                     if (sorted.length > 0) nextTarget = sorted[0].type;
                 }
                 snookered = checkIsSnookered(ballsRef.current, nextTarget);
            }
            
            setOfferFreeBall(snookered);
            setFoulDecisionNeeded(true); 
            return;
        }

        if (potted && pottedBall) {
            let points = pottedBall.value;
            if (isFreeBall && pottedBall.type !== BallType.RED) points = 1; 

            currentBreakRef.current += points;
            
            if (currentPlayer === Player.ONE) {
                setScoreP1(s => s + points);
                setP1Stats(s => ({ ...s, ballsPotted: s.ballsPotted + 1, highBreak: Math.max(s.highBreak, currentBreakRef.current) }));
            } else {
                setScoreP2(s => s + points);
                setP2Stats(s => ({ ...s, ballsPotted: s.ballsPotted + 1, highBreak: Math.max(s.highBreak, currentBreakRef.current) }));
            }

            const remainingReds = ballsRef.current.filter(b => b.type === BallType.RED && !b.potted).length;
            
            if (isFreeBall) {
                respawnBall(pottedBall); 
                setTargetState('COLOR');
                setShowColorSelection(true); 
                setMessage("Tap a Color to Nominate");
                turnContinues = true;
                setIsFreeBall(false); 
                setIsClearance(false);
            } else if (pottedBall.type === BallType.RED) {
                setTargetState('COLOR');
                setShowColorSelection(true); 
                setMessage("Tap a Color to Nominate");
                turnContinues = true;
                setIsClearance(false);
            } else {
                // Potting a Color
                if (targetState === 'COLOR') {
                    // Standard Red-Color-Red sequence
                    respawnBall(pottedBall);
                    if (remainingReds > 0) {
                        setTargetState('RED');
                        turnContinues = true;
                        setIsClearance(false);
                    } else {
                         // Color after Last Red. Transition to Clearance.
                         setTargetState(BallType.YELLOW);
                         turnContinues = true;
                         setIsClearance(true); 
                    }
                } else {
                     // Clearance Phase or Specific Target
                     if (remainingReds > 0) {
                         // Should technically be respawned if not in clearance mode, just in case state got weird
                         respawnBall(pottedBall);
                         setTargetState('RED');
                         turnContinues = true;
                     } else {
                         // Real Clearance
                         if (pottedBall.type === targetState) {
                             turnContinues = true;
                             const next = ballsRef.current.filter(b => !b.potted && b.type !== BallType.CUE).sort((a,b) => a.value - b.value);
                             if (next.length > 0) setTargetState(next[0].type);
                             else {
                                 setMessage("FRAME OVER");
                                 setGameState(GameState.GAME_OVER);
                                 return;
                             }
                         }
                     }
                }
            }
        }

        if (turnContinues) {
            if (!showColorSelection) {
                setMessage(`${currentPlayer === Player.ONE ? p1Name : p2Name} Break: ${currentBreakRef.current}`);
            }
        } else {
            switchTurn();
        }

  }, [currentPlayer, targetState, p1Name, p2Name, showColorSelection, isFreeBall, ballInHand, touchingBall, isClearance]);

  const respawnBall = (ball: Ball) => {
      // Force fetch ball from current ref to avoid staleness
      const currentBall = ballsRef.current.find(b => b.id === ball.id);
      if (!currentBall) return;
      
      currentBall.potted = false;
      currentBall.vel = {x:0, y:0};
      
      const spots = [
          { type: BallType.BLACK, pos: {x: 720, y: CENTER_Y} }, 
          { type: BallType.PINK, pos: {x: 600, y: CENTER_Y} },
          { type: BallType.BLUE, pos: {x: 400, y: CENTER_Y} },
          { type: BallType.BROWN, pos: {x: BAULK_X, y: CENTER_Y} },
          { type: BallType.GREEN, pos: {x: BAULK_X, y: CENTER_Y - D_RADIUS} },
          { type: BallType.YELLOW, pos: {x: BAULK_X, y: CENTER_Y + D_RADIUS} },
      ];

      let targetSpot = spots.find(s => s.type === currentBall.type);
      if (!targetSpot) return;

      const isOccupied = (pos: Vector2) => ballsRef.current.some(b => !b.potted && b.id !== currentBall.id && vecDist(b.pos, pos) < BALL_RADIUS * 2);

      if (!isOccupied(targetSpot.pos)) {
          currentBall.pos = { ...targetSpot.pos };
      } else {
          let found = false;
          for (const spot of spots) {
              if (!isOccupied(spot.pos)) {
                  currentBall.pos = { ...spot.pos };
                  found = true;
                  break;
              }
          }
          if (!found) {
               currentBall.pos = { x: 730 + BALL_RADIUS * 2.1, y: CENTER_Y };
          }
      }
      setBalls([...ballsRef.current]); 
  };

  const loop = useCallback(() => {
    const now = performance.now();
    let dt = (now - lastTimeRef.current) / 1000;
    lastTimeRef.current = now;
    if (dt > 0.1) dt = 0.1;

    // --- GAME LOOP LOGIC ---
    if (gameMode !== GameMode.ONLINE_CLIENT) {
        // Pausing Physics if foul decision is pending OR input is blocked (welcome sound)
        if (foulDecisionNeeded || (isInputBlocked && !isMoving)) {
             // Still need to send net messages so client knows about foul state
             if (gameMode === GameMode.ONLINE_HOST && foulDecisionNeeded) {
                  // Throttle
                  if (now % 20 < 1) { 
                      sendNetworkMessage({ 
                          type: 'GAME_STATE', 
                          balls: ballsRef.current, 
                          p1: scoreP1, 
                          p2: scoreP2, 
                          msg: message,
                          target: targetState,
                          player: currentPlayer,
                          spin: spin,
                          foul: foulNotification,
                          foulDecisionNeeded: true
                      });
                  }
             }

             render();
             animationFrameId.current = requestAnimationFrame(loop);
             return;
        }

        if (isShooting) {
            // "Pull Back" stroke animation speed - Adjusted to be slower for visibility
            const speed = 15; // Slowed down from 35 for better visual
            stickOffsetRef.current -= speed; 
            if (stickOffsetRef.current <= 0) {
                stickOffsetRef.current = 0;
                const angle = aimAngleRef.current;
                const aimDir = { x: Math.cos(angle), y: Math.sin(angle) };
                takeShot(aimDir, shotPowerRef.current);
            }
            render(); 
            animationFrameId.current = requestAnimationFrame(loop);
            return;
        }

        const wasMoving = movingRef.current;
        
        // --- SAFE STOP FAILSAFE ---
        // If balls have been moving for more than 20 seconds, force stop them.
        // This prevents soft-locks if a ball gets stuck vibrating against a wall/cushion.
        if (wasMoving) {
            turnTimerRef.current += dt;
            if (turnTimerRef.current > 20.0) {
                ballsRef.current.forEach(b => { b.vel = {x:0, y:0}; });
                // Force a render cycle to reflect stopped state
            }
        }

        ballsRef.current = updatePhysics(ballsRef.current, TABLE_CONFIG, spin, handlePot, dt, onCollision);
        const moving = ballsRef.current.some(b => vecLen(b.vel) > 0.05);
        
        visualEffectsRef.current = visualEffectsRef.current.filter(fx => {
            fx.life -= 0.05;
            return fx.life > 0;
        });

        floatingTextsRef.current = floatingTextsRef.current.filter(txt => {
            txt.y -= txt.velocity;
            txt.life -= 0.01; 
            return txt.life > 0;
        });
        
        if (wasMoving && !moving) {
            setIsMoving(false);
            handleTurnEnd();
        }

        if (gameMode === GameMode.ONLINE_HOST) {
            sendNetworkMessage({ 
                type: 'GAME_STATE', 
                balls: ballsRef.current, 
                p1: scoreP1, 
                p2: scoreP2, 
                msg: message,
                target: targetState,
                player: currentPlayer,
                spin: spin,
                foul: foulNotification,
                foulDecisionNeeded: foulDecisionNeeded
            });
            
            if (currentPlayer === Player.ONE && !isMoving) {
                 sendNetworkMessage({ type: 'INPUT_AIM', angle: aimAngle, power: dragPower, spin });
            }
        }
    } else {
        // Client Logic
        // Send aim data constantly if it is our turn, so the host sees the cursor moving
        if (currentPlayer === Player.TWO && !isMoving && !isShooting) {
             const nowT = Date.now();
             // Throttle network aim updates slightly
             if (nowT - lastAimSendTimeRef.current > 30) {
                 sendNetworkMessage({ type: 'INPUT_AIM', angle: aimAngleRef.current, power: dragPower, spin });
                 lastAimSendTimeRef.current = nowT;
             }
        }
    }

    if (trajectoryRef.current) {
        if (isDragging) {
             trajectoryRef.current.opacity = 1.0;
        } else {
             trajectoryRef.current.opacity = 0.6 + Math.sin(Date.now() / 300) * 0.2;
        }
    }

    render();
    animationFrameId.current = requestAnimationFrame(loop);
  }, [handlePot, spin, isShooting, isDragging, currentPlayer, onCollision, handleTurnEnd, gameMode, scoreP1, scoreP2, message, targetState, foulNotification, foulDecisionNeeded, isInputBlocked]); 

  useEffect(() => {
    lastTimeRef.current = performance.now();
    animationFrameId.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId.current);
  }, [loop]);

  const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameMode === GameMode.ONLINE_HOST && currentPlayer === Player.TWO) return;
    if (gameMode === GameMode.ONLINE_CLIENT && currentPlayer === Player.ONE) return;

    if (gameState !== GameState.PLAYING || currentPlayer === Player.AI || isMoving || isShooting || showStatsModal || foulDecisionNeeded || isInputBlocked) return;
    initAudio();
    const pos = getMousePos(e);

    if (showColorSelection) {
        const clickedBall = ballsRef.current.find(b => 
            !b.potted && 
            b.type !== BallType.CUE && 
            b.type !== BallType.RED && 
            vecDist(pos, b.pos) < b.radius * 2.0 
        );
        
        if (clickedBall) {
            handleColorSelect(clickedBall.type);
        }
        return; 
    }

    if (ballInHand) {
        const dist = Math.sqrt(Math.pow(pos.x - BAULK_X, 2) + Math.pow(pos.y - CENTER_Y, 2));
        if (pos.x <= BAULK_X + 2 && dist <= D_RADIUS + 2) {
             const isOverlapping = ballsRef.current.some(b => !b.potted && b.type !== BallType.CUE && vecDist(pos, b.pos) < BALL_RADIUS * 2);
             if (isOverlapping) {
                 setMessage("Invalid Position (Overlap)");
                 return;
             }

             const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
             if (cueBall) {
                 cueBall.pos = pos;
                 cueBall.potted = false; 
                 cueBall.vel = {x: 0, y: 0};
                 setBalls([...ballsRef.current]);
                 setBallInHand(false);
                 setMessage("Ball Placed");
                 render(); 
             }
        }
        return;
    }

    // Mobile Aiming Logic
    if ('touches' in e) {
        return; 
    }

    setIsDragging(true);
    dragStartPosRef.current = pos;
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getMousePos(e);
    cursorPosRef.current = pos;
    
    if (gameMode === GameMode.ONLINE_HOST && currentPlayer === Player.TWO) return;
    if (gameMode === GameMode.ONLINE_CLIENT && currentPlayer === Player.ONE) return;

    if (gameState !== GameState.PLAYING || currentPlayer === Player.AI || isMoving || isShooting || showStatsModal || foulDecisionNeeded || isInputBlocked) {
        return;
    }
    
    if (ballInHand || showColorSelection) {
        return; 
    }

    const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
    if (!cueBall) return;

    if (!isDragging) {
        const angle = Math.atan2(pos.y - cueBall.pos.y, pos.x - cueBall.pos.x);
        setAimAngle(angle);
        aimAngleRef.current = angle; 
        
        const aimDir = { x: Math.cos(angle), y: Math.sin(angle) };
        trajectoryRef.current = calculatePreciseTrajectory(cueBall.pos, aimDir, ballsRef.current, TABLE_CONFIG);
    } else {
        if (dragStartPosRef.current && !('touches' in e)) {
            const dragVec = vecSub(pos, dragStartPosRef.current);
            const angle = aimAngleRef.current;
            const aimDir = { x: Math.cos(angle), y: Math.sin(angle) };
            
            const pullVal = -vecDot(dragVec, aimDir);
            const rawDist = vecDist(pos, dragStartPosRef.current);
            
            const power = Math.max(0, Math.min(Math.max(pullVal, rawDist), 150));
            setDragPower(power);
            dragPowerRef.current = power; 
            
            if (power > 5) {
                if (!trajectoryRef.current) {
                    trajectoryRef.current = calculatePreciseTrajectory(cueBall.pos, aimDir, ballsRef.current, TABLE_CONFIG);
                }
                trajectoryRef.current.opacity = 1;
            }
        }
    }
  };

  const handleMouseUp = () => {
    if (gameMode === GameMode.ONLINE_HOST && currentPlayer === Player.TWO) return;
    if (gameMode === GameMode.ONLINE_CLIENT && currentPlayer === Player.ONE) return;

    if (ballInHand || showColorSelection || foulDecisionNeeded || isInputBlocked) return;
    if (!isDragging) return;
    setIsDragging(false);
    
    if (dragPower > 5) {
        if (gameMode === GameMode.ONLINE_CLIENT) {
             sendNetworkMessage({ type: 'INPUT_SHOT', angle: aimAngleRef.current, power: dragPower, spin });
        } else {
             shotPowerRef.current = dragPower;
             stickOffsetRef.current = 20 + dragPower * 3.0; 
             setIsShooting(true);
        }
    }
    setDragPower(0);
    dragPowerRef.current = 0;
    dragStartPosRef.current = null;
  };

  const handleSliderStart = (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isInputBlocked) return;
      isSliderDraggingRef.current = true;
      setIsDragging(true);
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      sliderStartYRef.current = clientY;
  };

  const handleSliderMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isSliderDraggingRef.current || isInputBlocked) return;
      e.preventDefault();
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const deltaY = clientY - sliderStartYRef.current;
      const power = Math.min(Math.max(deltaY * 0.5, 0), 100); 
      setDragPower(power);
      dragPowerRef.current = power; 
  };

  const handleSliderEnd = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isSliderDraggingRef.current || isInputBlocked) return;
      isSliderDraggingRef.current = false;
      handleMouseUp(); 
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = TABLE_WIDTH;
    const H = TABLE_HEIGHT;
    const C = TABLE_CONFIG.cushionWidth; 
    const angle = aimAngleRef.current; 
    const pR = TABLE_CONFIG.pocketRadius;

    const drawTable = () => {
        const cornerRadius = 32;
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cornerRadius, 0);
        ctx.lineTo(W - cornerRadius, 0);
        ctx.arcTo(W, 0, W, cornerRadius, cornerRadius);
        ctx.lineTo(W, H - cornerRadius);
        ctx.arcTo(W, H, W - cornerRadius, H, cornerRadius);
        ctx.lineTo(cornerRadius, H);
        ctx.arcTo(0, H, 0, H - cornerRadius, cornerRadius);
        ctx.lineTo(0, cornerRadius);
        ctx.arcTo(0, 0, cornerRadius, 0, cornerRadius);
        ctx.closePath();
        ctx.clip();

        const woodPat = ctx.createPattern(woodPattern, 'repeat');
        ctx.fillStyle = woodPat || '#5D4037';
        ctx.fillRect(0, 0, W, H);
        
        const pInset = 4;
        const pocketLocs = [
            {x: C-pInset, y: C-pInset}, 
            {x: W/2, y: C-8},           
            {x: W-(C-pInset), y: C-pInset}, 
            {x: C-pInset, y: H-(C-pInset)}, 
            {x: W/2, y: H-(C-8)},           
            {x: W-(C-pInset), y: H-(C-pInset)}, 
        ];

        const drawCut = (type: string, p: Vector2) => {
            ctx.save();
            ctx.fillStyle = '#8D6E63'; 
            ctx.beginPath();
            
            if (type === 'CORNER_TL') {
                ctx.moveTo(0, C); ctx.lineTo(C, C); ctx.lineTo(C, 0); ctx.lineTo(0, 0);
            } else if (type === 'CORNER_TR') {
                ctx.moveTo(W, C); ctx.lineTo(W-C, C); ctx.lineTo(W-C, 0); ctx.lineTo(W, 0);
            } else if (type === 'CORNER_BL') {
                ctx.moveTo(0, H-C); ctx.lineTo(C, H-C); ctx.lineTo(C, H); ctx.lineTo(0, H);
            } else if (type === 'CORNER_BR') {
                ctx.moveTo(W, H-C); ctx.lineTo(W-C, H-C); ctx.lineTo(W-C, H); ctx.lineTo(W, H);
            } else if (type === 'CENTER_TOP') {
                ctx.moveTo(W/2 - 25, C); 
                ctx.bezierCurveTo(W/2 - 25, C-15, W/2 - 15, 0, W/2 - 15, 0);
                ctx.lineTo(W/2 + 15, 0);
                ctx.bezierCurveTo(W/2 + 15, 0, W/2 + 25, C-15, W/2 + 25, C);
            } else if (type === 'CENTER_BOT') {
                ctx.moveTo(W/2 - 25, H-C); 
                ctx.bezierCurveTo(W/2 - 25, H-C+15, W/2 - 15, H, W/2 - 15, H);
                ctx.lineTo(W/2 + 15, H);
                ctx.bezierCurveTo(W/2 + 15, H, W/2 + 25, H-C+15, W/2 + 25, H-C);
            }
            ctx.fill();
            ctx.restore();
            
            ctx.save();
            const g = ctx.createLinearGradient(p.x - pR, p.y - pR, p.x + pR, p.y + pR);
            g.addColorStop(0, '#FCD34D'); g.addColorStop(0.3, '#F59E0B'); g.addColorStop(0.5, '#B45309'); g.addColorStop(0.7, '#F59E0B'); g.addColorStop(1, '#FCD34D');
            
            ctx.strokeStyle = g;
            ctx.lineWidth = 6;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            
            if (type === 'CORNER_TL') ctx.arc(p.x, p.y, pR+3, Math.PI, Math.PI*1.5);
            else if (type === 'CORNER_TR') ctx.arc(p.x, p.y, pR+3, Math.PI*1.5, Math.PI*2);
            else if (type === 'CORNER_BL') ctx.arc(p.x, p.y, pR+3, Math.PI*0.5, Math.PI);
            else if (type === 'CORNER_BR') ctx.arc(p.x, p.y, pR+3, 0, Math.PI*0.5);
            else if (type === 'CENTER_TOP') ctx.arc(p.x, p.y - 5, pR+3, Math.PI, 0); 
            else if (type === 'CENTER_BOT') ctx.arc(p.x, p.y + 5, pR+3, 0, Math.PI); 
            
            ctx.stroke();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
            ctx.restore();
        };

        drawCut('CORNER_TL', pocketLocs[0]);
        drawCut('CENTER_TOP', pocketLocs[1]);
        drawCut('CORNER_TR', pocketLocs[2]);
        drawCut('CORNER_BL', pocketLocs[3]);
        drawCut('CENTER_BOT', pocketLocs[4]);
        drawCut('CORNER_BR', pocketLocs[5]);

        const nailYTop = 13;
        const nailYBot = H - 13;
        
        const drawNail = (x: number, y: number) => {
            const r = 3.5;
            const g = ctx.createRadialGradient(x-1, y-1, 0, x, y, r);
            g.addColorStop(0, '#FFFBEB'); g.addColorStop(0.4, '#F59E0B'); g.addColorStop(1, '#92400E'); 
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fillStyle = g; ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x-1, y-1, 1, 0, Math.PI*2); ctx.fill();
        };

        const pLeft = C;
        const pMid = W / 2;
        const pRight = W - C;
        
        [0.25, 0.5, 0.75].forEach(t => {
            drawNail(pLeft + (pMid - pLeft) * t, nailYTop);
            drawNail(pMid + (pRight - pMid) * t, nailYTop);
            drawNail(pLeft + (pMid - pLeft) * t, nailYBot);
            drawNail(pMid + (pRight - pMid) * t, nailYBot);
        });

        ctx.save();
        const goldGrad = ctx.createLinearGradient(0, -10, 0, 10); 
        goldGrad.addColorStop(0, '#FDE68A'); goldGrad.addColorStop(0.3, '#D97706'); goldGrad.addColorStop(0.5, '#FFFBEB'); goldGrad.addColorStop(0.7, '#D97706'); goldGrad.addColorStop(1, '#92400E'); 

        ctx.font = '900 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.save();
        ctx.translate(13, H/2);
        ctx.rotate(-Math.PI/2);
        ctx.fillStyle = goldGrad;
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
        ctx.fillText("AZ Snooker Master", 0, 0);
        ctx.restore();

        ctx.save();
        ctx.translate(W - 13, H/2);
        ctx.rotate(Math.PI/2);
        ctx.fillStyle = goldGrad;
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
        ctx.fillText("AZ Snooker Master", 0, 0);
        ctx.restore();
        
        ctx.restore();
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(C, C, W-2*C, H-2*C);
        ctx.clip();

        const clothGrad = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, W*0.8);
        clothGrad.addColorStop(0, '#10b981');  
        clothGrad.addColorStop(1, '#065f46');   
        ctx.fillStyle = clothGrad;
        ctx.fillRect(C, C, W-2*C, H-2*C);
        
        const feltPat = ctx.createPattern(feltPattern, 'repeat');
        if (feltPat) { ctx.fillStyle = feltPat; ctx.globalAlpha = 0.15; ctx.fillRect(C, C, W-2*C, H-2*C); ctx.globalAlpha = 1.0; }

        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeRect(C - 5, C - 5, W - 2*C + 10, H - 2*C + 10);
        ctx.shadowColor = 'transparent'; 
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(BAULK_X, C); ctx.lineTo(BAULK_X, H-C); ctx.stroke();
        ctx.beginPath(); ctx.arc(BAULK_X, CENTER_Y, D_RADIUS, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
        
        const drawSpot = (x: number, y: number) => { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill(); };
        drawSpot(BAULK_X, CENTER_Y); drawSpot(400, CENTER_Y); drawSpot(600, CENTER_Y); drawSpot(720, CENTER_Y); 
        
        if (ballInHand) {
             ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(BAULK_X, CENTER_Y, D_RADIUS, Math.PI*0.5, Math.PI*1.5); ctx.fill();
             ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText("PLACE CUE BALL", BAULK_X - 50, CENTER_Y - 20);
        }

        ctx.restore(); 

        const kn = 18; // Knuckle offset for pockets
        const drawCushion3D = (p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2, type: string) => {
            const grad = ctx.createLinearGradient(p1.x, p1.y, (type==='LEFT'||type==='RIGHT') ? p2.x : p1.x, (type==='TOP'||type==='BOTTOM') ? p2.y : p1.y);
            grad.addColorStop(0, '#065f46'); grad.addColorStop(1, '#022c22'); 
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y);
            if (type === 'TOP' || type === 'BOTTOM') { ctx.quadraticCurveTo(p1.x, p2.y, p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.quadraticCurveTo(p4.x, p3.y, p4.x, p4.y); } else { ctx.quadraticCurveTo(p2.x, p1.y, p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.quadraticCurveTo(p3.x, p4.y, p4.x, p4.y); }
            ctx.closePath(); ctx.fillStyle = grad; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
        };

        drawCushion3D({x:26,y:26}, {x:C+kn, y:C}, {x:W/2-kn/2, y:C}, {x:W/2,y:26}, 'TOP'); 
        drawCushion3D({x:W/2,y:26}, {x:W/2+kn/2, y:C}, {x:W-C-kn, y:C}, {x:W-26,y:26}, 'TOP'); 
        drawCushion3D({x:W-26,y:H-26}, {x:W-C-kn, y:H-C}, {x:W/2+kn/2, y:H-C}, {x:W/2,y:H-26}, 'BOTTOM'); 
        drawCushion3D({x:W/2,y:H-26}, {x:W/2-kn/2, y:H-C}, {x:C+kn, y:H-C}, {x:26,y:H-26}, 'BOTTOM'); 
        drawCushion3D({x:26,y:H-26}, {x:C, y:H-C-kn}, {x:C, y:C+kn}, {x:26,y:26}, 'LEFT'); 
        drawCushion3D({x:W-26,y:26}, {x:W-C, y:C+kn}, {x:W-C, y:H-C-kn}, {x:W-26,y:H-26}, 'RIGHT'); 

        pocketLocs.forEach(p => { const g = ctx.createRadialGradient(p.x, p.y, pR*0.5, p.x, p.y, pR); g.addColorStop(0, '#000'); g.addColorStop(1, '#111'); ctx.beginPath(); ctx.arc(p.x, p.y, pR, 0, Math.PI*2); ctx.fillStyle = g; ctx.fill(); });

        ctx.restore(); 
    };
    
    drawTable();

    visualEffectsRef.current.forEach(fx => {
         if (fx.type === 'POT_ANIMATION') {
             ctx.save(); ctx.globalAlpha = fx.life; ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * fx.life, 0, Math.PI*2); ctx.fillStyle = fx.color; ctx.fill();
             ctx.beginPath(); ctx.arc(fx.x - fx.radius*0.3, fx.y - fx.radius*0.3, fx.radius*0.4*fx.life, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill(); ctx.restore();
         }
    });

    ballsRef.current.forEach(ball => {
      if (ball.potted) return;
      
      if (showColorSelection && ball.type !== BallType.RED && ball.type !== BallType.CUE) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(ball.pos.x, ball.pos.y, ball.radius * 1.8, 0, Math.PI*2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + Math.sin(Date.now() / 150) * 0.4})`;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
      }

      ctx.beginPath(); 
      const toCenter = vecSub({x: W/2, y: H/2}, ball.pos);
      const dir = vecNorm(toCenter);
      const shadowOffset = vecMult(dir, -2); 
      ctx.arc(ball.pos.x + shadowOffset.x, ball.pos.y + shadowOffset.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();

      ctx.beginPath(); ctx.arc(ball.pos.x, ball.pos.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = ball.color; ctx.fill();
      
      ctx.beginPath(); ctx.arc(ball.pos.x - 2, ball.pos.y - 2, 2, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();

      if (ball.type === BallType.CUE && (spin.x !== 0 || spin.y !== 0)) {
           ctx.fillStyle = 'rgba(220, 38, 38, 0.8)';
           const spinX = ball.pos.x + (spin.x * ball.radius * 0.6);
           const spinY = ball.pos.y - (spin.y * ball.radius * 0.6);
           ctx.beginPath(); ctx.arc(spinX, spinY, 3, 0, Math.PI*2); ctx.fill();
      }
    });

    floatingTextsRef.current.forEach(txt => {
        ctx.save(); ctx.globalAlpha = txt.life; ctx.fillStyle = txt.color; ctx.font = `bold ${txt.size}px monospace`; ctx.textAlign = 'center'; ctx.shadowColor = 'black'; ctx.shadowBlur = 4; ctx.fillText(txt.text, txt.x, txt.y); ctx.restore();
    });

    const showGuide = 
        (gameMode === GameMode.SINGLE_PLAYER || gameMode === GameMode.TWO_PLAYER) ||
        (gameMode === GameMode.ONLINE_HOST && currentPlayer === Player.ONE) ||
        (gameMode === GameMode.ONLINE_CLIENT && currentPlayer === Player.TWO);

    if (trajectoryRef.current && (isDragging || !isMoving) && !showStatsModal && !ballInHand && !showColorSelection && !foulDecisionNeeded && showGuide && !isInputBlocked) {
         const t = trajectoryRef.current;
         ctx.beginPath();
         t.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
         ctx.strokeStyle = `rgba(255,255,255,${t.opacity * 0.4})`;
         ctx.lineWidth = 3; ctx.setLineDash([6,6]); ctx.stroke(); ctx.setLineDash([]);
         if (t.ghostBall) {
             ctx.beginPath(); ctx.arc(t.ghostBall.x, t.ghostBall.y, BALL_RADIUS, 0, Math.PI*2); ctx.strokeStyle = `rgba(255,255,255,${t.opacity * 0.5})`; ctx.lineWidth = 1; ctx.stroke();
         }
    }

    if (currentPlayer !== Player.AI && gameState === GameState.PLAYING && (!isMoving || isShooting) && !showStatsModal && !ballInHand && !showColorSelection && !foulDecisionNeeded && !isInputBlocked) {
        const cueBall = ballsRef.current.find(b => b.type === BallType.CUE);
        if (cueBall && !cueBall.potted) {
            ctx.save();
            ctx.translate(cueBall.pos.x, cueBall.pos.y);
            ctx.rotate(angle); 
            
            let offset = 18; 
            if (isShooting) {
                offset = stickOffsetRef.current;
            } else if (isDragging) {
                offset = 18 + dragPowerRef.current * 3.0; 
            }
            ctx.translate(-offset, 0); 
            const stickLen = 600; const tipW = 4; const buttW = 10; 
            
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-stickLen, 12); ctx.lineTo(-stickLen, -5); ctx.lineTo(0, -5); ctx.fill();

            const woodGrad = ctx.createLinearGradient(-stickLen, 0, 0, 0);
            woodGrad.addColorStop(0, '#3E2723'); woodGrad.addColorStop(0.5, '#5D4037'); woodGrad.addColorStop(1, '#D7CCC8');
            ctx.fillStyle = woodGrad; ctx.beginPath(); ctx.moveTo(0, -tipW/2); ctx.lineTo(-stickLen, -buttW/2); ctx.lineTo(-stickLen, buttW/2); ctx.lineTo(0, tipW/2); ctx.fill();
            
            ctx.fillStyle = '#212121'; ctx.beginPath(); ctx.moveTo(-stickLen + 140, 0); ctx.lineTo(-stickLen, -buttW/2); ctx.lineTo(-stickLen, buttW/2); ctx.fill();
            ctx.fillStyle = '#facc15'; ctx.fillRect(-6, -tipW/2, 6, tipW);
            ctx.fillStyle = '#0284c7'; ctx.fillRect(-2, -tipW/2, 2, tipW); 

            ctx.restore();
        }
    }

  }, [isDragging, dragPower, gameState, currentPlayer, isMoving, isShooting, feltPattern, woodPattern, showStatsModal, ballInHand, spin, showColorSelection, foulDecisionNeeded, gameMode, isInputBlocked]);

  if (gameState === GameState.WELCOME) {
    return (
        <div className="fixed inset-0 w-full h-full bg-slate-900 text-white flex flex-col items-center justify-center overflow-hidden touch-none">
            <div className="absolute inset-0 bg-cover bg-center z-0" style={{ backgroundImage: 'radial-gradient(circle at 50% 30%, #1e293b 0%, #0f172a 100%)' }}></div>
            <div className="absolute inset-0 opacity-30 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] z-0"></div>
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-emerald-900/20 to-black/80 z-0"></div>
            <div className="absolute top-[-50%] left-[-20%] w-[140%] h-[100%] bg-emerald-500/10 blur-[100px] rounded-full z-0"></div>

            <div className="relative z-10 flex flex-col items-center gap-4 md:gap-6 animate-in fade-in zoom-in duration-700 p-4 w-full max-w-4xl">
                <div className="flex flex-col items-center gap-2 text-center">
                    <span className="text-emerald-400 font-bold tracking-[0.3em] md:tracking-[0.5em] text-[10px] md:text-xs uppercase drop-shadow-md">The Ultimate Simulation</span>
                    <h1 className="text-4xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-yellow-200 via-yellow-500 to-yellow-700 drop-shadow-xl filter" style={{ textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                        AZ SNOOKER
                    </h1>
                    <h2 className="text-2xl md:text-5xl font-light text-slate-300 tracking-widest uppercase">Master</h2>
                </div>
                <div className="w-16 md:w-24 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent my-2 md:my-4"></div>
                <button 
                    onClick={() => { initAudio(); setGameState(GameState.MENU); }}
                    className="group relative px-6 py-3 md:px-10 md:py-4 bg-transparent overflow-hidden rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
                >
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-emerald-600 to-cyan-700 opacity-80 group-hover:opacity-100 transition-opacity"></div>
                    <div className="absolute inset-0 w-full h-full bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.3)_50%,transparent_75%)] bg-[length:250%_250%] animate-[shimmer_2s_infinite]"></div>
                    <span className="relative text-sm md:text-xl font-bold text-white tracking-widest uppercase flex items-center gap-3">
                         Play Now <span className="text-lg md:text-2xl group-hover:translate-x-1 transition-transform">➝</span>
                    </span>
                </button>
            </div>
            <div className="absolute bottom-4 md:bottom-6 text-slate-500 text-[8px] md:text-[10px] tracking-widest uppercase font-semibold">Press Start to enter the arena</div>
        </div>
    );
  }

  const renderGameOverModal = () => (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in zoom-in p-4">
        <div className="bg-slate-900 p-6 md:p-10 rounded-2xl border-2 border-emerald-500 shadow-2xl text-center flex flex-col gap-6 max-w-md w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 via-cyan-500 to-emerald-400 animate-pulse"></div>
            <h2 className="text-3xl md:text-4xl font-black text-white uppercase tracking-tighter drop-shadow-xl">Frame Over</h2>
            <div className="flex flex-col gap-2 py-4">
                <div className="text-slate-400 text-sm font-bold uppercase tracking-widest">Winner</div>
                <div className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-amber-500 drop-shadow-sm">
                    {scoreP1 > scoreP2 ? p1Name : (scoreP2 > scoreP1 ? p2Name : "Draw")}
                </div>
                <div className="text-slate-500 font-mono text-xl mt-2">{scoreP1} - {scoreP2}</div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-2">
                 <button onClick={() => {
                     setBalls(setupBalls(TABLE_CONFIG));
                     setScoreP1(0); setScoreP2(0); currentBreakRef.current = 0; setGameState(GameState.PLAYING); setMessage("New Frame Started");
                     hasPlayedWelcome.current = false;
                 }} className="py-3 md:py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase tracking-widest shadow-lg transition-transform hover:scale-105 text-xs md:text-sm">Play Again</button>
                 <button onClick={() => { setGameState(GameState.MENU); }} className="py-3 md:py-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold uppercase tracking-widest shadow-lg transition-transform hover:scale-105 text-xs md:text-sm">Main Menu</button>
            </div>
        </div>
    </div>
  );

  const renderStatsModal = () => (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in zoom-in p-2">
        <div className="bg-slate-900 p-4 md:p-8 rounded-2xl border-2 border-emerald-500 shadow-2xl flex flex-col gap-4 md:gap-6 max-w-2xl w-full relative">
            <button onClick={() => setShowStatsModal(false)} className="absolute top-2 right-2 md:top-4 md:right-4 text-slate-500 hover:text-white font-bold p-2">X</button>
            <h2 className="text-2xl md:text-3xl font-black text-center text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500 uppercase tracking-tighter">Statistics</h2>
            <div className="grid grid-cols-3 gap-2 md:gap-4 text-center">
                <div className="flex flex-col gap-2 md:gap-4">
                    <div className="text-sm md:text-xl font-bold text-emerald-400 truncate">{p1Name}</div>
                    <div className="flex flex-col gap-1 md:gap-2 text-xs md:text-sm text-slate-300">
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Frames</span> <span>{p1Stats.framesWon}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Best</span> <span>{p1Stats.highBreak}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Shots</span> <span>{p1Stats.shotsPlayed}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Pots</span> <span>{p1Stats.ballsPotted}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Acc</span> <span>{p1Stats.shotsPlayed > 0 ? Math.round((p1Stats.ballsPotted / p1Stats.shotsPlayed) * 100) : 0}%</span></div>
                    </div>
                </div>
                <div className="flex flex-col justify-center items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                     <div className="h-full w-px bg-slate-700"></div>
                </div>
                <div className="flex flex-col gap-2 md:gap-4">
                    <div className="text-sm md:text-xl font-bold text-blue-400 truncate">{gameMode === GameMode.SINGLE_PLAYER ? 'AI Opponent' : p2Name}</div>
                    <div className="flex flex-col gap-1 md:gap-2 text-xs md:text-sm text-slate-300">
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Frames</span> <span>{p2Stats.framesWon}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Best</span> <span>{p2Stats.highBreak}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Shots</span> <span>{p2Stats.shotsPlayed}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Pots</span> <span>{p2Stats.ballsPotted}</span></div>
                        <div className="bg-slate-800 p-1 md:p-2 rounded flex justify-between"><span>Acc</span> <span>{p2Stats.shotsPlayed > 0 ? Math.round((p2Stats.ballsPotted / p2Stats.shotsPlayed) * 100) : 0}%</span></div>
                    </div>
                </div>
            </div>
            <div className="flex justify-center mt-2 md:mt-4">
                <button onClick={() => {
                     setP1Stats(DEFAULT_STATS);
                     setP2Stats(DEFAULT_STATS);
                }} className="px-4 py-2 bg-red-900/20 hover:bg-red-900/50 text-red-400 hover:text-red-200 text-xs font-bold uppercase tracking-widest rounded border border-red-900/50 transition-colors">Reset Stats</button>
            </div>
        </div>
    </div>
  );

  if (onlineMenu !== 'NONE') {
      return (
          <div className="fixed inset-0 w-full h-full bg-slate-900 text-white flex flex-col items-center justify-center p-4">
               <h1 className="text-2xl md:text-3xl font-extrabold mb-4 md:mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 drop-shadow-lg">Online Multiplayer</h1>
               {onlineMenu === 'WAITING' ? (
                   <div className="flex flex-col items-center gap-6 animate-pulse w-full max-w-sm">
                       <div className="text-xl font-bold text-emerald-400">Room Created!</div>
                       <div className="bg-black/50 p-4 rounded-lg border border-slate-600 text-center w-full">
                           <div className="text-xs text-slate-500 uppercase font-bold mb-1">Share Code</div>
                           <div className="text-xl md:text-2xl font-mono text-white tracking-widest select-all">{myPeerId}</div>
                       </div>
                       <div className="text-sm text-slate-400">{connStatus}</div>
                       <button onClick={() => setOnlineMenu('HOST')} className="mt-4 text-red-400 text-sm font-bold hover:underline">Cancel</button>
                   </div>
               ) : (
                   <div className="flex flex-col gap-4 w-full max-w-sm">
                        {onlineMenu === 'JOIN' ? (
                            <div className="flex flex-col gap-4">
                                <label className="text-xs uppercase font-bold text-slate-500">Enter Room Code</label>
                                <input 
                                    type="text" 
                                    value={targetPeerId}
                                    onChange={(e) => setTargetPeerId(e.target.value)}
                                    placeholder="Paste ID here..."
                                    className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none font-mono text-center"
                                />
                                <button onClick={() => connectToPeer(targetPeerId)} className="py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-white uppercase tracking-widest">Connect</button>
                                <button onClick={() => setOnlineMenu('HOST')} className="text-xs text-slate-500 font-bold hover:text-white mt-2 text-center">Back</button>
                            </div>
                        ) : (
                            <>
                                <button onClick={() => initializePeer('HOST')} className="py-3 md:py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold text-white uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 text-sm md:text-base">
                                    <span>Create Room</span>
                                </button>
                                <button onClick={() => {
                                    initializePeer('CLIENT');
                                    setOnlineMenu('JOIN');
                                }} className="py-3 md:py-4 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold text-white uppercase tracking-widest shadow-lg text-sm md:text-base">
                                    Join Room
                                </button>
                                <button onClick={() => setOnlineMenu('NONE')} className="mt-4 text-sm text-slate-500 font-bold hover:text-white uppercase tracking-widest">Back to Menu</button>
                            </>
                        )}
                   </div>
               )}
          </div>
      );
  }

  if (gameState === GameState.MENU) {
      return (
          <div className="fixed inset-0 w-full h-full bg-slate-900 text-white flex flex-col items-center justify-center overflow-hidden touch-none p-4">
              <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, #10b981 0%, #0f172a 70%)'}}></div>
              {showStatsModal && renderStatsModal()}
              <h1 className="text-3xl md:text-4xl font-extrabold mb-4 md:mb-6 text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500 z-10 drop-shadow-lg">Select Mode</h1>
              <div className="flex flex-col gap-4 w-full max-w-md z-10">
                  <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Player 1 Name</label>
                            <input type="text" value={p1Name} onChange={(e) => setP1Name(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none font-semibold" maxLength={10} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{gameMode === GameMode.SINGLE_PLAYER ? 'AI Opponent' : 'Player 2 Name'}</label>
                            <input 
                                type="text" 
                                value={p2Name} 
                                onChange={(e) => setP2Name(e.target.value)} 
                                disabled={gameMode === GameMode.SINGLE_PLAYER}
                                className={`bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none font-semibold ${gameMode === GameMode.SINGLE_PLAYER ? 'opacity-50 cursor-not-allowed' : ''}`}
                                maxLength={10} 
                            />
                        </div>
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                      <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Game Mode</label>
                      <div className="grid grid-cols-3 gap-2">
                          <button 
                              onClick={() => setGameMode(GameMode.SINGLE_PLAYER)}
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${gameMode === GameMode.SINGLE_PLAYER ? 'bg-emerald-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Vs AI
                          </button>
                          <button 
                              onClick={() => setGameMode(GameMode.TWO_PLAYER)}
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${gameMode === GameMode.TWO_PLAYER ? 'bg-emerald-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Local 2P
                          </button>
                          <button 
                              onClick={() => setOnlineMenu('HOST')} // Go to Online Submenu
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Online
                          </button>
                      </div>
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                      <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Difficulty</label>
                      <div className="grid grid-cols-3 gap-2">
                          <button 
                              onClick={() => setDifficulty(Difficulty.EASY)}
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${difficulty === Difficulty.EASY ? 'bg-green-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Easy
                          </button>
                          <button 
                              onClick={() => setDifficulty(Difficulty.MEDIUM)}
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${difficulty === Difficulty.MEDIUM ? 'bg-yellow-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Medium
                          </button>
                          <button 
                              onClick={() => setDifficulty(Difficulty.HARD)}
                              className={`py-3 rounded-lg text-xs md:text-sm font-bold uppercase transition-all ${difficulty === Difficulty.HARD ? 'bg-red-600 text-white shadow-lg scale-105' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                          >
                              Pro
                          </button>
                      </div>
                  </div>
                  <div className="mt-4 flex gap-4">
                      <button 
                          onClick={() => {
                              initAudio();
                              setBalls(setupBalls(TABLE_CONFIG));
                              setScoreP1(0); setScoreP2(0);
                              currentBreakRef.current = 0;
                              setGameState(GameState.PLAYING);
                              setCurrentPlayer(Player.ONE);
                              setMessage("New Frame Started");
                          }}
                          className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-black text-white uppercase tracking-widest shadow-xl transition-transform hover:scale-105 flex items-center justify-center gap-2"
                      >
                          <span>Start Match</span>
                      </button>
                  </div>
                  <div className="flex justify-center mt-2">
                       <button onClick={() => setShowStatsModal(true)} className="text-xs text-slate-500 uppercase font-bold hover:text-white tracking-widest">View Stats</button>
                  </div>
              </div>
          </div>
      );
  }

  // --- Main Render Container ---
  return (
    // Main Container: Full viewport height, no scroll
    <div ref={containerRef} className="fixed inset-0 w-full h-full bg-slate-950 flex flex-col overflow-hidden touch-none select-none">
        
        {/* Game Over Modal ... */}
        {gameState === GameState.GAME_OVER && renderGameOverModal()}

        {/* TOP BAR: SCORES */}
        <div className="flex-none w-full flex justify-between items-center bg-slate-900 p-2 border-b border-slate-800 shadow-md z-20 relative">
             {/* Player 1 */}
             <div className={`flex flex-col items-start px-2 py-1 rounded transition-colors ${currentPlayer === Player.ONE ? 'bg-emerald-900/40 border-l-2 border-emerald-500' : 'opacity-70'}`}>
                 <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider truncate max-w-[80px]">{p1Name}</span>
                 <span className="text-xl md:text-2xl font-mono font-bold text-white leading-none">{scoreP1}</span>
             </div>

             {/* Center Message */}
             <div className="flex flex-col items-center flex-1 mx-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center truncate w-full">{message}</div>
                  {/* Break Score Indicator */}
                  <div className="text-xs font-mono text-emerald-400 font-bold">Break: {currentBreakRef.current}</div>
             </div>

             {/* Player 2 */}
             <div className={`flex flex-col items-end px-2 py-1 rounded transition-colors ${currentPlayer === Player.TWO || currentPlayer === Player.AI ? 'bg-blue-900/40 border-r-2 border-blue-500' : 'opacity-70'}`}>
                 <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider truncate max-w-[80px]">{gameMode === GameMode.SINGLE_PLAYER ? 'AI' : p2Name}</span>
                 <span className="text-xl md:text-2xl font-mono font-bold text-white leading-none">{scoreP2}</span>
             </div>

             {/* Color Selection Overlay (Replaces/Overlays Top Bar when active) */}
             {showColorSelection && (
                 <div className="absolute inset-0 bg-slate-900/95 z-30 flex items-center justify-between px-2 animate-in fade-in border-b border-emerald-500">
                     <span className="text-white font-bold text-xs uppercase tracking-widest ml-1">Nominate:</span>
                     <div className="flex gap-2">
                         {[BallType.YELLOW, BallType.GREEN, BallType.BROWN, BallType.BLUE, BallType.PINK, BallType.BLACK].map(b => (
                             <button key={b} onClick={() => handleColorSelect(b)} className="w-8 h-8 rounded-full shadow-md border border-white/20 hover:scale-110 transition-transform relative group">
                                 <div className="absolute inset-0 rounded-full" style={{ backgroundColor: b === 'YELLOW' ? '#eab308' : b === 'GREEN' ? '#16a34a' : b === 'BROWN' ? '#92400e' : b === 'BLUE' ? '#2563eb' : b === 'PINK' ? '#ec4899' : '#111' }}></div>
                             </button>
                         ))}
                     </div>
                 </div>
             )}
        </div>

        {/* CONTROL BAR: Power -> Spin -> Chalk */}
        <div className="flex-none w-full bg-slate-900/90 p-2 border-b border-slate-700 flex items-center gap-3 z-20">
             
             {/* POWER BAR (Long Horizontal) */}
             <div className="flex-1 flex flex-col justify-center">
                 <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase mb-0.5 px-1">
                     <span>Power</span>
                     <span>{Math.round(dragPower)}%</span>
                 </div>
                 <div className="w-full h-6 bg-slate-800 rounded-md border border-slate-700 relative overflow-hidden group cursor-pointer">
                     {/* Gradient Fill */}
                     <div className="h-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 transition-all duration-75" 
                          style={{ width: `${dragPower}%` }}>
                     </div>
                     {/* Markers */}
                     <div className="absolute inset-0 flex justify-between px-[25%] opacity-20 pointer-events-none">
                         <div className="w-px h-full bg-white"></div>
                         <div className="w-px h-full bg-white"></div>
                         <div className="w-px h-full bg-white"></div>
                     </div>
                 </div>
             </div>

             {/* SPIN ICON (Square) */}
             <button 
                 onClick={() => setShowSpinModal(!showSpinModal)}
                 className={`flex-none w-10 h-10 bg-slate-800 rounded-md border ${showSpinModal ? 'border-emerald-500' : 'border-slate-600'} flex items-center justify-center relative shadow-sm active:scale-95 transition-all`}
             >
                 <div className="w-7 h-7 bg-white rounded-full relative overflow-hidden shadow-inner">
                     <div className="absolute top-1/2 w-full h-px bg-slate-200"></div>
                     <div className="absolute left-1/2 h-full w-px bg-slate-200"></div>
                     <div className="absolute w-2 h-2 bg-red-600 rounded-full transform -translate-x-1/2 -translate-y-1/2 shadow-sm"
                          style={{ left: `${50 + spin.x * 35}%`, top: `${50 - spin.y * 35}%` }}></div>
                 </div>
                 {/* Label */}
                 <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[6px] font-bold text-slate-400 bg-slate-900 px-1 rounded uppercase">Spin</span>
             </button>

             {/* CHALK ICON (Square) */}
             <button 
                 onClick={() => {
                     setChalkLevel(100);
                     playChalkSound();
                     addFloatingText("Chalked!", 0, -50, "#fff");
                 }}
                 className="flex-none w-10 h-10 bg-slate-800 rounded-md border border-slate-600 flex items-center justify-center relative shadow-sm active:scale-95 transition-all group"
             >
                 <div className="w-6 h-5 bg-blue-600 rounded-sm shadow-[0_2px_0_rgba(30,58,138,1)] transform group-active:translate-y-[2px] group-active:shadow-none transition-all"></div>
                 {chalkLevel < 30 && <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border border-slate-800 animate-ping"></div>}
                 <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[6px] font-bold text-slate-400 bg-slate-900 px-1 rounded uppercase">Chalk</span>
             </button>
             
             {/* Menu Button (Small) */}
             <button onClick={() => setGameState(GameState.MENU)} className="flex-none px-2 py-1 bg-slate-800 rounded border border-slate-700 text-[9px] text-slate-400 font-bold uppercase">
                 Menu
             </button>
        </div>

        {/* GAME AREA (Canvas) - Auto Fit */}
        <div className="flex-1 w-full relative flex items-center justify-center bg-[#1a1a1a] overflow-hidden p-2">
             {/* Container for Canvas with Aspect Ratio preservation */}
             <div className="relative w-full h-full flex items-center justify-center">
                  <canvas
                      ref={canvasRef}
                      width={TABLE_WIDTH}
                      height={TABLE_HEIGHT}
                      className="max-w-full max-h-full object-contain shadow-2xl rounded-lg cursor-crosshair"
                      style={{ aspectRatio: '2/1' }} // Enforce 2:1 aspect logic
                      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                      onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
                  />
                  
                  {/* Pocket Cam (Top Right of Game Area) */}
                  {pocketCam.active && pocketCam.pocket && (
                      <div className="absolute top-4 right-4 w-24 h-24 md:w-32 md:h-32 rounded-full border-2 border-white/50 shadow-2xl overflow-hidden z-30 bg-black animate-in zoom-in fade-in duration-300 pointer-events-none">
                           <div className="w-full h-full bg-emerald-900 flex items-center justify-center">
                               <span className="text-[10px] font-bold text-white/50">REPLAY</span>
                           </div>
                      </div>
                  )}
                  
                  {/* Notifications */}
                  {foulNotification.active && (
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-40 pointer-events-none">
                           <div className="text-4xl md:text-6xl font-black text-red-600 tracking-tighter drop-shadow-2xl animate-pulse whitespace-nowrap">FOUL</div>
                           <div className="text-sm md:text-lg font-bold text-white bg-red-600/90 px-3 py-1 rounded shadow-lg mt-1">{foulNotification.message}</div>
                           <div className="text-xs font-mono text-red-200 mt-0.5">Penalty: {foulNotification.points}</div>
                      </div>
                  )}
                  
                  {/* Umpire Cleaning */}
                  {isCleaningCue && (
                       <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-30 backdrop-blur-[1px]">
                            <div className="bg-white/90 text-black px-4 py-2 rounded-full text-xs font-bold shadow-xl animate-bounce">
                                Cleaning Cue Ball...
                            </div>
                       </div>
                  )}
                  
                  {/* Foul Decision Modal */}
                  {foulDecisionNeeded && currentPlayer !== Player.AI && (
                       <div className="absolute inset-0 bg-black/85 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in">
                            <h3 className="text-xl font-bold text-white mb-1">
                                {lastPlayerRef.current === Player.ONE ? p1Name : p2Name} Fouled
                            </h3>
                            <p className="text-slate-400 text-xs mb-4">You have control. Choose action:</p>
                            <div className="flex flex-col gap-2 w-full max-w-xs">
                                 <button onClick={() => handleFoulDecision('PLAY')} className="py-3 bg-emerald-600 active:bg-emerald-700 text-white font-bold rounded text-xs uppercase tracking-wider shadow-lg">Play from here</button>
                                 <button onClick={() => handleFoulDecision('AGAIN')} className="py-3 bg-slate-700 active:bg-slate-800 text-white font-bold rounded text-xs uppercase tracking-wider shadow-lg">Make Them Play Again</button>
                                 {offerFreeBall && (
                                     <button onClick={() => handleFoulDecision('FREE')} className="py-3 bg-blue-600 active:bg-blue-700 text-white font-bold rounded text-xs uppercase tracking-wider animate-pulse shadow-lg">Nominate Free Ball</button>
                                 )}
                            </div>
                       </div>
                  )}
             </div>
        </div>

        {/* SPIN MODAL (Positioned absolute relative to main container or fixed) */}
        {showSpinModal && (
             <div className="absolute top-[120px] left-4 bg-slate-900/95 p-3 rounded-xl border border-emerald-500 shadow-2xl z-50 animate-in slide-in-from-left-5">
                 <div className="w-24 h-24 bg-white rounded-full relative shadow-inner cursor-pointer border-2 border-slate-300"
                      onMouseDown={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
                          const y = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
                          const dist = Math.sqrt(x*x + y*y);
                          if (dist <= 1) setSpin({x, y});
                          else { const ang = Math.atan2(y, x); setSpin({x: Math.cos(ang), y: Math.sin(ang)}); }
                      }}
                      onTouchStart={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const touch = e.touches[0];
                          const x = ((touch.clientX - rect.left) / rect.width - 0.5) * 2;
                          const y = -((touch.clientY - rect.top) / rect.height - 0.5) * 2;
                          const dist = Math.sqrt(x*x + y*y);
                          if (dist <= 1) setSpin({x, y});
                      }}
                 >
                     <div className="absolute top-1/2 left-0 w-full h-px bg-slate-200"></div>
                     <div className="absolute top-0 left-1/2 w-px h-full bg-slate-200"></div>
                     <div className="absolute w-3 h-3 bg-red-600 rounded-full shadow-md transform -translate-x-1/2 -translate-y-1/2 transition-all duration-75" 
                          style={{ top: `${50 - spin.y * 45}%`, left: `${50 + spin.x * 45}%` }}></div>
                 </div>
                 <div className="flex justify-between mt-2 gap-1">
                     <button onClick={() => setSpin({x:0, y:0})} className="flex-1 py-1 bg-slate-800 text-[9px] text-white rounded border border-slate-700">Center</button>
                     <button onClick={() => setShowSpinModal(false)} className="px-2 py-1 bg-slate-800 text-[9px] text-red-400 rounded border border-slate-700">X</button>
                 </div>
             </div>
        )}
        
        {/* Mobile Shot Slider (Only Visible on Touch - in Gutter) */}
        {isTouchDevice && (
           <div className="absolute right-0 top-1/2 -translate-y-1/2 h-48 w-12 bg-slate-800/80 rounded-l-lg border-l border-emerald-500/30 flex items-center justify-center touch-none z-20"
                onTouchStart={handleSliderStart} onTouchMove={handleSliderMove} onTouchEnd={handleSliderEnd}
           >
                <div className="absolute w-1 h-3/4 bg-slate-600 rounded-full">
                     <div className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 to-red-500 rounded-full" style={{ height: `${dragPower}%` }}></div>
                </div>
                {/* Thumb */}
                <div className="absolute w-8 h-8 bg-white/10 rounded-full border-2 border-white shadow-lg pointer-events-none" style={{ bottom: `calc(${dragPower}% * 0.75 + 12.5%)` }}></div>
           </div>
        )}
    </div>
  );
};
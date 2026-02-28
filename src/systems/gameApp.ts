import { MobileControllerClient } from "./mobileController";
import type { ControlState } from "./inputTypes";
import { emptyControlState } from "./inputTypes";
import { VisionController } from "./visionController";

interface GameAppOptions {
  root: HTMLDivElement;
  miniCam: HTMLVideoElement;
  miniOverlay: HTMLCanvasElement;
  statusEl: HTMLElement;
  playerHpEl: HTMLElement;
  enemyHpEl: HTMLElement;
  timerEl: HTMLElement;
  resultEl: HTMLElement;
  controllerServerUrl: string;
}

export class GameApp {
  private readonly options: GameAppOptions;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d");
  private readonly worldWidth = 1024;
  private readonly worldHeight = 576;
  private readonly particles: Particle[] = [];
  private readonly fireBalls: FireBall[] = [];
  private readonly images = {
    background: loadImage("../../../game-final-fighter/src/assets/images/background.png"),
    shop: loadImage("../../../game-final-fighter/src/assets/images/shop.png"),
    p1Idle: loadImage("../../../game-final-fighter/src/assets/images/p1/Idle.png"),
    p1Run: loadImage("../../../game-final-fighter/src/assets/images/p1/Run.png"),
    p1Jump: loadImage("../../../game-final-fighter/src/assets/images/p1/Jump.png"),
    p1Attack: loadImage("../../../game-final-fighter/src/assets/images/p1/Attack1.png"),
    p2Idle: loadImage("../../../game-final-fighter/src/assets/images/p2/Idle.png"),
    p2Run: loadImage("../../../game-final-fighter/src/assets/images/p2/Run.png"),
    p2Jump: loadImage("../../../game-final-fighter/src/assets/images/p2/Jump.png"),
    p2Attack: loadImage("../../../game-final-fighter/src/assets/images/p2/Attack1.png"),
  };
  private player: FighterState = createFighter(170, 332, "Player");
  private enemy: FighterState = createFighter(780, 332, "Enemy");
  private playerHp = 100;
  private enemyHp = 100;
  private timerSec = 60;
  private roundOver = false;
  private lastTime = 0;
  private keyboardState: ControlState = emptyControlState();
  private prevCombined: ControlState = emptyControlState();
  private attackFlash = 0;
  private vision!: VisionController;
  private mobile!: MobileControllerClient;

  constructor(options: GameAppOptions) {
    this.options = options;
    this.canvas.width = this.worldWidth;
    this.canvas.height = this.worldHeight;
  }

  async start(): Promise<void> {
    this.mountCanvas();
    this.resetRound();
    this.bindKeyboard();

    this.mobile = new MobileControllerClient(this.options.controllerServerUrl);
    this.vision = new VisionController(this.options.miniCam, this.options.miniOverlay, (text) => {
      this.options.statusEl.textContent = text;
    });
    await this.vision.start();
    this.options.statusEl.textContent = "Ready. Fight with your body moves.";
    this.animate(0);
  }

  private mountCanvas(): void {
    if (!this.ctx) {
      throw new Error("2D context not available");
    }
    this.options.root.innerHTML = "";
    this.options.root.appendChild(this.canvas);
    const resize = () => {
      const width = this.options.root.clientWidth || window.innerWidth;
      const height = this.options.root.clientHeight || window.innerHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.canvas.style.imageRendering = "auto";
    };
    resize();
    window.addEventListener("resize", resize);
  }

  private resetRound(): void {
    this.player = createFighter(170, 332, "Player");
    this.enemy = createFighter(780, 332, "Enemy");
    this.playerHp = 100;
    this.enemyHp = 100;
    this.timerSec = 60;
    this.roundOver = false;
    this.particles.length = 0;
    this.fireBalls.length = 0;
    this.options.resultEl.textContent = "";
    this.options.statusEl.textContent = "Round started. Fight!";
  }

  private bindKeyboard(): void {
    const setKey = (key: string, pressed: boolean) => {
      if (key === "a" || key === "ArrowLeft") this.keyboardState.moveX = pressed ? -1 : 0;
      if (key === "d" || key === "ArrowRight") this.keyboardState.moveX = pressed ? 1 : 0;
      if (key === "Shift") this.keyboardState.run = pressed;
      if (key === " ") this.keyboardState.jump = pressed;
      if (key === "j") this.keyboardState.punch = pressed;
      if (key === "k") this.keyboardState.kick = pressed;
      if (key === "f") this.keyboardState.fire = pressed;
    };
    window.addEventListener("keydown", (event) => setKey(event.key, true));
    window.addEventListener("keyup", (event) => setKey(event.key, false));
  }

  private animate = (time: number): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min((time - this.lastTime) / 1000 || 0.016, 0.033);
    this.lastTime = time;

    const input = this.combineInputs();
    this.updateRoundTimer(dt);
    this.updateFighters(input, dt);
    this.updateParticles(dt);
    this.updateFireBalls(dt);
    this.renderScene();
    this.updateHud();
  };

  private combineInputs(): ControlState {
    const vision = this.vision.getState();
    const mobile = this.mobile.getState();
    const key = this.keyboardState;
    return {
      moveX: clamp(vision.moveX + mobile.moveX + key.moveX, -1, 1),
      run: vision.run || mobile.run || key.run,
      jump: vision.jump || mobile.jump || key.jump,
      punch: vision.punch || mobile.punch || key.punch,
      kick: vision.kick || mobile.kick || key.kick,
      fire: vision.fire || mobile.fire || key.fire,
    };
  }

  private updateFighters(input: ControlState, dt: number): void {
    if (this.roundOver) {
      if (this.player.x > this.worldWidth - 140) {
        this.resetRound();
      }
      this.prevCombined = input;
      return;
    }
    const speed = input.run ? 8 : 4.5;
    this.player.vx = input.moveX * speed * 60;
    this.player.x += this.player.vx * dt;
    this.player.x = clamp(this.player.x, 40, this.worldWidth - 40);
    this.player.facing = this.player.x <= this.enemy.x ? 1 : -1;
    this.enemy.facing = this.enemy.x < this.player.x ? 1 : -1;

    if (input.jump && !this.prevCombined.jump && this.player.onGround) {
      this.player.vy = -700;
      this.player.onGround = false;
      this.player.action = "jump";
    }
    this.player.vy += 1450 * dt;
    this.player.y += this.player.vy * dt;
    if (this.player.y >= 332) {
      this.player.y = 332;
      this.player.vy = 0;
      this.player.onGround = true;
      this.player.action = Math.abs(this.player.vx) > 80 ? "run" : "idle";
    }

    if (input.punch && !this.prevCombined.punch) {
      this.executeAttack("punch", 8, 120, "#ffcc66");
    }
    if (input.kick && !this.prevCombined.kick) {
      this.executeAttack("kick", 12, 160, "#72ffaa");
    }
    if (input.fire && !this.prevCombined.fire) {
      this.executeAttack("fire", 18, 240, "#ff6633");
    }
    if (Math.abs(this.player.vx) > 50 && this.player.onGround && this.player.action === "idle") {
      this.player.action = "run";
    }

    if (this.enemyHp > 0) {
      this.enemyBrain(dt);
    }

    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - dt);
    this.enemy.attackCooldown = Math.max(0, this.enemy.attackCooldown - dt);
    this.attackFlash = Math.max(0, this.attackFlash - dt * 3);
    this.prevCombined = input;
  }

  private executeAttack(kind: "punch" | "kick" | "fire", damage: number, range: number, color: string): void {
    if (this.player.attackCooldown > 0 || this.enemyHp <= 0) {
      return;
    }
    this.player.attackCooldown = kind === "fire" ? 0.9 : 0.35;
    this.player.action = kind;
    if (kind === "fire") {
      this.fireBalls.push({
        x: this.player.x + this.player.facing * 30,
        y: this.player.y + 58,
        vx: this.player.facing * 520,
        vy: -60,
        radius: 20,
        life: 1.8,
      });
    }
    const dist = Math.abs(this.player.x - this.enemy.x);
    if (dist <= range && this.isFacingTarget(this.player, this.enemy)) {
      this.enemyHp = Math.max(0, this.enemyHp - damage);
      this.attackFlash = 1;
      for (let i = 0; i < (kind === "fire" ? 40 : 14); i += 1) {
        this.spawnParticle(color, kind === "fire" ? 420 : 250);
      }
      if (this.enemyHp === 0) {
        this.enemy.action = "down";
        this.roundOver = true;
        this.options.resultEl.textContent = "PLAYER WINS";
        this.options.statusEl.textContent = "Enemy defeated! Move to right side to restart.";
      }
    }
  }

  private spawnParticle(color: string, speed: number): void {
    this.particles.push({
      x: this.player.x + this.player.facing * 30,
      y: this.player.y + 65,
      vx: this.player.facing * (speed * (0.35 + Math.random() * 0.65)),
      vy: (Math.random() - 0.55) * speed,
      life: 0.4 + Math.random() * 0.5,
      color,
      radius: 2 + Math.random() * 4,
    });
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy += 560 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private updateFireBalls(dt: number): void {
    for (let i = this.fireBalls.length - 1; i >= 0; i -= 1) {
      const b = this.fireBalls[i];
      b.life -= dt;
      b.vy += 180 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const hit = Math.abs(b.x - this.enemy.x) < 50 && Math.abs(b.y - (this.enemy.y + 52)) < 72;
      if (hit && this.enemyHp > 0) {
        this.enemyHp = Math.max(0, this.enemyHp - 12);
        this.attackFlash = 1;
        for (let j = 0; j < 28; j += 1) {
          this.particles.push({
            x: b.x,
            y: b.y,
            vx: (Math.random() - 0.5) * 300,
            vy: (Math.random() - 0.5) * 300,
            life: 0.3 + Math.random() * 0.4,
            color: "#facc15",
            radius: 2 + Math.random() * 5,
          });
        }
        b.life = 0;
      }
      if (b.life <= 0 || b.x < -80 || b.x > this.worldWidth + 80 || b.y > this.worldHeight + 80) {
        this.fireBalls.splice(i, 1);
      }
    }
  }

  private enemyBrain(dt: number): void {
    const distX = this.player.x - this.enemy.x;
    const absDist = Math.abs(distX);
    if (this.enemyHp <= 0) {
      this.enemy.action = "down";
      return;
    }

    if (absDist > 130) {
      const move = clamp(distX, -1, 1) * 160;
      this.enemy.x += move * dt;
      this.enemy.action = "run";
    } else {
      this.enemy.action = "idle";
      if (this.enemy.attackCooldown <= 0) {
        const dmg = 7 + Math.floor(Math.random() * 6);
        this.enemy.attackCooldown = 0.7;
        this.enemy.action = "punch";
        this.playerHp = Math.max(0, this.playerHp - dmg);
        for (let i = 0; i < 8; i += 1) {
          this.particles.push({
            x: this.player.x - this.player.facing * 22,
            y: this.player.y + 70,
            vx: (Math.random() - 0.5) * 180,
            vy: -120 + Math.random() * 120,
            life: 0.3 + Math.random() * 0.3,
            color: "#fca5a5",
            radius: 2 + Math.random() * 3,
          });
        }
      }
    }

    if (this.playerHp <= 0) {
      this.roundOver = true;
      this.options.resultEl.textContent = "ENEMY WINS";
      this.options.statusEl.textContent = "You are down! Auto restarting.";
    }
  }

  private updateRoundTimer(dt: number): void {
    if (this.roundOver) {
      return;
    }
    this.timerSec = Math.max(0, this.timerSec - dt);
    if (this.timerSec === 0) {
      this.roundOver = true;
      if (this.playerHp === this.enemyHp) {
        this.options.resultEl.textContent = "DRAW";
      } else {
        this.options.resultEl.textContent = this.playerHp > this.enemyHp ? "PLAYER WINS" : "ENEMY WINS";
      }
      this.options.statusEl.textContent = "Time over. Move right to restart.";
    }
  }

  private renderScene(): void {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.worldWidth, this.worldHeight);

    if (this.images.background.complete) {
      ctx.drawImage(this.images.background, 0, 0, this.worldWidth, this.worldHeight);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, this.worldHeight);
      sky.addColorStop(0, "#1e2e57");
      sky.addColorStop(1, "#0a1026");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);
    }
    if (this.images.shop.complete) {
      ctx.drawImage(this.images.shop, 650, 161, 295, 278);
    }

    this.drawFighter(this.player, true);
    this.drawFighter(this.enemy, false);
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of this.fireBalls) {
      const g = ctx.createRadialGradient(b.x - 6, b.y - 6, 2, b.x, b.y, b.radius);
      g.addColorStop(0, "#fff7c2");
      g.addColorStop(0.4, "#fde047");
      g.addColorStop(1, "#d97706");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.attackFlash > 0) {
      ctx.fillStyle = `rgba(255, 230, 180, ${0.08 * this.attackFlash})`;
      ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);
    }
  }

  private drawFighter(f: FighterState, isPlayer: boolean): void {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    const sprite = pickSprite(this.images, f.action, isPlayer);
    const frames = pickFrames(f.action, isPlayer);
    f.frameElapsed += 1;
    if (f.frameElapsed % 7 === 0) {
      f.frame = (f.frame + 1) % frames;
    }

    const drawW = isPlayer ? 220 : 185;
    const drawH = isPlayer ? 220 : 210;
    const offsetX = isPlayer ? 80 : 64;
    const offsetY = isPlayer ? 155 : 137;

    const frameW = sprite.width > 0 ? sprite.width / frames : drawW;
    const frameH = sprite.height > 0 ? sprite.height : drawH;
    const srcX = Math.min(frames - 1, f.frame) * frameW;

    ctx.save();
    if (f.facing === -1) {
      ctx.translate(this.worldWidth, 0);
      const x = this.worldWidth - f.x;
      ctx.drawImage(sprite, srcX, 0, frameW, frameH, x - offsetX, f.y - offsetY, drawW, drawH);
    } else {
      ctx.drawImage(sprite, srcX, 0, frameW, frameH, f.x - offsetX, f.y - offsetY, drawW, drawH);
    }
    ctx.restore();
  }

  private isFacingTarget(attacker: FighterState, target: FighterState): boolean {
    return attacker.facing === 1 ? target.x >= attacker.x : target.x <= attacker.x;
  }

  private updateHud(): void {
    this.options.playerHpEl.textContent = this.playerHp.toFixed(0);
    this.options.enemyHpEl.textContent = this.enemyHp.toFixed(0);
    this.options.timerEl.textContent = Math.ceil(this.timerSec).toString();
  }
}

interface FighterState {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  onGround: boolean;
  facing: 1 | -1;
  attackCooldown: number;
  action: "idle" | "run" | "jump" | "punch" | "kick" | "fire" | "down";
  frame: number;
  frameElapsed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  radius: number;
}

interface FireBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
}

function createFighter(x: number, y: number, name: string): FighterState {
  return {
    name,
    x,
    y,
    width: 36,
    height: 120,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    attackCooldown: 0,
    action: "idle",
    frame: 0,
    frameElapsed: 0,
  };
}

function loadImage(relativePath: string): HTMLImageElement {
  const img = new Image();
  img.src = new URL(relativePath, import.meta.url).href;
  return img;
}

function pickSprite(
  images: GameApp["images"],
  action: FighterState["action"],
  isPlayer: boolean,
): HTMLImageElement {
  if (isPlayer) {
    if (action === "run") return images.p1Run;
    if (action === "jump") return images.p1Jump;
    if (action === "punch" || action === "kick" || action === "fire") return images.p1Attack;
    return images.p1Idle;
  }
  if (action === "run") return images.p2Run;
  if (action === "jump") return images.p2Jump;
  if (action === "punch" || action === "kick" || action === "fire") return images.p2Attack;
  return images.p2Idle;
}

function pickFrames(action: FighterState["action"], isPlayer: boolean): number {
  if (isPlayer) {
    if (action === "run") return 8;
    if (action === "jump") return 2;
    if (action === "punch" || action === "kick" || action === "fire") return 6;
    return 8;
  }
  if (action === "run") return 8;
  if (action === "jump") return 2;
  if (action === "punch" || action === "kick" || action === "fire") return 4;
  return 4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

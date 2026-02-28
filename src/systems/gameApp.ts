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
  private readonly groundY = 470;
  private readonly particles: Particle[] = [];
  private player: FighterState = createFighter(180, 370, "#5b9dff", "Player");
  private enemy: FighterState = createFighter(780, 370, "#ff6b6b", "Enemy");
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
    this.player = createFighter(180, 370, "#5b9dff", "Player");
    this.enemy = createFighter(780, 370, "#ff6b6b", "Enemy");
    this.playerHp = 100;
    this.enemyHp = 100;
    this.timerSec = 60;
    this.roundOver = false;
    this.particles.length = 0;
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
    if (this.player.y >= this.groundY - this.player.height) {
      this.player.y = this.groundY - this.player.height;
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

    const sky = ctx.createLinearGradient(0, 0, 0, this.worldHeight);
    sky.addColorStop(0, "#1e2e57");
    sky.addColorStop(1, "#0a1026");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);

    this.drawParallaxLayer(0.15, "#2b3f78", 210);
    this.drawParallaxLayer(0.3, "#253664", 260);
    this.drawGround();

    this.drawFighter(this.player);
    this.drawFighter(this.enemy);
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.attackFlash > 0) {
      ctx.fillStyle = `rgba(255, 230, 180, ${0.08 * this.attackFlash})`;
      ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);
    }
  }

  private drawParallaxLayer(speed: number, color: string, baseY: number): void {
    if (!this.ctx) {
      return;
    }
    const t = performance.now() * 0.01 * speed;
    this.ctx.fillStyle = color;
    for (let i = -2; i < 8; i += 1) {
      const x = ((i * 220 - t) % 1500) - 120;
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.worldHeight);
      this.ctx.lineTo(x + 120, baseY);
      this.ctx.lineTo(x + 240, this.worldHeight);
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private drawGround(): void {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    ctx.fillStyle = "#2f241f";
    ctx.fillRect(0, this.groundY, this.worldWidth, this.worldHeight - this.groundY);
    ctx.fillStyle = "#5a3c2d";
    for (let i = 0; i < this.worldWidth; i += 42) {
      ctx.fillRect(i, this.groundY + 10 + (i % 3), 30, 8);
    }
    ctx.fillStyle = "#f59e0b";
    for (let i = 0; i < this.worldWidth; i += 170) {
      const flicker = 4 + Math.sin((performance.now() + i) * 0.02) * 2;
      ctx.fillRect(i + 30, this.groundY - flicker, 18, flicker);
    }
  }

  private drawFighter(f: FighterState): void {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    const punchBoost = f.action === "punch" ? 14 : 0;
    const kickBoost = f.action === "kick" ? 18 : 0;
    const fireAura = f.action === "fire";
    const x = f.x;
    const y = f.y;

    if (fireAura) {
      ctx.fillStyle = "rgba(255,120,80,0.25)";
      ctx.beginPath();
      ctx.arc(x, y + 65, 44, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = f.color;
    ctx.fillRect(x - 18, y + 24, 36, 70);
    ctx.fillRect(x - 12, y, 24, 28);

    const dir = f.facing;
    ctx.fillRect(x + dir * 16, y + 36, 16 + punchBoost, 12);
    ctx.fillRect(x + dir * 5, y + 95, 12 + kickBoost, 34);
    ctx.fillRect(x - dir * 16 - 10, y + 36, 16, 12);
    ctx.fillRect(x - dir * 5 - 10, y + 95, 12, 34);

    ctx.fillStyle = "#dbeafe";
    ctx.font = "bold 12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(f.name, x, y - 12);

    if (f.action === "down") {
      ctx.fillStyle = "rgba(220,38,38,0.85)";
      ctx.fillText("DOWN", x, y - 30);
    }
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
  color: string;
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

function createFighter(x: number, y: number, color: string, name: string): FighterState {
  return {
    name,
    color,
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
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

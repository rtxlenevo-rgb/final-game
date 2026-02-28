import * as THREE from "three";
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
  controllerServerUrl: string;
}

export class GameApp {
  private readonly options: GameAppOptions;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 300);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  private readonly clock = new THREE.Clock();
  private readonly player = new THREE.Group();
  private readonly enemy = new THREE.Group();
  private readonly floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x1d2230, roughness: 0.75, metalness: 0.2 }),
  );
  private readonly particles: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  private playerVelocityY = 0;
  private playerHp = 100;
  private enemyHp = 100;
  private lastTime = 0;
  private keyboardState: ControlState = emptyControlState();
  private prevCombined: ControlState = emptyControlState();
  private vision!: VisionController;
  private mobile!: MobileControllerClient;

  constructor(options: GameAppOptions) {
    this.options = options;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  async start(): Promise<void> {
    this.mountRenderer();
    this.buildWorld();
    this.bindKeyboard();

    this.mobile = new MobileControllerClient(this.options.controllerServerUrl);
    this.vision = new VisionController(this.options.miniCam, this.options.miniOverlay, (text) => {
      this.options.statusEl.textContent = text;
    });
    await this.vision.start();
    this.options.statusEl.textContent = "Ready. Fight with your body moves.";
    this.animate(0);
  }

  private mountRenderer(): void {
    this.options.root.innerHTML = "";
    this.options.root.appendChild(this.renderer.domElement);
    const resize = () => {
      const width = this.options.root.clientWidth || window.innerWidth;
      const height = this.options.root.clientHeight || window.innerHeight;
      this.camera.aspect = width / Math.max(height, 1);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    };
    resize();
    window.addEventListener("resize", resize);
  }

  private buildWorld(): void {
    this.scene.background = new THREE.Color(0x0a1024);
    this.scene.fog = new THREE.Fog(0x0a1024, 18, 90);

    const hemi = new THREE.HemisphereLight(0x8ec8ff, 0x19253d, 0.85);
    this.scene.add(hemi);
    const mainLight = new THREE.DirectionalLight(0xdde7ff, 1.7);
    mainLight.position.set(8, 16, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(mainLight);

    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    const grid = new THREE.GridHelper(100, 100, 0x2a3856, 0x16223c);
    this.scene.add(grid);

    this.player.position.set(0, 1, 4);
    this.enemy.position.set(0, 1.3, -7);
    this.player.add(this.createCharacter(0x5b9dff));
    this.enemy.add(this.createCharacter(0xff6b6b));
    this.scene.add(this.player);
    this.scene.add(this.enemy);

    this.camera.position.set(0, 6, 14);
    this.camera.lookAt(0, 1, 0);
  }

  private createCharacter(color: number): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.3, 8, 16), mat);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 24), mat);
    head.position.y = 1.2;
    head.castShadow = true;
    group.add(head);

    return group;
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
    const dt = Math.min((time - this.lastTime) / 1000 || this.clock.getDelta(), 0.033);
    this.lastTime = time;

    const input = this.combineInputs();
    this.updatePlayer(input, dt);
    this.updateEnemy(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
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

  private updatePlayer(input: ControlState, dt: number): void {
    const speed = input.run ? 8 : 4.5;
    this.player.position.x += input.moveX * speed * dt;
    this.player.position.x = clamp(this.player.position.x, -14, 14);

    if (input.jump && !this.prevCombined.jump && this.player.position.y <= 1.01) {
      this.playerVelocityY = 8.6;
    }
    this.playerVelocityY -= 20 * dt;
    this.player.position.y += this.playerVelocityY * dt;
    if (this.player.position.y < 1) {
      this.player.position.y = 1;
      this.playerVelocityY = 0;
    }

    if (input.punch && !this.prevCombined.punch) {
      this.executeAttack("punch", 8, 2.6, 0xffcc66);
    }
    if (input.kick && !this.prevCombined.kick) {
      this.executeAttack("kick", 12, 3.2, 0x72ffaa);
    }
    if (input.fire && !this.prevCombined.fire) {
      this.executeAttack("fire", 18, 4.5, 0xff6633);
    }

    this.prevCombined = input;
  }

  private executeAttack(kind: "punch" | "kick" | "fire", damage: number, range: number, color: number): void {
    const dist = this.player.position.distanceTo(this.enemy.position);
    if (dist <= range && this.enemyHp > 0) {
      this.enemyHp = Math.max(0, this.enemyHp - damage);
      for (let i = 0; i < (kind === "fire" ? 26 : 10); i += 1) {
        this.spawnParticle(color, kind === "fire" ? 2.2 : 1.2);
      }
      if (this.enemyHp === 0) {
        this.options.statusEl.textContent = "Boss defeated! Keep moving to restart.";
      }
    }
  }

  private spawnParticle(color: number, speed: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }),
    );
    mesh.position.copy(this.player.position);
    mesh.position.y += 0.9;
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * speed, (Math.random() - 0.2) * speed, -Math.random() * speed),
      life: 0.8 + Math.random() * 0.7,
    });
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      p.velocity.y -= 5 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  private updateEnemy(dt: number): void {
    if (this.enemyHp <= 0) {
      this.enemy.rotation.y += dt * 0.7;
      if (Math.abs(this.player.position.x) > 8) {
        this.enemyHp = 100;
        this.enemy.position.set(0, 1.3, -7);
        this.options.statusEl.textContent = "Boss revived. Continue the fight.";
      }
      return;
    }
    const dir = Math.sin(performance.now() * 0.001) * 0.5;
    this.enemy.position.x = dir * 6;
    this.enemy.lookAt(this.player.position.x, this.enemy.position.y, this.player.position.z);
    if (this.player.position.distanceTo(this.enemy.position) < 2.2) {
      this.playerHp = Math.max(0, this.playerHp - dt * 8);
      if (this.playerHp === 0) {
        this.playerHp = 100;
        this.enemyHp = 100;
        this.player.position.set(0, 1, 4);
        this.options.statusEl.textContent = "You were downed. Fight restarted.";
      }
    }
  }

  private updateCamera(dt: number): void {
    const target = new THREE.Vector3(this.player.position.x * 0.45, 4.8, this.player.position.z + 9.5);
    this.camera.position.lerp(target, Math.min(1, dt * 3.2));
    this.camera.lookAt(this.player.position.x, 1.2, this.enemy.position.z + 1.5);
  }

  private updateHud(): void {
    this.options.playerHpEl.textContent = this.playerHp.toFixed(0);
    this.options.enemyHpEl.textContent = this.enemyHp.toFixed(0);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

import "./style.css";
import QRCode from "qrcode";
import { GameApp } from "./systems/gameApp";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

app.innerHTML = `
  <div id="game-shell">
    <div id="hud">
      <h1>Fusion Arena</h1>
      <p class="sub">
        Webcam full-body + hand gestures. Mobile gyro as second controller.
      </p>
      <div class="bars">
        <div>Player HP <span id="player-hp">100</span></div>
        <div>Boss HP <span id="enemy-hp">100</span></div>
      </div>
      <div id="status">Loading models...</div>
      <div class="tips">
        <strong>Moves:</strong>
        <span>Hands up = Jump</span>
        <span>Fast right hand = Punch</span>
        <span>High knee/leg = Kick</span>
        <span>Both hands together = Fire Splash</span>
        <span>Move body side-to-side = Run</span>
      </div>
    </div>
    <div id="render-root"></div>
    <div id="mini-cam-wrap">
      <video id="mini-cam" autoplay playsinline muted></video>
      <canvas id="mini-overlay"></canvas>
    </div>
    <div id="mobile-card">
      <h2>Mobile Controller</h2>
      <canvas id="qr"></canvas>
      <div class="qr-config">
        <input id="host-input" placeholder="LAN IP (e.g. 192.168.1.173)" />
        <button id="apply-host" type="button">Apply</button>
      </div>
      <p>Open this QR in your phone browser (same Wi-Fi).</p>
      <p id="mobile-url"></p>
    </div>
  </div>
`;

const statusEl = document.querySelector<HTMLElement>("#status");
const playerHpEl = document.querySelector<HTMLElement>("#player-hp");
const enemyHpEl = document.querySelector<HTMLElement>("#enemy-hp");
const renderRoot = document.querySelector<HTMLDivElement>("#render-root");
const miniCam = document.querySelector<HTMLVideoElement>("#mini-cam");
const miniOverlay = document.querySelector<HTMLCanvasElement>("#mini-overlay");

if (!statusEl || !playerHpEl || !enemyHpEl || !renderRoot || !miniCam || !miniOverlay) {
  throw new Error("Missing required UI elements");
}

const mobileUrlEl = document.querySelector<HTMLElement>("#mobile-url");
const qrCanvas = document.querySelector<HTMLCanvasElement>("#qr");
const hostInput = document.querySelector<HTMLInputElement>("#host-input");
const applyHostBtn = document.querySelector<HTMLButtonElement>("#apply-host");
const controllerPort = 5174;

const updateQr = (host: string): void => {
  const safeHost = host.trim() || window.location.hostname;
  const mobileUrl = `${window.location.protocol}//${safeHost}:${controllerPort}/mobile-controller.html`;
  if (mobileUrlEl) {
    mobileUrlEl.textContent = mobileUrl;
  }
  if (qrCanvas) {
    QRCode.toCanvas(qrCanvas, mobileUrl, { width: 170, margin: 1 }).catch((error: unknown) => {
      console.error("QR generation failed", error);
    });
  }
};

if (applyHostBtn) {
  applyHostBtn.addEventListener("click", () => {
    updateQr(hostInput?.value ?? "");
  });
}
updateQr("");

const game = new GameApp({
  root: renderRoot,
  miniCam,
  miniOverlay,
  statusEl,
  playerHpEl,
  enemyHpEl,
  controllerServerUrl: `${window.location.protocol}//${window.location.hostname}:${controllerPort}`,
});

game.start().catch((error: unknown) => {
  statusEl.textContent = "Startup failed. Check camera permissions and console logs.";
  console.error("Game failed to start", error);
});

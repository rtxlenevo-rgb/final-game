import { io, type Socket } from "socket.io-client";
import type { ControlState, MobileInputPayload } from "./inputTypes";

export class MobileControllerClient {
  private socket: Socket;
  private latest: ControlState = {
    moveX: 0,
    run: false,
    jump: false,
    punch: false,
    kick: false,
    fire: false,
  };

  constructor(serverUrl: string, roomId = "default-room") {
    this.socket = io(serverUrl, { transports: ["websocket", "polling"] });
    this.socket.on("connect", () => {
      this.socket.emit("join", { role: "game", roomId });
    });
    this.socket.on("mobileInput", (payload: MobileInputPayload) => {
      this.latest = {
        moveX: clamp(payload.moveX ?? this.latest.moveX, -1, 1),
        run: Boolean(payload.run),
        jump: Boolean(payload.jump),
        punch: Boolean(payload.punch),
        kick: Boolean(payload.kick),
        fire: Boolean(payload.fire),
      };
    });
  }

  getState(): ControlState {
    return this.latest;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

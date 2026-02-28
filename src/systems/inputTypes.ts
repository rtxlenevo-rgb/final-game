export type ActionKind = "jump" | "punch" | "kick" | "fire";

export interface ControlState {
  moveX: number;
  run: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  fire: boolean;
}

export interface MobileInputPayload {
  moveX?: number;
  run?: boolean;
  jump?: boolean;
  punch?: boolean;
  kick?: boolean;
  fire?: boolean;
}

export const emptyControlState = (): ControlState => ({
  moveX: 0,
  run: false,
  jump: false,
  punch: false,
  kick: false,
  fire: false,
});

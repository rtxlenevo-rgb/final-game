import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import * as bodyPix from "@tensorflow-models/body-pix";
import "@tensorflow/tfjs-backend-webgl";
import type { ControlState } from "./inputTypes";

type BodyPixModel = bodyPix.BodyPix;

export class VisionController {
  private readonly video: HTMLVideoElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly onStatus: (text: string) => void;
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private bodyPixModel: BodyPixModel | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ready = false;
  private state: ControlState = {
    moveX: 0,
    run: false,
    jump: false,
    punch: false,
    kick: false,
    fire: false,
  };
  private prevRightWristX = 0;
  private prevLeftHandAngle = 0;
  private prevRightHandAngle = 0;
  private frameCount = 0;
  private nextActionAt: Record<"jump" | "punch" | "kick" | "fire", number> = {
    jump: 0,
    punch: 0,
    kick: 0,
    fire: 0,
  };

  constructor(video: HTMLVideoElement, overlay: HTMLCanvasElement, onStatus: (text: string) => void) {
    this.video = video;
    this.overlay = overlay;
    this.onStatus = onStatus;
    this.ctx = this.overlay.getContext("2d");
  }

  async start(): Promise<void> {
    await this.setupCamera();
    this.onStatus("Loading MediaPipe models...");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
    );

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
    });

    this.onStatus("Loading BodyPix segmentation...");
    this.bodyPixModel = await bodyPix.load({
      architecture: "MobileNetV1",
      outputStride: 16,
      multiplier: 0.75,
      quantBytes: 2,
    });
    this.ready = true;
    this.onStatus("Vision ready. Move your whole body into camera.");
    this.tick();
  }

  getState(): ControlState {
    return this.state;
  }

  private async setupCamera(): Promise<void> {
    const isLanHttp =
      window.location.protocol === "http:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1";
    if (isLanHttp) {
      this.onStatus("LAN over HTTP may block camera. Prefer localhost or HTTPS.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
    } catch (error) {
      this.onStatus("Camera permission failed. For LAN, use HTTPS or run on localhost.");
      throw error;
    }
  }

  private tick(): void {
    if (!this.ready || !this.poseLandmarker || !this.handLandmarker || !this.ctx) {
      return;
    }

    const now = performance.now();
    const pose = this.poseLandmarker.detectForVideo(this.video, now);
    const hand = this.handLandmarker.detectForVideo(this.video, now);

    this.deriveState(pose, hand, now);
    this.drawOverlay(pose, hand);

    this.frameCount += 1;
    if (this.bodyPixModel && this.frameCount % 20 === 0) {
      void this.bodyPixModel.segmentPerson(this.video, {
        internalResolution: "medium",
        segmentationThreshold: 0.7,
      });
    }
    requestAnimationFrame(() => this.tick());
  }

  private deriveState(pose: PoseLandmarkerResult, hand: HandLandmarkerResult, now: number): void {
    const landmarks = pose.landmarks?.[0];
    if (!landmarks) {
      this.state = { ...this.state, moveX: 0, run: false };
      return;
    }

    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const bodyCenterX = (leftHip.x + rightHip.x) * 0.5;
    const shoulderSpan = Math.abs(leftShoulder.x - rightShoulder.x);
    const wristDist = distance2D(leftWrist.x, leftWrist.y, rightWrist.x, rightWrist.y);
    const rightWristSpeedX = rightWrist.x - this.prevRightWristX;
    this.prevRightWristX = rightWrist.x;

    const defaultMoveX = clamp((0.5 - bodyCenterX) * 4, -1, 1);
    const handsUp = leftWrist.y < nose.y - 0.05 && rightWrist.y < nose.y - 0.05;
    const kickPose = leftAnkle.y < leftKnee.y - 0.06 || rightAnkle.y < rightKnee.y - 0.06;
    const punchPose = Math.abs(rightWristSpeedX) > 0.08 && shoulderSpan > 0.1;
    const handLandmarks = hand.landmarks ?? [];
    const leftHand = handLandmarks[0];
    const rightHand = handLandmarks[1];
    const leftOpen = leftHand ? this.isHandOpen(leftHand) : false;
    const rightOpen = rightHand ? this.isHandOpen(rightHand) : false;
    const handsVisible = Boolean(leftHand && rightHand);

    // Requested mapping:
    // - showing both hands (open palms) => forward run
    // - both hands close => backward run
    let moveX = defaultMoveX;
    let run = Math.abs(defaultMoveX) > 0.2 || Math.abs(leftAnkle.y - rightAnkle.y) > 0.12;
    if (handsVisible && leftOpen && rightOpen) {
      moveX = 0.85;
      run = true;
    } else if (handsVisible && !leftOpen && !rightOpen) {
      moveX = -0.85;
      run = true;
    }

    // Requested mapping:
    // - twisting both hands at same time => fire splash
    const twistPose = handsVisible && this.isTwoHandTwist(leftHand, rightHand) && wristDist < 0.35;
    const firePose = twistPose || (wristDist < 0.08 && Math.abs(leftWrist.y - rightWrist.y) < 0.05);

    const handCount = handLandmarks.length;
    const confidentHands = handCount >= 1;

    this.state = {
      moveX,
      run,
      jump: confidentHands && this.cooldownTrigger("jump", handsUp, now, 500),
      punch: this.cooldownTrigger("punch", punchPose, now, 220),
      kick: this.cooldownTrigger("kick", kickPose, now, 350),
      fire: confidentHands && this.cooldownTrigger("fire", firePose, now, 900),
    };
  }

  private isHandOpen(hand: { x: number; y: number; z: number }[]): boolean {
    if (hand.length < 21) {
      return false;
    }
    const wrist = hand[0];
    const palm = distance2D(wrist.x, wrist.y, hand[9].x, hand[9].y) || 0.01;
    const fingerTips = [8, 12, 16, 20];
    let total = 0;
    for (const tip of fingerTips) {
      total += distance2D(wrist.x, wrist.y, hand[tip].x, hand[tip].y) / palm;
    }
    const openness = total / fingerTips.length;
    return openness > 1.7;
  }

  private isTwoHandTwist(
    leftHand: { x: number; y: number; z: number }[],
    rightHand: { x: number; y: number; z: number }[],
  ): boolean {
    const leftAngle = Math.atan2(leftHand[8].y - leftHand[0].y, leftHand[8].x - leftHand[0].x);
    const rightAngle = Math.atan2(rightHand[8].y - rightHand[0].y, rightHand[8].x - rightHand[0].x);
    const deltaLeft = normalizeAngle(leftAngle - this.prevLeftHandAngle);
    const deltaRight = normalizeAngle(rightAngle - this.prevRightHandAngle);
    this.prevLeftHandAngle = leftAngle;
    this.prevRightHandAngle = rightAngle;
    return Math.abs(deltaLeft) > 0.35 && Math.abs(deltaRight) > 0.35 && Math.sign(deltaLeft) !== Math.sign(deltaRight);
  }

  private cooldownTrigger(
    action: "jump" | "punch" | "kick" | "fire",
    active: boolean,
    now: number,
    cooldownMs: number,
  ): boolean {
    if (!active || now < this.nextActionAt[action]) {
      return false;
    }
    this.nextActionAt[action] = now + cooldownMs;
    return true;
  }

  private drawOverlay(pose: PoseLandmarkerResult, hand: HandLandmarkerResult): void {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    const width = this.overlay.width;
    const height = this.overlay.height;
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(91, 176, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(91, 176, 255, 0.9)";
    const posePoints = pose.landmarks?.[0] ?? [];
    for (const point of posePoints) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255, 170, 77, 0.9)";
    for (const handPoints of hand.landmarks ?? []) {
      for (const point of handPoints) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function distance2D(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(rad: number): number {
  let value = rad;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

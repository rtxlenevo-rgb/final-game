import cv2
import mediapipe as mp


def main() -> None:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")

    mp_pose = mp.solutions.pose
    mp_hands = mp.solutions.hands
    draw = mp.solutions.drawing_utils

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose, mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pose_res = pose.process(rgb)
            hand_res = hands.process(rgb)

            if pose_res.pose_landmarks:
                draw.draw_landmarks(frame, pose_res.pose_landmarks, mp_pose.POSE_CONNECTIONS)

            if hand_res.multi_hand_landmarks:
                for h in hand_res.multi_hand_landmarks:
                    draw.draw_landmarks(frame, h, mp_hands.HAND_CONNECTIONS)

            cv2.putText(
                frame,
                "Python monitor (Pose + Hands) - press Q to quit",
                (8, 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (80, 220, 255),
                2,
                cv2.LINE_AA,
            )

            cv2.imshow("Fusion Arena - Monitor", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

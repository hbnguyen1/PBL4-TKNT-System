"""Camera, model paths and thresholds for the V3 pipeline."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "best.pt"
PHONE_DETECTION_ENABLED = True  # Only disables behavior alerts/QR, not the shared model.
ESP32_IP = "192.168.1.104"  # Change this if the ESP32-CAM IP changes
STREAM_URL = f"http://{ESP32_IP}:81/stream"

# Camera options:
# "AUTO"   = try ESP32-CAM first, then use laptop webcam if stream fails
# "ESP32"  = use only ESP32-CAM
# "LAPTOP" = use only laptop webcam
CAMERA_MODE = "ESP32"
LAPTOP_CAMERA_INDEX = 0
LAPTOP_CAMERA_WIDTH = 640
LAPTOP_CAMERA_HEIGHT = 480
CAMERA_STARTUP_READ_ATTEMPTS = 4
CAMERA_READ_FAILURES_BEFORE_FALLBACK = 3
EYE_IMAGE_SIZE = 224
SCENE_IMAGE_SIZE = 640
YAWN_CONFIDENCE = 0.5

# MediaPipe performance
PROCESS_WIDTH = 640
REFINE_LANDMARKS = False

# Eye / mouth temporal thresholds, in seconds
CLOSED_EYES_SECONDS = 0.5
YAWN_MIN_DURATION = 0.5
YAWN_DISPLAY_SECONDS = 2.0
PROLONGED_MOUTH_SECONDS = 1.5

# Head pose: increased start threshold + confirmation + hysteresis
YAW_START_THRESHOLD = 28.0
YAW_END_THRESHOLD = 18.0
DISTRACTED_SECONDS = 2.0
TURN_CONFIRM_SECONDS = 0.35
STRAIGHT_CONFIRM_SECONDS = 0.40
YAW_SIGN = 1  # Set to -1 only if the detected LEFT/RIGHT labels are reversed
SMOOTHING_FRAMES = 5
CALIBRATION_FRAMES = 30
MIN_CALIBRATION_SAMPLES = 10
CALIBRATION_MAX_RAW_YAW = 35.0
EYE_MAX_RAW_YAW_BEFORE_CALIBRATION = 28.0
# Allow the natural pitch/roll changes that often accompany a real head turn.
# The previous limits were too strict and rejected many RIGHT turns as head tilt.
MAX_RELATIVE_PITCH_FOR_TURN = 60.0
MAX_RELATIVE_ROLL_FOR_TURN = 55.0

# Pose/landmark loss handling: hold an already-known turn briefly across tracking dropouts.
POSE_LOST_RESET_SECONDS = 1.4

# Eye classification is trusted only when the face is sufficiently frontal.
# When the head is turned, skip eye classification instead of reporting
# random eye labels from a foreshortened/partly hidden eye crop.
EYE_MAX_RELATIVE_YAW = 22.0
EYE_MAX_RELATIVE_PITCH = 28.0
EYE_MAX_RELATIVE_ROLL = 30.0

PHONE_CONFIDENCE = 0.25
PHONE_INFER_EVERY = 3
PHONE_HISTORY_SIZE = 5
PHONE_REQUIRED_HITS = 3

# Scheduling only: model input sizes and decision thresholds stay unchanged.
TORCH_CPU_THREADS = 6
CAMERA_TARGET_FPS = 30
DISPLAY_TARGET_FPS = 60

# Optional Python -> ASP.NET stream bridge (same computer by default).
WEB_STREAM_ENABLED = False
WEB_STREAM_HOST = "127.0.0.1"
WEB_STREAM_PORT = 8001
WEB_STREAM_MAX_FPS = 15
WEB_STREAM_JPEG_QUALITY = 80
QR_SCAN_INTERVAL_SECONDS = 0.5
QR_SESSION_SECONDS = None  # Manual session termination only (legacy setting).

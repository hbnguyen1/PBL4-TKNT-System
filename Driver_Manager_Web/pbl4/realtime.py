"""Live preview with a single latest-frame inference worker (no frame backlog)."""
import threading
import time
import os
from collections import deque

import cv2

from . import config as cfg
from .application import load_optional_phone_detector
from .camera import CameraManager
from .display import draw_dashboard, draw_label
from .inference import UnifiedInference
from .pipeline import FacePipeline
from .qr import QRIdentity


class LatestWorker:
    def __init__(self, process):
        self.process = process
        self.condition = threading.Condition()
        self.pending = None
        self.output = None
        self.error = None
        self.stopping = False
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def submit(self, item):
        with self.condition:
            self.pending = item
            self.condition.notify()

    def _run(self):
        try:
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: self.stopping or self.pending is not None)
                    if self.stopping:
                        return
                    item, self.pending = self.pending, None
                output = self.process(item)
                with self.condition:
                    self.output = output
        except BaseException as exc:
            with self.condition:
                self.error = exc

    def snapshot(self):
        with self.condition:
            if self.error is not None:
                raise RuntimeError("Inference worker failed") from self.error
            return self.output

    def close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify()
        self.thread.join()


def run_realtime():
    camera = CameraManager()
    pipeline = worker = None
    hub = server = None
    calibrate = threading.Event()
    reset_identity = threading.Event()
    session_lock = threading.Lock()
    try:
        if cfg.WEB_STREAM_ENABLED:
            from .streaming import StreamHub, StreamServer
            hub = StreamHub(jpeg_quality=cfg.WEB_STREAM_JPEG_QUALITY, max_fps=cfg.WEB_STREAM_MAX_FPS)
            server = StreamServer(hub, host=cfg.WEB_STREAM_HOST, port=cfg.WEB_STREAM_PORT,
                                  api_key=os.environ.get('PBL4_STREAM_TOKEN'),
                                  end_session=lambda session_id: end_session(session_id))
            server.start()
            print(f"AI web bridge: http://{cfg.WEB_STREAM_HOST}:{cfg.WEB_STREAM_PORT} (waiting for QR)")
        engine = UnifiedInference(cfg.MODEL_PATH)
        pipeline = FacePipeline(cfg.PROCESS_WIDTH, engine)
        phone = load_optional_phone_detector(engine)
        if not camera.open():
            return 1
        generation = 0
        worker_generation = 0
        qr = QRIdentity()
        next_scan = 0.0

        def end_session(session_id):
            """HTTP stop request: immediately block old frames, then clear worker identity."""
            with session_lock:
                if hub is None or hub.status()["session_id"] != session_id:
                    return False
                reset_identity.set()
                hub.clear()
                return True

        def process(item):
            nonlocal phone, worker_generation, next_scan
            frame, captured_at, source_generation, read_ms = item
            if source_generation != worker_generation:
                pipeline.reset()
                qr.clear()
                worker_generation = source_generation
                next_scan = 0.0
            if reset_identity.is_set():
                qr.clear()
                reset_identity.clear()
                next_scan = time.monotonic() + cfg.QR_SCAN_INTERVAL_SECONDS
            if time.monotonic() >= next_scan:
                qr.scan(frame)
                next_scan = time.monotonic() + cfg.QR_SCAN_INTERVAL_SECONDS
            identity = (qr.driver_id, qr.driver_name, qr.session_id)
            with session_lock:
                if hub is not None and source_generation == generation:
                    if identity[0] and identity[2] and not reset_identity.is_set():
                        hub.set_identity(*identity)
                    else:
                        hub.clear()
            if calibrate.is_set():
                pipeline.head.calibrate()
                calibrate.clear()
            started = time.perf_counter()
            predictions, yawn, geometry = engine.predict_scene(frame)
            if phone is not None:
                try:
                    phone.update(frame, predictions, geometry)
                except Exception as exc:
                    print(f"Behavior module disabled: {exc}")
                    phone = None
            result, state, mesh_ms = pipeline.process(frame, captured_at, yawn)
            # Draw behavior boxes only on the frame that was actually analyzed.
            if phone is not None:
                phone.draw(frame)
            qr.draw(frame)
            elapsed = time.perf_counter() - started
            return source_generation, captured_at, result, state, mesh_ms, elapsed, frame, read_ms, identity

        worker = LatestWorker(process)
        frame_times = deque(maxlen=60)
        print("Live preview + latest-frame AI. C: calibrate; R: clear QR session; Q: quit.")
        while True:
            capture = camera.read()
            if capture.retry:
                continue
            if capture.frame is None:
                return 1
            now = time.monotonic()
            if capture.switched:
                with session_lock:
                    generation += 1
                    if hub is not None:
                        hub.clear()
                frame_times.clear()
                calibrate.clear()
            frame_times.append(now)
            camera_fps = ((len(frame_times) - 1) / (now - frame_times[0])
                          if len(frame_times) > 1 and now > frame_times[0] else 0)
            frame = capture.frame
            worker.submit((frame.copy(), now, generation, capture.read_ms))
            output = worker.snapshot()
            if output is not None and output[0] == generation:
                _, timestamp, result, state, mesh_ms, elapsed, analyzed, read_ms, identity = output
                age = now - timestamp
                if age < 2.0:
                    draw_dashboard(frame, result, state, camera_fps, camera.active_camera, read_ms, mesh_ms)
                draw_label(frame, f"AI {1/max(elapsed, 1e-6):.1f} FPS | result age {age:.2f}s", (10, 165), scale=0.48)
                # Separate, labelled inset avoids placing old detections over a
                # new face position. The live camera image always remains live.
                height, width = frame.shape[:2]
                inset_w, inset_h = width // 3, height // 3
                inset = cv2.resize(analyzed, (inset_w, inset_h))
                frame[height-inset_h:height, width-inset_w:width] = inset
                draw_label(frame, "Last AI frame", (width-inset_w, height-inset_h+16), scale=0.4)
            else:
                draw_label(frame, "AI warming up...", (10, 24))
            display_frame = cv2.resize(frame, (800, 600))
            if (hub is not None and output is not None and output[0] == generation
                    and now - output[1] < 2.0):
                driver_id, _, session_id = output[8]
                hub.publish(display_frame, driver_id, session_id)
            cv2.imshow("Driver Monitoring System", display_frame)
            key = cv2.waitKey(max(1, round(1000 / cfg.DISPLAY_TARGET_FPS))) & 0xff
            if key in (ord('q'), ord('Q')):
                return 0
            if key in (ord('c'), ord('C')):
                calibrate.set()
            if key in (ord('r'), ord('R')):
                with session_lock:
                    reset_identity.set()
                    if hub is not None:
                        hub.clear()
    finally:
        camera.close()
        if worker is not None:
            worker.close()
        if server is not None:
            server.close()
        if hub is not None:
            hub.close()
        if pipeline is not None:
            pipeline.close()
        cv2.destroyAllWindows()

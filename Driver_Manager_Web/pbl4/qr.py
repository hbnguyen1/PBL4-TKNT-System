"""Scan a QR once per presentation, validate against ASP.NET, then activate."""
import time
import cv2
import numpy as np
from .driver_identity import DriverIdentity, parse_driver_qr
from .driver_validation import DriverValidationError, validate_driver


class QRIdentity(DriverIdentity):
    def __init__(self, validator=validate_driver, clock=time.monotonic):
        super().__init__()
        self.validator = validator
        self.clock = clock
        self.qr_detector = cv2.QRCodeDetector()
        self.qr_polygon = None
        self._presented_id = None
        self._last_seen_at = 0.0
        self._retry_at = 0.0

    def clear(self):
        super().clear()
        # Do not re-activate a visible QR immediately after manual termination.
        if hasattr(self, '_presented_id'):
            self._retry_at = float('inf')

    def scan(self, frame: np.ndarray):
        try:
            data, points, _ = self.qr_detector.detectAndDecode(frame)
            if not data:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                data, points, _ = self.qr_detector.detectAndDecode(cv2.equalizeHist(gray))
            self.qr_polygon = points
        except Exception:
            self.qr_polygon = None
            data = ''
        now = self.clock()
        if not data:
            if now - self._last_seen_at >= 1.5:
                self._presented_id = None
                self._retry_at = 0.0
            return
        self._last_seen_at = now
        parsed = parse_driver_qr(data)
        if parsed is None:
            return  # Invalid QR cannot revoke an active driver.
        driver_id, _ = parsed
        if driver_id != self._presented_id:
            self._presented_id = driver_id
            self._retry_at = 0.0
        if driver_id == self.driver_id or now < self._retry_at:
            return
        try:
            result = self.validator(driver_id)
        except DriverValidationError as exc:
            print(f'[QR] Validation failed for {driver_id}: {exc}')
            self._retry_at = now + 3.0
            return
        except Exception as exc:
            print(f'[QR] Unexpected validation error: {exc}')
            self._retry_at = now + 3.0
            return
        if self.activate(result['driverId'], result.get('driverName'), result['vehiclePlate']):
            print(f'[QR] Active: {self.driver_id} -> {self.vehicle_plate}; session={self.session_id}')

    def draw(self, frame):
        h, w = frame.shape[:2]
        if self.qr_polygon is not None:
            pts = self.qr_polygon.astype(int).reshape((-1, 1, 2))
            cv2.polylines(frame, [pts], True, (0, 255, 0), 2)
        status = f'Driver: {self.driver_id}' if self.driver_id else 'QR: Chua quet the'
        color = (0, 255, 0) if self.driver_id else (0, 165, 255)
        cv2.putText(frame, status, (max(10, w - 240), 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

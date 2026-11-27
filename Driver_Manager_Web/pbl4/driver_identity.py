"""Driver QR parsing and explicitly controlled, non-expiring work sessions."""
import json
import re
import uuid


def parse_driver_qr(payload):
    """Parse a driver ID only; QR content is NOT proof of authorization."""
    if not isinstance(payload, str) or len(payload) > 2048:
        return None
    raw = payload.strip()
    name = None
    try:
        obj = json.loads(raw)
    except (ValueError, TypeError):
        obj = None
    if isinstance(obj, dict):
        raw = obj.get('driver_id') or obj.get('driverId') or obj.get('id')
        name = obj.get('name') or obj.get('driver_name')
    if not isinstance(raw, str):
        return None
    driver_id = raw.strip().upper()
    if not re.fullmatch(r'TX-?\d{1,12}', driver_id):
        return None
    return driver_id, name[:100] if isinstance(name, str) and name else driver_id


class DriverIdentity:
    """One active driver. Activation must follow an external DB validation."""
    def __init__(self, ttl_seconds=None, clock=None):
        # Kept for backwards-compatible callers; sessions no longer expire.
        self.clear()

    def clear(self):
        self.driver_id = self.driver_name = self.session_id = self.vehicle_plate = None

    def expire(self):
        """No automatic expiry: driver/admin must end the session."""
        return False

    def activate(self, driver_id, driver_name, vehicle_plate):
        """Call only after ASP.NET confirms driver and assigned vehicle."""
        parsed = parse_driver_qr(driver_id)
        if parsed is None or not isinstance(vehicle_plate, str) or not vehicle_plate.strip():
            raise ValueError('Validated driver and assigned vehicle required')
        driver_id = parsed[0]
        if driver_id == self.driver_id:
            return False
        self.driver_id = driver_id
        self.driver_name = str(driver_name or driver_id)[:100]
        self.vehicle_plate = vehicle_plate.strip()
        self.session_id = uuid.uuid4().hex
        return True

    def observe(self, payload):
        """Parse QR without activating; callers must validate with ASP.NET first."""
        return parse_driver_qr(payload)

"""Private Python -> ASP.NET Core driver assignment verification."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class DriverValidationError(Exception):
    pass


def validate_driver(driver_id, *, base_url=None, service_key=None, timeout=2.0):
    """Fail closed. The browser never supplies the service key."""
    base_url = base_url or os.environ.get('PBL4_WEB_BASE_URL', 'http://127.0.0.1:5005')
    service_key = service_key or os.environ.get('PBL4_SERVICE_TOKEN')
    if not service_key:
        raise DriverValidationError('PBL4_SERVICE_TOKEN is not configured')
    url = base_url.rstrip('/') + '/api/ai-stream/internal/validate-driver'
    request = Request(url, data=json.dumps({'driverId': driver_id}).encode('utf-8'),
                      headers={'Content-Type': 'application/json', 'X-PBL4-Service-Key': service_key},
                      method='POST')
    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        raise DriverValidationError(f'ASP.NET validation unavailable or rejected: {exc}') from exc
    if not isinstance(data, dict) or data.get('driverId') != driver_id or not data.get('vehiclePlate'):
        raise DriverValidationError('ASP.NET returned invalid assignment')
    return data

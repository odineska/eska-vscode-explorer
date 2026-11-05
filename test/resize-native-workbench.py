"""Resize only one Code X11 window belonging to the isolated test host PID."""
import json
import re
import subprocess
import sys
from ctypes import CDLL, c_int, c_uint, c_ulong, c_void_p
from ctypes.util import find_library

pid = int(sys.argv[1])
current, requested = json.loads(sys.argv[2]), json.loads(sys.argv[3])
assert pid > 0 and 200 <= requested['width'] <= 4096 and 100 <= requested['height'] <= 3072
identifiers = subprocess.check_output(['xprop', '-root', '_NET_CLIENT_LIST'], text=True).split('#', 1)[-1].replace(',', '').split()
matches = []
for identifier in identifiers:
    if not identifier.startswith('0x'):
        continue
    metadata = subprocess.check_output(['xprop', '-id', identifier, '_NET_WM_PID', 'WM_CLASS', '_NET_WM_NAME', 'WM_NAME'], text=True)
    if f'= {pid}\n' not in metadata:
        continue
    assert any(name in metadata for name in ['Code', 'code', 'VSCodium', 'codium']), metadata
    if current.get('xid'):
        if int(identifier, 0) != current['xid']:
            continue
    elif current['title'] not in metadata:
        continue
    geometry = subprocess.check_output(['xwininfo', '-id', identifier], text=True)
    width = int(re.search(r'Width: (\d+)', geometry)[1])
    height = int(re.search(r'Height: (\d+)', geometry)[1])
    left = int(re.search(r'Absolute upper-left X:\s*(-?\d+)', geometry)[1])
    top = int(re.search(r'Absolute upper-left Y:\s*(-?\d+)', geometry)[1])
    same_position = abs(left - current['left']) <= 2 and abs(top - current['top']) <= 2
    if width == current['width'] and height == current['height'] and (current.get('xid') or same_position):
        matches.append(int(identifier, 0))
assert len(matches) == 1, {'pid': pid, 'current': current, 'matches': matches}
x11 = CDLL(find_library('X11'))
x11.XOpenDisplay.restype = c_void_p
x11.XResizeWindow.argtypes = [c_void_p, c_ulong, c_uint, c_uint]
x11.XSync.argtypes = [c_void_p, c_int]
x11.XCloseDisplay.argtypes = [c_void_p]
display = x11.XOpenDisplay(None)
assert display
try:
    x11.XResizeWindow(display, matches[0], requested['width'], requested['height'])
    x11.XSync(display, 0)
finally:
    x11.XCloseDisplay(display)
print(json.dumps({'window': matches[0], 'width': requested['width'], 'height': requested['height']}))

"""Resize one Code window owned by the isolated native regression host."""
import ctypes
from ctypes import wintypes
import json
from pathlib import PureWindowsPath
import sys


def resize(pid, current, requested):
    if pid <= 0 or any(type(requested.get(key)) is not int or not low <= requested[key] <= high
                       for key, low, high in [('width', 200, 4096), ('height', 100, 3072)]):
        raise ValueError('invalid isolated host PID or window dimensions')
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    dwm = ctypes.WinDLL('dwmapi', use_last_error=True)
    user.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    process = kernel.OpenProcess(0x1000, False, pid)
    if not process:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        filename = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(filename))
        if not kernel.QueryFullProcessImageNameW(process, 0, filename, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        if PureWindowsPath(filename.value).name.lower() not in {'code.exe', 'codium.exe', 'vscodium.exe'}:
            raise ValueError('native resize is restricted to the isolated Code process')
    finally:
        kernel.CloseHandle(process)

    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.EnumWindows.restype = wintypes.BOOL
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowRect.restype = wintypes.BOOL
    user.GetDpiForWindow.argtypes = [wintypes.HWND]
    user.GetDpiForWindow.restype = wintypes.UINT
    dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    dwm.DwmGetWindowAttribute.restype = ctypes.c_long
    matches, observed = [], []

    def inspect(hwnd, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user.IsWindowVisible(hwnd):
            return True
        if current.get('xid') and hwnd != current['xid']:
            return True
        title, classname = ctypes.create_unicode_buffer(32768), ctypes.create_unicode_buffer(256)
        user.GetWindowTextW(hwnd, title, len(title))
        user.GetClassNameW(hwnd, classname, len(classname))
        if classname.value != 'Chrome_WidgetWin_1' or title.value != current['title']:
            return True
        rect, visible = wintypes.RECT(), wintypes.RECT()
        if not user.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        scale = user.GetDpiForWindow(hwnd) / 96
        if scale <= 0:
            return True
        candidates = [rect]
        if dwm.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(visible), ctypes.sizeof(visible)) == 0:
            candidates.append(visible)
        observed.append({'window': hwnd, 'dpi': scale * 96,
                         'rects': [[r.left, r.top, r.right - r.left, r.bottom - r.top] for r in candidates]})
        for measured in candidates:
            expected = [current['left'], current['top'], current['width'], current['height']]
            actual = [measured.left, measured.top, measured.right - measured.left, measured.bottom - measured.top]
            if all(abs(value - round(want * scale)) <= 2 for value, want in zip(actual, expected)):
                correction = (rect.right - rect.left - actual[2], rect.bottom - rect.top - actual[3])
                matches.append((hwnd, scale, correction))
                break
        return True

    callback = callback_type(inspect)
    if not user.EnumWindows(callback, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    if len(matches) != 1:
        raise ValueError(json.dumps({'pid': pid, 'current': current, 'matches': matches, 'observed': observed}))
    hwnd, scale, correction = matches[0]
    user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                 ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user.SetWindowPos.restype = wintypes.BOOL
    width, height = (round(requested[key] * scale) + correction[i] for i, key in enumerate(['width', 'height']))
    # Preserve position, stacking and keyboard focus in this disposable test window.
    if not user.SetWindowPos(hwnd, None, 0, 0, width, height, 0x0002 | 0x0004 | 0x0010):
        raise ctypes.WinError(ctypes.get_last_error())
    return {'window': hwnd, 'width': requested['width'], 'height': requested['height'], 'dpi': round(scale * 96)}


if __name__ == '__main__':
    print(json.dumps(resize(int(sys.argv[1]), json.loads(sys.argv[2]), json.loads(sys.argv[3]))))

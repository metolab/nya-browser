#!/usr/bin/env python3
"""Inject UTF-8 text into the focused X11 window via a reused scratch keycode.

Does not touch CLIPBOARD/PRIMARY. ASCII already in the keymap is typed on its
real keycode; everything else reuses one unused (or stolen) keycode, waits for
MappingNotify, then XTest down/up.
"""

from __future__ import annotations

import atexit
import ctypes
import ctypes.util
import os
import select
import subprocess
import sys
import time

NoSymbol = 0
MappingNotify = 34
KeyPress = 2
CurrentTime = 0
KeyPressMask = 1 << 0
StructureNotifyMask = 1 << 17
FocusChangeMask = 1 << 21
MapNotify = 19
FocusIn = 9

XK_Shift_L = 0xFFE1
XK_Shift_R = 0xFFE2
XK_Control_L = 0xFFE3
XK_Control_R = 0xFFE4
XK_Caps_Lock = 0xFFE5
XK_Shift_Lock = 0xFFE6
XK_Meta_L = 0xFFE7
XK_Meta_R = 0xFFE8
XK_Alt_L = 0xFFE9
XK_Alt_R = 0xFFEA
XK_Super_L = 0xFFEB
XK_Super_R = 0xFFEC
XK_ISO_Level3_Shift = 0xFE03
XK_Mode_switch = 0xFF7E

MOD_KEYSYMS = (
    XK_Shift_L,
    XK_Shift_R,
    XK_Control_L,
    XK_Control_R,
    XK_Caps_Lock,
    XK_Shift_Lock,
    XK_Meta_L,
    XK_Meta_R,
    XK_Alt_L,
    XK_Alt_R,
    XK_Super_L,
    XK_Super_R,
    XK_ISO_Level3_Shift,
    XK_Mode_switch,
)

# After remap: give other X clients time to apply MappingNotify / XkbMapNotify.
# After tap: do not remap again until they have translated the previous keycode.
GAP_S = max(0.0, float(os.environ.get('NYA_XTYPE_GAP_MS', '10')) / 1000.0)
MAP_WAIT_S = max(0.01, float(os.environ.get('NYA_XTYPE_MAP_WAIT_MS', '50')) / 1000.0)


def _load(name: str):
    path = ctypes.util.find_library(name)
    if not path:
        raise RuntimeError(f'lib{name} not found')
    return ctypes.CDLL(path, mode=os.RTLD_GLOBAL)


x11 = _load('X11')
xtst = _load('Xtst')

x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XConnectionNumber.restype = ctypes.c_int
x11.XConnectionNumber.argtypes = [ctypes.c_void_p]
x11.XPending.restype = ctypes.c_int
x11.XPending.argtypes = [ctypes.c_void_p]
x11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
x11.XDisplayKeycodes.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
x11.XGetKeyboardMapping.restype = ctypes.POINTER(ctypes.c_ulong)
x11.XGetKeyboardMapping.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_int),
]
x11.XChangeKeyboardMapping.argtypes = [
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.c_int,
]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeycodeToKeysym.restype = ctypes.c_ulong
x11.XKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int]
x11.XFree.argtypes = [ctypes.c_void_p]
x11.XInitThreads.restype = ctypes.c_int
xtst.XTestFakeKeyEvent.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_ulong,
]
xtst.XTestGrabControl.argtypes = [ctypes.c_void_p, ctypes.c_int]

x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XCreateSimpleWindow.restype = ctypes.c_ulong
x11.XCreateSimpleWindow.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
    ctypes.c_uint,
    ctypes.c_uint,
    ctypes.c_ulong,
    ctypes.c_ulong,
]
x11.XSelectInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_long]
x11.XMapRaised.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
x11.XStoreBytes.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XFetchBytes.restype = ctypes.c_void_p
x11.XFetchBytes.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
x11.XQueryKeymap.argtypes = [ctypes.c_void_p, ctypes.c_char_p]

RevertFocus = 0


class XEvent(ctypes.Structure):
    _fields_ = [('type', ctypes.c_int), ('pad', ctypes.c_long * 24)]


class XMappingEvent(ctypes.Structure):
    _fields_ = [
        ('type', ctypes.c_int),
        ('serial', ctypes.c_ulong),
        ('send_event', ctypes.c_int),
        ('display', ctypes.c_void_p),
        ('window', ctypes.c_ulong),
        ('request', ctypes.c_int),
        ('first_keycode', ctypes.c_int),
        ('count', ctypes.c_int),
    ]


class XKeyEvent(ctypes.Structure):
    _fields_ = [
        ('type', ctypes.c_int),
        ('serial', ctypes.c_ulong),
        ('send_event', ctypes.c_int),
        ('display', ctypes.c_void_p),
        ('window', ctypes.c_ulong),
        ('root', ctypes.c_ulong),
        ('subwindow', ctypes.c_ulong),
        ('time', ctypes.c_ulong),
        ('x', ctypes.c_int),
        ('y', ctypes.c_int),
        ('x_root', ctypes.c_int),
        ('y_root', ctypes.c_int),
        ('state', ctypes.c_uint),
        ('keycode', ctypes.c_uint),
        ('same_screen', ctypes.c_int),
    ]


class XClientEvent(ctypes.Union):
    _fields_ = [('type', ctypes.c_int), ('xkey', XKeyEvent), ('xmapping', XMappingEvent), ('pad', XEvent)]


x11.XRefreshKeyboardMapping.argtypes = [ctypes.POINTER(XMappingEvent)]


def unicode_keysym(cp: int) -> int:
    if 0x20 <= cp <= 0xFF:
        return cp
    return 0x01000000 | cp


def keysym_to_char(ks: int) -> str:
    if not ks:
        return ''
    if 0x20 <= ks <= 0xFF:
        return chr(ks)
    if ks >= 0x01000000:
        cp = ks & 0xFFFFFF
        if cp >= 0x20:
            return chr(cp)
    return ''


def _mapping(dpy, first: int, count: int):
    spk = ctypes.c_int()
    ptr = x11.XGetKeyboardMapping(dpy, first, count, ctypes.byref(spk))
    if not ptr:
        raise RuntimeError('XGetKeyboardMapping failed')
    n = spk.value
    vals = [int(ptr[i]) for i in range(count * n)]
    x11.XFree(ptr)
    return n, vals


def _set_keycode(dpy, kc: int, spk: int, keysym: int) -> None:
    arr = (ctypes.c_ulong * spk)(*([keysym] * spk))
    x11.XChangeKeyboardMapping(dpy, kc, spk, arr, 1)


def _empty_keycodes(dpy) -> tuple[int, int, int, list[int]]:
    lo = ctypes.c_int()
    hi = ctypes.c_int()
    x11.XDisplayKeycodes(dpy, ctypes.byref(lo), ctypes.byref(hi))
    spk, vals = _mapping(dpy, lo.value, hi.value - lo.value + 1)
    empty = []
    for kc in range(lo.value, hi.value + 1):
        base = (kc - lo.value) * spk
        if all(s == NoSymbol for s in vals[base : base + spk]):
            empty.append(kc)
    return lo.value, hi.value, spk, empty


def _wait_mapping(dpy, timeout: float = MAP_WAIT_S) -> bool:
    x11.XFlush(dpy)
    fd = x11.XConnectionNumber(dpy)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if x11.XPending(dpy):
            ev = XClientEvent()
            x11.XNextEvent(dpy, ctypes.byref(ev))
            if ev.type == MappingNotify:
                x11.XRefreshKeyboardMapping(ctypes.byref(ev.xmapping))
                return True
            continue
        remain = deadline - time.monotonic()
        if remain <= 0:
            break
        select.select([fd], [], [], remain)
    x11.XSync(dpy, 0)
    return False


def _keycode_down(dpy, kc: int) -> bool:
    keys = ctypes.create_string_buffer(32)
    x11.XQueryKeymap(dpy, keys)
    return bool(keys.raw[kc // 8] & (1 << (kc % 8)))


def _clear_modifiers(dpy) -> list[int]:
    raised = []
    for ks in MOD_KEYSYMS:
        kc = x11.XKeysymToKeycode(dpy, ks)
        if not kc:
            continue
        if _keycode_down(dpy, kc):
            xtst.XTestFakeKeyEvent(dpy, kc, 0, CurrentTime)
            raised.append(kc)
    if raised:
        x11.XSync(dpy, 0)
    return raised


def _restore_modifiers(dpy, raised: list[int]) -> None:
    for kc in raised:
        xtst.XTestFakeKeyEvent(dpy, kc, 1, CurrentTime)
    if raised:
        x11.XSync(dpy, 0)


def _tap(dpy, kc: int) -> None:
    xtst.XTestFakeKeyEvent(dpy, kc, 1, CurrentTime)
    xtst.XTestFakeKeyEvent(dpy, kc, 0, CurrentTime)
    x11.XFlush(dpy)


def _existing_keycode(dpy, keysym: int) -> tuple[int, bool] | None:
    """Return (keycode, need_shift) if keysym already lives in the map."""
    kc = x11.XKeysymToKeycode(dpy, keysym)
    if not kc:
        return None
    for level in range(8):
        got = int(x11.XKeycodeToKeysym(dpy, kc, level))
        if got == keysym:
            return kc, level % 2 == 1
    return None


class Injector:
    def __init__(self, dpy):
        self.dpy = dpy
        self.lo, self.hi, self.spk, empty = _empty_keycodes(dpy)
        if empty:
            self.scratch = empty[-1]
            self.stolen = False
            self.saved = None
        else:
            self.scratch = self.hi
            self.stolen = True
            spk, vals = _mapping(dpy, self.scratch, 1)
            self.spk = spk
            self.saved = vals[:]
        xtst.XTestGrabControl(dpy, 1)

    def close(self) -> None:
        if self.stolen and self.saved is not None:
            arr = (ctypes.c_ulong * len(self.saved))(*self.saved)
            x11.XChangeKeyboardMapping(self.dpy, self.scratch, self.spk, arr, 1)
            x11.XSync(self.dpy, 0)
        xtst.XTestGrabControl(self.dpy, 0)

    def type_text(self, text: str, mode: str = 'scratch') -> int:
        """Return number of characters actually injected."""
        sent = 0
        raised = _clear_modifiers(self.dpy)
        try:
            if mode == 'noreuse':
                sent = self._type_noreuse(text)
            else:
                sent = self._type_scratch(text)
        finally:
            _restore_modifiers(self.dpy, raised)
        return sent

    def _type_scratch(self, text: str) -> int:
        sent = 0
        shift = x11.XKeysymToKeycode(self.dpy, XK_Shift_L)
        for ch in text:
            cp = ord(ch)
            if cp < 0x20:
                continue
            ks = unicode_keysym(cp)
            existing = _existing_keycode(self.dpy, ks)
            if existing:
                kc, need_shift = existing
                if need_shift and shift:
                    xtst.XTestFakeKeyEvent(self.dpy, shift, 1, CurrentTime)
                _tap(self.dpy, kc)
                if need_shift and shift:
                    xtst.XTestFakeKeyEvent(self.dpy, shift, 0, CurrentTime)
                    x11.XFlush(self.dpy)
                sent += 1
                continue
            _set_keycode(self.dpy, self.scratch, self.spk, ks)
            x11.XSync(self.dpy, 0)
            _wait_mapping(self.dpy)
            if GAP_S:
                time.sleep(GAP_S)
            _tap(self.dpy, self.scratch)
            x11.XSync(self.dpy, 0)
            if GAP_S:
                time.sleep(GAP_S)
            sent += 1
        x11.XSync(self.dpy, 0)
        return sent

    def _type_noreuse(self, text: str) -> int:
        """x11vnc-style: occupy a fresh empty keycode per unique keysym, drop when full."""
        lo, hi, spk, empty = _empty_keycodes(self.dpy)
        assigned: dict[int, int] = {}
        sent = 0
        for ch in text:
            cp = ord(ch)
            if cp < 0x20:
                continue
            ks = unicode_keysym(cp)
            kc = assigned.get(ks)
            if kc is None:
                if not empty:
                    continue
                kc = empty.pop()
                assigned[ks] = kc
                _set_keycode(self.dpy, kc, spk, ks)
                x11.XFlush(self.dpy)
            _tap(self.dpy, kc)
            sent += 1
        x11.XSync(self.dpy, 0)
        return sent


def open_display(name: str | None = None):
    x11.XInitThreads()
    raw = None if name is None else name.encode()
    dpy = x11.XOpenDisplay(raw)
    if not dpy:
        raise RuntimeError(f'cannot open display {name or os.environ.get("DISPLAY")}')
    return dpy


def inject_stdin() -> None:
    text = sys.stdin.buffer.read().decode('utf-8')
    if not text:
        return
    dpy = open_display()
    inj = Injector(dpy)
    try:
        inj.type_text(text, 'scratch')
    finally:
        inj.close()
        x11.XCloseDisplay(dpy)


def _start_xvfb() -> tuple[subprocess.Popen, str]:
    for n in range(70, 130):
        sock = f'/tmp/.X11-unix/X{n}'
        if not os.path.exists(sock):
            display = f':{n}'
            proc = subprocess.Popen(
                [
                    'Xvfb',
                    display,
                    '-screen',
                    '0',
                    '800x600x24',
                    '+extension',
                    'XTEST',
                    '-nolisten',
                    'tcp',
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.exists(sock) and proc.poll() is None:
                    atexit.register(lambda p=proc: p.kill())
                    return proc, display
                if proc.poll() is not None:
                    break
                time.sleep(0.05)
            proc.kill()
    raise RuntimeError('could not start Xvfb')


def _drain(recv) -> None:
    while x11.XPending(recv):
        ev = XClientEvent()
        x11.XNextEvent(recv, ctypes.byref(ev))
        if ev.type == MappingNotify:
            x11.XRefreshKeyboardMapping(ctypes.byref(ev.xmapping))


def _collect(recv, win, expected: int, timeout: float) -> str:
    got: list[str] = []
    fd = x11.XConnectionNumber(recv)
    deadline = time.monotonic() + timeout
    while len(got) < expected and time.monotonic() < deadline:
        if not x11.XPending(recv):
            select.select([fd], [], [], min(0.05, max(0.0, deadline - time.monotonic())))
            continue
        ev = XClientEvent()
        x11.XNextEvent(recv, ctypes.byref(ev))
        if ev.type == MappingNotify:
            x11.XRefreshKeyboardMapping(ctypes.byref(ev.xmapping))
            continue
        if ev.type != KeyPress:
            continue
        kc = ev.xkey.keycode
        ks = int(x11.XKeycodeToKeysym(recv, kc, 0))
        ch = keysym_to_char(ks)
        if ch:
            got.append(ch)
    return ''.join(got)


def _focus_window(recv):
    root = x11.XDefaultRootWindow(recv)
    win = x11.XCreateSimpleWindow(recv, root, 0, 0, 400, 200, 0, 0, 0xFFFFFF)
    x11.XSelectInput(recv, win, KeyPressMask | StructureNotifyMask | FocusChangeMask)
    x11.XMapRaised(recv, win)
    x11.XSync(recv, 0)
    fd = x11.XConnectionNumber(recv)
    deadline = time.monotonic() + 2
    mapped = False
    while time.monotonic() < deadline and not mapped:
        if x11.XPending(recv):
            ev = XClientEvent()
            x11.XNextEvent(recv, ctypes.byref(ev))
            if ev.type == MapNotify:
                mapped = True
        else:
            select.select([fd], [], [], 0.05)
    x11.XSetInputFocus(recv, win, RevertFocus, CurrentTime)
    x11.XSync(recv, 0)
    time.sleep(0.05)
    return win


def selftest() -> int:
    xvfb, display = _start_xvfb()
    os.environ['DISPLAY'] = display
    recv = open_display(display)
    win = _focus_window(recv)
    inj_dpy = open_display(display)
    inj = Injector(inj_dpy)
    failures = 0

    def check(name: str, ok: bool, detail: str = '') -> None:
        nonlocal failures
        status = 'ok' if ok else 'FAIL'
        print(f'{status}  {name}' + (f'  {detail}' if detail else ''))
        if not ok:
            failures += 1

    phrases = ['这个太平淡了', '要有一些剧情', '我比较喜欢']
    x11.XStoreBytes(recv, b'CLIP-SENTINEL', 13)

    lo, hi, spk, empty = _empty_keycodes(inj_dpy)
    n_empty = len(empty)
    overflow = ''.join(chr(0x4E00 + i) for i in range(n_empty + 24))
    print(f'# empty keycodes={n_empty} overflow_len={len(overflow)} scratch={inj.scratch}')

    import threading

    received = {'noreuse': '', 'scratch': '', 'phrases': ''}

    def run_inject(mode: str, text: str, slot: str) -> None:
        time.sleep(0.05)
        inj.type_text(text, mode)
        received[slot] = 'sent'

    # --- reproduce x11vnc slot exhaustion ---
    t = threading.Thread(target=run_inject, args=('noreuse', overflow, 'noreuse'), daemon=True)
    t.start()
    got_old = _collect(recv, win, len(overflow), 8)
    t.join(timeout=8)
    check(
        'repro: x11vnc-style drop unique CJK when keycodes run out',
        len(got_old) < len(overflow),
        f'got {len(got_old)}/{len(overflow)} {got_old[:20]!r}',
    )
    x11.XSync(recv, 0)
    time.sleep(0.08)
    _drain(recv)

    # --- scratch inject recovers the same payload ---
    t = threading.Thread(target=run_inject, args=('scratch', overflow, 'scratch'), daemon=True)
    t.start()
    got_new = _collect(recv, win, len(overflow), 12)
    t.join(timeout=12)
    check(
        'fix: scratch+MappingNotify injects every unique CJK',
        got_new == overflow,
        f'got {len(got_new)}/{len(overflow)}' + ('' if got_new == overflow else f' {got_new[:24]!r} vs {overflow[:24]!r}'),
    )

    _drain(recv)

    blob = ''.join(phrases)
    t = threading.Thread(target=run_inject, args=('scratch', blob, 'phrases'), daemon=True)
    t.start()
    got_phrases = _collect(recv, win, len(blob), 8)
    t.join(timeout=8)
    check('fix: user phrases 这个太平淡了 / 要有一些剧情 / 我比较喜欢', got_phrases == blob, repr(got_phrases))

    inject_src = open(__file__, encoding='utf-8').read().split('def selftest')[0]
    check(
        'injector code does not call xclip or X selection APIs',
        'xclip' not in inject_src and 'XSetSelectionOwner' not in inject_src and 'XConvertSelection' not in inject_src,
    )
    try:
        n = ctypes.c_int()
        ptr = x11.XFetchBytes(recv, ctypes.byref(n))
        clip = ctypes.string_at(ptr, n.value) if ptr else b''
        if ptr:
            x11.XFree(ptr)
        check('cutbuffer untouched after inject', clip == b'CLIP-SENTINEL', repr(clip))
    except Exception as exc:
        check('cutbuffer unread (non-fatal)', True, str(exc))

    inj.close()
    x11.XCloseDisplay(inj_dpy)
    x11.XCloseDisplay(recv)
    xvfb.kill()
    return 1 if failures else 0


def main() -> int:
    if '--selftest' in sys.argv:
        try:
            return selftest()
        except Exception as exc:
            print(f'FAIL  selftest crashed: {exc}', file=sys.stderr)
            return 1
    try:
        inject_stdin()
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

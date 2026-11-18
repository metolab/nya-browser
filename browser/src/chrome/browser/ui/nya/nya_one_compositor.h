// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef CHROME_BROWSER_UI_NYA_NYA_ONE_COMPOSITOR_H_
#define CHROME_BROWSER_UI_NYA_NYA_ONE_COMPOSITOR_H_

#include <string>

#include "ui/gfx/native_ui_types.h"
#include "ui/views/widget/widget.h"

namespace nya {

// --nya-x11-multi-display: menus, bubbles, and window.open popups stay
// NativeWidgetAura on the session GPU compositor. Extra type_normal
// Browser windows (Ctrl+N / Chrome 新窗口) are real X11 Desktop widgets
// so Openbox/tint2 can see them. Each extra normal window gets its own
// EGL-readback present (named FBO, 013).
bool OneCompositorEnabled();

// True for an extra type_normal BrowserWidget that should be a real X11
// window. params.name is "BrowserWidget" after BrowserWidget::Init;
// wm_role_name is "browser" for type_normal (popups use "pop-up" or leave
// it empty when hosted in-compositor).
bool IsExtraDesktopBrowser(const views::Widget::InitParams& params);

// Desktop host already open on |x11_display|. Empty display prefers the
// active host, then any host. Null if this would be the first
// AcceleratedWidget on that X server.
gfx::NativeView FindDesktopHost(const std::string& x11_display);

// Prefer params.parent / params.context; otherwise search by x11_display.
gfx::NativeView FindDesktopHost(const views::Widget::InitParams& params);

// True when this widget must not create a second Desktop AcceleratedWidget.
// Extra type_normal BrowserWidget windows are excluded — they are real
// X11 GPU windows.
bool ShouldHostInExistingCompositor(const views::Widget::InitParams& params);

}  // namespace nya

#endif  // CHROME_BROWSER_UI_NYA_NYA_ONE_COMPOSITOR_H_

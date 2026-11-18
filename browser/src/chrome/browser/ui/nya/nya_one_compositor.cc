// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#include "chrome/browser/ui/nya/nya_one_compositor.h"

#include "base/command_line.h"
#include "components/ungoogled/ungoogled_switches.h"
#include "ui/aura/window.h"
#include "ui/views/widget/desktop_aura/desktop_window_tree_host_platform.h"
#include "ui/views/widget/widget.h"

namespace nya {

bool OneCompositorEnabled() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch(
      switches::kNyaX11MultiDisplay);
}

bool IsExtraDesktopBrowser(const views::Widget::InitParams& params) {
  if (!OneCompositorEnabled()) {
    return false;
  }
  if (params.name != "BrowserWidget") {
    return false;
  }
  // AuraLinux GetWidgetParams sets "browser" for type_normal. Popups set
  // "pop-up"; in-compositor Child widgets leave the role empty.
  if (params.wm_role_name != "browser") {
    return false;
  }
  return FindDesktopHost(params.x11_display) != nullptr;
}

gfx::NativeView FindDesktopHost(const std::string& x11_display) {
  gfx::NativeView fallback = nullptr;
  gfx::NativeView active = nullptr;
  for (aura::Window* window :
       views::DesktopWindowTreeHostPlatform::GetAllOpenWindows()) {
    views::Widget* widget = views::Widget::GetWidgetForNativeView(window);
    if (!widget) {
      widget = views::Widget::GetWidgetForNativeWindow(window);
    }
    if (!widget) {
      continue;
    }
    if (!fallback) {
      fallback = window;
    }
    if (widget->IsActive()) {
      active = window;
    }
    if (!x11_display.empty() && widget->x11_display() == x11_display) {
      return window;
    }
  }
  if (!x11_display.empty()) {
    return nullptr;
  }
  return active ? active : fallback;
}

gfx::NativeView FindDesktopHost(const views::Widget::InitParams& params) {
  if (params.parent) {
    return params.parent;
  }
  if (params.context) {
    return params.context;
  }
  return FindDesktopHost(params.x11_display);
}

bool ShouldHostInExistingCompositor(const views::Widget::InitParams& params) {
  if (!OneCompositorEnabled()) {
    return false;
  }
  if (IsExtraDesktopBrowser(params)) {
    return false;
  }
  return FindDesktopHost(params) != nullptr;
}

}  // namespace nya

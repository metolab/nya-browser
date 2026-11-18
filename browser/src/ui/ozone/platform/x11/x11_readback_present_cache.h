// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef UI_OZONE_PLATFORM_X11_X11_READBACK_PRESENT_CACHE_H_
#define UI_OZONE_PLATFORM_X11_X11_READBACK_PRESENT_CACHE_H_

#include "base/memory/scoped_refptr.h"
#include "base/task/single_thread_task_runner.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/gfx/x/xproto.h"

namespace ui {

struct X11ReadbackPresentTarget {
  x11::Window window = x11::Window::None;
  x11::GraphicsContext gc{};
  x11::VisualId visual{};
  scoped_refptr<base::SingleThreadTaskRunner> ui_runner;
};

// UI-thread owned GC/visual for EGL-readback present. The GPU thread must not
// Sync() on an unpumped xcb connection (in-process GPU deadlock / freeze).
class X11ReadbackPresentCache {
 public:
  static void Register(gfx::AcceleratedWidget widget,
                       const X11ReadbackPresentTarget& target);
  static void Unregister(gfx::AcceleratedWidget widget);
  static bool Lookup(gfx::AcceleratedWidget widget,
                     X11ReadbackPresentTarget* out);
  static bool Contains(gfx::AcceleratedWidget widget);
  // Extra type_normal X11 windows may also claim a readback view. Named
  // FBO present (013) keeps two pbuffers from sharing FBO 0. Refusing a
  // second view blanked WebContents or fell back to MIT-SHM (freeze).
  static bool TryClaimEglView(gfx::AcceleratedWidget widget);
  static void ReleaseEglView(gfx::AcceleratedWidget widget);
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_X11_X11_READBACK_PRESENT_CACHE_H_

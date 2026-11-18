// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#include "ui/ozone/platform/x11/x11_readback_present_cache.h"

#include <map>
#include <string>

#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/synchronization/lock.h"
#include "base/task/single_thread_task_runner.h"
#include "ui/gfx/x/connection.h"

namespace ui {
namespace {

struct Map {
  base::Lock lock;
  std::map<gfx::AcceleratedWidget, X11ReadbackPresentTarget> targets;
  std::map<std::string, gfx::AcceleratedWidget> egl_view_by_display;
};

Map& GetMap() {
  static base::NoDestructor<Map> map;
  return *map;
}

}  // namespace

void X11ReadbackPresentCache::Register(gfx::AcceleratedWidget widget,
                                       const X11ReadbackPresentTarget& target) {
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  map.targets[widget] = target;
}

void X11ReadbackPresentCache::Unregister(gfx::AcceleratedWidget widget) {
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  map.targets.erase(widget);
}

bool X11ReadbackPresentCache::Lookup(gfx::AcceleratedWidget widget,
                                     X11ReadbackPresentTarget* out) {
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  auto it = map.targets.find(widget);
  if (it == map.targets.end()) {
    return false;
  }
  *out = it->second;
  return true;
}

bool X11ReadbackPresentCache::Contains(gfx::AcceleratedWidget widget) {
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  return map.targets.contains(widget);
}

bool X11ReadbackPresentCache::TryClaimEglView(gfx::AcceleratedWidget widget) {
  const std::string display = x11::Connection::DisplayForIndex(
      x11::Connection::WidgetDisplayIndex(static_cast<uint32_t>(widget)));
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  auto it = map.egl_view_by_display.find(display);
  if (it != map.egl_view_by_display.end() && it->second != widget) {
    // Extra type_normal X11 windows need their own readback present.
    // 013's named FBO keeps glReadPixels off FBO 0. Refusing here blanked
    // WebContents or froze the session (MIT-SHM fallback).
    LOG(ERROR) << "nya-present extra EGL readback widget="
               << static_cast<uint32_t>(widget)
               << " display already has widget="
               << static_cast<uint32_t>(it->second);
  } else {
    map.egl_view_by_display[display] = widget;
  }
  return true;
}

void X11ReadbackPresentCache::ReleaseEglView(gfx::AcceleratedWidget widget) {
  auto& map = GetMap();
  base::AutoLock lock(map.lock);
  for (auto it = map.egl_view_by_display.begin();
       it != map.egl_view_by_display.end();) {
    if (it->second == widget) {
      it = map.egl_view_by_display.erase(it);
    } else {
      ++it;
    }
  }
}

}  // namespace ui

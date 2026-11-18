// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#include "chrome/browser/ui/nya/nya_browser_native_widget.h"

#include <string>

#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_init_state.h"
#include "chrome/browser/ui/nya/nya_one_compositor.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/browser_widget.h"
#include "content/public/browser/keyboard_event_processing_result.h"
#include "ui/base/mojom/window_show_state.mojom.h"
#include "ui/views/widget/widget.h"

namespace nya {

BrowserNativeWidgetChild::BrowserNativeWidgetChild(
    BrowserWidget* browser_widget,
    BrowserView* browser_view)
    : views::NativeWidgetAura(browser_widget),
      browser_view_(browser_view),
      browser_widget_(browser_widget) {}

BrowserNativeWidgetChild::~BrowserNativeWidgetChild() = default;

void BrowserNativeWidgetChild::ClientDestroyedWidget() {
  browser_widget_ = nullptr;
  browser_view_ = nullptr;
  NativeWidgetAura::ClientDestroyedWidget();
}

views::Widget::InitParams BrowserNativeWidgetChild::GetWidgetParams(
    views::Widget::InitParams::Ownership ownership) {
  views::Widget::InitParams params(ownership);
  params.native_widget = this;
  params.remove_standard_frame = true;
  params.opacity = views::Widget::InitParams::WindowOpacity::kTranslucent;

  std::string display;
  if (browser_view_ && browser_view_->browser()) {
    display = BrowserInitState::From(browser_view_->browser())
                  ->create_params()
                  .nya_x11_display;
  }
  gfx::NativeView host = FindDesktopHost(display);
  DCHECK(host) << "Extra browser windows require an existing GPU compositor";
  params.parent = host;
  params.context = host;
  // Transient (not child=true): views treats this as top-level so BrowserView
  // layout stays correct, while NativeWidgetAura still paints into the host
  // compositor. child=true would make screen bounds relative to a bubble.
  params.child = false;
  params.x11_display = display;
  return params;
}

bool BrowserNativeWidgetChild::UseCustomFrame() const {
  return true;
}

bool BrowserNativeWidgetChild::ShouldDrawRestoredFrameShadow() const {
  // Hosted as NativeWidgetAura on the session compositor — no
  // DesktopWindowTreeHost, so Linux CSD shadows would null-deref.
  return false;
}

bool BrowserNativeWidgetChild::UsesNativeSystemMenu() const {
  return false;
}

bool BrowserNativeWidgetChild::ShouldSaveWindowPlacement() const {
  return false;
}

void BrowserNativeWidgetChild::GetWindowPlacement(
    gfx::Rect* bounds,
    ui::mojom::WindowShowState* show_state) const {
  NativeWidgetAura::GetWindowPlacement(bounds, show_state);
}

content::KeyboardEventProcessingResult
BrowserNativeWidgetChild::PreHandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  return content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool BrowserNativeWidgetChild::HandleKeyboardEvent(
    const input::NativeWebKeyboardEvent& event) {
  return false;
}

bool BrowserNativeWidgetChild::ShouldRestorePreviousBrowserWidgetState()
    const {
  return true;
}

bool BrowserNativeWidgetChild::ShouldUseInitialVisibleOnAllWorkspaces() const {
  return false;
}

}  // namespace nya

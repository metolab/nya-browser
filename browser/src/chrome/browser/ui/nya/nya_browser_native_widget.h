// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef CHROME_BROWSER_UI_NYA_NYA_BROWSER_NATIVE_WIDGET_H_
#define CHROME_BROWSER_UI_NYA_NYA_BROWSER_NATIVE_WIDGET_H_

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/views/frame/browser_native_widget.h"
#include "ui/views/widget/native_widget_aura.h"

class BrowserView;
class BrowserWidget;

namespace nya {

// Extra Browser windows (window.open, undocked DevTools, PiP) on an X
// display that already has a GPU compositor. Hosted as NativeWidgetAura
// layers so they stay GPU-composited without a second EGL pbuffer.
class BrowserNativeWidgetChild : public views::NativeWidgetAura,
                                 public BrowserNativeWidget {
 public:
  BrowserNativeWidgetChild(BrowserWidget* browser_widget,
                           BrowserView* browser_view);
  BrowserNativeWidgetChild(const BrowserNativeWidgetChild&) = delete;
  BrowserNativeWidgetChild& operator=(const BrowserNativeWidgetChild&) = delete;

  // views::NativeWidgetAura:
  void ClientDestroyedWidget() override;

  // BrowserNativeWidget:
  views::Widget::InitParams GetWidgetParams(
      views::Widget::InitParams::Ownership ownership) override;
  bool UseCustomFrame() const override;
  bool ShouldDrawRestoredFrameShadow() const override;
  bool UsesNativeSystemMenu() const override;
  bool ShouldSaveWindowPlacement() const override;
  void GetWindowPlacement(
      gfx::Rect* bounds,
      ui::mojom::WindowShowState* show_state) const override;
  content::KeyboardEventProcessingResult PreHandleKeyboardEvent(
      const input::NativeWebKeyboardEvent& event) override;
  bool HandleKeyboardEvent(
      const input::NativeWebKeyboardEvent& event) override;
  bool ShouldRestorePreviousBrowserWidgetState() const override;
  bool ShouldUseInitialVisibleOnAllWorkspaces() const override;

 protected:
  ~BrowserNativeWidgetChild() override;

 private:
  raw_ptr<BrowserView> browser_view_;
  raw_ptr<BrowserWidget> browser_widget_;
};

}  // namespace nya

#endif  // CHROME_BROWSER_UI_NYA_NYA_BROWSER_NATIVE_WIDGET_H_

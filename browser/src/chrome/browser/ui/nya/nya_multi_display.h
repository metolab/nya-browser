// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef CHROME_BROWSER_UI_NYA_NYA_MULTI_DISPLAY_H_
#define CHROME_BROWSER_UI_NYA_NYA_MULTI_DISPLAY_H_

namespace nya {

// Starts a Unix socket at {user-data-dir}/nya-chrome.sock when
// --nya-x11-multi-display is set. Safe to call more than once.
void StartMultiDisplayController();

void StopMultiDisplayController();

}  // namespace nya

#endif  // CHROME_BROWSER_UI_NYA_NYA_MULTI_DISPLAY_H_

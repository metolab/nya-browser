// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/containers/span.h"
#include "third_party/blink/renderer/platform/platform_export.h"

namespace nya {

enum class WebrtcMode {
  kOffline,
  kDisabled,
  kDisableUdp,
  kReplace,
  kForward,
};

struct WebGpuInfo {
  std::string vendor;
  std::string architecture;
  std::string device;
  std::string description;
};

struct MediaDeviceSpoof {
  std::string device_id;
  std::string label;
  std::string group_id;
  std::string kind;  // audioinput | audiooutput | videoinput
};

// True when --nya-fp-seed is set on this process.
PLATFORM_EXPORT bool HasSeed();

// Brave BALANCED-style LSB perturbation. No-op without a seed.
PLATFORM_EXPORT void FarbleBytes(uint8_t* data, size_t size);
PLATFORM_EXPORT void FarbleBytes(base::span<uint8_t> data);

// Brave BALANCED-style amplitude fudge. No-op without a seed.
PLATFORM_EXPORT void FarbleAudio(float* data, size_t count);

PLATFORM_EXPORT std::optional<unsigned> HardwareConcurrency();
PLATFORM_EXPORT std::optional<float> DeviceMemory();

// Rewrite an NVIDIA ANGLE renderer string in place. Leaves non-NVIDIA
// renderers (SwiftShader, etc.) unchanged and keeps the host GL / driver
// suffix so the claimed card stays on the real driver.
PLATFORM_EXPORT std::string MaybeSpoofUnmaskedRenderer(const std::string& real);
// "Google Inc. (NVIDIA Corporation)" -> "Google Inc. (NVIDIA)" under Windows
// emulation on NVIDIA hardware.
PLATFORM_EXPORT std::string MaybeSpoofUnmaskedVendor(const std::string& real);
// True under Windows emulation when |real_renderer| is NVIDIA hardware, i.e.
// WebGL should report ANGLE D3D11 limits instead of the Linux driver's.
PLATFORM_EXPORT bool EmulatesWindowsGpu(const std::string& real_renderer);

PLATFORM_EXPORT std::optional<WebGpuInfo> MaybeSpoofWebGpu(
    const std::string& real_vendor,
    const std::string& real_description);

PLATFORM_EXPORT WebrtcMode GetWebrtcMode();
PLATFORM_EXPORT bool WebrtcForcesGoogleStun();
// nullopt = leave candidate; empty string = drop.
PLATFORM_EXPORT std::optional<std::string> MaybeRewriteIceCandidate(
    const std::string& sdp);
// Rewrites every a=candidate line. Identity if nothing changes.
PLATFORM_EXPORT std::string MaybeRewriteSdp(const std::string& sdp);

PLATFORM_EXPORT std::vector<MediaDeviceSpoof> SpoofedMediaDevices();
// Labels of the "default" and "communications" audio entries in the UI
// language. Windows prefixes them to the endpoint name; Linux shows the
// default label alone and has no communications entry (empty).
PLATFORM_EXPORT const std::string& MediaDefaultPrefix();
PLATFORM_EXPORT const std::string& MediaCommunicationsPrefix();

PLATFORM_EXPORT bool HasFontSpoof();
PLATFORM_EXPORT bool AllowsFontFamily(const std::string& family);
PLATFORM_EXPORT const std::vector<std::string>& SpoofedFontFamilies();
PLATFORM_EXPORT std::string FontPostscriptName(const std::string& family);
// Under Windows emulation: true for the fontconfig aliases (serif, Sans, ...)
// DirectWrite has no family for, so lookups that reach the platform with a
// literal generic name fall through to the last-resort Arial.
PLATFORM_EXPORT bool WindowsLacksFamily(const std::string& family);

enum class EmulatedOs {
  kNative,
  kWindows,
};

enum class WindowsRelease {
  kWin10,
  kWin11,
};

// --nya-os; kNative when unset.
PLATFORM_EXPORT EmulatedOs GetEmulatedOs();
PLATFORM_EXPORT bool EmulatesWindows();
PLATFORM_EXPORT WindowsRelease GetWindowsRelease();
// --nya-os-navigator-platform; empty when unset.
PLATFORM_EXPORT const std::string& NavigatorPlatform();
// --nya-os-ui-font: NONCLIENTMETRICS menu/caption/status family; empty when
// unset.
PLATFORM_EXPORT const std::string& WindowsUiFont();
// Windows emulation on a GPU host: claim the hardware codecs (HEVC decode,
// H.264 High / HEVC WebRTC) Chrome on Windows gets from the GPU.
PLATFORM_EXPORT bool EmulatesWindowsHwVideo();
// {mimeType, sdpFmtpLine} of the hardware WebRTC codecs Chrome on Windows
// lists after the software ones (before video/red); empty when not claimed.
PLATFORM_EXPORT std::vector<std::pair<std::string, std::string>>
WindowsHwRtcCodecs(bool sender);

}  // namespace nya

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

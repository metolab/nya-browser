// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
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

PLATFORM_EXPORT const std::string& DeviceName();
PLATFORM_EXPORT std::vector<MediaDeviceSpoof> SpoofedMediaDevices();

PLATFORM_EXPORT bool HasFontSpoof();
PLATFORM_EXPORT bool AllowsFontFamily(const std::string& family);
PLATFORM_EXPORT const std::vector<std::string>& SpoofedFontFamilies();
PLATFORM_EXPORT std::string FontPostscriptName(const std::string& family);

}  // namespace nya

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

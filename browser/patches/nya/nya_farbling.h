// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

#include <cstddef>
#include <cstdint>
#include <optional>

#include "base/containers/span.h"
#include "third_party/blink/renderer/platform/platform_export.h"

namespace nya {

// True when --nya-fp-seed is set on this process.
PLATFORM_EXPORT bool HasSeed();

// Brave BALANCED-style LSB perturbation. No-op without a seed.
PLATFORM_EXPORT void FarbleBytes(uint8_t* data, size_t size);
PLATFORM_EXPORT void FarbleBytes(base::span<uint8_t> data);

// Brave BALANCED-style amplitude fudge. No-op without a seed.
PLATFORM_EXPORT void FarbleAudio(float* data, size_t count);

PLATFORM_EXPORT std::optional<unsigned> HardwareConcurrency();
PLATFORM_EXPORT std::optional<float> DeviceMemory();

}  // namespace nya

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_NYA_NYA_FARBLING_H_

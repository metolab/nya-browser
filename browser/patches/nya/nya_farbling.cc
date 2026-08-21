// Copyright 2026 Nya Browser
// Use of this source code is governed by a BSD-style license.
//
// Session-stable farbling modeled on Brave's BALANCED algorithm
// (PriVaricator / FPRandom): deterministic noise from a process-wide seed
// forwarded to every renderer, including workers.

#include "third_party/blink/renderer/platform/nya/nya_farbling.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <string>

#include "base/command_line.h"
#include "base/strings/string_number_conversions.h"
#include "components/ungoogled/ungoogled_switches.h"

namespace nya {
namespace {

struct Config {
  bool has_seed = false;
  uint64_t seed = 1;
  std::optional<unsigned> hardware_concurrency;
  std::optional<float> device_memory;
};

uint64_t ParseSeed(const std::string& hex) {
  uint64_t value = 0;
  size_t n = std::min<size_t>(hex.size(), 16);
  for (size_t i = 0; i < n; ++i) {
    char c = hex[i];
    uint8_t nibble = 0;
    if (c >= '0' && c <= '9') {
      nibble = static_cast<uint8_t>(c - '0');
    } else if (c >= 'a' && c <= 'f') {
      nibble = static_cast<uint8_t>(c - 'a' + 10);
    } else if (c >= 'A' && c <= 'F') {
      nibble = static_cast<uint8_t>(c - 'A' + 10);
    } else {
      continue;
    }
    value = (value << 4) | nibble;
  }
  return value ? value : 1;
}

const Config& GetConfig() {
  static const Config config = [] {
    Config out;
    const base::CommandLine* cmd = base::CommandLine::ForCurrentProcess();
    if (!cmd) {
      return out;
    }
    if (cmd->HasSwitch(switches::kNyaFpSeed)) {
      out.has_seed = true;
      out.seed = ParseSeed(cmd->GetSwitchValueASCII(switches::kNyaFpSeed));
    }
    if (cmd->HasSwitch(switches::kNyaHwConcurrency)) {
      unsigned value = 0;
      if (base::StringToUint(
              cmd->GetSwitchValueASCII(switches::kNyaHwConcurrency), &value) &&
          value > 0) {
        out.hardware_concurrency = value;
      }
    }
    if (cmd->HasSwitch(switches::kNyaDeviceMemory)) {
      double value = 0;
      if (base::StringToDouble(
              cmd->GetSwitchValueASCII(switches::kNyaDeviceMemory), &value) &&
          value > 0) {
        out.device_memory = static_cast<float>(value);
      }
    }
    return out;
  }();
  return config;
}

uint32_t Lcg(uint32_t& state) {
  state = static_cast<uint32_t>(static_cast<uint64_t>(state) * 1664525u +
                                1013904223u);
  return state;
}

}  // namespace

bool HasSeed() {
  return GetConfig().has_seed;
}

void FarbleBytes(uint8_t* data, size_t size) {
  if (!data || size == 0 || !HasSeed()) {
    return;
  }
  const size_t flips = std::min<size_t>(64, std::max<size_t>(8, size / 256));
  uint32_t state = static_cast<uint32_t>(GetConfig().seed);
  for (size_t i = 0; i < flips; ++i) {
    const uint32_t r = Lcg(state);
    data[r % size] ^= 1u;
  }
}

void FarbleBytes(base::span<uint8_t> data) {
  FarbleBytes(data.data(), data.size());
}

void FarbleAudio(float* data, size_t count) {
  if (!data || count == 0 || !HasSeed()) {
    return;
  }
  // Brave BALANCED: scale by 0.99 + seed_fraction / 100.
  const double max_u64 =
      static_cast<double>(std::numeric_limits<uint64_t>::max());
  const double fudge =
      0.99 + (static_cast<double>(GetConfig().seed) / max_u64) / 100.0;
  for (size_t i = 0; i < count; ++i) {
    data[i] = static_cast<float>(data[i] * fudge);
  }
}

std::optional<unsigned> HardwareConcurrency() {
  return GetConfig().hardware_concurrency;
}

std::optional<float> DeviceMemory() {
  return GetConfig().device_memory;
}

}  // namespace nya

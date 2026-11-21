// PartyPad C++17 Adapter & Binary Frame Decoder
// Decodes PartyPad's 16-byte Input, 28-byte IMU Motion, and 14-byte Drawing binary packets
// directly (compatible with libdatachannel direct WebRTC DataChannel OR WebSocket bridge).

#include <cstdint>
#include <cstring>
#include <iostream>
#include <iomanip>
#include <string>
#include <vector>

namespace partypad {

constexpr uint8_t PKT_INPUT   = 0x01;
constexpr uint8_t PKT_MOTION  = 0x02;
constexpr uint8_t PKT_CONTROL = 0x03;
constexpr uint8_t PKT_DRAW    = 0x04;

struct InputFrame {
    uint16_t seq = 0;
    uint32_t buttons = 0; // bit 0=A, 1=B, 2=X, 3=Y, 4=L1, 5=R1, 6=L2, 7=R2, 8=SEL, 9=STA, 12..15=DPAD
    float lx = 0.0f;
    float ly = 0.0f;
    float rx = 0.0f;
    float ry = 0.0f;

    bool isPressed(int bit) const { return ((buttons >> bit) & 1u) != 0; }
};

struct MotionFrame {
    uint16_t seq = 0;
    float qx = 0.0f, qy = 0.0f, qz = 0.0f, qw = 1.0f;
    float omega = 0.0f;
    float hit = 0.0f;
};

struct DrawFrame {
    uint8_t op = 1; // 0=start, 1=move, 2=end, 3=clear, 4=undo
    uint16_t seq = 0;
    float x = 0.0f;
    float y = 0.0f;
    uint8_t r = 255, g = 255, b = 255;
    uint8_t width = 4;
    uint16_t strokeId = 0;
};

static uint16_t readU16LE(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

static int16_t readI16LE(const uint8_t* p) {
    return static_cast<int16_t>(readU16LE(p));
}

static uint32_t readU32LE(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) |
           (static_cast<uint32_t>(p[3]) << 24);
}

static float readF32LE(const uint8_t* p) {
    uint32_t bits = readU32LE(p);
    float f = 0.0f;
    std::memcpy(&f, &bits, sizeof(float));
    return f;
}

inline bool decodeInput(const uint8_t* data, size_t len, InputFrame& out) {
    if (len < 16 || data[0] != PKT_INPUT) return false;
    out.seq = readU16LE(data + 2);
    out.buttons = readU32LE(data + 4);
    out.lx = readI16LE(data + 8) / 32767.0f;
    out.ly = readI16LE(data + 10) / 32767.0f;
    out.rx = readI16LE(data + 12) / 32767.0f;
    out.ry = readI16LE(data + 14) / 32767.0f;
    return true;
}

inline bool decodeMotion(const uint8_t* data, size_t len, MotionFrame& out) {
    if (len < 28 || data[0] != PKT_MOTION) return false;
    out.seq = readU16LE(data + 2);
    out.qx = readF32LE(data + 4);
    out.qy = readF32LE(data + 8);
    out.qz = readF32LE(data + 12);
    out.qw = readF32LE(data + 16);
    out.omega = readF32LE(data + 20);
    out.hit = readF32LE(data + 24);
    return true;
}

inline bool decodeDraw(const uint8_t* data, size_t len, DrawFrame& out) {
    if (len < 14 || data[0] != PKT_DRAW) return false;
    out.op = data[1];
    out.seq = readU16LE(data + 2);
    out.x = readU16LE(data + 4) / 65535.0f;
    out.y = readU16LE(data + 6) / 65535.0f;
    out.r = data[8];
    out.g = data[9];
    out.b = data[10];
    out.width = data[11];
    out.strokeId = readU16LE(data + 12);
    return true;
}

} // namespace partypad

// Self-test demonstrating zero-copy decoding of a PartyPad 16-byte input packet.
// Hook `decodeInput` / `decodeMotion` / `decodeDraw` directly into libdatachannel's
// `dc->onMessage(...)` or your WebSocket server callback, and feed into ViGEmClient.
int main() {
    // Sample 16-byte packet: seq=10, buttons=0x0001 (A pressed), lx=+16383 (~0.5), ly=-16383 (~-0.5)
    std::vector<uint8_t> sample = {
        0x01, 0x00, 0x0A, 0x00,
        0x01, 0x00, 0x00, 0x00,
        0xFF, 0x3F, 0x01, 0xC0,
        0x00, 0x00, 0x00, 0x00
    };

    partypad::InputFrame frame;
    if (partypad::decodeInput(sample.data(), sample.size(), frame)) {
        std::cout << "[PartyPad-C++] Decoded Input seq=" << frame.seq
                  << " A=" << frame.isPressed(0)
                  << " LStick=(" << std::fixed << std::setprecision(2)
                  << frame.lx << ", " << frame.ly << ")\n";
    }
    return 0;
}

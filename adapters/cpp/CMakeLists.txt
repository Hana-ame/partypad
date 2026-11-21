cmake_minimum_required(VERSION 3.16)
project(partypad_cpp_adapter LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Minimal C++17 PartyPad Bridge Example
# Pair with IXWebSocket / Boost.Beast (WebSocket) or libdatachannel (direct WebRTC DataChannel)
# and Nefarius ViGEmClient (Windows virtual Xbox 360 controller).
add_executable(partypad_cpp_demo main.cpp)

cmake_minimum_required(VERSION 3.16)

# This is a standalone ESP-IDF project. It intentionally does not participate
# in the pnpm/Turbo build graph used by the desktop application.
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(note4c_firmware)

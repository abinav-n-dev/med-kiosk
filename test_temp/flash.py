import subprocess
import os
import sys
import time

BUILD_DIR = "/tmp/test_temp_build"
ESPTOOL_PATH = "/home/abinav/.arduino15/packages/esp32/tools/esptool_py/5.3.1/esptool"
PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
BAUD = "460800"
CHUNK_SIZE = 128 * 1024

def flash_file(addr_hex, file_path):
    cmd = [
        ESPTOOL_PATH,
        "--port", PORT,
        "--baud", BAUD,
        "--no-stub",
        "write-flash",
        "--flash-mode", "dio",
        "--flash-freq", "80m",
        "--flash-size", "4MB",
        addr_hex, file_path
    ]
    for attempt in range(1, 4):
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if res.returncode == 0:
            print(f"  OK: {os.path.basename(file_path)} at {addr_hex}")
            time.sleep(0.3)
            return True
        time.sleep(0.8)
    print(f"Failed to flash {file_path} at {addr_hex}")
    sys.exit(1)

print("\n--- 1. Flashing Bootloader, Partitions, and App0 ---")
flash_file("0x1000", os.path.join(BUILD_DIR, "test_temp.ino.bootloader.bin"))
flash_file("0x8000", os.path.join(BUILD_DIR, "test_temp.ino.partitions.bin"))
flash_file("0xe000", os.path.join(BUILD_DIR, "boot_app0.bin"))

print("\n--- 2. Flashing Main Application in 128KB Chunks ---")
bin_file = os.path.join(BUILD_DIR, "test_temp.ino.bin")
with open(bin_file, "rb") as f:
    full_data = f.read()

total_bytes = len(full_data)
num_chunks = (total_bytes + CHUNK_SIZE - 1) // CHUNK_SIZE
BASE_ADDR = 0x10000

for i in range(num_chunks):
    start = i * CHUNK_SIZE
    end = min(start + CHUNK_SIZE, total_bytes)
    chunk_data = full_data[start:end]
    addr = BASE_ADDR + start
    addr_hex = f"0x{addr:X}"
    chunk_file = f"/tmp/tt_chunk_{i}.bin"
    with open(chunk_file, "wb") as cf:
        cf.write(chunk_data)
    print(f"Chunk {i+1}/{num_chunks}: {len(chunk_data)} bytes at {addr_hex}...")
    flash_file(addr_hex, chunk_file)

print("\n--- 3. Hard Resetting ESP32 ---")
subprocess.run([ESPTOOL_PATH, "--port", PORT, "--after", "hard-reset", "run"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print("\nDeployment complete! Booting isolated test firmware...")

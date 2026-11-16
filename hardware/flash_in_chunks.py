import subprocess
import os
import sys
import time

BUILD_DIR = "/home/abinav/Projects/Kisok_main/hardware/build"
BINARY_PATH = f"{BUILD_DIR}/esp32_clinical_node.ino.bin"
BOOTLOADER_PATH = f"{BUILD_DIR}/esp32_clinical_node.ino.bootloader.bin"
PARTITIONS_PATH = f"{BUILD_DIR}/esp32_clinical_node.ino.partitions.bin"
BOOT_APP0_PATH = f"{BUILD_DIR}/boot_app0.bin"

ESPTOOL_PATH = "/home/abinav/.arduino15/packages/esp32/tools/esptool_py/5.3.1/esptool"
PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
BAUD = "460800"
CHUNK_SIZE = 128 * 1024  # 128 KB

print("==================================================")
print(f" Deploying Clinical Node to ESP32 on {PORT} ")
print("==================================================")

# Step 1: Flash Bootloader, Partitions, and boot_app0
print("\n--- 1. Flashing Bootloader, Partitions, and App0 ---")
boot_cmd = [
    ESPTOOL_PATH,
    "--port", PORT,
    "--baud", BAUD,
    "--no-stub",
    "write-flash",
    "--flash-mode", "dio",
    "--flash-freq", "80m",
    "--flash-size", "4MB",
    "0x1000", BOOTLOADER_PATH,
    "0x8000", PARTITIONS_PATH,
    "0xe000", BOOT_APP0_PATH
]
res = subprocess.run(boot_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
if res.returncode != 0:
    print("Warning: Initial boot write failed, retrying...")
    time.sleep(1)
    res = subprocess.run(boot_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if res.returncode != 0:
        print(f"Error flashing boot structures:\n{res.stdout[-400:]}")
        sys.exit(1)
print("  Bootloader (0x1000), Partitions (0x8000), and Boot App0 (0xe000) flashed OK.")

# Step 2: Flash Main Application in 128KB chunks
with open(BINARY_PATH, "rb") as f:
    full_data = f.read()

total_bytes = len(full_data)
num_chunks = (total_bytes + CHUNK_SIZE - 1) // CHUNK_SIZE
print(f"\n--- 2. Flashing Main Application ({total_bytes} bytes in {num_chunks} chunks) ---")

for i in range(num_chunks):
    start = i * CHUNK_SIZE
    end = min(start + CHUNK_SIZE, total_bytes)
    chunk_data = full_data[start:end]
    addr = 0x10000 + start
    addr_hex = f"0x{addr:X}"
    chunk_file = f"/tmp/clin_chunk_{i}.bin"
    with open(chunk_file, "wb") as cf:
        cf.write(chunk_data)

    print(f"Chunk {i+1}/{num_chunks}: {len(chunk_data)} bytes at {addr_hex}...")
    success = False
    for attempt in range(1, 4):
        cmd = [
            ESPTOOL_PATH,
            "--port", PORT,
            "--baud", BAUD,
            "--no-stub",
            "write-flash",
            "--flash-mode", "dio",
            "--flash-freq", "80m",
            "--flash-size", "4MB",
            addr_hex, chunk_file
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if res.returncode == 0:
            print(f"  OK: Chunk {i+1} verified.")
            success = True
            time.sleep(0.3)
            break
        else:
            print(f"  Attempt {attempt} failed. Retrying...")
            time.sleep(0.8)

    if not success:
        print(f"CRITICAL: Failed to flash chunk {i+1} at {addr_hex}.")
        sys.exit(1)

# Step 3: Hard reset
print("\n--- 3. Hard Resetting ESP32 ---")
subprocess.run([ESPTOOL_PATH, "--port", PORT, "--after", "hard-reset", "run"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

print("\n==================================================")
print("  CLINICAL NODE DEPLOYED AND RUNNING LIVE!        ")
print("==================================================")

import os
import termios
import sys
import time

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"

try:
    fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
except Exception as e:
    print(f"Error opening {PORT}: {e}")
    sys.exit(1)

attrs = termios.tcgetattr(fd)
attrs[0] = 0; attrs[1] = 0
attrs[2] = termios.B115200 | termios.CS8 | termios.CREAD | termios.CLOCAL
attrs[3] = 0; attrs[4] = termios.B115200; attrs[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, attrs)
termios.tcflush(fd, termios.TCIOFLUSH)

print("==================================================")
print(f"  Streaming MLX90614 Live Temperature on {PORT}  ")
print("  Press Ctrl+C to exit                            ")
print("==================================================\n")

buf = ""
try:
    while True:
        data = os.read(fd, 256)
        if data:
            buf += data.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if "[TEMP]" in line or "[SUCCESS" in line or "[POLLING]" in line:
                    print(line, flush=True)
except KeyboardInterrupt:
    print("\nExiting monitor.")
finally:
    os.close(fd)

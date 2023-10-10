import time
from pathlib import Path

Import("env")

print("Adding build time macro to build_time.h")
build_time_macro = f"#define BUILD_TIME_UNIX_S {int(time.time())}\n"
print(build_time_macro)
with open(Path("include") / "build_time.h", "w") as f:
  f.write(build_time_macro)

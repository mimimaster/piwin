#!/usr/bin/env python3
"""Finite, read-only macOS process sampling; no prompts, secrets, or process kills."""

import argparse
import ctypes
import datetime
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import subprocess
import sys
import time

MIB = 1024 * 1024
BUNDLE_PATTERN = re.compile(r"bundle ID = (app\.piwinwin\.desktop(?:\.shell)?)\s*$", re.M)
USAGE_FIELDS = """user_time system_time pkg_idle_wkups interrupt_wkups pageins
wired_size resident_size phys_footprint proc_start_abstime proc_exit_abstime
child_user_time child_system_time child_pkg_idle_wkups child_interrupt_wkups
child_pageins child_elapsed_abstime diskio_bytesread diskio_byteswritten
cpu_time_qos_default cpu_time_qos_maintenance cpu_time_qos_background
cpu_time_qos_utility cpu_time_qos_legacy cpu_time_qos_user_initiated
cpu_time_qos_user_interactive billed_system_time serviced_system_time logical_writes
lifetime_max_phys_footprint instructions cycles billed_energy serviced_energy
interval_max_phys_footprint runnable_time""".split()


class ProcessUsage(ctypes.Structure):
    # sys/resource.h rusage_info_v4. The start clock distinguishes reused PIDs.
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (field, ctypes.c_uint64) for field in USAGE_FIELDS
    ]


def run_text(arguments, timeout=5):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{Path(arguments[0]).name} exited {result.returncode}")
    return result.stdout


def parse_processes(source):
    processes = {}
    for line in source.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) != 4 or not all(value.isdigit() for value in fields[:3]):
            continue
        pid, parent, rss = map(int, fields[:3])
        processes[pid] = {"pid": pid, "ppid": parent, "rssBytes": rss * 1024,
                          "executable": fields[3]}
    return processes


def select_processes(processes, read_coalition, read_files):
    selected = {}
    unknown_webkit = []
    errors = []
    for pid, process in processes.items():
        executable = process["executable"]
        if Path(executable).name in ("piwin-desktop", "piwin-host"):
            selected[pid] = {**process, "ownership": "piwin-executable"}
    # OS descendants include worker Node processes, which have no piwin basename.
    changed = True
    while changed:
        changed = False
        for pid, process in processes.items():
            if pid not in selected and process["ppid"] in selected:
                selected[pid] = {**process, "ownership": "piwin-descendant"}
                changed = True
    for pid, process in processes.items():
        if "com.apple.WebKit." not in process["executable"] or pid in selected:
            continue
        try:
            coalition = BUNDLE_PATTERN.search(read_coalition(pid))
            if coalition:
                selected[pid] = {**process, "ownership": "resource-coalition",
                                 "bundleId": coalition.group(1)}
                continue
            # Development binaries can lack a bundle coalition. Do not guess
            # main vs pet from size, and never claim an arbitrary large WebView.
            files = read_files(pid)
            if "Caches/piwin-desktop/" in files or "/apps/desktop/" in files:
                selected[pid] = {**process, "ownership": "piwin-open-file"}
                continue
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            errors.append({"pid": pid, "error": str(error)})
        unknown_webkit.append(pid)
    return list(selected.values()), unknown_webkit, errors


def sample_usage(library, pid):
    usage = ProcessUsage()
    if library.proc_pid_rusage(pid, 4, ctypes.byref(usage)) != 0:
        return {"sampleError": "proc_pid_rusage unavailable", "errno": ctypes.get_errno()}
    return {"footprintBytes": usage.phys_footprint,
            "residentBytes": usage.resident_size,
            "lifetimePeakBytes": usage.lifetime_max_phys_footprint,
            "startClock": usage.proc_start_abstime}


def snapshot_due(process, previous, now, threshold, growth):
    footprint = process.get("footprintBytes")
    if footprint is None:
        return False
    identity = (process["pid"], process["startClock"])
    prior = previous.get(identity)
    if footprint < threshold and (prior is None or footprint - prior[1] < growth):
        return False
    return prior is None or now - prior[0] >= 600


def capture_categories(process, output, slot):
    destination = output / f"footprint-{slot:02d}.txt"
    # One snapshot per tick, 30 seconds maximum, 16 rotating slots. No heap dump
    # (which could contain conversation text or credentials) is collected.
    with destination.open("w") as stream:
        stream.write(json.dumps({"timestamp": timestamp(), "pid": process["pid"],
                                 "startClock": process["startClock"]}) + "\n")
        stream.flush()
        try:
            result = subprocess.run(["/usr/bin/footprint", "--swapped", str(process["pid"])],
                                    stdout=stream, stderr=stream, timeout=30)
            stream.write(f"\nexitCode={result.returncode}\n")
        except subprocess.TimeoutExpired:
            stream.write("\nsnapshot timed out\n")
    # Category summaries normally fit in KB; retain a bounded prefix if a
    # future tool version becomes verbose. Sampling JSONL is rotated separately.
    if destination.stat().st_size > 2 * MIB:
        with destination.open("r+b") as stream:
            stream.truncate(2 * MIB)
    os.chmod(destination, 0o600)
    return destination.name


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=Path.home() / ".piwin/diagnostics/memory")
    parser.add_argument("--duration-seconds", type=int, default=600)
    parser.add_argument("--interval-seconds", type=int, default=10)
    parser.add_argument("--threshold-mib", type=int, default=1024)
    parser.add_argument("--growth-mib", type=int, default=256)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("macOS only")
    if min(args.duration_seconds, args.interval_seconds, args.threshold_mib, args.growth_mib) <= 0:
        parser.error("duration, interval and budgets must be positive")
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True)
    lock = args.output / "recorder.lock"
    # flock permits restart after a crash without trusting a stale PID file.
    import fcntl
    lock_stream = lock.open("a+")
    try:
        fcntl.flock(lock_stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("a recorder already owns this output directory")
    lock_stream.seek(0)
    lock_stream.truncate()
    lock_stream.write(str(os.getpid()))
    lock_stream.flush()
    logger = logging.getLogger("desktop-memory-recorder")
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(args.output / "samples.jsonl", maxBytes=5 * MIB, backupCount=2)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    library.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    library.proc_pid_rusage.restype = ctypes.c_int
    started = time.monotonic()
    previous = {}
    baseline = {}
    snapshot_slot = 0
    logger.info(json.dumps({"event": "start", "timestamp": timestamp(), "pid": os.getpid(),
                            "durationSeconds": args.duration_seconds}))
    try:
        while time.monotonic() - started < args.duration_seconds:
            tick_started = time.monotonic()
            try:
                processes = parse_processes(run_text(["/bin/ps", "-axo", "pid=,ppid=,rss=,comm="]))
                selected, unknown, errors = select_processes(
                    processes,
                    lambda pid: run_text(["/bin/launchctl", "print", f"pid/{pid}"]),
                    lambda pid: run_text(["/usr/sbin/lsof", "-Fn", "-p", str(pid)]))
                identities = set()
                snapshot_taken = False
                for process in selected:
                    process.update(sample_usage(library, process["pid"]))
                    if "startClock" not in process:
                        continue
                    identity = (process["pid"], process["startClock"])
                    identities.add(identity)
                    # First sample is a growth baseline, not a prior snapshot.
                    first = baseline.setdefault(identity, process["footprintBytes"])
                    history = previous if identity in previous else {
                        identity: (float("-inf"), first)}
                    if not snapshot_taken and snapshot_due(
                            process, history, tick_started,
                            args.threshold_mib * MIB, args.growth_mib * MIB):
                        process["snapshot"] = capture_categories(process, args.output, snapshot_slot)
                        previous[identity] = (tick_started, process["footprintBytes"])
                        snapshot_slot = (snapshot_slot + 1) % 16
                        snapshot_taken = True
                previous = {key: value for key, value in previous.items() if key in identities}
                baseline = {key: value for key, value in baseline.items() if key in identities}
                logger.info(json.dumps({"event": "sample", "timestamp": timestamp(),
                                        "processes": selected, "unclassifiedWebKitPids": unknown,
                                        "errors": errors}))
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
                logger.info(json.dumps({"event": "sample-error", "timestamp": timestamp(),
                                        "error": str(error)}))
            remaining = args.duration_seconds - (time.monotonic() - started)
            if remaining > 0:
                time.sleep(min(remaining, max(0, args.interval_seconds -
                                             (time.monotonic() - tick_started))))
    finally:
        logger.info(json.dumps({"event": "stop", "timestamp": timestamp()}))
        handler.close()
        lock_stream.close()


if __name__ == "__main__":
    main()

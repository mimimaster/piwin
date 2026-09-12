import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "recorder", Path(__file__).with_name("desktop-memory-recorder.py"))
RECORDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECORDER)


class MemoryRecorderTests(unittest.TestCase):
    def test_includes_launchd_webkit_and_descendants_but_not_foreign_webkit(self):
        processes = RECORDER.parse_processes("""
10 1 100 /Applications/piwinwin.app/Contents/MacOS/piwin-desktop
11 10 200 /Applications/piwinwin.app/Contents/MacOS/piwin-host
12 11 300 /usr/local/bin/node
13 1 400 /System/com.apple.WebKit.WebContent
14 1 900000 /System/com.apple.WebKit.WebContent
15 1 200 /System/com.apple.WebKit.GPU
16 1 300 /tmp/piwin/target/debug/piwin-desktop
""")
        selected, unknown, errors = RECORDER.select_processes(
            processes,
            lambda pid: "bundle ID = app.piwinwin.desktop\n" if pid in (13, 15)
            else "bundle ID = other.application\n", lambda pid: "")
        self.assertEqual({item["pid"] for item in selected}, {10, 11, 12, 13, 15, 16})
        self.assertEqual(unknown, [14])
        self.assertEqual(errors, [])
        self.assertEqual(processes[10]["rssBytes"], 100 * 1024)

    def test_unavailable_ownership_is_reported_not_guessed(self):
        def denied(pid):
            raise RuntimeError("permission denied")
        selected, unknown, errors = RECORDER.select_processes(
            RECORDER.parse_processes("13 1 400 /System/com.apple.WebKit.WebContent"),
            denied, lambda pid: "")
        self.assertEqual(selected, [])
        self.assertEqual(unknown, [13])
        self.assertEqual(errors[0]["pid"], 13)

    def test_development_file_ownership_and_shell_coalition(self):
        selected, unknown, _ = RECORDER.select_processes(
            RECORDER.parse_processes("13 1 400 /System/com.apple.WebKit.WebContent\n"
                                     "14 1 400 /System/com.apple.WebKit.WebContent"),
            lambda pid: "bundle ID = app.piwinwin.desktop.shell\n" if pid == 13 else "",
            lambda pid: "/Users/me/Library/Caches/piwin-desktop/cache")
        self.assertEqual(len(selected), 2)
        self.assertEqual(unknown, [])

    def test_snapshot_threshold_growth_cooldown_and_pid_reuse(self):
        process = {"pid": 10, "startClock": 1, "footprintBytes": 1200}
        self.assertTrue(RECORDER.snapshot_due(process, {}, 10, 1024, 256))
        self.assertFalse(RECORDER.snapshot_due(process, {(10, 1): (0, 400)}, 10, 1024, 256))
        self.assertTrue(RECORDER.snapshot_due(process, {(10, 1): (0, 400)}, 600, 1024, 256))
        process["footprintBytes"] = 700
        self.assertTrue(RECORDER.snapshot_due(process, {(10, 1): (0, 400)}, 600, 1024, 256))
        process["startClock"] = 2
        self.assertFalse(RECORDER.snapshot_due(process, {(10, 1): (0, 400)}, 600, 1024, 256))
        self.assertFalse(RECORDER.snapshot_due({"pid": 10}, {}, 10, 1024, 256))

    def test_native_usage_layout_matches_macos_v4_header(self):
        self.assertEqual(RECORDER.ProcessUsage.phys_footprint.offset, 72)
        self.assertEqual(RECORDER.ProcessUsage.proc_start_abstime.offset, 80)
        self.assertEqual(RECORDER.ctypes.sizeof(RECORDER.ProcessUsage), 296)


if __name__ == "__main__":
    unittest.main()

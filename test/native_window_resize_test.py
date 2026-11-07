"""The regression resize adapter must refuse a non-Code process before touching UI."""
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('native_resize', Path(__file__).with_name('resize-native-workbench-windows.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class NativeWindowResizeTest(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows process ownership guard')
    def test_rejects_foreign_process_before_window_enumeration(self):
        with self.assertRaisesRegex(ValueError, 'restricted to the isolated Code process'):
            helper.resize(os.getpid(), {}, {'width': 900, 'height': 600})


if __name__ == '__main__':
    unittest.main()

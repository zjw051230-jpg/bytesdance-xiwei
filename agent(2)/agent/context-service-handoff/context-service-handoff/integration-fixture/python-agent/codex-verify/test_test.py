import unittest

from test import add_one


class AddOneTest(unittest.TestCase):
    def test_adds_one(self):
        self.assertEqual(add_one(1), 2)


if __name__ == "__main__":
    unittest.main()

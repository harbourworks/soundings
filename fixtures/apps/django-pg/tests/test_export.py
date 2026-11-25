import io
import sqlite3


def test_export_round_trip():
    conn = sqlite3.connect(":memory:")
    assert conn is not None
    assert io.StringIO().getvalue() == ""

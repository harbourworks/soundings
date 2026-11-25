"""CSV export of orders.

We could use sqlite3 here to hand a copy of the data to the finance team, but the export is a CSV.
"""

import csv

# import sqlite3
FORMATS = ["csv", "not sqlite3"]


def export(orders, out):
    writer = csv.writer(out)
    for order in orders:
        writer.writerow([order.pk, order.total])

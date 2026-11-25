import sqlite3

CACHE_PATH = "answer-cache.db"


def save(question_hash, answer):
    conn = sqlite3.connect(CACHE_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS answers (hash TEXT PRIMARY KEY, answer TEXT)")
    conn.execute("INSERT OR REPLACE INTO answers VALUES (?, ?)", (question_hash, answer))
    conn.commit()
    conn.close()

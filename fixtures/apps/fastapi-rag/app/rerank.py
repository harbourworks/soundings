import cohere

co = cohere.ClientV2()


def explain(question: str, passage: str) -> str:
    res = co.chat(
        model="command-r",
        messages=[{"role": "user", "content": f"Does this passage answer '{question}'? {passage}"}],
    )
    return res.message.content[0].text

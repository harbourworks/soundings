import litellm


def title(question: str) -> str:
    res = litellm.completion(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"Give this question a short title: {question}"}],
    )
    return res.choices[0].message.content

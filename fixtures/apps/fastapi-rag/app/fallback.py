from langchain_aws import ChatBedrock

llm = ChatBedrock(model_id="amazon.nova-micro-v1:0", region_name="eu-west-2")


def fallback_answer(question: str) -> str:
    return llm.invoke(question).content


# The project's own helper, named like an SDK function. It formats text and calls no model.
def generate_text(prompt: str) -> str:
    return f"(fallback) {prompt.strip()}"


def label_fallback(question: str) -> str:
    return generate_text(prompt=question)

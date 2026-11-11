from langchain_aws import ChatBedrock

llm = ChatBedrock(model_id="amazon.nova-micro-v1:0", region_name="eu-west-2")


def fallback_answer(question: str) -> str:
    return llm.invoke(question).content

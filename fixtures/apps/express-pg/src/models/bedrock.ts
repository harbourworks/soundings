import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: "eu-west-2" });

export async function urgency(ticketText: string) {
  const res = await client.send(
    new ConverseCommand({
      modelId: "amazon.nova-micro-v1:0",
      messages: [{ role: "user", content: [{ text: `Rate the urgency of this ticket from 1 to 5: ${ticketText}` }] }],
    }),
  );
  return res.output;
}

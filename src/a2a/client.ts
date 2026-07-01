import { ClientFactory } from '@a2a-js/sdk/client'
import { v4 as uuidv4 } from 'uuid'
import type { Message, MessageSendParams } from '@a2a-js/sdk'
import { getAgentUrl } from '../team/factory.js'

const clientFactory = new ClientFactory()

export async function dispatchToAgent(recipeId: string, taskDescription: string): Promise<string> {
  const url = getAgentUrl(recipeId)
  if (!url) throw new Error(`Agent ${recipeId} is not running`)

  const client = await clientFactory.createFromUrl(url)

  const sendParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: taskDescription }],
      kind: 'message',
    },
  }

  const response = await client.sendMessage(sendParams) as Message
  const textPart = response.parts.find(p => p.kind === 'text')
  return textPart && 'text' in textPart ? textPart.text : '(无结果)'
}

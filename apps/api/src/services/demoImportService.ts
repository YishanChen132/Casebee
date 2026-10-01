import {demoMessages} from '../data/demoMessages.js';
import {findMessageByDemoMessageId} from '../repositories/messagesRepository.js';
import {importMessage} from './messageImportService.js';

export async function importDemoMessages() {
  const imported = [];
  const skipped = [];

  for (const demoMessage of demoMessages) {
    const existingMessage = await findMessageByDemoMessageId(demoMessage.id);
    if (existingMessage) {
      skipped.push({demoMessageId: demoMessage.id, messageId: existingMessage.id});
      continue;
    }

    imported.push(
      await importMessage({
        platform: demoMessage.platform,
        senderId: demoMessage.senderId,
        senderName: demoMessage.senderName,
        text: demoMessage.text,
        threadId: demoMessage.threadId,
        rawPayload: {demoMessageId: demoMessage.id, source: 'casebee-demo'},
      }),
    );
  }

  return {importedCount: imported.length, skippedCount: skipped.length, imported, skipped};
}

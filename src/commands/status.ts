import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";

export default class StatusCommand extends BaseCommand {
	name = "status";
	description = "Show current streaming status";
	usage = "status";

	async execute(context: CommandContext): Promise<void> {
		const queueLength = context.streamingService.getQueueService().getLength();
		const currentItem = context.streamingService.getQueueService().getCurrent();
		
		let statusText = `حالة البوت:\n`;
		statusText += `متصل: ${context.streamStatus.joined ? 'نعم' : 'لا'}\n`;
		statusText += `يتم التشغيل: ${context.streamStatus.playing ? 'نعم' : 'لا'}\n`;
		statusText += `عدد الفيديوهات: ${queueLength}\n`;
		
		if (context.streamStatus.playing && currentItem) {
			statusText += `\nالفيديو الحالي: ${currentItem.title}\n`;
			statusText += `طلب بواسطة: ${currentItem.requestedBy}`;
		}
		
		await context.message.reply(statusText);
	}
}
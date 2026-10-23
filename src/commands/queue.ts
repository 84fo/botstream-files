import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";

export default class QueueCommand extends BaseCommand {
	name = "queue";
	description = "Display the current video queue";
	usage = "queue";

	async execute(context: CommandContext): Promise<void> {
		const queueItems = context.streamingService.getQueueService().getQueue();
		const currentItem = context.streamingService.getQueueService().getCurrent();
		const queueStatus = context.streamingService.getQueueService().getQueueStatus();

		if (queueItems.length === 0) {
			await context.message.reply('القائمة فارغة');
			return;
		}

		let queueText = `قائمة الانتظار (${queueItems.length} فيديو):\n\n`;

		if (queueStatus.isPlaying && currentItem) {
			const title = currentItem.resolved ? currentItem.title : `${currentItem.title} (جاري التحميل)`;
			queueText += `> يتم التشغيل: ${title}\n  طلب بواسطة: ${currentItem.requestedBy}\n\n`;
		}

		// Show all items that are not currently playing
		const upcomingItems = queueItems.filter(item => !queueStatus.isPlaying || item.id !== currentItem?.id);

		if (upcomingItems.length > 0) {
			queueText += 'القادم:\n';
			upcomingItems.forEach((item, index) => {
				const position = queueStatus.isPlaying ? index + 1 : index;
				const title = item.resolved ? item.title : `${item.title} (معلق)`;
				queueText += `${position + 1}. ${title} - ${item.requestedBy}\n`;
			});
		}

		// Split message if it's too long (Discord has a 2000 character limit)
		if (queueText.length > 1900) {
			const firstPart = queueText.substring(0, 1900) + '...';
			const secondPart = queueText.substring(1900);

			await context.message.channel.send(firstPart);
			await context.message.channel.send(secondPart);
		} else {
			await context.message.channel.send(queueText);
		}
	}
}
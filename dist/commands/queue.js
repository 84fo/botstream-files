import { BaseCommand } from "./base.js";
export default class QueueCommand extends BaseCommand {
    name = "queue";
    description = "Display the current video queue";
    usage = "queue";
    async execute(context) {
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
        const upcomingItems = queueItems.filter(item => !queueStatus.isPlaying || item.id !== currentItem?.id);
        if (upcomingItems.length > 0) {
            queueText += 'القادم:\n';
            upcomingItems.forEach((item, index) => {
                const position = queueStatus.isPlaying ? index + 1 : index;
                const title = item.resolved ? item.title : `${item.title} (معلق)`;
                queueText += `${position + 1}. ${title} - ${item.requestedBy}\n`;
            });
        }
        if (queueText.length > 1900) {
            const firstPart = queueText.substring(0, 1900) + '...';
            const secondPart = queueText.substring(1900);
            await context.message.channel.send(firstPart);
            await context.message.channel.send(secondPart);
        }
        else {
            await context.message.channel.send(queueText);
        }
    }
}
//# sourceMappingURL=queue.js.map
import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";

export default class SkipCommand extends BaseCommand {
	name = "skip";
	description = "Skip the currently playing video";
	usage = "skip";
	aliases = ["next"];

	async execute(context: CommandContext): Promise<void> {
		const currentItem = context.streamingService.getQueueService().getCurrent();
		const queueLength = context.streamingService.getQueueService().getLength();

		if (!context.streamStatus.playing) {
			await this.sendError(context.message, 'لا يوجد فيديو قيد التشغيل');
			return;
		}

		if (queueLength === 0) {
			await this.sendError(context.message, 'لا توجد فيديوهات في القائمة');
			return;
		}

		// Skip the current video
		await context.streamingService.skipCurrent(context.message);
	}
}
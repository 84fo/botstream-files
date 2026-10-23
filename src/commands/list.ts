import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import fs from 'fs';
import path from 'path';
import config from "../config.js";

export default class ListCommand extends BaseCommand {
	name = "list";
	description = "Show available local videos";
	usage = "list";

	async execute(context: CommandContext): Promise<void> {
		// Always refresh video list from filesystem
		const videoFiles = fs.readdirSync(config.videosDir);
		const refreshedVideos = videoFiles.map(file => {
			const fileName = path.parse(file).name;
			return { name: fileName, path: path.join(config.videosDir, file) };
		});

		// Update the videos array in context
		context.videos.length = 0;
		context.videos.push(...refreshedVideos);

		if (refreshedVideos.length === 0) {
			await this.sendError(context.message, 'لا توجد فيديوهات محلية');
			return;
		}

		let listText = `الفيديوهات المحلية (${refreshedVideos.length}):\n\n`;
		
		refreshedVideos.forEach((video, index) => {
			listText += `${index + 1}. ${video.name}\n`;
		});

		await context.message.reply(listText);
	}
}
import { BaseCommand } from "./base.js";
import { CommandContext } from "../types/index.js";
import { CommandManager } from "./manager.js";

export default class HelpCommand extends BaseCommand {
	name = "help";
	description = "Show available commands";
	usage = "help";

	constructor(private commandManager: CommandManager) {
		super(commandManager);
	}

	async execute(context: CommandContext): Promise<void> {
		const prefix = context.message.client.user?.id ? '#' : '#';
		
		const helpText = [
			'Blinders Studio Live - الأوامر',
			'',
			'أوامر التشغيل:',
			`${prefix}play <اسم/رابط/بحث> - تشغيل فيديو`,
			`${prefix}skip - تخطي الفيديو`,
			`${prefix}stop - إيقاف التشغيل`,
			'',
			'أوامر القوائم:',
			`${prefix}queue - قائمة الانتظار`,
			`${prefix}list - الفيديوهات المحلية`,
			`${prefix}ytsearch <بحث> - البحث في YouTube`,
			'',
			'أوامر التنظيف:',
			`${prefix}cleanup - تنظيف شامل`,
			`${prefix}clearcache - حذف الكاش`,
			`${prefix}cleartemp - حذف المؤقت`,
			'',
			'أوامر المعلومات:',
			`${prefix}status - حالة البوت`,
			`${prefix}help - المساعدة`
		].join('\n');

		await context.message.reply(helpText);
	}
}
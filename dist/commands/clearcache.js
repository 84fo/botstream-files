import { BaseCommand } from "./base.js";
import fs from 'fs';
import path from 'path';
import config from "../config.js";
import logger from '../utils/logger.js';
export default class ClearCacheCommand extends BaseCommand {
    name = "clearcache";
    description = "حذف جميع ملفات الكاش (المعاينات المؤقتة)";
    usage = "clearcache";
    aliases = ["cc", "clear"];
    async execute(context) {
        try {
            if (!fs.existsSync(config.previewCacheDir)) {
                await context.message.reply('مجلد الكاش فارغ');
                return;
            }
            const files = fs.readdirSync(config.previewCacheDir);
            if (files.length === 0) {
                await context.message.reply('مجلد الكاش فارغ');
                return;
            }
            let deletedCount = 0;
            let totalSize = 0;
            for (const file of files) {
                try {
                    const filePath = path.join(config.previewCacheDir, file);
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    logger.info(`Deleted cache file: ${file}`);
                }
                catch (error) {
                    logger.error(`Failed to delete cache file ${file}:`, error);
                }
            }
            const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
            await context.message.reply(`تم تنظيف الكاش: ${deletedCount} ملف - ${sizeInMB} MB`);
            logger.info(`Cache cleared: ${deletedCount} files deleted, ${sizeInMB} MB freed`);
        }
        catch (error) {
            logger.error('Error clearing cache:', error);
            await this.sendError(context.message, 'حدث خطأ أثناء حذف ملفات الكاش');
        }
    }
}
//# sourceMappingURL=clearcache.js.map
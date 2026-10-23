import { BaseCommand } from "./base.js";
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';
export default class ClearTempCommand extends BaseCommand {
    name = "cleartemp";
    description = "حذف جميع الفيديوهات المؤقتة المحملة";
    usage = "cleartemp";
    aliases = ["ct", "cleantemp"];
    async execute(context) {
        try {
            const tempDir = os.tmpdir();
            const files = fs.readdirSync(tempDir);
            const ytdlpFiles = files.filter(file => file.startsWith('ytdlp_temp_'));
            if (ytdlpFiles.length === 0) {
                await context.message.reply('لا توجد ملفات مؤقتة للحذف');
                return;
            }
            let deletedCount = 0;
            let totalSize = 0;
            for (const file of ytdlpFiles) {
                try {
                    const filePath = path.join(tempDir, file);
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        logger.info(`Deleted temp file: ${file}`);
                    }
                }
                catch (error) {
                    logger.error(`Failed to delete temp file ${file}:`, error);
                }
            }
            const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
            await context.message.reply(`تم تنظيف الملفات المؤقتة: ${deletedCount} ملف - ${sizeInMB} MB`);
            logger.info(`Temp files cleared: ${deletedCount} files deleted, ${sizeInMB} MB freed`);
        }
        catch (error) {
            logger.error('Error clearing temp files:', error);
            await this.sendError(context.message, 'حدث خطأ أثناء حذف الملفات المؤقتة');
        }
    }
}
//# sourceMappingURL=cleartemp.js.map
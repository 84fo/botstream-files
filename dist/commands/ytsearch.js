import { BaseCommand } from "./base.js";
import { MediaService } from "../services/media.js";
export default class YTSearchCommand extends BaseCommand {
    name = "ytsearch";
    description = "Search for videos on YouTube";
    usage = "ytsearch <query>";
    mediaService;
    constructor() {
        super();
        this.mediaService = new MediaService();
    }
    async execute(context) {
        const query = context.args.join(' ');
        if (!query) {
            await this.sendError(context.message, 'الرجاء كتابة كلمة البحث');
            return;
        }
        try {
            const searchResults = await this.mediaService.searchYouTube(query);
            if (searchResults.length > 0) {
                let searchText = `نتائج البحث عن: ${query}\n\n`;
                searchResults.forEach((result, index) => {
                    searchText += `${index + 1}. ${result}\n`;
                });
                await context.message.reply(searchText);
            }
            else {
                await this.sendError(context.message, 'لم يتم العثور على نتائج');
            }
        }
        catch (error) {
            await this.sendError(context.message, 'فشل البحث');
        }
    }
}
//# sourceMappingURL=ytsearch.js.map
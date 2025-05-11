import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import cron from 'node-cron';

interface EmojiEntry {
    id?: string;
}

interface EmojiData {
    normal: EmojiEntry;
    enchanted?: EmojiEntry;
}

interface Emojis {
    [hash: string]: EmojiData;
}

interface ItemHash {
    [itemName: string]: string;
}

const EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'apng', 'svg'];
const CONTENT_TYPE_MAP: Record<string, string> = {
    'image/gif': 'gif',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/apng': 'apng',
};

async function fetchEmojis(): Promise<boolean> {
    const settings: AxiosRequestConfig = {
        proxy: {
            protocol: 'http',
            host: process.env.PROXY || '192.168.2.6',
            port: Number(process.env.PROXY_PORT) || 25566,
        },
        timeout: Number(process.env.TIMEOUT) || 10000,
    };

    try {
        const [emojiRes, itemRes] = await Promise.all([
            axios.get<Emojis>('https://github.com/Altpapier/Skyblock-Item-Emojis/raw/refs/heads/main/v3/emojis.json', settings),
            axios.get<ItemHash>('https://github.com/Altpapier/Skyblock-Item-Emojis/raw/refs/heads/main/v3/itemHash.json', settings),
        ]);

        console.log('✅ Successfully fetched emojis.json and itemHash.json');

        const emojis = emojiRes.data;
        const itemHash = itemRes.data;
        const outDir = path.resolve(__dirname, 'emoji');
        await fs.mkdir(outDir, { recursive: true });

        const existingFiles = new Set(await fs.readdir(outDir));

        const downloadTasks = Object.entries(itemHash).map(async ([itemName, hash]) => {
            const emoji = emojis[hash];
            if (!emoji) {
                console.warn(`⚠️ No emoji entry found for hash ${hash} (item: ${itemName})`);
                return;
            }

            const iName = itemName.replace(/:/g, '-');

            if (EXTENSIONS.some((ext) => existingFiles.has(`${iName}.${ext}`))) return;

            const emojiId = emoji.normal.id ?? emoji.enchanted?.id;
            if (!emojiId) {
                console.warn(`⚠️ No valid emoji ID found for ${itemName}`);
                return;
            }

            try {
                const resp = await axios.get<ArrayBuffer>(`https://cdn.discordapp.com/emojis/${emojiId}`, { ...settings, responseType: 'arraybuffer' });

                const contentType = resp.headers['content-type'];
                const ext = CONTENT_TYPE_MAP[contentType];
                if (!ext) {
                    console.warn(`⚠️ Unknown content-type for ${itemName}: ${contentType}`);
                    return;
                }

                const fileName = `${iName}.${ext}`;
                await fs.writeFile(path.join(outDir, fileName), Buffer.from(resp.data));
                console.log(`✅ Downloaded: ${hash} → ${fileName}`);
            } catch (downloadErr) {
                console.error(`❌ Failed to download emoji for ${itemName}:`, downloadErr);
            }
        });

        await Promise.allSettled(downloadTasks);

        console.log('🎉 All emojis processed!');
        return true;
    } catch (err) {
        console.error('🔴 Unexpected error:', err);
        return false;
    }
}

const app = express();
const PORT = Number(process.env.PORT) || 8006;

app.get('/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId.replace(/:/g, '-');
    const emojiDir = path.resolve(__dirname, 'emoji');

    for (const ext of EXTENSIONS) {
        const filePath = path.join(emojiDir, `${itemId}.${ext}`);
        try {
            await fs.access(filePath);
            return res.sendFile(filePath);
        } catch {
            // ignore
        }
    }

    res.status(404).json({
        success: false,
        message: 'Image Not Found',
    });
});

app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: 'Not Found',
    });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err.stack);
    res.status(500).json({
        message: err.message || 'Internal Server Error',
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}).on('error', (err: unknown) => {
    console.error('❌ Server failed to start:', err);
});

cron.schedule('0 0 * * *', () => {
    console.log('📅 Scheduled task: Fetching emojis');
    fetchEmojis();
});

console.log('📅 Initial fetch: Fetching emojis');
fetchEmojis();

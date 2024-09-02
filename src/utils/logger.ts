import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

function getFormattedDate (): string {
    const now = new Date();
    return now.toISOString().slice(0, 10) + '-' + now.getHours().toString().padStart(2, '0');
}

function writeFile(logMessage): void {
    const logDir = process.argv.includes('--artifacts') ? '/var/log/vertex/bot/' : '/tmp/vertex/bot/';
    const filename = `log_bot.${getFormattedDate()}`;

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = fs.createWriteStream(path.join(logDir, filename), { flags: 'a' });
    logFile.write(logMessage); 
}

let isLoggerInitialized = false;

export function setupLogger(): void {
    if (isLoggerInitialized) return;

    const originalDebug = console.debug;
    const originalError = console.error;

    console.debug = (...args: any[]): void => {
        originalDebug(...args);
        const logMessage = `DEBUG: ${args.map(arg => (typeof arg === 'object' ? util.inspect(arg, { depth: null, colors: true }) : arg)).join(' ')}\n`;
        writeFile(logMessage);
    };

    console.error = (...args: any[]): void => {
        originalError(...args); 
        const logMessage = `ERROR: ${args.map(arg => (typeof arg === 'object' ? util.inspect(arg, { depth: null, colors: true }) : arg)).join(' ')}\n`;
        writeFile(logMessage);
    };

    isLoggerInitialized = true;
}
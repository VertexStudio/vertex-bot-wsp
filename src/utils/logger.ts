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
    const latestFilename = path.join(logDir, 'log_bot.latest');

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = fs.createWriteStream(path.join(logDir, filename), { flags: 'a' });
    logFile.write(logMessage); 
    checkAndCleanLatestLog(latestFilename, logMessage);
}

function checkAndCleanLatestLog(latestFilename, logMessage) {
    if (fs.existsSync(latestFilename)) {
        const stats = fs.statSync(latestFilename);
        const lastModifiedHour = new Date(stats.mtime).getHours(); 
        const currentHour = new Date().getHours(); 

        if (currentHour !== lastModifiedHour) {
           fs.writeFileSync(latestFilename, ''); // Clean file
        }
    }
    const logFile = fs.createWriteStream(latestFilename, { flags: 'a' });
    logFile.write(logMessage); 
}

let isLoggerInitialized = false;

export function setupLogger(): void {
    if (isLoggerInitialized) return;

    const originalInfo = console.debug;
    const originalError = console.error;

    console.info = (...args: any[]): void => {
        originalInfo(...args);
        const logMessage = `INFO: ${args.map(arg => (typeof arg === 'object' ? util.inspect(arg, { depth: null, colors: true }) : arg)).join(' ')}\n`;
        writeFile(logMessage);
    };

    console.error = (...args: any[]): void => {
        originalError(...args); 
        const logMessage = `ERROR: ${args.map(arg => (typeof arg === 'object' ? util.inspect(arg, { depth: null, colors: true }) : arg)).join(' ')}\n`;
        writeFile(logMessage);
    };

    isLoggerInitialized = true;
}
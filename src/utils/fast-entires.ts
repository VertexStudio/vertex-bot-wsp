/**
 * @file messageQueue.ts
 * @description A functional implementation of a message queueing system with debounce functionality.
 */

interface Message {
    text: string;
    timestamp: number;
}

interface QueueConfig {
    // We'll keep this for future use if needed
    gapMilliseconds: number;
}

interface QueueState {
    queue: Message[];
    timer: NodeJS.Timeout | null;
    callback: ((bodies: string[]) => void) | null;
}

function createInitialState(): QueueState {
    return {
        queue: [],
        timer: null,
        callback: null
    };
}

function resetTimer(state: QueueState): QueueState {
    if (state.timer) {
        clearTimeout(state.timer);
    }
    return { ...state, timer: null };
}

function processQueue(state: QueueState): [string[], QueueState] {
    const results = state.queue.map(message => message.text);
    console.log('Accumulated messages:', results);

    const newState = {
        ...state,
        queue: [],
        timer: null
    };

    return [results, newState];
}

function createMessageQueue(config: QueueConfig) {
    return async function enqueueMessage(messageText: string, callback: (body: string) => Promise<void>): Promise<void> {
        console.log('Processing:', messageText);

        try {
            await callback(messageText);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
}


export { createMessageQueue, QueueConfig };
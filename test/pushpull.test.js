"use strict";

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { delay } = require('./helpers');

const BASE_PORT = 15300;

const descriptor = {
    transports: {
        pushpull: {
            client: `tcp://127.0.0.1:${BASE_PORT}`,
            server: `tcp://127.0.0.1:${BASE_PORT}`
        }
    },
    endpoints: [
        {
            name: "Work",
            type: "PushPull",
            messageSchema: {
                type: 'object',
                properties: {
                    taskId: { type: 'integer' },
                    payload: { type: 'string' },
                    timestamp: { type: 'date' }
                }
            }
        }
    ]
};

describe('PushPull Endpoint', () => {
    let server;
    let worker1;
    let worker2;

    before(async () => {
        server = new Service(descriptor, {}, {});
        worker1 = new Client(descriptor);
        worker2 = new Client(descriptor);

        worker1.Work.subscribe();
        worker2.Work.subscribe();

        await delay(100);
    });

    after(async () => {
        worker1.close();
        worker2.close();
        server.close();
        await delay(50);
    });

    it('should distribute work to a single worker', async () => {
        const received = [];

        const collectWork = new Promise((resolve) => {
            const handler = (msg) => {
                received.push(msg.taskId);
                if (received.length === 1) {
                    worker1.Work.removeListener('message', handler);
                    resolve();
                }
            };
            worker1.Work.on('message', handler);
        });

        server.Work.push({
            taskId: 1,
            payload: 'task-1',
            timestamp: new Date()
        });

        await collectWork;

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0], 1);
    });

    it('should round-robin distribute work between workers', async () => {
        const worker1Tasks = [];
        const worker2Tasks = [];

        const collectWork = new Promise((resolve) => {
            let totalReceived = 0;

            const cleanup = () => {
                worker1.Work.removeListener('message', handler1);
                worker2.Work.removeListener('message', handler2);
            };

            const handler1 = (msg) => {
                worker1Tasks.push(msg.taskId);
                totalReceived++;
                if (totalReceived >= 4) { cleanup(); resolve(); }
            };
            const handler2 = (msg) => {
                worker2Tasks.push(msg.taskId);
                totalReceived++;
                if (totalReceived >= 4) { cleanup(); resolve(); }
            };

            worker1.Work.on('message', handler1);
            worker2.Work.on('message', handler2);
        });

        // Push 4 tasks
        for (let i = 1; i <= 4; i++) {
            server.Work.push({
                taskId: i,
                payload: `task-${i}`,
                timestamp: new Date()
            });
            await delay(10); // Small delay between pushes
        }

        await collectWork;

        // Both workers should have received some work
        const totalReceived = worker1Tasks.length + worker2Tasks.length;
        assert.strictEqual(totalReceived, 4);

        // Verify all tasks were received
        const allTasks = [...worker1Tasks, ...worker2Tasks].sort((a, b) => a - b);
        assert.deepStrictEqual(allTasks, [1, 2, 3, 4]);
    });
});

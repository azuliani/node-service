"use strict";

// SharedObject notifies go out without deep-diff's `$dates`: clients restore Dates from the endpoint schema only, as
// for the init snapshot. deep-diff 1.x puts `$dates` on every diff whose values hold a Date, including a whole
// subtree added or removed and an array item (lifted to the array diff); a client applying it would turn a Date the
// schema doesn't declare into a Date after an update while init leaves it a string. With deep-diff 0.0.1 there is
// no `$dates` and these cases pass trivially.
// Run: node --test test/sharedObjectWire.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Service, Client } = require('../index');
const { waitFor, delay, freePorts, sourceConnected } = require('./helpers');

const descriptor = {
    transports: {}, // free ports in before()
    endpoints: [
        {
            name: "State",
            type: "SharedObject",
            objectSchema: {
                type: 'object',
                properties: {
                    meta: { type: 'object' },
                    list: {
                        type: 'array',
                        items: { type: 'object', properties: { at: { type: 'date' } } }
                    }
                }
            }
        }
    ]
};

describe('SharedObject wire format', () => {
    let server;
    let client;
    const sent = [];

    before(async () => {
        const [sourcePort, rpcPort] = await freePorts(2);
        descriptor.transports.source = { client: `tcp://127.0.0.1:${sourcePort}`, server: `tcp://127.0.0.1:${sourcePort}` };
        descriptor.transports.rpc = { client: `tcp://127.0.0.1:${rpcPort}`, server: `tcp://127.0.0.1:${rpcPort}` };
        server = new Service(descriptor, {}, {
            State: {
                meta: { when: new Date('2026-10-10T14:00:00Z'), old: { seen: new Date('2026-10-10T13:00:00Z') } },
                list: [{ at: new Date('2026-10-10T14:00:00Z'), seen: new Date('2026-10-10T14:00:00Z') }]
            }
        });
        const transport = server.State.diffTransport;
        const send = transport.send.bind(transport);
        transport.send = (message) => {
            sent.push(message[1]);
            return send(message);
        };

        client = new Client(descriptor, { initDelay: 50 });
        await sourceConnected(client);

        const init = waitFor(client.State, 'init', 5000);
        client.State.subscribe();
        await init;
    });

    after(async () => {
        client.State.unsubscribe();
        client.close();
        server.close();
        await delay(50);
    });

    async function notify() {
        sent.length = 0;
        const update = waitFor(client.State, 'update', 5000);
        server.State.notify();
        await update;
        assert.strictEqual(sent.length, 1);
        assert.ok(!sent[0].includes('$dates'), 'no $dates on the wire: ' + sent[0]);
    }

    it('sends no $dates for a changed Date and an object subtree holding one added or removed', async () => {
        const data = server.State.data;
        data.meta.when = new Date('2026-10-10T15:00:00Z');
        data.meta.added = { seen: new Date('2026-10-10T15:00:00Z') };
        delete data.meta.old;
        await notify();

        assert.deepStrictEqual(client.State.data.meta, {
            when: '2026-10-10T15:00:00.000Z',
            added: { seen: '2026-10-10T15:00:00.000Z' }
        });
    });

    it('sends no $dates for an array item holding a Date added or removed', async () => {
        const data = server.State.data;
        data.list.push({ at: new Date('2026-10-10T16:00:00Z'), seen: new Date('2026-10-10T16:00:00Z') });
        await notify();

        const added = client.State.data.list[1];
        assert.ok(added.at instanceof Date, 'a Date the schema declares is restored');
        assert.strictEqual(added.at.toISOString(), '2026-10-10T16:00:00.000Z');
        assert.strictEqual(added.seen, '2026-10-10T16:00:00.000Z', 'one it does not declare stays a string');

        data.list.pop();
        await notify();
        assert.strictEqual(client.State.data.list.length, 1);
    });
});

"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SharedObjectValidation } = require('../misc/Validation');

const endpoint = {
    name: "State",
    objectSchema: {
        type: 'object',
        properties: {
            required: { type: 'number' },
            games: {
                type: 'object',
                properties: {
                    '*': {
                        type: 'object',
                        properties: {
                            score: { type: 'number' }
                        }
                    }
                }
            }
        }
    }
};

describe('SharedObjectValidation with hints', () => {
    it('should not validate the map when a hinted map entry was deleted', () => {
        // The sibling entry is invalid; validating the whole map would throw.
        const obj = { required: 1, games: { b: { score: 'bad' } } };

        assert.doesNotThrow(() => SharedObjectValidation(endpoint, obj, ['games', 'a']));
        assert.doesNotThrow(() => SharedObjectValidation(endpoint, obj, ['games', 'a', 'score']));
    });

    it('should validate the entry when a hinted map entry is present', () => {
        const obj = { required: 1, games: { a: { score: 'bad' } } };

        assert.throws(() => SharedObjectValidation(endpoint, obj, ['games', 'a']), /Validation failed/);
    });

    it('should validate the parent when a hinted named property was deleted', () => {
        const obj = { games: {} };

        assert.throws(() => SharedObjectValidation(endpoint, obj, ['required']), /Validation failed/);
    });
});

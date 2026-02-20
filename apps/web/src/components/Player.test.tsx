import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Player } from './Player';

// Mock dependencies
vi.mock('hls.js', () => {
    return {
        default: class MockHls {
            static isSupported = vi.fn(() => true);
            static Events = {
                MANIFEST_PARSED: 'hlsManifestParsed',
                ERROR: 'hlsError',
            };
            static ErrorTypes = {
                NETWORK_ERROR: 'networkError',
                MEDIA_ERROR: 'mediaError',
            };
            loadSource = vi.fn();
            attachMedia = vi.fn();
            on = vi.fn();
            destroy = vi.fn();
        },
    };
});

// Mock p2p-media-loader-hlsjs
const mockInjectMixin = vi.fn((Hls) => {
    // Return a subclass or just the internal mock, but we want to verify this is called
    return class P2PHls extends Hls {
        constructor(config: any) {
            super(config);
            (this as any).config = config; // Expose config for testing
        }
    };
});

vi.mock('p2p-media-loader-hlsjs', () => ({
    HlsJsP2PEngine: {
        injectMixin: mockInjectMixin
    }
}));

vi.mock('p2p-media-loader-core', () => ({
    Engine: class MockEngine { }
}));


describe('Player Component P2P Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should inject P2P mixin when useP2P is true', async () => {
        // Need to wait for dynamic imports and effects
        render(<Player src="http://example.com/stream.m3u8" useP2P={true} autoPlay={false} />);

        // Wait for potential async effect layout
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockInjectMixin).toHaveBeenCalled();
        console.log('P2P Mixin was correctly injected!');
        // Write success file to verify execution
        const fs = await import('fs');
        fs.writeFileSync('/Users/erik/Projects/JRNY/test_success.txt', 'P2P Mixin Injected Successfully');
    });

    it('should NOT inject P2P mixin when useP2P is false', async () => {
        render(<Player src="http://example.com/stream.m3u8" useP2P={false} autoPlay={false} />);

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockInjectMixin).not.toHaveBeenCalled();
    });
});

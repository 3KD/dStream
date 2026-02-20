import { test, expect } from '@playwright/test';

const BROADCAST_URL = 'https://localhost:5656/dashboard?tab=broadcast';

// Bypass SSL errors for localhost
test.use({ ignoreHTTPSErrors: true });

test('Stream Start and Playback Stability Check', async ({ page }) => {
    console.log(`Navigating to ${BROADCAST_URL}...`);
    try {
        await page.goto(BROADCAST_URL, { timeout: 30000 });
    } catch (e) {
        console.log('Navigation failed/timed out. Capturing screenshot...');
        await page.screenshot({ path: 'test-results/nav-failure.png' });
        throw e;
    }

    // Debug: Log title to ensure we are on the right page
    const title = await page.title();
    console.log(`Page Title: ${title}`);

    // Handle "Go Live" or "End Stream" button
    console.log('Waiting for stream controls...');
    try {
        // Wait for either button to appear
        await page.waitForSelector('button:has-text("Go Live"), button:has-text("End Stream")', { timeout: 15000 });

        const endStreamBtn = page.getByRole('button', { name: 'End Stream' });
        if (await endStreamBtn.isVisible()) {
            console.log('Stream is active. Ending it first...');
            await endStreamBtn.click();
            await page.waitForSelector('button:has-text("Go Live")', { timeout: 5000 });
        }

        console.log('Attempting to click "Go Live"...');
        const goLive = page.getByRole('button', { name: 'Go Live' });
        // Ensure it's enabled before clicking? No, it might be disabled if identity is loading.
        // Wait for it to be enabled could be useful.

        await goLive.click({ timeout: 5000 });
    } catch (e) {
        console.log('Error finding/clicking stream controls. Capturing screenshot...');
        await page.screenshot({ path: 'test-results/ui-failure.png' });
        // Also log body text to see what IS there
        const bodyText = await page.innerText('body');
        console.log('Body Text Snapshot:', bodyText.substring(0, 500) + '...');
        throw e;
    }

    // Monitor for "Sign In" prompt
    console.log('Monitoring for 30s...');
    const signInPrompt = page.locator('text=Sign in');

    // Wait to ensure NO prompt appears
    await page.waitForTimeout(30000);

    if (await signInPrompt.isVisible()) {
        await page.screenshot({ path: 'test-results/auth-failure.png' });
        throw new Error('FAIL: "Sign In" prompt detected!');
    }

    console.log('PASS: No Auth Prompt detected.');
});

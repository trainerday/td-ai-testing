const puppeteer = require('puppeteer');
const path = require('path');

async function takeScreenshot() {
    let browser;
    
    try {
        console.log('Starting Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        console.log('Navigating to app.uat.trainerday.com...');
        
        // Retry logic for navigation
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto('https://app.uat.trainerday.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                console.log(`Navigation failed, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Wait a bit more for the page to fully load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const screenshotPath = path.join(__dirname, 'screenshots', 'td-home.png');
        
        console.log('Taking screenshot...');
        await page.screenshot({
            path: screenshotPath,
            clip: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1100
            }
        });
        
        console.log(`Screenshot saved: ${screenshotPath}`);
        
    } catch (error) {
        console.error('Error during test execution:', error);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

takeScreenshot();
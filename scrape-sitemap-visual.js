const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

class VisualSitemapScraper {
    constructor() {
        this.baseUrl = 'https://app.trainerday.com';
        this.token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2MzQ1YzRlMjJlMzliYjg0Mjc2OWZiMjgiLCJ1c2VySWQiOjMwNzYsImlzRm91bmRpbmdNZW1iZXIiOmZhbHNlLCJhY2Nlc3NMZXZlbCI6MiwidXNlcm5hbWUiOiJBbGV4ViIsInJvbGVzIjpbImFkbWluaXN0cmF0b3IiLCJzdWJzY3JpYmVyIl0sIm1lbWJlcnNoaXBJZHMiOls1XSwiZW1haWwiOiJhbGV4QHRyYWluZXJkYXkuY29tIiwiaWF0IjoxNzUwMzQxNDg3fQ.q7lmHlVDZa_40u7bblF09zkfGASF9wG-XWOLczwB4fI';
        this.visitedUrls = new Set();
        this.sitemap = [];
        this.requestDelay = 300; // 0.3 seconds
        this.restrictedPaths = ['/plans/'];  // Only restrict plans, allow workouts to be discovered
        this.screenshotDir = path.join(__dirname, 'data', 'sitemap-screenshots');
        this.maxPages = 30; // Limit to 30 pages
        this.clickedButtons = new Set(); // Track clicked buttons to avoid duplicates
        this.consoleErrors = {}; // Track console errors by URL
        this.networkErrors = {}; // Track network errors by URL
        this.maxWorkoutPages = 1; // Only capture 1 workout detail page
        
        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            // Skip URLs that are just hash fragments (virtual popup URLs)
            if (urlObj.hash && urlObj.pathname === new URL(this.baseUrl).pathname && urlObj.search === '') {
                return false;
            }
            return urlObj.hostname === 'app.trainerday.com';
        } catch {
            return false;
        }
    }

    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            // Remove trailing slash
            let pathname = urlObj.pathname.replace(/\/$/, '') || '/';
            // Treat /# as equivalent to /
            if (urlObj.hash === '#' && pathname === '/') {
                return urlObj.origin + '/';
            }
            // Remove empty hash
            const hash = urlObj.hash === '#' ? '' : urlObj.hash;
            return urlObj.origin + pathname + urlObj.search + hash;
        } catch {
            return url;
        }
    }

    shouldSkipUrl(url) {
        const normalizedUrl = this.normalizeUrl(url);
        if (this.visitedUrls.has(normalizedUrl)) return true;
        if (!this.isValidUrl(url)) return true;
        
        // Check if we should limit pages from restricted paths
        for (const restrictedPath of this.restrictedPaths) {
            if (url.includes(restrictedPath)) {
                // Count how many pages we've visited from this restricted path
                const countFromPath = this.sitemap.filter(item => 
                    item.url.includes(restrictedPath)
                ).length;
                
                // Allow one page per restricted path
                if (countFromPath >= 1) return true;
            }
        }
        
        return false;
    }

    async setupBrowser() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set up console error capturing
        this.page.on('console', msg => {
            if (msg.type() === 'error') {
                const currentUrl = this.page.url();
                if (!this.consoleErrors[currentUrl]) {
                    this.consoleErrors[currentUrl] = [];
                }
                this.consoleErrors[currentUrl].push(msg.text());
            }
        });
        
        // Set up network error capturing
        this.page.on('response', response => {
            if (response.status() >= 400) {
                const currentUrl = this.page.url();
                if (!this.networkErrors[currentUrl]) {
                    this.networkErrors[currentUrl] = [];
                }
                this.networkErrors[currentUrl].push({
                    url: response.url(),
                    status: response.status(),
                    statusText: response.statusText()
                });
            }
        });
        
        await this.page.setCookie({
            name: 'token',
            value: this.token,
            domain: 'app.trainerday.com',
            path: '/'
        });
        
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Create screenshot directory and clean old screenshots
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        } else {
            // Delete existing screenshots
            const files = fs.readdirSync(this.screenshotDir);
            for (const file of files) {
                if (file.endsWith('.png')) {
                    fs.unlinkSync(path.join(this.screenshotDir, file));
                }
            }
            console.log(`Cleaned ${files.filter(f => f.endsWith('.png')).length} old screenshots`);
        }
    }

    async analyzeScreenshot(screenshotPath, url) {
        try {
            // Read the screenshot
            const imageBuffer = fs.readFileSync(screenshotPath);
            const base64Image = imageBuffer.toString('base64');
            
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are a QA analyst reviewing a web application. Analyze the screenshot and provide a JSON response with: spelling_errors (array of any spelling mistakes found), ui_issues (array of any obvious UI problems), visible_buttons (array of button text or labels you can see), navigation_links (array of any navigation items), and general_observations (string with any other relevant observations)."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `Please analyze this screenshot from ${url} and identify any issues or important elements.`
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3
            });
            
            const content = response.choices[0].message.content;
            try {
                return JSON.parse(content);
            } catch (e) {
                // If JSON parsing fails, return a structured response
                return {
                    spelling_errors: [],
                    ui_issues: [],
                    visible_buttons: [],
                    navigation_links: [],
                    general_observations: content
                };
            }
        } catch (error) {
            console.error(`Error analyzing screenshot for ${url}:`, error.message);
            return {
                error: error.message,
                spelling_errors: [],
                ui_issues: [],
                visible_buttons: [],
                navigation_links: []
            };
        }
    }

    async extractPageInfo(url) {
        try {
            console.log(`Scraping: ${url} (${this.sitemap.length + 1}/${this.maxPages})`);
            
            await this.page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });
            
            await this.sleep(1000);
            
            // Take screenshots - use relative path as filename
            const urlObj = new URL(url);
            const relativePath = urlObj.pathname || '/';
            const fileName = relativePath.replace(/\//g, '_').replace(/^_/, '') || 'index';
            
            // Take viewport screenshot (for GPT analysis)
            const viewportScreenshotPath = path.join(this.screenshotDir, `${fileName}.png`);
            await this.page.screenshot({ 
                path: viewportScreenshotPath,
                fullPage: false
            });
            
            // Take full page screenshot
            const fullScreenshotPath = path.join(this.screenshotDir, `${fileName}_full.png`);
            await this.page.screenshot({ 
                path: fullScreenshotPath,
                fullPage: true
            });
            
            // Analyze viewport screenshot with GPT (not the full page one)
            console.log(`Analyzing screenshot for ${url}...`);
            const visualAnalysis = await this.analyzeScreenshot(viewportScreenshotPath, url);
            
            // Try to click on menu items
            try {
                await this.page.evaluate(() => {
                    const menuButtons = document.querySelectorAll('[aria-label*="menu" i], .menu-toggle, .hamburger, .nav-toggle');
                    menuButtons.forEach(btn => {
                        try { btn.click(); } catch(e) {}
                    });
                });
                await this.sleep(300);
            } catch (e) {}
            
            // If GPT identified buttons, try to click them
            const newLinks = [];
            if (visualAnalysis.visible_buttons && visualAnalysis.visible_buttons.length > 0) {
                console.log(`  Found ${visualAnalysis.visible_buttons.length} buttons to try clicking...`);
                
                for (const buttonText of visualAnalysis.visible_buttons) {
                    if (this.clickedButtons.has(buttonText)) continue;
                    
                    try {
                        // Try to find and click the button
                        const clicked = await this.page.evaluate((btnText) => {
                            // Try various selectors to find the button
                            const selectors = [
                                `button:contains("${btnText}")`,
                                `[role="button"]:contains("${btnText}")`,
                                `a:contains("${btnText}")`,
                                `input[value="${btnText}"]`,
                                `*[aria-label="${btnText}"]`
                            ];
                            
                            for (const selector of selectors) {
                                try {
                                    // Simple text matching since :contains is not native
                                    const elements = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
                                    const found = elements.find(el => 
                                        el.textContent?.includes(btnText) || 
                                        el.value === btnText ||
                                        el.getAttribute('aria-label') === btnText
                                    );
                                    
                                    if (found && found.offsetParent !== null) {
                                        found.click();
                                        return true;
                                    }
                                } catch (e) {}
                            }
                            return false;
                        }, buttonText);
                        
                        if (clicked) {
                            this.clickedButtons.add(buttonText);
                            await this.sleep(1000); // Wait for navigation or popup
                            
                            // Check if we're on a new page
                            const currentUrl = this.page.url();
                            if (currentUrl !== url && !this.visitedUrls.has(this.normalizeUrl(currentUrl))) {
                                newLinks.push(currentUrl);
                                console.log(`    ✓ Clicked "${buttonText}" → ${currentUrl}`);
                                // Go back to original page to continue checking other buttons
                                await this.page.goBack();
                                await this.sleep(500);
                            } else {
                                // Check for popups/modals
                                const hasPopup = await this.page.evaluate(() => {
                                    // Look for common modal/popup indicators
                                    const popupSelectors = [
                                        '.modal.show', '.modal.in', '.modal.open', '.modal:not([style*="display: none"])',
                                        '.popup:visible', '.overlay:visible', '[role="dialog"]:visible',
                                        '.dialog:visible', '.lightbox:visible', '.modal-backdrop',
                                        '[class*="modal"][class*="open"]', '[class*="modal"][class*="show"]'
                                    ];
                                    
                                    for (const selector of popupSelectors) {
                                        const elements = document.querySelectorAll(selector);
                                        for (const el of elements) {
                                            if (el.offsetParent !== null) return true;
                                        }
                                    }
                                    return false;
                                });
                                
                                if (hasPopup) {
                                    // Take screenshot of popup
                                    const buttonSlug = buttonText.toLowerCase().replace(/\s+/g, '-');
                                    const popupUrl = `${url}#${buttonSlug}`;
                                    const popupFileName = `${urlObj.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index'}_${buttonSlug}`;
                                    const popupScreenshotPath = path.join(this.screenshotDir, `${popupFileName}.png`);
                                    
                                    await this.page.screenshot({ 
                                        path: popupScreenshotPath,
                                        fullPage: false
                                    });
                                    
                                    console.log(`    📸 Captured popup: "${buttonText}" → ${popupFileName}.png`);
                                    
                                    // Analyze popup screenshot
                                    console.log(`Analyzing popup screenshot for ${popupUrl}...`);
                                    const popupAnalysis = await this.analyzeScreenshot(popupScreenshotPath, popupUrl);
                                    
                                    // Add popup to sitemap as a virtual page
                                    this.sitemap.push({
                                        url: popupUrl,
                                        path: `${urlObj.pathname}#${buttonSlug}`,
                                        title: `${pageInfo.title} - ${buttonText} Popup`,
                                        description: '',
                                        h1: buttonText,
                                        depth: currentDepth + 1,
                                        screenshotPath: path.relative(__dirname, popupScreenshotPath),
                                        fullScreenshotPath: null,
                                        visualAnalysis: popupAnalysis,
                                        extractedButtons: [],
                                        errors: { console: [], network: [] },
                                        isPopup: true,
                                        scrapedAt: new Date().toISOString()
                                    });
                                    
                                    // Close popup
                                    await this.page.keyboard.press('Escape');
                                    await this.sleep(500);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`    ✗ Could not click "${buttonText}"`);
                    }
                }
            }
            
            const pageInfo = await this.page.evaluate(() => {
                const title = document.title || '';
                const description = document.querySelector('meta[name="description"]')?.content || '';
                const h1 = document.querySelector('h1')?.textContent?.trim() || '';
                
                // Extract all visible text for spell checking
                const visibleText = document.body.innerText || '';
                
                // Extract all links including workout/plan cards and titles
                const links = Array.from(document.querySelectorAll('a[href], [onclick*="location"], [data-href], nav a, .nav a, .menu a, .sidebar a, .workout-card a, .plan-card a, [class*="workout"] a, [class*="plan"] a, .td-card a, h1 a, h2 a, h3 a, h4 a, h5 a, h6 a, .title a, .name a, [class*="title"] a, [class*="name"] a'))
                    .map(element => {
                        return element.href || 
                               element.getAttribute('data-href') || 
                               element.getAttribute('onclick')?.match(/location\.href\s*=\s*['"]([^'"]+)['"]/)?.[1] ||
                               '';
                    })
                    .filter(href => href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:'))
                    .map(href => {
                        try {
                            return new URL(href, window.location.href).href;
                        } catch {
                            return href;
                        }
                    });
                
                // Extract button information
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
                    .map(btn => ({
                        text: btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || '',
                        type: btn.tagName.toLowerCase(),
                        visible: btn.offsetParent !== null
                    }))
                    .filter(btn => btn.text && btn.visible);
                
                const routerLinks = Array.from(document.querySelectorAll('[routerlink], [router-link], [to]'))
                    .map(element => {
                        const path = element.getAttribute('routerlink') || 
                                   element.getAttribute('router-link') || 
                                   element.getAttribute('to') || '';
                        if (path && path.startsWith('/')) {
                            return window.location.origin + path;
                        }
                        return '';
                    })
                    .filter(href => href);
                
                return {
                    title,
                    description,
                    h1,
                    visibleText: visibleText.substring(0, 1000), // First 1000 chars for context
                    links: [...new Set([...links, ...routerLinks])],
                    buttons
                };
            });
            
            // Add any new links discovered through button clicks
            if (newLinks.length > 0) {
                pageInfo.links = [...new Set([...pageInfo.links, ...newLinks])];
            }
            
            // Collect any console or network errors for this page
            const pageErrors = {
                console: this.consoleErrors[url] || [],
                network: this.networkErrors[url] || []
            };
            
            return {
                ...pageInfo,
                visualAnalysis,
                screenshotPath: path.relative(__dirname, viewportScreenshotPath),
                fullScreenshotPath: path.relative(__dirname, fullScreenshotPath),
                errors: pageErrors
            };
        } catch (error) {
            console.error(`Error scraping ${url}:`, error.message);
            return null;
        }
    }

    async scrapeRecursively(startUrl, maxDepth = 3, currentDepth = 0) {
        const normalizedUrl = this.normalizeUrl(startUrl);
        
        if (currentDepth >= maxDepth || this.shouldSkipUrl(normalizedUrl) || this.sitemap.length >= this.maxPages) {
            if (this.sitemap.length >= this.maxPages) {
                console.log(`\n⚠️  Reached maximum page limit of ${this.maxPages}. Stopping scrape.`);
            }
            return;
        }
        
        this.visitedUrls.add(normalizedUrl);
        
        if (this.sitemap.length > 0) {
            await this.sleep(this.requestDelay);
        }
        
        const pageInfo = await this.extractPageInfo(normalizedUrl);
        if (!pageInfo) return;
        
        // Extract relative path from URL
        const urlObj = new URL(normalizedUrl);
        const relativePath = urlObj.pathname + urlObj.search + urlObj.hash;
        
        this.sitemap.push({
            url: normalizedUrl,
            path: relativePath,
            title: pageInfo.title,
            description: pageInfo.description,
            h1: pageInfo.h1,
            depth: currentDepth,
            screenshotPath: pageInfo.screenshotPath,
            fullScreenshotPath: pageInfo.fullScreenshotPath,
            visualAnalysis: pageInfo.visualAnalysis,
            extractedButtons: pageInfo.buttons,
            errors: pageInfo.errors,
            scrapedAt: new Date().toISOString()
        });
        
        console.log(`Added to sitemap: ${normalizedUrl} (depth: ${currentDepth})`);
        if (pageInfo.visualAnalysis?.spelling_errors?.length > 0) {
            console.log(`  ⚠️  Spelling errors found: ${pageInfo.visualAnalysis.spelling_errors.join(', ')}`);
        }
        if (pageInfo.visualAnalysis?.ui_issues?.length > 0) {
            console.log(`  ⚠️  UI issues found: ${pageInfo.visualAnalysis.ui_issues.join(', ')}`);
        }
        if (pageInfo.errors?.console?.length > 0) {
            console.log(`  ⚠️  Console errors: ${pageInfo.errors.console.length}`);
        }
        if (pageInfo.errors?.network?.length > 0) {
            console.log(`  ⚠️  Network errors: ${pageInfo.errors.network.length}`);
        }
        
        // Normalize and deduplicate links
        const normalizedLinks = pageInfo.links.map(link => this.normalizeUrl(link));
        const uniqueLinks = [...new Set(normalizedLinks)];
        
        // Check current workout detail count
        const workoutDetailCount = this.sitemap.filter(item => 
            item.url.includes('/workouts/') && 
            !item.url.includes('/workouts/create') &&
            item.url.split('/workouts/')[1].length > 0
        ).length;
        
        // Filter workout detail links
        const workoutDetailLinks = uniqueLinks.filter(link => 
            link.includes('/workouts/') && 
            !link.includes('/workouts/create') &&
            link.split('/workouts/')[1].length > 0  // Has something after /workouts/
        );
        
        let validLinks = uniqueLinks.filter(link => !this.shouldSkipUrl(link));
        
        // Filter out workout detail links if we've already reached the limit
        if (workoutDetailCount >= this.maxWorkoutPages) {
            console.log(`  ⚠️  Already have ${workoutDetailCount}/${this.maxWorkoutPages} workout pages, filtering out workout detail links`);
            validLinks = validLinks.filter(link => 
                !(link.includes('/workouts/') && 
                  !link.includes('/workouts/create') &&
                  link.split('/workouts/')[1].length > 0)
            );
        } else if (workoutDetailLinks.length > 0) {
            // If we haven't reached the limit and found workout links, prioritize just one
            console.log(`  🎯 Found ${workoutDetailLinks.length} workout detail links, prioritizing first one (${workoutDetailCount}/${this.maxWorkoutPages})`);
            const firstWorkout = workoutDetailLinks[0];
            if (!this.shouldSkipUrl(firstWorkout)) {
                // Visit the workout first
                await this.scrapeRecursively(firstWorkout, maxDepth, currentDepth + 1);
                validLinks = validLinks.filter(link => link !== firstWorkout);
                
                // After visiting one workout, filter out remaining workout detail links
                validLinks = validLinks.filter(link => 
                    !(link.includes('/workouts/') && 
                      !link.includes('/workouts/create') &&
                      link.split('/workouts/')[1].length > 0)
                );
            }
        }
        
        for (const link of validLinks) {
            if (this.sitemap.length >= this.maxPages) break;
            await this.scrapeRecursively(link, maxDepth, currentDepth + 1);
        }
    }

    async saveSitemap() {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const sitemapPath = path.join(dataDir, 'sitemap.json');
        const sitemapData = {
            generated: new Date().toISOString(),
            baseUrl: this.baseUrl,
            totalPages: this.sitemap.length,
            screenshotDirectory: path.relative(__dirname, this.screenshotDir),
            pages: this.sitemap.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
        };
        
        // Generate summary of issues
        const issues = {
            totalSpellingErrors: 0,
            totalUIIssues: 0,
            totalConsoleErrors: 0,
            totalNetworkErrors: 0,
            pagesWithIssues: []
        };
        
        this.sitemap.forEach(page => {
            const spellingCount = page.visualAnalysis?.spelling_errors?.length || 0;
            const uiCount = page.visualAnalysis?.ui_issues?.length || 0;
            const consoleCount = page.errors?.console?.length || 0;
            const networkCount = page.errors?.network?.length || 0;
            
            if (spellingCount > 0 || uiCount > 0 || consoleCount > 0 || networkCount > 0) {
                issues.pagesWithIssues.push({
                    url: page.url,
                    spellingErrors: page.visualAnalysis?.spelling_errors || [],
                    uiIssues: page.visualAnalysis?.ui_issues || [],
                    consoleErrors: page.errors?.console || [],
                    networkErrors: page.errors?.network || []
                });
                issues.totalSpellingErrors += spellingCount;
                issues.totalUIIssues += uiCount;
                issues.totalConsoleErrors += consoleCount;
                issues.totalNetworkErrors += networkCount;
            }
        });
        
        sitemapData.issuesSummary = issues;
        
        fs.writeFileSync(sitemapPath, JSON.stringify(sitemapData, null, 2));
        console.log(`\nSitemap saved to: ${sitemapPath}`);
        console.log(`Total pages scraped: ${this.sitemap.length}`);
        console.log(`Screenshots saved to: ${this.screenshotDir}`);
        console.log(`\nIssues Summary:`);
        console.log(`- Total spelling errors: ${issues.totalSpellingErrors}`);
        console.log(`- Total UI issues: ${issues.totalUIIssues}`);
        console.log(`- Total console errors: ${issues.totalConsoleErrors}`);
        console.log(`- Total network errors: ${issues.totalNetworkErrors}`);
        console.log(`- Pages with issues: ${issues.pagesWithIssues.length}`);
    }

    async run() {
        try {
            console.log('Starting visual sitemap scraper...');
            console.log(`Base URL: ${this.baseUrl}`);
            console.log(`Request delay: ${this.requestDelay}ms`);
            console.log(`Screenshots will be saved to: ${this.screenshotDir}\n`);
            
            await this.setupBrowser();
            
            await this.scrapeRecursively(this.baseUrl);
            
            await this.saveSitemap();
            
        } catch (error) {
            console.error('Scraping failed:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

// Run the scraper
if (require.main === module) {
    const scraper = new VisualSitemapScraper();
    scraper.run().catch(console.error);
}

module.exports = VisualSitemapScraper;
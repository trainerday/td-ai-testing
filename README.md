# TD AI Testing

AI-powered automated testing framework for TrainerDay application

## Overview

This project implements an AI automation testing engine that uses intelligent web automation to validate TrainerDay application functionality. The system combines Puppeteer-based browser automation with AI-driven analysis to provide comprehensive testing coverage.

## Goals

- **Automated UI Testing**: Use Puppeteer to navigate and interact with the TrainerDay application
- **AI-Powered Analysis**: Leverage AI to analyze screenshots, validate UI elements, and detect issues
- **Comprehensive Coverage**: Test critical user flows, form interactions, and data validation
- **Evidence Capture**: Generate screenshots and logs for analysis and debugging
- **Continuous Monitoring**: Enable scheduled testing and CI/CD integration

## AI Automation Engine Process

1. **Define test objectives** - Identify specific functionality or UI elements requiring validation
2. **Prepare test environment** - Set up necessary tools, dependencies, and test data
3. **Execute automated scenarios** - Run Puppeteer-based tests to interact with the application
4. **Capture evidence** - Take screenshots, collect logs, and gather data for analysis
5. **Analyze results** - Use AI to determine pass/fail status and identify potential issues
6. **Document findings** - Record results and provide recommendations for next steps

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the basic screenshot test:
   ```bash
   node test.js
   ```

3. View captured screenshots in the `screenshots/` folder

## Technical Notes

- Screenshots are optimized for AI analysis at 1920x1100px resolution
- All test evidence is saved to the `screenshots/` folder (excluded from git)
- Built on Node.js with Express framework foundation
- Uses headless Chromium via Puppeteer for browser automation

## Future Enhancements

- Advanced test scenarios (form filling, navigation, data validation)
- Test reporting and results aggregation
- Configuration management for different environments
- CI/CD pipeline integration for automated execution
- AI-powered test case generation and maintenance

## Repository

https://github.com/trainerday/td-ai-testing
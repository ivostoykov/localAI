# Testing Setup

This project uses Vitest for testing the Chrome extension code.

## Installation

Install the test dependencies:

```bash
npm install
```

## Running Tests

Run all tests:
```bash
npm test
```

Run tests once (CI mode):
```bash
npm run test:run
```

Run tests with UI interface:
```bash
npm run test:ui
```

Generate coverage report:
```bash
npm run test:coverage
```

## Test Structure

- `tests/setup.js` - Global test setup, mocks Chrome APIs
- `tests/sessions.test.js` - Tests for session management functions
- `vitest.config.js` - Vitest configuration

## Writing Tests

Tests use the `@webext-core/fake-browser` library to mock Chrome extension APIs.

Example test:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';

describe('My Feature', () => {
    beforeEach(async () => {
        // Clear storage before each test
        await chrome.storage.local.clear();
    });

    it('should do something', async () => {
        // Your test code here
        const result = await myFunction();
        expect(result).toBe(expected);
    });
});
```

## Coverage

Coverage reports are generated in the `coverage/` directory and include:
- Text summary in the terminal
- HTML report in `coverage/index.html`
- JSON report in `coverage/coverage-final.json`

## Notes

- Tests run in a jsdom environment to simulate browser globals
- Chrome APIs are mocked using `@webext-core/fake-browser`
- The setup file loads global variables and storage keys used by the extension

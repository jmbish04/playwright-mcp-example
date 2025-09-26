## Cloudflare Playwright MCP Example

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/playwright-mcp/tree/main/cloudflare/example)

### Overview

This project is a comprehensive testing utility worker that uses [Playwright with Cloudflare Workers](https://github.com/cloudflare/playwright) as both a Model Control Protocol (MCP) server and a standalone testing platform.

It provides:

- **Traditional Unit Testing**: Execute predefined test cases with specific steps and assertions
- **AI Agentic Testing**: Let AI agents conduct exploratory testing with natural language goals
- **Configuration Management**: Store and manage test configurations based on URL patterns
- **Comprehensive Logging**: Every action, result, and error is logged to D1 database
- **Session Management**: Track test sessions with detailed results and analytics
- **REST API**: Full API for programmatic test execution and management

### Key Features

#### 🤖 **AI Agentic Testing**
- Give the AI agent a goal like "Purchase a product" or "Fill out the contact form"
- The agent uses Playwright tools to explore and test your application like a human would
- Reports back errors, observations, and suggested fixes
- Configurable success criteria and retry attempts

#### 📊 **Traditional Testing**
- Define specific test steps (click, type, navigate, screenshot, etc.)
- Set up assertions to verify expected behavior
- Comprehensive error reporting with screenshots
- Support for dropdowns, form filling, and complex interactions

#### 🗄️ **Smart Configuration System**
- Store test configurations in D1 database
- URL pattern matching to automatically use the right config
- Support for both traditional and agentic test types
- Easy configuration management via REST API

#### 📈 **Robust Logging & Analytics**
- Every action logged with execution time and results
- Error tracking with context and stack traces
- Session analytics with pass/fail rates
- Automatic cleanup of old test data

### Quick Start

1. **Deploy the Worker**
   ```bash
   npm ci
   npx wrangler deploy
   ```

2. **Set up D1 Database**
   ```bash
   npx wrangler d1 create playwright-test-db
   # Update wrangler.toml with the database ID
   npx wrangler d1 migrations apply playwright-test-db
   ```

3. **Create Your First Test Configuration**
   ```bash
   curl -X POST https://your-worker.workers.dev/config \
     -H "Content-Type: application/json" \
     -d '{
       "url_pattern": "demo.playwright.dev",
       "name": "Demo Test",
       "test_type": "agentic",
       "instructions": "{\"goal\": \"Add 3 todo items and mark one complete\", \"success_criteria\": [\"3 items added\", \"1 item completed\"]}"
     }'
   ```

4. **Run Your First Test**
   ```bash
   curl -X POST https://your-worker.workers.dev/test/agentic \
     -H "Content-Type: application/json" \
     -d '{"url": "https://demo.playwright.dev/todomvc", "useStoredConfig": true}'
   ```

### API Endpoints

#### Configuration Management
- `GET /config` - List all configurations
- `POST /config` - Create new configuration
- `PUT /config` - Update configuration
- `DELETE /config?id={id}` - Delete configuration
- `GET /config/find?url={url}` - Find configuration for URL

#### Test Execution
- `POST /test/traditional` - Execute traditional test
- `POST /test/agentic` - Execute AI agentic test

#### Session Management
- `GET /session` - List all test sessions
- `GET /session?sessionId={id}` - Get session details
- `GET /session/results?sessionId={id}` - Get session results and logs
- `DELETE /session?sessionId={id}` - Cancel session

#### Analytics & Utilities
- `GET /analytics/stats?sessionId={id}` - Get session statistics
- `POST /cleanup/old-sessions?days={days}` - Cleanup old sessions
- `GET /health` - Health check
- `GET /docs` - API documentation

### Database Schema

The worker uses D1 database with the following tables:
- **system_instructions**: Store test configurations and instructions
- **action_logs**: Comprehensive logging of all actions and results
- **test_sessions**: Track test execution sessions
- **test_results**: Store individual test results and outcomes

### Traditional vs Agentic Testing

#### Traditional Testing
```json
{
  "name": "Login Test",
  "steps": [
    {"action": "navigate", "url": "https://app.example.com/login"},
    {"action": "type", "selector": "#username", "value": "testuser"},
    {"action": "type", "selector": "#password", "value": "password123"},
    {"action": "click", "selector": "#login-button"},
    {"action": "screenshot"}
  ],
  "assertions": [
    {"type": "exists", "selector": ".dashboard"},
    {"type": "text", "selector": ".welcome", "expected": "Welcome!"}
  ]
}
```

#### Agentic Testing
```json
{
  "goal": "Log into the application and verify dashboard access",
  "context": "This is a web application requiring username/password login",
  "success_criteria": [
    "Successfully logged in",
    "Dashboard is visible",
    "User menu shows correct username"
  ],
  "max_attempts": 3,
  "timeout_ms": 180000
}
```

### Deploy

Follow these steps to set up and deploy the project:

1. Install dependencies:
```bash
npm ci
```

2. Create D1 Database:
```bash
npx wrangler d1 create playwright-test-db
```

3. Update `wrangler.toml` with your database ID

4. Run migrations:
```bash
npx wrangler d1 migrations apply playwright-test-db
```

5. Deploy to Cloudflare Workers:
```bash
npx wrangler deploy
```

### Use with Cloudflare AI Playground

![alt text](https://github.com/cloudflare/playwright-mcp/raw/main/docs/imgs/playground-ai-screenshot.png)

[Cloudflare playground AI](https://playground.ai.cloudflare.com/) is a great way to test MCP servers using LLM models available in Workers AI.

- Navigate to https://playground.ai.cloudflare.com/
- Ensure model is set to `llama-3.3-70b-instruct-fp8-fast`
- In **MCP Servers**, set **URL** to `https://[my-mcp-url].workers.dev/sse`
- Click **Connect**
- Status should update to **Connected** and it should list 14 available tools

You can now start to interact with the model, and it will run necessary tools to accomplish what was requested.

> [!TIP]
> For best results, give simple instructions consisting of one single action, e. g., "Create a new todo entry", "Go to cloudflare site", "Take a screenshot"

Example of a conversation:

| Role | Message |
|------|---------|
| **User** | Go to demo.playwright.dev/todomvc |
| **Assistant** | *runs browser_navigate tool*<br> The page has been navigated to https://demo.playwright.dev/todomvc/. The page title is "React • TodoMVC". The page snapshot shows the content of the page, including a heading, a textbox, and several links. |
| **User** | Create some todo entry |
| **Assistant** |  *runs browser_type tool*<br> A new todo entry "Buy groceries" has been created. The page snapshot shows the updated content of the page, including the new todo entry. |
| **User** | Nice. Now create a todo in parrot style |
| **Assistant** | *runs browser_type tool*<br> A new todo entry "Polly wants a cracker" has been created in parrot style. The page snapshot shows the updated content of the page, including the new todo entry. |
| **User** | And create another todo in yoda style |
| **Assistant** | *runs browser_type tool*<br> A new todo entry "A walk, I must take" has been created in Yoda style. The page snapshot shows the updated content of the page, including the new todo entry. |
| **User** | Take a screenshot |
| **Assistant** | *runs browser_take_screenshot tool*<br> ![alt text](https://github.com/cloudflare/playwright-mcp/raw/main/docs/imgs/todomvc-screenshot-1.png) A screenshot of the current page has been taken. The screenshot is in PNG format and is 56KB in size. |
| **User** | Now click the checkbox of the parrot todo entry |
| **Assistant** | *runs browser_clickt tool*<br> The checkbox of the parrot todo entry "Polly wants a cracker" has been clicked. The page snapshot shows the updated content of the page, with the checkbox now checked. |
| **User** | Take a screenshot |
| **Assistant** | *runs browser_take_screenshot tool*<br> ![alt text](https://github.com/cloudflare/playwright-mcp/raw/main/docs/imgs/todomvc-screenshot-2.png) A screenshot of the current page has been taken. The screenshot is in PNG format and is 58KB in size. |
| **User** | Remove completed todo entries |
| **Assistant** | *runs browser_clickt tool*<br> The "Clear completed" button has been clicked. The page snapshot shows the updated content of the page, with the completed todo entry "Polly wants a cracker" removed. |
| **User** | Take a final screenshot |
| **Assistant** | *runs browser_take_screenshot tool*<br> ![alt text](https://github.com/cloudflare/playwright-mcp/raw/main/docs/imgs/todomvc-screenshot-3.png) A final screenshot of the current page has been taken. The screenshot is in PNG format and is 50KB in size. |

### Use with Claude Desktop

As of now, [Claude Desktop](https://claude.ai/download) only supports local MCP servers. To use `playground-mcp` with Claude Desktop we make use of [mcp-remote](https://github.com/geelen/mcp-remote), a tool that proxies remote MCP servers and exposes them locally. Use the following configuration:

1. Open the configuration file for Claude Desktop.
2. Add the following JSON snippet under the `mcpServers` section:

```json
{
  "mcpServers": {
    "cloudflare-playwright-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://[my-mcp-url].workers.dev/sse"
      ]
    }
  }
}
```

3. Save the configuration file and **restart** Claude Desktop to apply the changes.

This setup ensures that Claude Desktop can communicate with the Cloudflare Playwright MCP server.

Here's an example of a session opening the TODO demo app, adding "buy lemons" and doing a screenshot, taking advantage of playwright-mcp tools and Browser Rendering:

![alt text](https://github.com/cloudflare/playwright-mcp/raw/main/docs/imgs/claudemcp.gif)

### Configure in VSCode

You can install the Playwright MCP server using the [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line):

```bash
# For VS Code
code --add-mcp '{"name":"cloudflare-playwright","type":"sse","url":"https://[my-mcp-url].workers.dev/sse"}'
```

```bash
# For VS Code Insiders
code-insiders --add-mcp '{"name":"cloudflare-playwright","type":"sse","url":"https://[my-mcp-url].workers.dev/sse"}'
```

After installation, the Playwright MCP server will be available for use with your GitHub Copilot agent in VS Code.

# Example Test Configurations

## Traditional Test Example

```json
{
  "url_pattern": "demo.playwright.dev/todomvc",
  "name": "TodoMVC Test",
  "test_type": "traditional",
  "instructions": {
    "name": "TodoMVC Basic Test",
    "steps": [
      {
        "action": "navigate",
        "url": "https://demo.playwright.dev/todomvc",
        "description": "Navigate to TodoMVC demo"
      },
      {
        "action": "type",
        "selector": ".new-todo",
        "value": "Buy groceries",
        "description": "Add first todo item"
      },
      {
        "action": "type",
        "selector": ".new-todo",
        "value": "Walk the dog",
        "description": "Add second todo item"
      },
      {
        "action": "click",
        "selector": ".todo-list li:first-child .toggle",
        "description": "Mark first item as complete"
      },
      {
        "action": "screenshot",
        "description": "Take screenshot of completed state"
      }
    ],
    "assertions": [
      {
        "type": "exists",
        "selector": ".todo-list li",
        "description": "Todo items should exist"
      },
      {
        "type": "count",
        "selector": ".todo-list li",
        "expected": 2,
        "description": "Should have 2 todo items"
      },
      {
        "type": "exists",
        "selector": ".todo-list li.completed",
        "description": "Should have completed item"
      }
    ]
  }
}
```

## Agentic Test Example

```json
{
  "url_pattern": "example-ecommerce.com",
  "name": "E-commerce Purchase Flow",
  "test_type": "agentic",
  "instructions": {
    "goal": "Complete a purchase of a product on the e-commerce site",
    "context": "This is an e-commerce website where users can browse products, add them to cart, and checkout. Test as if you're a real customer wanting to buy a specific product.",
    "success_criteria": [
      "Product is successfully added to cart",
      "Cart shows correct item and quantity",
      "Checkout process completes without errors",
      "Order confirmation is displayed"
    ],
    "max_attempts": 3,
    "timeout_ms": 300000
  }
}
```

## API Usage Examples

### Create Configuration
```bash
curl -X POST https://your-worker.workers.dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "url_pattern": "*.example.com",
    "name": "Example Site Test",
    "test_type": "traditional",
    "instructions": "{\"name\":\"Basic Test\",\"steps\":[...],\"assertions\":[...]}"
  }'
```

### Run Traditional Test
```bash
curl -X POST https://your-worker.workers.dev/test/traditional \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://demo.playwright.dev/todomvc",
    "useStoredConfig": true
  }'
```

### Run Agentic Test
```bash
curl -X POST https://your-worker.workers.dev/test/agentic \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example-ecommerce.com",
    "config": {
      "goal": "Find and purchase a laptop",
      "context": "Browse the electronics section and add a laptop to cart",
      "success_criteria": ["Item added to cart", "Checkout initiated"],
      "max_attempts": 2
    }
  }'
```

### Get Session Results
```bash
curl https://your-worker.workers.dev/session/results?sessionId=session_123456789_abc
```
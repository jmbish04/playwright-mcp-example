import { TraditionalTestCase, TestStep, TestAssertion, TestExecutionResult } from './types';
import { Logger } from './logger';
import { DatabaseService } from './database';

export class TraditionalTestExecutor {
  private logger: Logger;
  private db: DatabaseService;
  private playwright: any;

  constructor(playwright: any, db: DatabaseService, logger: Logger) {
    this.playwright = playwright;
    this.db = db;
    this.logger = logger;
  }

  async executeTest(sessionId: string, testCase: TraditionalTestCase): Promise<TestExecutionResult> {
    const startTime = Date.now();
    const results: any[] = [];
    const logs: any[] = [];
    const screenshots: string[] = [];
    let success = true;

    await this.logger.logTestStart(testCase.name);

    try {
      // Execute test steps
      for (const step of testCase.steps) {
        try {
          await this.executeStep(step, screenshots);
          await this.db.saveTestResult({
            session_id: sessionId,
            test_name: `${testCase.name} - ${step.description}`,
            status: 'passed',
            execution_time_ms: Date.now() - startTime
          });
        } catch (error) {
          success = false;
          await this.db.saveTestResult({
            session_id: sessionId,
            test_name: `${testCase.name} - ${step.description}`,
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
            execution_time_ms: Date.now() - startTime
          });
          await this.logger.logError(error as Error, { step });
          throw error; // Stop execution on first failure
        }
      }

      // Execute assertions
      for (const assertion of testCase.assertions) {
        try {
          await this.executeAssertion(assertion);
          await this.db.saveTestResult({
            session_id: sessionId,
            test_name: `${testCase.name} - ${assertion.description}`,
            status: 'passed',
            execution_time_ms: Date.now() - startTime
          });
        } catch (error) {
          success = false;
          await this.db.saveTestResult({
            session_id: sessionId,
            test_name: `${testCase.name} - ${assertion.description}`,
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
            execution_time_ms: Date.now() - startTime
          });
          await this.logger.logError(error as Error, { assertion });
        }
      }

      const executionTime = Date.now() - startTime;
      await this.logger.logTestEnd(testCase.name, success ? 'passed' : 'failed', executionTime);

      return {
        session_id: sessionId,
        success,
        results,
        logs: await this.db.getActionLogs(sessionId),
        screenshots,
        execution_time_ms: executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.logger.logTestEnd(testCase.name, 'failed', executionTime);
      
      return {
        session_id: sessionId,
        success: false,
        results,
        logs: await this.db.getActionLogs(sessionId),
        screenshots,
        error_summary: error instanceof Error ? error.message : String(error),
        execution_time_ms: executionTime
      };
    }
  }

  private async executeStep(step: TestStep, screenshots: string[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      switch (step.action) {
        case 'navigate':
          if (!step.url) throw new Error('URL is required for navigate action');
          await this.logger.timedExecution('navigate', { url: step.url }, async () => {
            return await this.playwright.navigate(step.url!);
          });
          break;

        case 'click':
          if (!step.selector) throw new Error('Selector is required for click action');
          await this.logger.timedExecution('click', { selector: step.selector }, async () => {
            return await this.playwright.click(step.selector!);
          });
          break;

        case 'type':
          if (!step.selector || !step.value) {
            throw new Error('Selector and value are required for type action');
          }
          await this.logger.timedExecution('type', { selector: step.selector, value: step.value }, async () => {
            return await this.playwright.type(step.selector!, step.value!);
          });
          break;

        case 'select':
          if (!step.selector || !step.value) {
            throw new Error('Selector and value are required for select action');
          }
          await this.logger.timedExecution('select', { selector: step.selector, value: step.value }, async () => {
            return await this.playwright.selectOption(step.selector!, step.value!);
          });
          break;

        case 'wait':
          const timeout = step.timeout || 5000;
          await this.logger.timedExecution('wait', { timeout }, async () => {
            return await new Promise(resolve => setTimeout(resolve, timeout));
          });
          break;

        case 'screenshot':
          const screenshotPath = `screenshot_${Date.now()}.png`;
          await this.logger.timedExecution('screenshot', { path: screenshotPath }, async () => {
            const result = await this.playwright.takeScreenshot();
            screenshots.push(screenshotPath);
            return result;
          });
          break;

        case 'custom':
          // For custom actions, expect the step to have additional data
          await this.logger.logInfo(`Executing custom step: ${step.description}`, step);
          break;

        default:
          throw new Error(`Unknown action type: ${step.action}`);
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.logger.logError(error as Error, { step, executionTime });
      throw error;
    }
  }

  private async executeAssertion(assertion: TestAssertion): Promise<void> {
    const startTime = Date.now();
    
    try {
      switch (assertion.type) {
        case 'exists':
          if (!assertion.selector) throw new Error('Selector is required for exists assertion');
          await this.logger.timedExecution('assertion_exists', { selector: assertion.selector }, async () => {
            const exists = await this.checkElementExists(assertion.selector!);
            if (!exists) {
              throw new Error(`Element ${assertion.selector} does not exist`);
            }
            return { exists };
          });
          break;

        case 'visible':
          if (!assertion.selector) throw new Error('Selector is required for visible assertion');
          await this.logger.timedExecution('assertion_visible', { selector: assertion.selector }, async () => {
            const visible = await this.checkElementVisible(assertion.selector!);
            if (!visible) {
              throw new Error(`Element ${assertion.selector} is not visible`);
            }
            return { visible };
          });
          break;

        case 'text':
          if (!assertion.selector || assertion.expected === undefined) {
            throw new Error('Selector and expected text are required for text assertion');
          }
          await this.logger.timedExecution('assertion_text', { 
            selector: assertion.selector, 
            expected: assertion.expected 
          }, async () => {
            const actualText = await this.getElementText(assertion.selector!);
            if (actualText !== assertion.expected) {
              throw new Error(`Expected text "${assertion.expected}", got "${actualText}"`);
            }
            return { actualText, expected: assertion.expected };
          });
          break;

        case 'value':
          if (!assertion.selector || assertion.expected === undefined) {
            throw new Error('Selector and expected value are required for value assertion');
          }
          await this.logger.timedExecution('assertion_value', { 
            selector: assertion.selector, 
            expected: assertion.expected 
          }, async () => {
            const actualValue = await this.getElementValue(assertion.selector!);
            if (actualValue !== assertion.expected) {
              throw new Error(`Expected value "${assertion.expected}", got "${actualValue}"`);
            }
            return { actualValue, expected: assertion.expected };
          });
          break;

        case 'count':
          if (!assertion.selector || typeof assertion.expected !== 'number') {
            throw new Error('Selector and expected count (number) are required for count assertion');
          }
          await this.logger.timedExecution('assertion_count', { 
            selector: assertion.selector, 
            expected: assertion.expected 
          }, async () => {
            const actualCount = await this.getElementCount(assertion.selector!);
            if (actualCount !== assertion.expected) {
              throw new Error(`Expected ${assertion.expected} elements, found ${actualCount}`);
            }
            return { actualCount, expected: assertion.expected };
          });
          break;

        case 'custom':
          // For custom assertions, log the attempt
          await this.logger.logInfo(`Executing custom assertion: ${assertion.description}`, assertion);
          break;

        default:
          throw new Error(`Unknown assertion type: ${assertion.type}`);
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.logger.logError(error as Error, { assertion, executionTime });
      throw error;
    }
  }

  // Helper methods for assertions
  private async checkElementExists(selector: string): Promise<boolean> {
    try {
      // This would use actual playwright methods
      await this.playwright.snapshot();
      return true; // Placeholder
    } catch {
      return false;
    }
  }

  private async checkElementVisible(selector: string): Promise<boolean> {
    try {
      // This would use actual playwright methods
      await this.playwright.snapshot();
      return true; // Placeholder
    } catch {
      return false;
    }
  }

  private async getElementText(selector: string): Promise<string> {
    // This would use actual playwright methods
    await this.playwright.snapshot();
    return 'placeholder text';
  }

  private async getElementValue(selector: string): Promise<string> {
    // This would use actual playwright methods
    await this.playwright.snapshot();
    return 'placeholder value';
  }

  private async getElementCount(selector: string): Promise<number> {
    // This would use actual playwright methods
    await this.playwright.snapshot();
    return 1;
  }
}
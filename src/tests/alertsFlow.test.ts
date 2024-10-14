import { getMessage } from "../services/translate";
import { typing } from "../utils/presence";

// Mock dependencies
jest.mock("../services/translate");
jest.mock("../utils/presence");
jest.mock('../database/surreal', () => ({
    initDb: jest.fn().mockResolvedValue(undefined),
  }));

// Mock the entire module, but keep alertsFlow real
jest.mock('../flows/alertsFlow.flow', () => {
    const actualModule = jest.requireActual('../flows/alertsFlow.flow');
    return {
      ...actualModule,
      anomalyLiveQuery: jest.fn(),
      handleReaction: jest.fn().mockResolvedValue(undefined),
      processFeedback: jest.fn,
    };
  });
  
const alertsFlowModule = jest.requireActual('../flows/alertsFlow.flow');

describe('alertsFlow', () => {
    let mockProvider: any;
    let mockCtx: any;
    let action;
  
    beforeEach(() => {
        // Reset mocks and set up common test data
        jest.resetModules();
        jest.clearAllMocks();

        mockProvider = {
          sendText: jest.fn(),
          on: jest.fn(),
        };
        mockCtx = {
          key: { remoteJid: '120363323762193994@g.us' },
        };
        (getMessage as jest.Mock).mockImplementation((key) => `Mocked ${key} message`);

        // Try to find the action function
        action = findActionFunction(alertsFlowModule.alertsFlow);
        if (!action) {
          throw new Error('Could not find action function in alertsFlow');
        }
      });
  
      it('should send an alert activation message', async () => {        
        const result = await action(mockCtx, { provider: mockProvider });
      
        expect(typing).toHaveBeenCalled();
        expect(mockProvider.sendText).toHaveBeenCalledWith('120363323762193994@g.us', 'Mocked alerts_on message');
        expect(mockProvider.on).toHaveBeenCalledWith('reaction', expect.any(Function));
      });

      it('should send an alert activation message', async () => {
        const mockError = new Error('Test error');
        require('../flows/alertsFlow.flow').anomalyLiveQuery.mockRejectedValue(mockError);
        
        const result = await action(mockCtx, { provider: mockProvider });
      
        expect(typing).toHaveBeenCalled();
        expect(mockProvider.sendText).toHaveBeenCalledWith('120363323762193994@g.us', 'Mocked alerts_error message');
      });
  });
  
  function findActionFunction(obj: any): Function | null {
    if (typeof obj === 'function') {
      return obj;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (typeof obj[key] === 'function') {
          return obj[key];
        }
        const nestedResult = findActionFunction(obj[key]);
        if (nestedResult) {
          return nestedResult;
        }
      }
    }
    return null;
  }
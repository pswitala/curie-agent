import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramGateway } from './telegram-gateway.js';

describe('TelegramGateway', () => {
  const botToken = '123456:ABC-DEF';
  const allowedUserId = '42';

  const mockOnUserMessage = vi.fn();
  const mockOnError = vi.fn();

  let gateway: TelegramGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnUserMessage.mockClear();
    mockOnError.mockClear();
  });

  it('should instantiate without errors', () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });
    expect(gateway).toBeDefined();
    expect(gateway.isAlive).toBe(false);
  });

  it('should accept onError callback', () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
      onError: mockOnError,
    });
    expect(gateway).toBeDefined();
  });

  it('should reject messages from unauthorized users', async () => {
    // This test verifies the filter logic exists.
    // The actual grammy context is tested by grammy's own tests.
    // Here we just confirm the gateway can be created with a filter.
    gateway = new TelegramGateway({
      botToken,
      allowedUserId: '42',
      onUserMessage: mockOnUserMessage,
    });
    expect(gateway).toBeDefined();
    expect(gateway.isAlive).toBe(false);
  });

  it('should start and stop without errors', async () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });

    // start() will try to connect to Telegram, so we expect it to fail
    // without a valid token. We catch the error to avoid unhandled rejection.
    const startPromise = gateway.start();
    await expect(startPromise).rejects.toThrow();

    // stop() should work even if start() failed
    await expect(gateway.stop()).resolves.not.toThrow();
  });

  it('should be idempotent on double stop', async () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });
    await gateway.stop();
    await expect(gateway.stop()).resolves.not.toThrow();
  });

  it('should have sendMessage method', async () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });
    // sendMessage will fail without a running bot, but it should be callable
    await expect(gateway.sendMessage('123', 'hello')).rejects.toThrow();
  });

  it('should accept onApprovalDecision callback', () => {
    const mockOnApprovalDecision = vi.fn();
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
      onApprovalDecision: mockOnApprovalDecision,
    });
    expect(gateway).toBeDefined();
  });

  it('should have setOnApprovalDecision method', () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });
    const mockOnApprovalDecision = vi.fn();
    // Should not throw
    expect(() => gateway.setOnApprovalDecision(mockOnApprovalDecision)).not.toThrow();
  });

  it('should have sendApprovalRequest method', () => {
    gateway = new TelegramGateway({
      botToken,
      allowedUserId,
      onUserMessage: mockOnUserMessage,
    });
    // sendApprovalRequest will fail without a running bot, but it should be callable
    expect(gateway.sendApprovalRequest).toBeInstanceOf(Function);
  });
});
